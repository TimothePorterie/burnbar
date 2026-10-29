import { readdirSync, statSync } from 'fs'
import { homedir } from 'os'
import { join } from 'path'
import { CliNotFoundError, resolveCli, runCli } from './cli-path'
import { logger } from './logger'
import { settingsStore } from './settings-store'
import type { QuotaErrorState } from './quota-errors'
import { t } from '../../shared/i18n'
import type { ConsumptionInfo, ProviderStatus, QuotaError, UsageTotals } from '../../shared/types'

export type ConsumptionProvider = 'grok' | 'opencode'

const REFRESH_INTERVAL_MS = 15 * 60 * 1000
const CLI_TIMEOUT_MS = 20000
const SESSION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const TICKS_PER_USD = 1e10

interface GrokSession {
  updatedAt: number
  cost: number
  tokens: number
}

interface State {
  data: ConsumptionInfo | null
  error: QuotaErrorState | null
  status: ProviderStatus | null
}

const isObject = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object'
const count = (value: unknown): number | null => typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null

function parseJson(output: string): unknown {
  try {
    return JSON.parse(output)
  } catch {
    return undefined
  }
}

// Local midnight today, and six days before: the window of `opencode stats --days 7`
export function dayStarts(now = new Date()): { today: number; week: number } {
  return {
    today: new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime(),
    week: new Date(now.getFullYear(), now.getMonth(), now.getDate() - 6).getTime()
  }
}

// `grok usage <id>`: costUsdTicks are 1e-10 USD
export function parseGrokUsage(output: string): GrokSession | null {
  const data = parseJson(output)
  if (!isObject(data) || !isObject(data.session)) return null
  const updatedAt = typeof data.updatedAt === 'string' ? new Date(data.updatedAt).getTime() : NaN
  const tokens = count(data.session.totalTokens)
  const ticks = count(data.session.costUsdTicks)
  if (!Number.isFinite(updatedAt) || tokens === null || ticks === null) return null
  return { updatedAt, tokens, cost: ticks / TICKS_PER_USD }
}

// `opencode stats --json`: every token kind, cached ones included
export function parseOpenCodeStats(output: string): UsageTotals | null {
  const data = parseJson(output)
  if (!isObject(data) || !isObject(data.tokens) || !isObject(data.tokens.cache)) return null
  const { input, output: generated, reasoning } = data.tokens
  const parts = [input, generated, reasoning, data.tokens.cache.read, data.tokens.cache.write].map(count)
  const cost = count(data.cost)
  if (cost === null || parts.some(part => part === null)) return null
  return { cost, tokens: parts.reduce((sum: number, part) => sum + part!, 0) }
}

function mtime(path: string): number | null {
  try {
    return statSync(path).mtimeMs
  } catch {
    return null
  }
}

// Session directories under ~/.grok/sessions/<project>/<id>/: names and mtimes only, never their contents.
// `grok sessions list` only sees the current directory's sessions.
export function listGrokSessions(root: string, since: number): { id: string; key: string }[] {
  let projects: string[]
  try {
    projects = readdirSync(root)
  } catch {
    return []
  }
  const sessions = new Map<string, string>()
  for (const project of projects) {
    let ids: string[]
    try {
      ids = readdirSync(join(root, project))
    } catch {
      continue
    }
    for (const id of ids.filter(name => SESSION_ID.test(name))) {
      const dir = join(root, project, id)
      const modified = mtime(join(dir, 'usage.json')) ?? mtime(dir)
      if (modified !== null && modified >= since) sessions.set(id, `${id}:${modified}`)
    }
  }
  return [...sessions].map(([id, key]) => ({ id, key }))
}

// A session counts entirely on the day it was last updated
export function sumGrokSessions(sessions: Iterable<GrokSession>, now = new Date()): { today: UsageTotals; week: UsageTotals } {
  const starts = dayStarts(now)
  const today = { cost: 0, tokens: 0 }
  const week = { cost: 0, tokens: 0 }
  for (const session of sessions) {
    for (const [totals, start] of [[today, starts.today], [week, starts.week]] as const) {
      if (session.updatedAt < start) continue
      totals.cost += session.cost
      totals.tokens += session.tokens
    }
  }
  return { today, week }
}

