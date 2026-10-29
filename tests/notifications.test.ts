import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { CodexQuota, QuotaInfo } from '../src/shared/types'
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
const notificationOptions = vi.fn()
vi.mock('electron', () => ({
  Notification: class {
    static isSupported = () => true
    constructor(public opts: { title: string; body: string }) { notificationOptions(opts) }
    show = () => shown(this.opts.title)
  }
}))
const period = (hours: number) => ({ utilization: 0, resetsAt: new Date(Date.now() + hours * 3600000), resetsIn: '', resetProgress: 50 })
const quota: QuotaInfo = { fiveHour: period(5), sevenDay: period(168), models: [], lastUpdated: new Date() }
vi.mock('../src/main/services/quota-api', () => ({ quotaService: { getCachedQuota: () => quota } }))
let codex: CodexQuota | null = null
vi.mock('../src/main/services/codex', () => ({ codexService: { getCachedQuota: () => codex } }))

const { NotificationService } = await import('../src/main/services/notifications')

beforeEach(() => {
  for (const key of Object.keys(store)) delete store[key]
  Object.assign(store, { enableNotifications: true, notifiedLevels: {}, resetNotifications: {} })
  setLocale('en')
  quota.fiveHour = period(5)
  quota.sevenDay = period(168)
  quota.models = []
  delete quota.error
  delete quota.stale
  delete quota.extraUsage
  codex = null
  shown.mockReset()
  notificationOptions.mockReset()
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

  describe('extra usage', () => {
    beforeEach(() => {
      quota.extraUsage = { isEnabled: true, usedCredits: 0, monthlyLimit: 5000, currency: 'USD' }
    })

    it('records an unknown initial state without notifying, including passed levels', () => {
      quota.extraUsage!.usedCredits = 4600
      new NotificationService().checkAndNotify()
      new NotificationService().checkAndNotify()
      expect(shown).not.toHaveBeenCalled()
      expect(store.extraUsageNotified).toEqual({ used: 4600, levels: ['started', '50', '90'] })
    })

    it('notifies on first billed usage, with credits converted to currency', () => {
      new NotificationService().checkAndNotify()
      quota.extraUsage!.usedCredits = 120
      new NotificationService().checkAndNotify()
      new NotificationService().checkAndNotify()
      expect(shown).toHaveBeenCalledExactlyOnceWith('Extra usage started')
      expect(notificationOptions).toHaveBeenCalledWith({ title: 'Extra usage started', body: '$1.20 billed beyond your plan' })
    })

    it('notifies once at each limit crossing across restarts', () => {
      store.extraUsageNotified = { used: 120, levels: ['started'] }
      quota.extraUsage!.usedCredits = 2500
      new NotificationService().checkAndNotify()
      new NotificationService().checkAndNotify()
      quota.extraUsage!.usedCredits = 4500
      new NotificationService().checkAndNotify()
      new NotificationService().checkAndNotify()
      expect(shown.mock.calls).toEqual([
        ['Extra usage at 50% of your $50.00 limit'], ['Extra usage at 90% of your $50.00 limit']
      ])
    })

    it('announces only the highest level when usage jumps over multiple thresholds', () => {
      new NotificationService().checkAndNotify()
      quota.extraUsage!.usedCredits = 4600
      new NotificationService().checkAndNotify()
      expect(shown.mock.calls).toEqual([['Extra usage at 90% of your $50.00 limit']])
      expect(store.extraUsageNotified).toEqual({ used: 4600, levels: ['started', '50', '90'] })
    })

    it.each([0, 120])('clears levels when billed usage falls to %s in a new cycle', (usedCredits) => {
      store.extraUsageNotified = { used: 4600, levels: ['started', '50', '90'] }
      quota.extraUsage!.usedCredits = usedCredits
      new NotificationService().checkAndNotify()
      expect(store.extraUsageNotified).toEqual({ used: usedCredits, levels: usedCredits ? ['started'] : [] })
      shown.mockClear()
      quota.extraUsage!.usedCredits = 4500
      new NotificationService().checkAndNotify()
      expect(shown.mock.calls).toEqual([['Extra usage at 90% of your $50.00 limit']])
    })

    it('only notifies the start when there is no monthly limit', () => {
      new NotificationService().checkAndNotify()
      quota.extraUsage!.monthlyLimit = 0
      quota.extraUsage!.usedCredits = 10000
      new NotificationService().checkAndNotify()
      expect(shown).toHaveBeenCalledExactlyOnceWith('Extra usage started')
    })

    it('formats French messages and currency in the current locale', () => {
      setLocale('fr')
      new NotificationService().checkAndNotify()
      quota.extraUsage!.usedCredits = 120
      new NotificationService().checkAndNotify()
      const amount = new Intl.NumberFormat('fr', { style: 'currency', currency: 'USD' }).format(1.2)
      expect(notificationOptions).toHaveBeenCalledWith({ title: 'Usage hors forfait démarré', body: `${amount} facturés au-delà de votre forfait` })
    })

    it('falls back to a decimal amount and the currency code if it is invalid', () => {
      new NotificationService().checkAndNotify()
      quota.extraUsage!.currency = 'invalid'
      quota.extraUsage!.usedCredits = 120
      new NotificationService().checkAndNotify()
      expect(notificationOptions).toHaveBeenCalledWith({ title: 'Extra usage started', body: '1.20 invalid billed beyond your plan' })
    })

    it.each(['disabled', 'error', 'stale', 'absent', 'alerts-off'])('ignores extra usage when %s', (state) => {
      store.extraUsageNotified = { used: 0, levels: [] }
      quota.extraUsage!.usedCredits = 4600
      if (state === 'disabled') quota.extraUsage!.isEnabled = false
      if (state === 'error') quota.error = { type: 'network', message: 'offline', retryable: true }
      if (state === 'stale') quota.stale = true
      if (state === 'absent') delete quota.extraUsage
      if (state === 'alerts-off') store.enableNotifications = false
      new NotificationService().checkAndNotify()
      expect(shown).not.toHaveBeenCalled()
      expect(store.extraUsageNotified).toEqual({ used: 0, levels: [] })
    })
  })
})

