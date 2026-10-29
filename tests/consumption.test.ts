import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { setLocale } from '../src/shared/i18n'

const mocks = vi.hoisted(() => ({
  installed: new Set<string>(),
  enabled: { grok: true, opencode: true } as Record<string, boolean>,
  run: vi.fn<(name: string, args: string[]) => Promise<string>>()
}))
vi.mock('../src/main/services/logger', () => ({ logger: { info: vi.fn(), error: vi.fn(), debug: vi.fn() } }))
vi.mock('../src/main/services/settings-store', () => ({ settingsStore: { get: () => mocks.enabled } }))
vi.mock('../src/main/services/cli-path', async () => {
  class CliNotFoundError extends Error {}
  return {
    CliNotFoundError,
    resolveCli: async (name: string) => mocks.installed.has(name) ? `/bin/${name}` : null,
    runCli: (name: string, args: string[]) => mocks.run(name, args)
  }
})

const { ConsumptionService, dayStarts, listGrokSessions, parseGrokUsage, parseOpenCodeStats, sumGrokSessions } =
  await import('../src/main/services/consumption')

const ID_A = '01a1871c-5b6d-7b21-a6e6-23b5c5e35866'
const ID_B = '01a1839f-6757-7242-9d15-f15df79b8fef'
const NOW = new Date(2026, 9, 29, 12, 0)

// Real `grok usage <id>` output, without the per-turn details
const grokUsage = (id: string, updatedAt: string, ticks = 16872340000, tokens = 2319359): string => JSON.stringify({
  sessionId: id, updatedAt,
  session: { inputTokens: 2281646, outputTokens: 37713, totalTokens: tokens, modelCalls: 25, costUsdTicks: ticks, primaryModelId: 'grok-4.7-build' },
  turns: []
})
const openCodeStats = (cost: number, input: number): string => JSON.stringify({
  sessions: 3, prompts: 3, tokens: { input, output: 182, reasoning: 51, cache: { read: 1536, write: 0 } }, cost, models: []
})

let root: string
const addSession = (project: string, id: string, modified = NOW): void => {
  mkdirSync(join(root, project, id), { recursive: true })
  writeFileSync(join(root, project, id, 'usage.json'), '{}')
  utimesSync(join(root, project, id, 'usage.json'), modified, modified)
}

beforeEach(() => {
  vi.useFakeTimers({ now: NOW, toFake: ['Date'] })
  root = mkdtempSync(join(tmpdir(), 'burnbar-grok-'))
  mocks.installed = new Set(['grok', 'opencode'])
  mocks.enabled = { grok: true, opencode: true }
  mocks.run.mockReset()
  setLocale('en')
})

afterEach(() => {
  vi.useRealTimers()
  rmSync(root, { recursive: true, force: true })
})

describe('parsing', () => {
  it('converts Grok cost ticks to dollars', () => {
    expect(parseGrokUsage(grokUsage(ID_A, '2026-10-29T10:10:44.494363121+00:00'))).toEqual({
      updatedAt: new Date('2026-10-29T10:10:44.494Z').getTime(), tokens: 2319359, cost: 1.687234
    })
  })

  it.each(['', '{', '{"session":{}}', JSON.stringify({ updatedAt: 'x', session: { totalTokens: 1, costUsdTicks: 1 } }),
    JSON.stringify({ updatedAt: '2026-10-29T10:00:00Z', session: { totalTokens: -1, costUsdTicks: 1 } })])(
    'rejects invalid Grok output %#', (output) => {
      expect(parseGrokUsage(output)).toBeNull()
    })

  it('sums every OpenCode token kind', () => {
    expect(parseOpenCodeStats(openCodeStats(0, 16698))).toEqual({ cost: 0, tokens: 16698 + 182 + 51 + 1536 })
    expect(parseOpenCodeStats('{"tokens":{"input":1}}')).toBeNull()
    expect(parseOpenCodeStats(JSON.stringify({ tokens: { input: 1, output: 1, reasoning: 1, cache: { read: 1, write: 1 } }, cost: NaN }))).toBeNull()
  })
})

