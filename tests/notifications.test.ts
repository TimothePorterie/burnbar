import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { QuotaInfo } from '../src/shared/types'
import { setLocale } from '../src/shared/i18n'

const store: Record<string, unknown> = {}
vi.mock('../src/main/services/settings-store', () => ({
  settingsStore: {
    get: (key: string) => store[key],
    set: (key: string, value: unknown) => { store[key] = value }
  }
}))
vi.mock('../src/main/services/logger', () => ({ logger: { info: vi.fn() } }))
const shown = vi.fn()
vi.mock('electron', () => ({
  Notification: class {
    static isSupported = () => true
    constructor(public opts: { title: string }) {}
    show = () => shown(this.opts.title)
  }
}))
const period = (hours: number) => ({ utilization: 0, resetsAt: new Date(Date.now() + hours * 3600000), resetsIn: '', resetProgress: 50 })
const quota: QuotaInfo = { fiveHour: period(5), sevenDay: period(168), models: [], lastUpdated: new Date() }
vi.mock('../src/main/services/quota-api', () => ({ quotaService: { getCachedQuota: () => quota } }))

const { NotificationService } = await import('../src/main/services/notifications')

beforeEach(() => {
  Object.assign(store, { enableNotifications: true, notifiedLevels: {}, resetNotifications: {} })
  setLocale('en')
  quota.fiveHour = period(5)
  quota.sevenDay = period(168)
  quota.models = []
  delete quota.error
  delete quota.stale
  shown.mockReset()
  vi.useRealTimers()
})

describe('NotificationService', () => {
  it('notifies once when crossing into warning', () => {
    const service = new NotificationService()
    quota.fiveHour!.utilization = 75
    service.checkAndNotify()
    service.checkAndNotify()
    expect(shown).toHaveBeenCalledTimes(1)
  })

  it('does not notify again after a restart at the same level', () => {
    quota.fiveHour!.utilization = 75
    new NotificationService().checkAndNotify()
    new NotificationService().checkAndNotify()
    expect(shown).toHaveBeenCalledTimes(1)
  })

  it('notifies again after the quota resets and climbs back', () => {
    const service = new NotificationService()
    quota.fiveHour!.utilization = 75
    service.checkAndNotify()
    quota.fiveHour!.utilization = 10
    service.checkAndNotify()
    quota.fiveHour!.utilization = 95
    service.checkAndNotify()
    expect(shown).toHaveBeenCalledTimes(2)
  })

  it.each(['fiveHour', 'sevenDay'] as const)('notifies a %s reset only once across restarts', (key) => {
    const service = new NotificationService()
    quota[key]!.utilization = 75
    service.checkAndNotify()
    shown.mockClear()
    vi.useFakeTimers({ now: quota[key]!.resetsAt.getTime() + 1000 })
    quota[key] = { ...quota[key]!, utilization: 0 }
    service.checkAndNotify()
    new NotificationService().checkAndNotify()
    expect(shown).toHaveBeenCalledExactlyOnceWith(key === 'fiveHour' ? 'Session quota reset' : 'Weekly quota reset')
  })

  it('does not notify a reset if previous use was below warning', () => {
    const service = new NotificationService()
    quota.fiveHour!.utilization = 69
    service.checkAndNotify()
    vi.useFakeTimers({ now: quota.fiveHour!.resetsAt.getTime() + 1000 })
    service.checkAndNotify()
    expect(shown).not.toHaveBeenCalled()
  })

  it('waits for the reset time before notifying', () => {
    const service = new NotificationService()
    quota.fiveHour!.utilization = 75
    service.checkAndNotify()
    shown.mockClear()
    service.checkAndNotify()
    expect(shown).not.toHaveBeenCalled()
  })

  it('notifies a session reset even when the API has no active session yet', () => {
    const service = new NotificationService()
    quota.fiveHour!.utilization = 75
    service.checkAndNotify()
    shown.mockClear()
    vi.useFakeTimers({ now: quota.fiveHour!.resetsAt.getTime() + 1000 })
    delete quota.fiveHour
    service.checkAndNotify()
    expect(shown).toHaveBeenCalledExactlyOnceWith('Session quota reset')
  })

  it('checks generic model thresholds without an app name prefix', () => {
    quota.models = [{ key: 'seven_day_sonnet', label: 'Sonnet', period: { ...period(168), utilization: 95 } }]
    new NotificationService().checkAndNotify()
    expect(shown).toHaveBeenCalledExactlyOnceWith('Sonnet at 95%')
  })

  it('migrates the old Opus notification level without a duplicate', () => {
    store.notifiedLevels = { sevenDayOpus: 'critical' }
    quota.models = [{ key: 'seven_day_opus', label: 'Opus', period: { ...period(168), utilization: 95 } }]
    new NotificationService().checkAndNotify()
    expect(shown).not.toHaveBeenCalled()
    expect(store.notifiedLevels).toEqual({ fiveHour: 'normal', sevenDay: 'normal', seven_day_opus: 'critical' })
  })

  it('respects the existing notifications switch for thresholds and resets', () => {
    quota.fiveHour!.utilization = 80
    new NotificationService().checkAndNotify()
    store.enableNotifications = false
    shown.mockClear()
    quota.fiveHour = period(6)
    quota.sevenDay.utilization = 95
    new NotificationService().checkAndNotify()
    expect(shown).not.toHaveBeenCalled()
  })

  it('ignores stale data and fetch errors', () => {
    quota.sevenDay.utilization = 95
    quota.stale = true
    new NotificationService().checkAndNotify()
    quota.stale = false
    quota.error = { type: 'network', message: 'offline', retryable: true }
    new NotificationService().checkAndNotify()
    expect(shown).not.toHaveBeenCalled()
  })

})
