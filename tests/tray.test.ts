import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import type { CodexQuota, ConsumptionInfo, ProviderId, QuotaError, QuotaInfo, QuotaPeriod, TrayProvider } from '../src/shared/types'
import { renderGaugeBitmap } from '../src/main/tray-icon'
import { setLocale } from '../src/shared/i18n'

const mocks = vi.hoisted(() => ({
  quota: null as QuotaInfo | null,
  error: null as QuotaError | null,
  codex: null as CodexQuota | null,
  codexError: null as QuotaError | null,
  usage: {} as Record<string, { data: ConsumptionInfo | null; error: QuotaError | null }>,
  enabled: { claude: true, codex: false, grok: false, opencode: false } as Record<ProviderId, boolean>,
  trayProvider: 'claude' as TrayProvider,
  mode: 'standard',
  showRemaining: false,
  closePopup: vi.fn(),
  send: vi.fn(),
  images: [] as { bitmap: Buffer; addRepresentation: ReturnType<typeof vi.fn>; setTemplateImage: ReturnType<typeof vi.fn> }[],
  tray: {
    setTitle: vi.fn(), setImage: vi.fn(), setToolTip: vi.fn(), on: vi.fn(), destroy: vi.fn(), popUpContextMenu: vi.fn()
  },
  createTray: vi.fn(),
  menu: vi.fn()
}))

vi.mock('electron', () => ({
  app: { quit: vi.fn() },
  BrowserWindow: { getAllWindows: () => [{ isDestroyed: () => false, webContents: { send: mocks.send } }] },
  Tray: class {
    constructor(...args: unknown[]) {
      mocks.createTray(...args)
      return mocks.tray
    }
  },
  Menu: { buildFromTemplate: mocks.menu },
  nativeImage: {
    createFromBitmap: (bitmap: Buffer) => {
      const image = { bitmap, addRepresentation: vi.fn(), setTemplateImage: vi.fn() }
      mocks.images.push(image)
      return image
    }
  }
}))
vi.mock('../src/main/services/quota-api', () => ({
  quotaService: { getCachedQuota: () => mocks.quota, getLastError: () => mocks.error }
}))
vi.mock('../src/main/services/settings-store', () => ({
  settingsStore: {
    get: (key: string) => key === 'showRemaining' ? mocks.showRemaining : mocks.mode,
    set: (key: string, value: string | boolean) => {
      if (key === 'showRemaining') mocks.showRemaining = value as boolean
      else mocks.mode = value as string
    }
  }
}))
vi.mock('../src/main/services/scheduler', () => ({ schedulerService: { onRefresh: vi.fn() }, codexScheduler: { onRefresh: vi.fn() } }))
vi.mock('../src/main/services/codex', () => ({
  codexService: { getCachedQuota: () => mocks.codex, getLastError: () => mocks.codexError }
}))
vi.mock('../src/main/services/consumption', () => ({
  consumptionService: { onRefresh: vi.fn(), getView: (id: string) => mocks.usage[id] ?? { data: null, error: null } }
}))
vi.mock('../src/main/services/providers', () => ({
  getEnabledProviders: () => mocks.enabled,
  isProviderEnabled: (id: ProviderId) => mocks.enabled[id],
  getTrayProvider: () => mocks.trayProvider,
  getProvidersSnapshot: vi.fn(async () => ({}))
}))
vi.mock('../src/main/services/updater', () => ({ updaterService: {} }))
vi.mock('../src/main/services/logger', () => ({ logger: { info: vi.fn() } }))
vi.mock('../src/main/services/notifications', () => ({ notificationService: {} }))
vi.mock('../src/main/windows', () => ({ windowManager: { closePopup: mocks.closePopup } }))

const { TrayManager } = await import('../src/main/tray')
let manager: InstanceType<typeof TrayManager>

const period = (utilization: number): QuotaPeriod => ({
  utilization, resetsAt: new Date('2026-10-30T00:00:00Z'), resetsIn: '4h 30m', resetProgress: 10
})
const quota = (): QuotaInfo => ({
  fiveHour: period(45), sevenDay: period(32),
  models: [{ key: 'seven_day_sonnet', label: 'Sonnet', period: period(12) }],
  lastUpdated: new Date('2026-10-29T10:00:00Z')
})
const create = (): void => manager.create({ onShowPopup: vi.fn(), onShowSettings: vi.fn() })
const currentBitmap = (): Buffer => mocks.images.at(-1)!.bitmap

beforeEach(() => {
  vi.useFakeTimers()
  vi.clearAllMocks()
  mocks.images.length = 0
  mocks.quota = null
  mocks.error = null
  mocks.mode = 'standard'
  mocks.showRemaining = false
  mocks.codex = null
  mocks.codexError = null
  mocks.usage = {}
  mocks.enabled = { claude: true, codex: false, grok: false, opencode: false }
  mocks.trayProvider = 'claude'
  setLocale('en')
  manager = new TrayManager()
})

