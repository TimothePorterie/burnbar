import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { QuotaInfo } from '../src/shared/types'

const { idleTime, fetchQuota, getCachedQuota, getLastError, cooldown, throttled, info, quotaService } = vi.hoisted(() => {
  const mocks = {
    idleTime: vi.fn(), fetchQuota: vi.fn(), getCachedQuota: vi.fn(), getLastError: vi.fn(),
    cooldown: vi.fn(), throttled: vi.fn(), info: vi.fn()
  }
  return { ...mocks, quotaService: {
    fetchQuota: mocks.fetchQuota, getCachedQuota: mocks.getCachedQuota, getLastError: mocks.getLastError,
    getRateLimitRemainingMs: mocks.cooldown, wasThrottled: mocks.throttled, nextRetryAt: 0, idlePaused: false
  } }
})
vi.mock('electron', () => ({ powerMonitor: { getSystemIdleTime: idleTime } }))
vi.mock('../src/main/services/quota-api', () => ({ quotaService }))
vi.mock('../src/main/services/logger', () => ({ logger: { info, warn: vi.fn(), error: vi.fn() } }))

import { SchedulerService } from '../src/main/services/scheduler'

let service: SchedulerService
let quota: QuotaInfo

beforeEach(() => {
  vi.useFakeTimers({ now: new Date('2026-10-29T12:00:00Z') })
  vi.resetAllMocks()
  quota = {
    sevenDay: { utilization: 10, resetsAt: new Date(), resetsIn: '', resetProgress: 10 },
    models: [], lastUpdated: new Date()
  }
  idleTime.mockReturnValue(0)
  cooldown.mockReturnValue(0)
  throttled.mockReturnValue(false)
  quotaService.nextRetryAt = 0
  quotaService.idlePaused = false
  getCachedQuota.mockImplementation(() => quota)
  fetchQuota.mockImplementation(async () => {
    quota.lastUpdated = new Date()
    return quota
  })
  service = new SchedulerService()
})

afterEach(() => {
  service.stop()
  vi.useRealTimers()
})

