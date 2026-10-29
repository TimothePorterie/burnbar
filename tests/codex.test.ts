import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { setLocale } from '../src/shared/i18n'

const mocks = vi.hoisted(() => ({ bin: null as string | null }))
vi.mock('electron', () => ({ app: { getVersion: () => '1.8.0', getPath: () => '/tmp' } }))
vi.mock('../src/main/services/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }))
vi.mock('../src/main/services/settings-store', () => ({
  settingsStore: { get: (key: string) => key === 'refreshInterval' ? 300 : key === 'rateLimitedUntil' ? 0 : null, set: vi.fn() }
}))
vi.mock('../src/main/services/status', () => ({ statusService: {} }))
vi.mock('../src/main/services/keychain', () => ({ keychainService: {} }))
vi.mock('../src/main/services/cli-path', () => ({
  resolveCli: async () => mocks.bin,
  cliEnv: async () => process.env
}))

const { CodexService, classifyCodexError, parseRateLimits, readRateLimits, CodexRpcError } = await import('../src/main/services/codex')

// Real `account/rateLimits/read` result, trimmed
const NOW_S = Math.floor(new Date('2026-10-29T12:00:00Z').getTime() / 1000)
const REAL = {
  ordinaryUsageAllowed: true,
  rateLimits: {
    limitId: 'codex',
    primary: { usedPercent: 22, windowDurationMins: 300, resetsAt: NOW_S + 3 * 3600 },
    secondary: { usedPercent: 12, windowDurationMins: 10080, resetsAt: NOW_S + 5 * 86400 },
    credits: { hasCredits: true, unlimited: false, balance: null },
    spendControlReached: false,
    planType: 'team',
    rateLimitReachedType: null
  },
  rateLimitsByLimitId: {},
  rateLimitResetCredits: { availableCount: 2, credits: [] }
}

let dir: string
const fakeCodex = (lines: string[], extra = 'exec sleep 30'): string => {
  const bin = join(dir, 'codex')
  writeFileSync(bin, `#!/bin/sh\nread a\nread b\nread c\n${lines.map(line => `echo '${line}'`).join('\n')}\n${extra}\n`)
  chmodSync(bin, 0o755)
  return bin
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'burnbar-codex-'))
  mocks.bin = null
  setLocale('en')
  vi.useFakeTimers({ now: new Date('2026-10-29T12:00:00Z'), toFake: ['Date'] })
})

afterEach(() => {
  vi.useRealTimers()
  rmSync(dir, { recursive: true, force: true })
})

describe('parseRateLimits', () => {
  it('maps the real response to session, weekly, plan and reset credits', () => {
    const data = parseRateLimits(REAL)!
    expect(data.fiveHour).toMatchObject({ utilization: 22, hours: 5 })
    expect(data.fiveHour!.resetsAt.getTime()).toBe((NOW_S + 3 * 3600) * 1000)
    expect(data.sevenDay).toMatchObject({ utilization: 12, hours: 168 })
    expect(data).toMatchObject({ plan: 'Team', resetsAvailable: 2, limitReached: false })
  })

  it('keeps missing windows absent and flags a reached limit', () => {
    const data = parseRateLimits({ rateLimits: { primary: null, secondary: { usedPercent: 100 }, rateLimitReachedType: 'rate_limit_reached', planType: 'unknown' } })!
    expect(data.fiveHour).toBeUndefined()
    expect(data.sevenDay!.hours).toBe(168)
    expect(Number.isNaN(data.sevenDay!.resetsAt.getTime())).toBe(true)
    expect(data.plan).toBeUndefined()
    expect(data).toMatchObject({ resetsAvailable: 0, limitReached: true })
  })

  it.each([null, {}, { rateLimits: null }, { rateLimits: { primary: { usedPercent: 'x' } } }, { rateLimits: { primary: { usedPercent: NaN } } }])(
    'rejects an invalid result %#', (result) => {
      expect(parseRateLimits(result)).toBeNull()
    })
})

