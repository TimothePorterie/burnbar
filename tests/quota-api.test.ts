import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const store: Record<string, unknown> = {}
vi.mock('../src/main/services/settings-store', () => ({
  settingsStore: {
    get: (key: string) => store[key],
    set: (key: string, value: unknown) => { store[key] = value }
  }
}))
vi.mock('../src/main/services/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }
}))
const keychain = { getCredentials: vi.fn(), isTokenExpired: vi.fn() }
vi.mock('../src/main/services/keychain', () => ({ keychainService: keychain }))
vi.mock('../src/main/services/auth', () => ({
  authService: { getValidAccessToken: vi.fn(), refreshTokens: vi.fn(), getUserInfo: vi.fn() }
}))

const { QuotaService, isValidUsageResponse, formatTimeUntil, calculateResetProgress } = await import(
  '../src/main/services/quota-api'
)

const HOUR = 60 * 60 * 1000
const usage = (overrides: Record<string, unknown> = {}) => ({
  five_hour: { utilization: 45, resets_at: new Date(Date.now() + 2 * HOUR).toISOString() },
  seven_day: { utilization: 32, resets_at: new Date(Date.now() + 48 * HOUR).toISOString() },
  ...overrides
})
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status })
const fetchMock = vi.fn()

beforeEach(() => {
  for (const key of Object.keys(store)) delete store[key]
  Object.assign(store, { authMode: 'cli', rateLimitedUntil: 0, lastQuotaData: null })
  keychain.getCredentials.mockReset().mockResolvedValue({ accessToken: 'token-a' })
  keychain.isTokenExpired.mockReset().mockReturnValue(false)
  fetchMock.mockReset()
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('pure helpers', () => {
  it('accepts null resets_at (no active session window)', () => {
    expect(isValidUsageResponse(usage({ five_hour: { utilization: 0, resets_at: null } }))).toBe(true)
    expect(isValidUsageResponse(usage({ five_hour: { resets_at: null } }))).toBe(false)
  })

  it('formats time until reset', () => {
    expect(formatTimeUntil(new Date(NaN))).toBe('—')
    expect(formatTimeUntil(new Date(Date.now() - 1000))).toBe('Now')
    expect(formatTimeUntil(new Date(Date.now() + 2.5 * HOUR + 30_000))).toBe('2h 30m')
    expect(formatTimeUntil(new Date(Date.now() + 53 * HOUR + 30_000))).toBe('2d 5h')
  })

  it('computes reset progress', () => {
    expect(calculateResetProgress(new Date(NaN), 5)).toBe(0)
    expect(calculateResetProgress(new Date(Date.now() + 2.5 * HOUR), 5)).toBe(50)
  })
})

describe('QuotaService', () => {
  it('classifies a native request timeout as a retryable network error', async () => {
    fetchMock.mockRejectedValueOnce(new DOMException('timed out', 'TimeoutError'))
    const service = new QuotaService()
    expect(await service.fetchQuota(true)).toBeNull()
    expect(service.getLastError()).toMatchObject({ type: 'network', retryable: true })
    expect(fetchMock.mock.calls[0][1].signal).toBeInstanceOf(AbortSignal)
  })

  it('parses a response with null resets_at', async () => {
    fetchMock.mockResolvedValueOnce(json(usage({ five_hour: { utilization: 0, resets_at: null } })))
    const quota = await new QuotaService().fetchQuota(true)
    expect(quota?.fiveHour.resetsIn).toBe('—')
    expect(quota?.sevenDay.utilization).toBe(32)
  })

  it('ignores extra_usage with an invalid currency', async () => {
    fetchMock.mockResolvedValueOnce(
      json(usage({ extra_usage: { is_enabled: true, used_credits: 100, monthly_limit: 0, currency: null } }))
    )
    const quota = await new QuotaService().fetchQuota(true)
    expect(quota?.extraUsage).toBeUndefined()
  })

  it('CLI mode: expired Keychain token is reported without calling the API', async () => {
    keychain.isTokenExpired.mockReturnValue(true)
    const service = new QuotaService()
    expect(await service.fetchQuota(true)).toBeNull()
    expect(fetchMock).not.toHaveBeenCalled()
    expect(service.getLastError()).toMatchObject({ type: 'auth', retryable: true })
  })

  it('CLI mode: 401 re-reads the Keychain and never hits a refresh endpoint', async () => {
    fetchMock.mockResolvedValueOnce(json({}, 401))
    const service = new QuotaService()
    expect(await service.fetchQuota(true)).toBeNull()
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(keychain.getCredentials).toHaveBeenCalledTimes(2)
    expect(service.getLastError()?.type).toBe('auth')
  })

  it('CLI mode: 401 retries with the token Claude Code rotated', async () => {
    keychain.getCredentials
      .mockResolvedValueOnce({ accessToken: 'token-a' })
      .mockResolvedValueOnce({ accessToken: 'token-b' })
    fetchMock.mockResolvedValueOnce(json({}, 401)).mockResolvedValueOnce(json(usage()))
    const quota = await new QuotaService().fetchQuota(true)
    expect(quota?.fiveHour.utilization).toBe(45)
    expect(fetchMock.mock.calls[1][1].headers.Authorization).toBe('Bearer token-b')
  })

  it('surfaces the last error alongside cached data', async () => {
    fetchMock.mockResolvedValueOnce(json(usage())).mockResolvedValueOnce(json({}, 500))
    const service = new QuotaService()
    await service.fetchQuota(true)
    vi.useFakeTimers({ now: Date.now() + 20_000 })
    await service.fetchQuota(true)
    expect(service.getCachedQuota()?.error?.type).toBe('server')
  })

  it('does not throttle a scheduled fetch exactly one interval after the previous one', async () => {
    fetchMock.mockImplementation(async () => json(usage()))
    const service = new QuotaService()
    vi.useFakeTimers({ now: Date.now() })
    await service.fetchQuota()
    // setInterval ticks from the request start; the response lands a bit later
    vi.setSystemTime(Date.now() + 300_000 - 500)
    await service.fetchQuota()
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('shows a rate-limit error when a restored cooldown has nothing cached', async () => {
    store.rateLimitedUntil = Date.now() + 60_000
    const service = new QuotaService()
    expect(await service.fetchQuota(true)).toBeNull()
    expect(service.getLastError()?.type).toBe('rate_limit')
  })

  it('resetForAccountChange() forgets cached and persisted quota and notified levels', async () => {
    fetchMock.mockResolvedValueOnce(json(usage()))
    store.notifiedLevels = { fiveHour: 'warning' }
    const service = new QuotaService()
    await service.fetchQuota(true)
    expect(store.lastQuotaData).not.toBeNull()
    service.resetForAccountChange()
    expect(service.getCachedQuota()).toBeNull()
    expect(store.lastQuotaData).toBeNull()
    expect(store.notifiedLevels).toEqual({})
  })

  it('drops a response that lands after an account change', async () => {
    let respond!: (r: Response) => void
    fetchMock.mockReturnValueOnce(new Promise((resolve) => { respond = resolve }))
    const service = new QuotaService()
    const inFlight = service.fetchQuota(true)
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalled())
    service.resetForAccountChange()
    respond(json(usage()))
    await inFlight
    expect(service.getCachedQuota()).toBeNull()
  })

  it('shows 0% for a period whose reset time has passed, and flags stale data', async () => {
    store.refreshInterval = 300
    fetchMock.mockResolvedValueOnce(json(usage()))
    const service = new QuotaService()
    await service.fetchQuota(true)
    vi.useFakeTimers({ now: Date.now() + 3 * HOUR })
    const quota = service.getCachedQuota()
    expect(quota?.fiveHour.utilization).toBe(0)
    expect(quota?.sevenDay.utilization).toBe(32)
    expect(quota?.stale).toBe(true)
  })
})