afterEach(() => {
  manager.destroy()
  vi.useRealTimers()
})

describe('tray display', () => {
  it.each([
    ['standard', '55% / 68%'],
    ['detailed', '5h: 55% | 7d: 68% | Sonnet: 88%'],
    ['compact', '55%'], ['time-remaining', '4h 30m'], ['minimal', '']
  ])('shows remaining percentages in %s mode without changing the gauge', (mode, title) => {
    mocks.mode = mode
    mocks.showRemaining = true
    mocks.quota = quota()
    create()
    expect(mocks.tray.setTitle).toHaveBeenLastCalledWith(title, { fontType: 'monospacedDigit' })
    expect(currentBitmap().equals(renderGaugeBitmap(45, 32, 1, false))).toBe(true)
    expect(mocks.tray.setToolTip.mock.lastCall![0]).toContain('Session: 55% left (resets in 4h 30m)')
    expect(mocks.tray.setToolTip.mock.lastCall![0]).toContain('Weekly: 68% left')
    expect(mocks.tray.setToolTip.mock.lastCall![0]).toContain('Sonnet: 88% left')
  })

  it('rounds the remaining percentage and preserves an absent session', () => {
    mocks.showRemaining = true
    mocks.quota = { ...quota(), fiveHour: undefined, sevenDay: period(32.5) }
    create()
    expect(mocks.tray.setTitle).toHaveBeenLastCalledWith('— / 68%', { fontType: 'monospacedDigit' })
    expect(mocks.tray.setToolTip.mock.lastCall![0]).toContain('No active session')
  })

  it('toggles remaining from the context menu and synchronizes settings immediately', () => {
    mocks.quota = quota()
    create()
    mocks.tray.on.mock.calls.find(([name]) => name === 'right-click')![1]()
    const item = mocks.menu.mock.lastCall![0].find((entry: { label?: string }) => entry.label === 'Show Remaining')
    expect(item).toMatchObject({ type: 'checkbox', checked: false })
    item.click({ checked: true })
    expect(mocks.showRemaining).toBe(true)
    expect(mocks.closePopup).toHaveBeenCalledOnce()
    expect(mocks.send).toHaveBeenCalledWith('show-remaining-changed', true)
    expect(mocks.tray.setTitle).toHaveBeenLastCalledWith('55% / 68%', { fontType: 'monospacedDigit' })
  })

  it('localizes the remaining tooltip in French', () => {
    setLocale('fr')
    mocks.showRemaining = true
    mocks.quota = quota()
    create()
    expect(mocks.tray.setToolTip.mock.lastCall![0]).toContain('Session : 55 % restant')
  })

  it('adds only active Anthropic disruptions to the tooltip', () => {
    mocks.quota = { ...quota(), status: { indicator: 'minor', incident: { name: 'API delays', url: 'https://status.claude.com/' } } }
    create()
    expect(mocks.tray.setToolTip.mock.lastCall![0]).toContain('Anthropic: API delays')
    mocks.quota.status = { indicator: 'none' }
    manager.refreshDisplay()
    expect(mocks.tray.setToolTip.mock.lastCall![0]).not.toContain('Anthropic:')
  })
  it('uses two template representations and a fixed UUID v4', () => {
    create()
    expect(mocks.createTray).toHaveBeenCalledWith(mocks.images[0], '18f3a40d-d04b-4b87-972e-79bd0432eed3')
    for (const image of mocks.images) {
      expect(image.bitmap.equals(renderGaugeBitmap(null, null, 1, false))).toBe(true)
      expect(image.addRepresentation).toHaveBeenCalledWith({
        width: 36, height: 36, scaleFactor: 2, buffer: renderGaugeBitmap(null, null, 2, false)
      })
      expect(image.setTemplateImage).toHaveBeenCalledExactlyOnceWith(true)
    }
    expect(mocks.tray.setTitle).toHaveBeenCalledExactlyOnceWith('', { fontType: 'monospacedDigit' })
  })

  it.each([
    ['standard', '45% / 32%'],
    ['detailed', '5h: 45% | 7d: 32% | Sonnet: 12%'],
    ['compact', '45%'],
    ['time-remaining', '4h 30m'],
    ['minimal', '']
  ])('keeps the gauge in %s mode', (mode, title) => {
    mocks.mode = mode
    mocks.quota = quota()
    create()
    expect(mocks.tray.setTitle).toHaveBeenCalledExactlyOnceWith(title, { fontType: 'monospacedDigit' })
    expect(currentBitmap().equals(renderGaugeBitmap(45, 32, 1, false))).toBe(true)
  })

  it.each([
    ['standard', '— / 32%'], ['detailed', '5h: — | 7d: 32% | Sonnet: 12%'],
    ['compact', '—'], ['time-remaining', '—']
  ])('shows the absent session in %s mode', (mode, title) => {
    mocks.mode = mode
    mocks.quota = { ...quota(), fiveHour: undefined }
    create()
    expect(mocks.tray.setTitle).toHaveBeenCalledWith(title, { fontType: 'monospacedDigit' })
    expect(mocks.tray.setToolTip.mock.lastCall![0]).toContain('No active session')
    expect(currentBitmap().equals(renderGaugeBitmap(null, 32, 1, false))).toBe(true)
  })

  it.each(['auth', 'network', 'rate_limit'] as const)('dims empty tracks on a %s error', type => {
    mocks.error = { type, message: 'Request failed', retryable: true }
    create()
    expect(mocks.tray.setTitle).toHaveBeenCalledExactlyOnceWith('', { fontType: 'monospacedDigit' })
    expect(currentBitmap().equals(renderGaugeBitmap(null, null, 1, true))).toBe(true)
    expect(mocks.tray.setToolTip.mock.lastCall![0]).toContain('Request failed')
  })

  it('dims stale data and retains the tooltip warning without prefixing the title', () => {
    mocks.quota = { ...quota(), stale: true }
    create()
    expect(mocks.tray.setTitle).toHaveBeenCalledWith('45% / 32%', { fontType: 'monospacedDigit' })
    expect(currentBitmap().equals(renderGaugeBitmap(45, 32, 1, true))).toBe(true)
    expect(mocks.tray.setToolTip.mock.lastCall![0]).toContain('Data may be outdated')
  })

  it('dims cached data on error and restores the gauge after recovery', () => {
    mocks.error = { type: 'network', message: 'Offline', retryable: true }
    mocks.quota = { ...quota(), error: mocks.error }
    create()
    expect(currentBitmap().equals(renderGaugeBitmap(45, 32, 1, true))).toBe(true)
    expect(mocks.tray.setToolTip.mock.lastCall![0]).toContain('Offline')
    mocks.error = null
    mocks.quota = quota()
    manager.refreshDisplay()
    expect(currentBitmap().equals(renderGaugeBitmap(45, 32, 1, false))).toBe(true)
  })

  it('keeps fresh cached data undimmed during a rate limit but says why and when it retries', () => {
    vi.setSystemTime(new Date('2026-10-29T10:25:00Z'))
    mocks.error = { type: 'rate_limit', message: 'Anthropic rate limit reached.', retryable: true, retryAt: Date.now() + 3 * 60000 }
    mocks.quota = { ...quota(), error: mocks.error }
    create()
    expect(currentBitmap().equals(renderGaugeBitmap(45, 32, 1, false))).toBe(true)
    expect(mocks.tray.setToolTip.mock.lastCall![0].split('\n').slice(-3)).toEqual([
      'Updated 25m ago', 'Anthropic rate limit reached.', 'Next try in 3m.'
    ])
  })

  it('shows plain-text errors with the next try when nothing is cached', () => {
    vi.setSystemTime(new Date('2026-10-29T10:00:00Z'))
    mocks.error = { type: 'auth', message: 'Run `claude` to log in.', retryable: true, retryAt: Date.now() + 10 * 60000 }
    create()
    expect(mocks.tray.setToolTip).toHaveBeenLastCalledWith('BurnBar \u2014 Run claude to log in.\nNext try in 10m.')
  })

  it('ages the tooltip and dims newly stale data every minute without a fetch', () => {
    vi.setSystemTime(new Date('2026-10-29T10:00:30Z'))
    mocks.quota = quota()
    create()
    expect(mocks.tray.setToolTip.mock.lastCall![0]).toContain('Updated just now')
    mocks.quota = { ...quota(), stale: true }
    vi.advanceTimersByTime(60_000)
    expect(mocks.tray.setToolTip.mock.lastCall![0]).toContain('Updated 1m ago')
    expect(currentBitmap().equals(renderGaugeBitmap(45, 32, 1, true))).toBe(true)
  })

  it('keeps critical quotas template and refreshes the time title with monospaced digits', () => {
    mocks.quota = { ...quota(), fiveHour: period(95) }
    mocks.mode = 'time-remaining'
    create()
    expect(currentBitmap().equals(renderGaugeBitmap(95, 32, 1, false))).toBe(true)
    vi.advanceTimersByTime(60_000)
    expect(mocks.tray.setTitle).toHaveBeenCalledTimes(2)
    expect(mocks.tray.setTitle).toHaveBeenLastCalledWith('4h 30m', { fontType: 'monospacedDigit' })
  })

  it.each([['en', 'Icon only'], ['fr', 'Icône seule']] as const)('renames the persisted minimal mode in %s', (locale, label) => {
    setLocale(locale)
    mocks.mode = 'minimal'
    create()
    const rightClick = mocks.tray.on.mock.calls.find(([name]) => name === 'right-click')![1]
    rightClick()
    const modes = mocks.menu.mock.lastCall![0].find((item: { submenu?: unknown }) => item.submenu).submenu
    expect(modes.at(-1)).toMatchObject({ label, checked: true })
    modes.at(-1).click()
    expect(mocks.mode).toBe('minimal')
  })
})