describe('Grok aggregation', () => {
  it('counts a session on the local day it was last updated', () => {
    const at = (day: number, hour: number): number => new Date(2026, 9, day, hour).getTime()
    const totals = sumGrokSessions([
      { updatedAt: at(29, 9), cost: 1, tokens: 10 },
      { updatedAt: at(23, 0), cost: 2, tokens: 20 },
      { updatedAt: at(22, 23), cost: 4, tokens: 40 }
    ], NOW)
    expect(totals).toEqual({ today: { cost: 1, tokens: 10 }, week: { cost: 3, tokens: 30 } })
    expect(dayStarts(NOW)).toEqual({ today: at(29, 0), week: at(23, 0) })
  })

  it('lists session directories of every project, recent ones only', () => {
    addSession('%2Fhome%2Fme', ID_A)
    addSession('%2Fgone%2Fworktree', ID_B, new Date(2026, 9, 1))
    writeFileSync(join(root, '%2Fhome%2Fme', 'prompt_history.jsonl'), '')
    mkdirSync(join(root, '%2Fhome%2Fme', 'terminal'))
    writeFileSync(join(root, 'stray-file'), '')
    expect(listGrokSessions(root, dayStarts(NOW).week)).toEqual([{ id: ID_A, key: `${ID_A}:${NOW.getTime()}` }])
    expect(listGrokSessions(join(root, 'missing'), 0)).toEqual([])
  })
})

describe('ConsumptionService', () => {
  const service = (): InstanceType<typeof ConsumptionService> => new ConsumptionService(root)
  const answer = (): void => {
    mocks.run.mockImplementation(async (name, args) => {
      if (name === 'opencode') return openCodeStats(args.includes('0') ? 0 : 0.5, args.includes('0') ? 100 : 16698)
      return grokUsage(args[1], args[1] === ID_A ? '2026-10-29T09:00:00Z' : '2026-10-25T09:00:00Z')
    })
  }

  it('aggregates both tools and reads only changed Grok sessions again', async () => {
    addSession('p1', ID_A)
    addSession('p2', ID_B)
    answer()
    const consumption = service()
    await consumption.refresh()
    expect(consumption.getView('grok')).toMatchObject({
      status: 'installed', error: null,
      data: { today: { cost: 1.687234, tokens: 2319359 }, week: { cost: 2 * 1.687234, tokens: 2 * 2319359 } }
    })
    expect(consumption.getView('opencode').data).toMatchObject({ today: { cost: 0 }, week: { cost: 0.5, tokens: 16698 + 1769 } })
    expect(mocks.run).toHaveBeenCalledWith('opencode', ['stats', '--json', '--days', '7', '--standalone'])

    mocks.run.mockClear()
    await consumption.refresh(true)
    expect(mocks.run.mock.calls.filter(([name]) => name === 'grok')).toHaveLength(0)

    addSession('p1', ID_A, new Date(NOW.getTime() + 60000))
    await consumption.refresh(true)
    expect(mocks.run.mock.calls.filter(([name]) => name === 'grok')).toEqual([['grok', ['usage', ID_A]]])
  })

  it('refreshes at most every 15 minutes unless forced', async () => {
    answer()
    const consumption = service()
    await consumption.refresh()
    const calls = mocks.run.mock.calls.length
    vi.setSystemTime(new Date(NOW.getTime() + 14 * 60000))
    await consumption.refresh()
    expect(mocks.run.mock.calls.length).toBe(calls)
    vi.setSystemTime(new Date(NOW.getTime() + 15 * 60000))
    await consumption.refresh()
    expect(mocks.run.mock.calls.length).toBeGreaterThan(calls)
  })

  it('isolates a missing Grok from a working OpenCode', async () => {
    mocks.installed.delete('grok')
    addSession('p1', ID_A)
    answer()
    const consumption = service()
    await consumption.refresh()
    expect(consumption.getView('grok')).toMatchObject({
      data: null, status: 'not-installed', error: { message: 'Grok CLI not found. Install it, or turn Grok off in Settings.' }
    })
    expect(consumption.getView('opencode')).toMatchObject({ status: 'installed', error: null })
  })

  it('keeps the previous totals with a warning when a tool fails', async () => {
    answer()
    const consumption = service()
    await consumption.refresh()
    mocks.run.mockRejectedValue(new Error('boom'))
    await consumption.refresh(true)
    expect(consumption.getView('opencode')).toMatchObject({
      status: 'error', data: { week: { cost: 0.5 } }, error: { message: 'Couldn’t read OpenCode usage.' }
    })
  })

  it('counts unreadable Grok sessions as a partial result', async () => {
    addSession('p1', ID_A)
    addSession('p2', ID_B)
    mocks.run.mockImplementation(async (name, args) => args[1] === ID_A ? grokUsage(ID_A, '2026-10-29T09:00:00Z') : 'garbage')
    mocks.enabled = { grok: true, opencode: false }
    const consumption = service()
    await consumption.refresh()
    expect(consumption.getView('grok')).toMatchObject({ data: { week: { tokens: 2319359 } }, error: { message: expect.stringMatching(/incomplete/) } })
    expect(mocks.run.mock.calls.every(([name]) => name === 'grok')).toBe(true)
  })
})