describe('adaptive scheduler', () => {
  it('fetches every configured interval while active', async () => {
    service.start()
    await vi.advanceTimersByTimeAsync(0)
    fetchQuota.mockClear()
    await vi.advanceTimersByTimeAsync(300000)
    expect(fetchQuota).toHaveBeenCalledExactlyOnceWith(false)
  })

  it('skips scheduled refreshes after ten minutes idle while data is recent', async () => {
    service.start()
    await vi.advanceTimersByTimeAsync(0)
    fetchQuota.mockClear()
    idleTime.mockReturnValue(600)
    await vi.advanceTimersByTimeAsync(300000 * 5)
    expect(fetchQuota).not.toHaveBeenCalled()
    expect(info).toHaveBeenCalledExactlyOnceWith('Scheduled quota refresh skipped during inactivity')
    expect(vi.getTimerCount()).toBe(1)
  })

  it('refreshes at thirty minutes even while idle', async () => {
    idleTime.mockReturnValue(600)
    service.start()
    await vi.advanceTimersByTimeAsync(30 * 60000)
    expect(fetchQuota).toHaveBeenCalledExactlyOnceWith(false)
    await vi.advanceTimersByTimeAsync(25 * 60000)
    expect(fetchQuota).toHaveBeenCalledTimes(1)
  })

  it('fetches idle data that is already older than thirty minutes', async () => {
    idleTime.mockReturnValue(600)
    quota.lastUpdated = new Date(Date.now() - 31 * 60000)
    service.start()
    await vi.advanceTimersByTimeAsync(0)
    expect(fetchQuota).toHaveBeenCalledExactlyOnceWith(false)
  })

  it('skips while the screen is locked even if the system idle time is low', async () => {
    service.setScreenLocked(true)
    service.start()
    await vi.advanceTimersByTimeAsync(300000)
    expect(fetchQuota).not.toHaveBeenCalled()
    expect(vi.getTimerCount()).toBe(1)
  })

  it('allows a forced refresh while idle and locked', async () => {
    idleTime.mockReturnValue(600)
    service.setScreenLocked(true)
    service.start(true)
    await vi.advanceTimersByTimeAsync(0)
    expect(fetchQuota).toHaveBeenCalledExactlyOnceWith(true)
    fetchQuota.mockClear()
    await service.refresh(true)
    expect(fetchQuota).toHaveBeenCalledExactlyOnceWith(true)
  })

  it('allows a non-forced refresh on unlock even before the idle counter resets', async () => {
    idleTime.mockReturnValue(600)
    service.setScreenLocked(true)
    service.start()
    service.setScreenLocked(false)
    await service.refresh()
    expect(fetchQuota).toHaveBeenCalledExactlyOnceWith(false)
  })

  it('fetches while idle when there has been no successful fetch yet', async () => {
    idleTime.mockReturnValue(600)
    getCachedQuota.mockReturnValue(null)
    service.start()
    await vi.advanceTimersByTimeAsync(0)
    expect(fetchQuota).toHaveBeenCalledExactlyOnceWith(false)
  })

  it('logs one resumption after skipped ticks and preserves the configured interval', async () => {
    service.setRefreshInterval(900)
    idleTime.mockReturnValue(600)
    service.start()
    await vi.advanceTimersByTimeAsync(900000)
    idleTime.mockReturnValue(0)
    await vi.advanceTimersByTimeAsync(899999)
    expect(fetchQuota).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    await vi.advanceTimersByTimeAsync(900000)
    expect(fetchQuota).toHaveBeenCalledTimes(2)
    expect(info.mock.calls).toEqual([
      ['Scheduled quota refresh skipped during inactivity'], ['Quota refresh resumed after inactivity']
    ])
  })

  it('marks the idle pause so the data is not flagged stale meanwhile', async () => {
    service.start()
    await vi.advanceTimersByTimeAsync(0)
    idleTime.mockReturnValue(600)
    await vi.advanceTimersByTimeAsync(300000)
    expect(quotaService.idlePaused).toBe(true)
    await service.refresh()
    expect(quotaService.idlePaused).toBe(false)
  })
})

describe('error handling', () => {
  const failing = (): void => {
    quota.error = { type: 'network', message: 'Offline', retryable: true }
    fetchQuota.mockImplementation(async () => quota)
  }

  it('publishes the backoff retry time and clears it on success', async () => {
    failing()
    await service.refresh()
    expect(quotaService.nextRetryAt).toBe(Date.now() + 300000)
    await service.refresh()
    expect(quotaService.nextRetryAt).toBe(Date.now() + 300000)
    quota.error = undefined
    await service.refresh()
    expect(quotaService.nextRetryAt).toBe(0)
  })

  it('publishes the rate-limit retry time', async () => {
    cooldown.mockReturnValue(120000)
    await service.refresh()
    expect(quotaService.nextRetryAt).toBe(Date.now() + 122000)
  })

  it('does not grow the backoff when the cache answered without a request', async () => {
    failing()
    await service.refresh()
    throttled.mockReturnValue(true)
    await service.refresh()
    await service.refresh()
    throttled.mockReturnValue(false)
    await vi.advanceTimersByTimeAsync(300000)
    // Second real failure: 2x, not 8x
    expect(quotaService.nextRetryAt).toBe(Date.now() + 600000)
  })

  it('shares one run between concurrent refreshes', async () => {
    let finish!: () => void
    fetchQuota.mockImplementationOnce(() => new Promise(resolve => { finish = () => resolve(quota) }))
    const first = service.refresh()
    const second = service.refresh(true)
    expect(second).toBe(first)
    finish()
    await first
    expect(fetchQuota).toHaveBeenCalledOnce()
  })
})