describe('classifyCodexError', () => {
  it('asks to log in when Codex is signed out', () => {
    expect(classifyCodexError(new CodexRpcError('codex account authentication required to read rate limits')))
      .toEqual({ type: 'auth', key: 'codex.notConnected', retryable: false })
  })

  it('separates timeouts and other failures', () => {
    expect(classifyCodexError(new Error('timeout')).key).toBe('codex.timeout')
    expect(classifyCodexError(new Error('codex app-server exited (1)')).key).toBe('codex.failed')
  })
})

describe('readRateLimits', () => {
  it('initializes, reads the limits and stops the server', async () => {
    const bin = fakeCodex(['{"id":1,"result":{}}', '{"method":"configWarning","params":{}}', 'not json', JSON.stringify({ id: 2, result: REAL })])
    await expect(readRateLimits(bin, process.env, '1.8.0')).resolves.toEqual(REAL)
  })

  it('rejects with the JSON-RPC error of a signed-out Codex', async () => {
    const bin = fakeCodex(['{"error":{"code":-32600,"message":"codex account authentication required to read rate limits"},"id":2}'])
    const error = await readRateLimits(bin, process.env, '1.8.0').catch(e => e)
    expect(error).toBeInstanceOf(CodexRpcError)
    expect(classifyCodexError(error).key).toBe('codex.notConnected')
  })

  it('rejects when the server exits without answering', async () => {
    const bin = fakeCodex([], 'exit 3')
    await expect(readRateLimits(bin, process.env, '1.8.0')).rejects.toThrow('exited')
  })

  it('times out after 20 s and kills the server', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const bin = fakeCodex([])
    const pending = readRateLimits(bin, process.env, '1.8.0').catch(e => e)
    vi.advanceTimersByTime(20000)
    expect((await pending).message).toBe('timeout')
  })
})

describe('CodexService', () => {
  it('reports a missing Codex without data or NaN', async () => {
    const service = new CodexService()
    await expect(service.fetchQuota(true)).resolves.toBeNull()
    expect(service.status).toBe('not-installed')
    expect(service.getLastError()).toMatchObject({ message: 'Codex CLI not found. Install it, or turn Codex off in Settings.', retryable: false })
  })

  it('keeps the last data on a transient failure and drops it when signed out', async () => {
    const service = new CodexService()
    mocks.bin = fakeCodex([JSON.stringify({ id: 2, result: REAL })])
    const quota = (await service.fetchQuota(true))!
    expect(quota).toMatchObject({ plan: 'Team', resetsAvailable: 2, stale: false })
    expect(quota.fiveHour).toMatchObject({ utilization: 22, resetsIn: '3h 0m' })
    expect(service.status).toBe('connected')

    vi.setSystemTime(new Date('2026-10-29T12:06:00Z'))
    mocks.bin = fakeCodex(['{"id":2,"result":{"rateLimits":{"primary":{"usedPercent":"?"}}}}'])
    const cached = (await service.fetchQuota(false))!
    expect(cached.fiveHour!.utilization).toBe(22)
    expect(cached.error?.message).toMatch(/Couldn.t read Codex limits/)

    vi.setSystemTime(new Date('2026-10-29T12:12:00Z'))
    mocks.bin = fakeCodex(['{"error":{"message":"authentication required"},"id":2}'])
    await expect(service.fetchQuota(false)).resolves.toBeNull()
    expect(service.status).toBe('not-connected')
    expect(service.getLastError()?.message).toBe('Codex is not signed in. Run `codex login` in a terminal.')
  })

  it('throttles scheduled reads for about five minutes', async () => {
    const service = new CodexService()
    mocks.bin = fakeCodex([JSON.stringify({ id: 2, result: REAL })])
    await service.fetchQuota(true)
    mocks.bin = null
    await service.fetchQuota(false)
    expect(service.wasThrottled()).toBe(true)
    expect(service.status).toBe('connected')
  })
})
