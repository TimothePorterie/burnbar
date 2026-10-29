import { EventEmitter } from 'node:events'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  trayBounds: { x: 0, y: 0, width: 0, height: 0 } as Electron.Rectangle | null,
  primary: vi.fn(() => ({ workArea: { x: 1200, y: 40, width: 1512, height: 900 } })),
  nearest: vi.fn(() => ({ workArea: { x: -1440, y: 25, width: 1440, height: 875 } })),
  refresh: vi.fn(async () => {}),
  error: null as { type: string; message: string; retryable: boolean } | null
}))
vi.mock('electron', () => ({
  app: { isReady: () => false, once: vi.fn(), isPackaged: true, focus: vi.fn() },
  screen: { getPrimaryDisplay: mocks.primary, getDisplayNearestPoint: mocks.nearest },
  BrowserWindow: class extends EventEmitter {
    webContents = Object.assign(new EventEmitter(), { send: vi.fn() })
    isDestroyed = () => false
    getBounds = () => ({ width: 320, height: 300 })
    setPosition = vi.fn()
    setVisibleOnAllWorkspaces = vi.fn()
    setAlwaysOnTop = vi.fn()
    loadFile = vi.fn()
    show = vi.fn()
    focus = vi.fn()
  }
}))
vi.mock('../src/main/tray', () => ({ trayManager: { getBounds: () => mocks.trayBounds }, broadcastProviders: vi.fn() }))
vi.mock('../src/main/services/logger', () => ({ logger: {} }))
vi.mock('../src/main/services/quota-api', () => ({ quotaService: { getCachedQuota: () => null, getLastError: () => mocks.error } }))
vi.mock('../src/main/services/scheduler', () => ({ schedulerService: { refresh: mocks.refresh }, codexScheduler: { refresh: vi.fn() } }))
vi.mock('../src/main/services/consumption', () => ({ consumptionService: { refresh: vi.fn() } }))

const { WindowManager } = await import('../src/main/windows')

beforeEach(() => {
  vi.clearAllMocks()
  mocks.trayBounds = { x: 0, y: 0, width: 0, height: 0 }
  mocks.error = null
})

describe('popup reveal', () => {
  it('requests a non-forced refresh and resends the error when nothing is cached', () => {
    mocks.error = { type: 'network', message: 'Offline', retryable: true }
    const popup = new WindowManager().createPopupWindow()
    popup.emit('ready-to-show')
    expect(mocks.refresh).toHaveBeenCalledExactlyOnceWith()
    expect(popup.webContents.send).toHaveBeenCalledExactlyOnceWith('quota-error', mocks.error)
  })
})

describe('popup position', () => {
  it('uses the top right of the primary work area when the tray item is hidden', () => {
    const popup = new WindowManager().createPopupWindow()
    popup.emit('ready-to-show')
    expect(mocks.primary).toHaveBeenCalledOnce()
    expect(mocks.nearest).not.toHaveBeenCalled()
    expect(popup.setPosition).toHaveBeenCalledExactlyOnceWith(2382, 45)
  })

  it('centers below a visible tray item on its display', () => {
    mocks.trayBounds = { x: -700, y: 0, width: 40, height: 24 }
    const popup = new WindowManager().createPopupWindow()
    popup.emit('ready-to-show')
    expect(mocks.nearest).toHaveBeenCalledWith({ x: -700, y: 0 })
    expect(popup.setPosition).toHaveBeenCalledExactlyOnceWith(-840, 29)
    expect(mocks.primary).not.toHaveBeenCalled()
  })

  it.each([[-1440, -1430], [-20, -330]])('keeps the popup inside the display at tray x=%d', (x, expectedX) => {
    mocks.trayBounds = { x, y: 0, width: 40, height: 24 }
    const popup = new WindowManager().createPopupWindow()
    popup.emit('ready-to-show')
    expect(popup.setPosition).toHaveBeenCalledExactlyOnceWith(expectedX, 29)
  })

  it('does not reposition without a tray', () => {
    mocks.trayBounds = null
    const popup = new WindowManager().createPopupWindow()
    popup.emit('ready-to-show')
    expect(popup.setPosition).not.toHaveBeenCalled()
  })
})