export class ConsumptionService {
  private states: Record<ConsumptionProvider, State> = {
    grok: { data: null, error: null, status: null },
    opencode: { data: null, error: null, status: null }
  }
  private grokCache = new Map<string, GrokSession>()
  private lastRun = -Infinity
  private pending: Promise<void> | null = null
  private timer: NodeJS.Timeout | null = null
  private callbacks = new Set<() => void>()

  constructor(private grokRoot = join(homedir(), '.grok', 'sessions')) {}

  onRefresh(callback: () => void): void {
    this.callbacks.add(callback)
  }

  start(): void {
    if (this.timer) return
    void this.refresh()
    this.timer = setInterval(() => void this.refresh(), REFRESH_INTERVAL_MS)
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
  }

  // At most every 15 minutes; `force` is for a provider just switched on
  refresh(force = false): Promise<void> {
    if (this.pending) return this.pending
    const elapsed = Date.now() - this.lastRun
    if (!force && elapsed >= 0 && elapsed < REFRESH_INTERVAL_MS) return Promise.resolve()
    this.lastRun = Date.now()
    const enabled = settingsStore.get('providers')
    const providers = (['grok', 'opencode'] as const).filter(provider => enabled?.[provider])
    this.pending = Promise.all(providers.map(provider => this.refreshOne(provider))).then(() => {
      for (const callback of this.callbacks) callback()
    }).finally(() => { this.pending = null })
    return this.pending
  }

  getView(provider: ConsumptionProvider): { data: ConsumptionInfo | null; error: QuotaError | null; status: ProviderStatus | null } {
    const { data, error, status } = this.states[provider]
    return { data, status, error: error && { type: error.type, message: t(error.key), retryable: error.retryable } }
  }

  private async refreshOne(provider: ConsumptionProvider): Promise<void> {
    const state = this.states[provider]
    try {
      if (!(await resolveCli(provider))) throw new CliNotFoundError(provider)
      const { today, week, failed } = provider === 'grok' ? await this.readGrok() : await this.readOpenCode()
      state.data = { today, week, lastUpdated: new Date() }
      state.status = 'installed'
      state.error = failed ? { type: 'unknown', key: `${provider}.failed`, retryable: true } : null
      logger.info(`${provider} usage: today $${today.cost.toFixed(2)}, 7d $${week.cost.toFixed(2)}, ${week.tokens} tokens${failed ? `, ${failed} sessions unreadable` : ''}`)
    } catch (error) {
      if (error instanceof CliNotFoundError) {
        state.data = null
        state.status = 'not-installed'
        state.error = { type: 'unknown', key: `${provider}.notInstalled`, retryable: false }
        return
      }
      logger.error(`Failed to read ${provider} usage:`, error instanceof Error ? error.message : error)
      state.status = 'error'
      state.error = { type: 'unknown', key: `${provider}.failed`, retryable: true }
    }
  }

  // Only sessions changed since the last run are read again
  private async readGrok(): Promise<{ today: UsageTotals; week: UsageTotals; failed: number }> {
    const sessions = listGrokSessions(this.grokRoot, dayStarts().week)
    const next = new Map<string, GrokSession>()
    let failed = 0
    for (const { id, key } of sessions) {
      let usage = this.grokCache.get(key)
      if (!usage) {
        try {
          usage = parseGrokUsage(await runCli('grok', ['usage', id], CLI_TIMEOUT_MS)) ?? undefined
        } catch (error) {
          if (error instanceof CliNotFoundError) throw error
          logger.debug(`grok usage ${id} failed:`, error instanceof Error ? error.message : error)
        }
      }
      if (usage) next.set(key, usage)
      else failed++
    }
    this.grokCache = next
    return { ...sumGrokSessions(next.values()), failed }
  }

  // --standalone: the default mode leaves a background `opencode serve --service` running
  private async readOpenCode(): Promise<{ today: UsageTotals; week: UsageTotals; failed: number }> {
    const read = async (days: string): Promise<UsageTotals> => {
      const totals = parseOpenCodeStats(await runCli('opencode', ['stats', '--json', '--days', days, '--standalone'], CLI_TIMEOUT_MS))
      if (!totals) throw new Error('unexpected opencode stats output')
      return totals
    }
    return { today: await read('0'), week: await read('7'), failed: 0 }
  }
}

export const consumptionService = new ConsumptionService()
