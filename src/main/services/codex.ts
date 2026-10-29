import { app } from 'electron'
import { spawn } from 'child_process'
import { cliEnv, resolveCli } from './cli-path'
import { logger } from './logger'
import { settingsStore } from './settings-store'
import { buildPeriod } from './quota-api'
import type { QuotaErrorState } from './quota-errors'
import { t } from '../../shared/i18n'
import { IDLE_REFRESH_MAX_AGE_MS } from '../../shared/quota'
import type { CodexQuota, ProviderStatus, QuotaError } from '../../shared/types'

const TIMEOUT_MS = 20000
const MIN_FETCH_INTERVAL_MS = 290000
const MIN_FORCE_INTERVAL_MS = 15000

const PLANS: Record<string, string> = {
  free: 'Free', go: 'Go', plus: 'Plus', pro: 'Pro', prolite: 'Pro Lite', promax: 'Pro Max',
  team: 'Team', business: 'Business', enterprise: 'Enterprise', edu: 'Edu'
}

interface Window {
  utilization: number
  resetsAt: Date
  hours: number
}

interface CodexData {
  fiveHour?: Window
  sevenDay?: Window
  plan?: string
  resetsAvailable: number
  limitReached: boolean
  lastUpdated: Date
}

export class CodexRpcError extends Error {}

const isObject = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object'
const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value)

// `account/rateLimits/read` result (schema: v2/GetAccountRateLimitsResponse.json)
export function parseRateLimits(result: unknown): Omit<CodexData, 'lastUpdated'> | null {
  if (!isObject(result) || !isObject(result.rateLimits)) return null
  const limits = result.rateLimits
  const data: Omit<CodexData, 'lastUpdated'> = {
    resetsAvailable: 0,
    limitReached: limits.rateLimitReachedType != null || limits.spendControlReached === true
  }
  for (const [raw, defaultMins] of [[limits.primary, 300], [limits.secondary, 10080]] as const) {
    if (raw == null) continue
    if (!isObject(raw) || !finite(raw.usedPercent)) return null
    const mins = finite(raw.windowDurationMins) && raw.windowDurationMins > 0 ? raw.windowDurationMins : defaultMins
    const window = { utilization: raw.usedPercent, resetsAt: new Date(finite(raw.resetsAt) ? raw.resetsAt * 1000 : NaN), hours: mins / 60 }
    const slot = window.hours <= 24 ? 'fiveHour' : 'sevenDay'
    data[slot] ??= window
  }
  if (typeof limits.planType === 'string' && PLANS[limits.planType]) data.plan = PLANS[limits.planType]
  const count = isObject(result.rateLimitResetCredits) ? result.rateLimitResetCredits.availableCount : 0
  if (finite(count) && count > 0) data.resetsAvailable = Math.floor(count)
  return data
}

export function classifyCodexError(error: unknown): QuotaErrorState {
  if (error instanceof CodexRpcError) {
    if (/auth|log ?in|sign ?in/i.test(error.message)) return { type: 'auth', key: 'codex.notConnected', retryable: false }
    if (/network|connect|dns|timed? ?out|request/i.test(error.message)) return { type: 'network', key: 'codex.network', retryable: true }
  }
  if (error instanceof Error && error.message === 'timeout') return { type: 'network', key: 'codex.timeout', retryable: true }
  return { type: 'unknown', key: 'codex.failed', retryable: true }
}

// One short-lived `codex app-server`: initialize, read the limits, kill it
export function readRateLimits(bin: string, env: NodeJS.ProcessEnv, version: string): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, ['app-server'], { env, stdio: ['pipe', 'pipe', 'ignore'] })
    let done = false
    let buffer = ''
    const finish = (error: Error | null, result?: unknown): void => {
      if (done) return
      done = true
      clearTimeout(timer)
      child.kill()
      if (error) reject(error)
      else resolve(result)
    }
    const timer = setTimeout(() => finish(new Error('timeout')), TIMEOUT_MS)
    child.on('error', error => finish(error))
    child.on('exit', code => finish(new Error(`codex app-server exited (${code})`)))
    child.stdin.on('error', () => {})
    child.stdout.on('data', (chunk: Buffer) => {
      buffer += chunk.toString()
      let newline: number
      while ((newline = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, newline)
        buffer = buffer.slice(newline + 1)
        let message: { id?: unknown; result?: unknown; error?: { message?: unknown } }
        try {
          message = JSON.parse(line)
        } catch {
          continue
        }
        if ((message.id === 1 || message.id === 2) && message.error) {
          finish(new CodexRpcError(String(message.error.message ?? 'JSON-RPC error')))
        } else if (message.id === 2) {
          finish(null, message.result)
        }
      }
    })
    child.stdin.write([
      { jsonrpc: '2.0', id: 1, method: 'initialize', params: { clientInfo: { name: 'burnbar', version } } },
      { jsonrpc: '2.0', method: 'initialized' },
      { jsonrpc: '2.0', id: 2, method: 'account/rateLimits/read', params: null }
    ].map(message => JSON.stringify(message) + '\n').join(''))
  })
}

