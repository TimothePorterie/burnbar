import { EventEmitter } from 'node:events'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const quit = vi.fn()
const refresh = vi.fn().mockResolvedValue(undefined)
vi.mock('electron', () => ({
  app: { isReady: () => false, once: vi.fn(), isPackaged: true, quit },
  BrowserWindow: class extends EventEmitter {
    webContents = new EventEmitter()
    hide = vi.fn()
    isDestroyed = () => false
    isVisible = () => true
    setVisibleOnAllWorkspaces = vi.fn()
    setAlwaysOnTop = vi.fn()
    loadFile = vi.fn()
  }
}))
vi.mock('../src/main/tray', () => ({ trayManager: {} }))
vi.mock('../src/main/services/logger', () => ({ logger: {} }))
vi.mock('../src/main/services/quota-api', () => ({ quotaService: {} }))
vi.mock('../src/main/services/scheduler', () => ({ schedulerService: { refresh } }))

const { WindowManager } = await import('../src/main/windows')

beforeEach(() => vi.clearAllMocks())

describe('popup shortcuts', () => {
  const input = (key: string, overrides = {}) => ({
    key, type: 'keyDown', meta: true, control: false, shift: false, alt: false, ...overrides
  })

  it('hides on Escape', () => {
    const popup = new WindowManager().createPopupWindow()
    const event = { preventDefault: vi.fn() }
    popup.webContents.emit('before-input-event', event, input('Escape', { meta: false }))
    expect(event.preventDefault).toHaveBeenCalledOnce()
    expect(popup.hide).toHaveBeenCalledOnce()
  })

  it('uses the same forced scheduler refresh as the button on Command-R', () => {
    const popup = new WindowManager().createPopupWindow()
    const event = { preventDefault: vi.fn() }
    popup.webContents.emit('before-input-event', event, input('r'))
    expect(event.preventDefault).toHaveBeenCalledOnce()
    expect(refresh).toHaveBeenCalledExactlyOnceWith(true)
  })

  it('opens Settings on Command-comma', () => {
    const manager = new WindowManager()
    const settings = vi.spyOn(manager, 'showSettings').mockImplementation(() => {})
    const popup = manager.createPopupWindow()
    popup.webContents.emit('before-input-event', { preventDefault: vi.fn() }, input(','))
    expect(settings).toHaveBeenCalledOnce()
  })

  it('quits on Command-Q', () => {
    const popup = new WindowManager().createPopupWindow()
    popup.webContents.emit('before-input-event', { preventDefault: vi.fn() }, input('q'))
    expect(quit).toHaveBeenCalledOnce()
  })

  it.each([
    input('r', { meta: false }), input('r', { type: 'keyUp' }), input('r', { alt: true }),
    input('r', { shift: true }), input('r', { control: true }), input('a')
  ])('leaves unrelated input untouched: %o', (keyInput) => {
    const popup = new WindowManager().createPopupWindow()
    const event = { preventDefault: vi.fn() }
    popup.webContents.emit('before-input-event', event, keyInput)
    expect(event.preventDefault).not.toHaveBeenCalled()
    expect(refresh).not.toHaveBeenCalled()
    expect(quit).not.toHaveBeenCalled()
  })
})
