import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const store: Record<string, unknown> = {}
vi.mock('../src/main/services/settings-store', () => ({
  settingsStore: {
    get: (key: string) => store[key],
    set: (key: string, value: unknown) => { store[key] = value },
    delete: (key: string) => { delete store[key] }
  }
}))
vi.mock('../src/main/services/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }
}))
const keychain = { getCredentials: vi.fn(), isTokenExpired: vi.fn(), lastFailure: null as string | null }
vi.mock('../src/main/services/keychain', () => ({ keychainService: keychain }))

const { setLocale } = await import('../src/shared/i18n')
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
  Object.assign(store, { rateLimitedUntil: 0, lastQuotaData: null })
  keychain.getCredentials.mockReset().mockResolvedValue({ accessToken: 'token-a' })
  keychain.isTokenExpired.mockReset().mockReturnValue(false)
  keychain.lastFailure = null
  setLocale('en')
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

  it('accepts an absent session but still requires a valid weekly quota', () => {
    expect(isValidUsageResponse(usage({ five_hour: null }))).toBe(true)
    expect(isValidUsageResponse(usage({ seven_day: null }))).toBe(false)
    expect(isValidUsageResponse(usage({ five_hour: undefined }))).toBe(false)
    expect(isValidUsageResponse(usage({ seven_day: { utilization: NaN, resets_at: null } }))).toBe(false)
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
    expect(quota?.fiveHour?.resetsIn).toBe('—')
    expect(quota?.sevenDay.utilization).toBe(32)
  })

  it('persists and restores a null session without losing weekly data', async () => {
    fetchMock.mockResolvedValueOnce(json(usage({ five_hour: null })))
    const quota = await new QuotaService().fetchQuota(true)
    expect(quota?.fiveHour).toBeUndefined()
    expect(quota?.sevenDay.utilization).toBe(32)
    expect(new QuotaService().getCachedQuota()?.fiveHour).toBeUndefined()
    expect(new QuotaService().getCachedQuota()?.sevenDay.utilization).toBe(32)
  })

  it('parses, persists and restores every model while ignoring non-model keys', async () => {
    const model = { utilization: 95, resets_at: new Date(Date.now() + 48.5 * HOUR).toISOString() }
    fetchMock.mockResolvedValueOnce(json(usage({
      seven_day_opus: { ...model, utilization: 20 }, seven_day_sonnet: model,
      seven_day_routines: model, seven_day_oauth_apps: model, seven_day_cowork: model,
      seven_day_bad: { utilization: '90', resets_at: null }, seven_day_empty: null
    })))
    const service = new QuotaService()
    const quota = await service.fetchQuota(true)
    expect(quota?.models.map(({ key, label }) => ({ key, label }))).toEqual([
      { key: 'seven_day_opus', label: 'Opus' }, { key: 'seven_day_sonnet', label: 'Sonnet' }
    ])
    expect(service.getQuotaLevel()).toBe('critical')
    expect(new QuotaService().getCachedQuota()?.models).toEqual(quota?.models)
    expect(store.lastQuotaData).not.toHaveProperty('sevenDayOpus')
  })

  it('migrates an old persisted Opus quota', () => {
    store.lastQuotaData = {
      fiveHour: { utilization: 0, resetsAt: null },
      sevenDay: { utilization: 10, resetsAt: new Date(Date.now() + 48 * HOUR).toISOString() },
      sevenDayOpus: { utilization: 90, resetsAt: new Date(Date.now() + 48 * HOUR).toISOString() },
      fetchedAt: Date.now()
    }
    const service = new QuotaService()
    expect(service.getCachedQuota()?.models[0]).toMatchObject({
      key: 'seven_day_opus', label: 'Opus', period: { utilization: 90 }
    })
    expect(service.getQuotaLevel()).toBe('critical')
  })

  it('updates time-dependent model fields and utilization after reset', async () => {
    fetchMock.mockResolvedValueOnce(json(usage({ seven_day_sonnet: {
      utilization: 90, resets_at: new Date(Date.now() + HOUR).toISOString()
    } })))
    const service = new QuotaService()
    await service.fetchQuota(true)
    vi.useFakeTimers({ now: Date.now() + 2 * HOUR })
    expect(service.getCachedQuota()?.models[0].period.utilization).toBe(0)
    expect(service.getQuotaLevel()).toBe('normal')
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
    expect(quota?.fiveHour?.utilization).toBe(45)
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
    store.resetNotifications = { fiveHour: { resetsAt: Date.now(), utilization: 75 } }
    store.extraUsageNotified = { used: 4600, levels: ['started', '50', '90'] }
    const service = new QuotaService()
    await service.fetchQuota(true)
    expect(store.lastQuotaData).not.toBeNull()
    service.resetForAccountChange()
    expect(service.getCachedQuota()).toBeNull()
    expect(store.lastQuotaData).toBeNull()
    expect(store.notifiedLevels).toEqual({})
    expect(store.resetNotifications).toEqual({})
    expect(store.extraUsageNotified).toBeUndefined()
  })

  it('resets the previous account data when the Keychain account changes', async () => {
    fetchMock.mockImplementation(async () => json(usage()))
    keychain.getCredentials.mockResolvedValue({ accessToken: 'token-a', accountUuid: 'acc-a' })
    const service = new QuotaService()
    await service.fetchQuota(true)
    store.notifiedLevels = { fiveHour: 'warning' }
    keychain.getCredentials.mockResolvedValue({ accessToken: 'token-b', accountUuid: 'acc-b' })
    vi.useFakeTimers({ now: Date.now() + 20_000 })
    expect(await service.fetchQuota(true)).not.toBeNull()
    expect(store.notifiedLevels).toEqual({})
    expect(store.lastAccount).toBe('acc-b')
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
    expect(quota?.fiveHour?.utilization).toBe(0)
    expect(quota?.sevenDay.utilization).toBe(32)
    expect(quota?.stale).toBe(true)
  })

  it('reports a body that is not JSON as an unexpected response', async () => {
    fetchMock.mockResolvedValueOnce(new Response('<html>Bad gateway</html>', { status: 200 }))
    const service = new QuotaService()
    expect(await service.fetchQuota(true)).toBeNull()
    expect(service.getLastError()).toMatchObject({
      type: 'unknown', retryable: true, message: 'Anthropic sent an unexpected response. Update BurnBar if this persists.'
    })
  })

  it.each([
    ['missing', 'auth', 'No Claude Code session found'],
    ['invalid', 'auth', 'can\u2019t be read'],
    ['denied', 'keychain', 'Keychain access was denied'],
    ['failed', 'keychain', 'Couldn\u2019t read the Keychain']
  ])('explains a %s Keychain read without calling the API', async (failure, type, message) => {
    keychain.getCredentials.mockResolvedValue(null)
    keychain.lastFailure = failure
    const service = new QuotaService()
    expect(await service.fetchQuota(true)).toBeNull()
    expect(fetchMock).not.toHaveBeenCalled()
    expect(service.getLastError()?.type).toBe(type)
    expect(service.getLastError()?.message).toContain(message)
  })

  it('translates the current error when the language changes', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('fetch failed'))
    const service = new QuotaService()
    await service.fetchQuota(true)
    expect(service.getLastError()?.message).toBe('Offline, or Anthropic can\u2019t be reached.')
    setLocale('fr')
    expect(service.getLastError()?.message).toBe('Hors ligne, ou Anthropic injoignable.')
  })

  it('attaches the next automatic attempt to the error', async () => {
    vi.useFakeTimers({ now: Date.now() })
    fetchMock.mockResolvedValueOnce(json({}, 500)).mockResolvedValueOnce(json({}, 429))
    const service = new QuotaService()
    await service.fetchQuota(true)
    expect(service.getLastError()?.retryAt).toBeUndefined()
    service.nextRetryAt = Date.now() + 600_000
    expect(service.getLastError()?.retryAt).toBe(Date.now() + 600_000)
    service.nextRetryAt = 0
    await service.fetchQuota(true)
    expect(service.getLastError()).toMatchObject({ type: 'rate_limit', retryAt: Date.now() + 120_000 })
  })

  it('keeps utilization within 0-100% and drops an expired reset time', async () => {
    fetchMock.mockResolvedValueOnce(json(usage({
      five_hour: { utilization: 104, resets_at: new Date(Date.now() + HOUR).toISOString() },
      seven_day: { utilization: -3, resets_at: new Date(Date.now() - 1000).toISOString() }
    })))
    const quota = await new QuotaService().fetchQuota(true)
    expect(quota?.fiveHour?.utilization).toBe(100)
    expect(quota?.sevenDay).toMatchObject({ utilization: 0, resetsIn: '—', resetProgress: 0 })
    expect(Number.isNaN(quota?.sevenDay.resetsAt.getTime())).toBe(true)
  })

  it('still fetches after the clock was set back', async () => {
    fetchMock.mockImplementation(async () => json(usage()))
    vi.useFakeTimers({ now: Date.now() })
    const service = new QuotaService()
    await service.fetchQuota(true)
    vi.setSystemTime(Date.now() - HOUR)
    await service.fetchQuota()
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('does not flag data stale while idle refreshes are paused', async () => {
    store.refreshInterval = 300
    fetchMock.mockResolvedValueOnce(json(usage()))
    const service = new QuotaService()
    await service.fetchQuota(true)
    vi.useFakeTimers({ now: Date.now() + 20 * 60_000 })
    expect(service.getCachedQuota()?.stale).toBe(true)
    service.idlePaused = true
    expect(service.getCachedQuota()?.stale).toBe(false)
    vi.setSystemTime(Date.now() + 16 * 60_000)
    expect(service.getCachedQuota()?.stale).toBe(true)
  })

  it('ignores a corrupted persisted quota instead of failing at startup', () => {
    store.lastQuotaData = { sevenDay: { utilization: 'x' }, fetchedAt: Date.now() }
    expect(new QuotaService().getCachedQuota()).toBeNull()
    store.lastQuotaData = { sevenDay: { utilization: 10, resetsAt: null }, models: [{ key: 'k', label: 'K', period: null }], fetchedAt: Date.now() }
    expect(new QuotaService().getCachedQuota()?.models).toEqual([])
  })
})