export class CodexService {
  private cached: CodexData | null = null
  private lastError: QuotaErrorState | null = null
  private lastFetchTime = 0
  private pending: Promise<CodexQuota | null> | null = null
  private throttled = false
  status: ProviderStatus | null = null
  // Set by the scheduler, as for Claude
  nextRetryAt = 0
  idlePaused = false

  async fetchQuota(force = false): Promise<CodexQuota | null> {
    if (this.pending) {
      this.throttled = false
      return this.pending
    }
    const elapsed = Date.now() - this.lastFetchTime
    if (this.cached && elapsed >= 0 && elapsed < (force ? MIN_FORCE_INTERVAL_MS : MIN_FETCH_INTERVAL_MS)) {
      this.throttled = true
      return this.getCachedQuota()
    }
    this.throttled = false
    this.pending = this.doFetch().finally(() => { this.pending = null })
    return this.pending
  }

  private async doFetch(): Promise<CodexQuota | null> {
    const startedAt = Date.now()
    try {
      const bin = await resolveCli('codex')
      if (!bin) {
        this.fail('not-installed', { type: 'unknown', key: 'codex.notInstalled', retryable: false })
        return null
      }
      const data = parseRateLimits(await readRateLimits(bin, await cliEnv(), app.getVersion()))
      if (!data) {
        logger.error('Unexpected Codex rate limits response')
        this.fail('error', { type: 'unknown', key: 'codex.failed', retryable: true })
        return this.getCachedQuota()
      }
      this.cached = { ...data, lastUpdated: new Date() }
      this.lastFetchTime = startedAt
      this.lastError = null
      this.status = 'connected'
      logger.info(`Codex limits read: 5h=${Math.round(data.fiveHour?.utilization ?? 0)}%, 7d=${Math.round(data.sevenDay?.utilization ?? 0)}%`)
    } catch (error) {
      logger.error('Failed to read Codex limits:', error instanceof Error ? error.message : error)
      const state = classifyCodexError(error)
      this.fail(state.type === 'auth' ? 'not-connected' : 'error', state)
    }
    return this.getCachedQuota()
  }

  // Signed out or uninstalled: the previous data no longer describes this machine
  private fail(status: ProviderStatus, error: QuotaErrorState): void {
    this.status = status
    this.lastError = error
    if (status !== 'error') this.cached = null
  }

  wasThrottled(): boolean {
    return this.throttled
  }

  getRateLimitRemainingMs(): number {
    return 0
  }

  getLastError(): QuotaError | null {
    if (!this.lastError) return null
    const { type, key, retryable } = this.lastError
    return { type, message: t(key), retryable, ...(this.nextRetryAt > Date.now() ? { retryAt: this.nextRetryAt } : {}) }
  }

  getCachedQuota(): CodexQuota | null {
    if (!this.cached) return null
    const { fiveHour, sevenDay, ...rest } = this.cached
    const intervalMs = settingsStore.get('refreshInterval') * 1000
    const staleAfterMs = this.idlePaused ? IDLE_REFRESH_MAX_AGE_MS + intervalMs : 2 * intervalMs
    const period = (window: Window | undefined) => window && buildPeriod(window.utilization, window.resetsAt, window.hours)
    return {
      ...rest,
      fiveHour: period(fiveHour),
      sevenDay: period(sevenDay),
      error: this.getLastError() ?? undefined,
      stale: Date.now() - this.cached.lastUpdated.getTime() > staleAfterMs
    }
  }
}

export const codexService = new CodexService()
