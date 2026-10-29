import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import type { QuotaError, QuotaInfo, QuotaPeriod } from '../src/shared/types'
import { renderGaugeBitmap } from '../src/main/tray-icon'
import { setLocale } from '../src/shared/i18n'

const mocks = vi.hoisted(() => ({
  quota: null as QuotaInfo | null,
  error: null as QuotaError | null,
  mode: 'standard',
  images: [] as { bitmap: Buffer; addRepresentation: ReturnType<typeof vi.fn>; setTemplateImage: ReturnType<typeof vi.fn> }[],
  tray: {
    setTitle: vi.fn(), setImage: vi.fn(), setToolTip: vi.fn(), on: vi.fn(), destroy: vi.fn(), popUpContextMenu: vi.fn()
  },
  createTray: vi.fn(),
  menu: vi.fn()
}))

vi.mock('electron', () => ({
  app: { quit: vi.fn() },
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
  settingsStore: { get: () => mocks.mode, set: (_key: string, value: string) => { mocks.mode = value } }
}))
vi.mock('../src/main/services/scheduler', () => ({ schedulerService: { onRefresh: vi.fn() } }))
vi.mock('../src/main/services/updater', () => ({ updaterService: {} }))
vi.mock('../src/main/services/logger', () => ({ logger: { info: vi.fn() } }))
vi.mock('../src/main/services/notifications', () => ({ notificationService: {} }))
vi.mock('../src/main/windows', () => ({ windowManager: {} }))

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
  setLocale('en')
  manager = new TrayManager()
})

afterEach(() => {
  manager.destroy()
  vi.useRealTimers()
})

describe('tray display', () => {
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

  it('keeps fresh cached data undimmed during a rate limit', () => {
    mocks.error = { type: 'rate_limit', message: 'Wait', retryable: true }
    mocks.quota = { ...quota(), error: mocks.error }
    create()
    expect(currentBitmap().equals(renderGaugeBitmap(45, 32, 1, false))).toBe(true)
    expect(mocks.tray.setToolTip.mock.lastCall![0]).not.toContain('Wait')
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