describe('several providers', () => {
  const codex = (five = 22, seven = 12): CodexQuota => ({
    fiveHour: period(five), sevenDay: period(seven), plan: 'Team', resetsAvailable: 2, limitReached: false,
    lastUpdated: new Date('2026-10-29T10:00:00Z')
  })
  const usage = (): ConsumptionInfo => ({
    today: { cost: 1.69, tokens: 120000 }, week: { cost: 12.4, tokens: 2_300_000 }, lastUpdated: new Date()
  })

  beforeEach(() => {
    mocks.enabled = { claude: true, codex: true, grok: true, opencode: false }
    mocks.quota = quota()
    mocks.codex = codex()
  })

  it('follows Codex in the menu bar when chosen', () => {
    mocks.trayProvider = 'codex'
    create()
    expect(mocks.tray.setTitle).toHaveBeenLastCalledWith('22% / 12%', { fontType: 'monospacedDigit' })
    expect(currentBitmap().equals(renderGaugeBitmap(22, 12, 1, false))).toBe(true)
  })

  it('shows the highest bar of each window and the title of the most loaded provider', () => {
    mocks.trayProvider = 'max'
    mocks.codex = codex(60, 10)
    create()
    expect(currentBitmap().equals(renderGaugeBitmap(60, 32, 1, false))).toBe(true)
    expect(mocks.tray.setTitle).toHaveBeenLastCalledWith('60% / 10%', { fontType: 'monospacedDigit' })
  })

  it('names both providers in detailed mode, with remaining percentages', () => {
    mocks.mode = 'detailed'
    mocks.showRemaining = true
    create()
    expect(mocks.tray.setTitle).toHaveBeenLastCalledWith('Claude 55% / 68% \u00b7 Codex 78% / 88%', { fontType: 'monospacedDigit' })
  })

  it('lists one tooltip block per enabled provider', () => {
    mocks.usage.grok = { data: usage(), error: null }
    create()
    const blocks = mocks.tray.setToolTip.mock.lastCall![0].split('\n\n')
    expect(blocks).toHaveLength(3)
    expect(blocks[0]).toMatch(/^Claude Code\nSession: 45%/)
    expect(blocks[1]).toMatch(/^Codex\nSession: 22% \(resets in 4h 30m\)\nWeekly: 12%/)
    expect(blocks[1]).toContain('2 resets available')
    expect(blocks[2]).toBe('Grok: Today $1.69 \u00b7 7d $12.40 \u00b7 2.3M tokens')
  })

  it('keeps Claude on the menu bar undimmed when Codex fails', () => {
    mocks.codex = null
    mocks.codexError = { type: 'auth', message: 'Codex is not signed in. Run `codex login` in a terminal.', retryable: false }
    create()
    expect(mocks.tray.setTitle).toHaveBeenLastCalledWith('45% / 32%', { fontType: 'monospacedDigit' })
    expect(currentBitmap().equals(renderGaugeBitmap(45, 32, 1, false))).toBe(true)
    expect(mocks.tray.setToolTip.mock.lastCall![0]).toContain('Codex\nCodex is not signed in. Run codex login in a terminal.')
  })

  it('dims Highest only when both providers need attention', () => {
    mocks.trayProvider = 'max'
    mocks.codexError = { type: 'network', message: 'Offline', retryable: true }
    mocks.codex = { ...codex(), error: mocks.codexError }
    create()
    expect(currentBitmap().equals(renderGaugeBitmap(45, 32, 1, false))).toBe(true)
    mocks.quota = { ...quota(), stale: true }
    manager.refreshDisplay()
    expect(currentBitmap().equals(renderGaugeBitmap(45, 32, 1, true))).toBe(true)
  })

  it('falls back to the other provider when one has no data', () => {
    mocks.trayProvider = 'max'
    mocks.quota = null
    create()
    expect(mocks.tray.setTitle).toHaveBeenLastCalledWith('22% / 12%', { fontType: 'monospacedDigit' })
  })
})