describe('Codex notifications', () => {
  const codexQuota = (five: number): CodexQuota => ({
    fiveHour: { ...period(5), utilization: five }, sevenDay: period(168), resetsAvailable: 0, limitReached: false, lastUpdated: new Date()
  })

  it('uses the Claude thresholds with Codex labels and separate levels', () => {
    const service = new NotificationService()
    quota.fiveHour!.utilization = 75
    service.checkAndNotify()
    codex = codexQuota(75)
    service.checkCodex()
    service.checkCodex()
    expect(shown.mock.calls).toEqual([['Session (5h) at 75%'], ['Codex session at 75%']])
    expect(store.notifiedLevels).toMatchObject({ fiveHour: 'warning', 'codex.fiveHour': 'warning' })
  })

  it('announces a Codex reset after high use', () => {
    vi.useFakeTimers()
    const service = new NotificationService()
    codex = codexQuota(80)
    service.checkCodex()
    vi.advanceTimersByTime(5 * 3600000 + 1000)
    codex = { ...codexQuota(0), fiveHour: undefined }
    shown.mockReset()
    service.checkCodex()
    expect(shown).toHaveBeenCalledExactlyOnceWith('Codex session quota reset')
  })

  it('ignores stale or failed Codex data, and the Alerts switch', () => {
    const service = new NotificationService()
    codex = { ...codexQuota(95), stale: true }
    service.checkCodex()
    codex = { ...codexQuota(95), error: { type: 'network', message: 'x', retryable: true } }
    service.checkCodex()
    store.enableNotifications = false
    codex = codexQuota(95)
    service.checkCodex()
    expect(shown).not.toHaveBeenCalled()
  })
})
