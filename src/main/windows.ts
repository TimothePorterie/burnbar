import { BrowserWindow, screen, app, session, ipcMain, systemPreferences } from 'electron'
import { join } from 'path'
import { trayManager } from './tray'
import { logger } from './services/logger'
import { quotaService } from './services/quota-api'
import { schedulerService } from './services/scheduler'

// Content Security Policy
const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'", // Allow inline styles for dynamic styling
  "img-src 'self' data:",
  "font-src 'self'",
  "connect-src 'self' https://api.anthropic.com", // Allow Anthropic API
  "frame-src 'none'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'none'",
  "upgrade-insecure-requests"
].join('; ')

// Permissions Policy - disable unnecessary browser features
const PERMISSIONS_POLICY = [
  'camera=()',
  'microphone=()',
  'geolocation=()',
  'payment=()',
  'usb=()',
  'magnetometer=()',
  'gyroscope=()',
  'accelerometer=()'
].join(', ')

export class WindowManager {
  private popupWindow: BrowserWindow | null = null
  private settingsWindow: BrowserWindow | null = null
  private securityInitialized = false
  private ipcSetup = false
  private popupHiddenAt = 0

  constructor() {
    // Defer security setup until app is ready
    if (app.isReady()) {
      this.setupSecurityHeaders()
      this.setupIpcHandlers()
      this.setupAutoHide()
    } else {
      app.once('ready', () => {
        this.setupSecurityHeaders()
        this.setupIpcHandlers()
        this.setupAutoHide()
      })
    }
  }

  // Close the popup when the context changes under it: Space switch (incl. an app
  // going fullscreen) or display configuration change. Blur covers app switches.
  private setupAutoHide(): void {
    const hide = (): void => this.hidePopup()
    systemPreferences.subscribeWorkspaceNotification('NSWorkspaceActiveSpaceDidChangeNotification', hide)
    screen.on('display-added', hide)
    screen.on('display-removed', hide)
    screen.on('display-metrics-changed', hide)
  }

  private hidePopup(): void {
    if (this.popupWindow && !this.popupWindow.isDestroyed() && this.popupWindow.isVisible()) {
      this.popupWindow.hide()
      this.popupHiddenAt = Date.now()
    }
  }

  // Place the popup under the tray icon, on the display that holds it
  private positionPopup(): void {
    if (!this.popupWindow || this.popupWindow.isDestroyed()) return
    const trayBounds = trayManager.getBounds()
    if (!trayBounds) return

    const { width } = this.popupWindow.getBounds()
    if (trayBounds.width === 0) {
      const area = screen.getPrimaryDisplay().workArea
      this.popupWindow.setPosition(area.x + area.width - width - 10, area.y + 5)
      return
    }
    const area = screen.getDisplayNearestPoint({ x: trayBounds.x, y: trayBounds.y }).workArea
    let x = Math.round(trayBounds.x - width / 2 + trayBounds.width / 2)
    x = Math.max(area.x + 10, Math.min(x, area.x + area.width - width - 10))
    this.popupWindow.setPosition(x, trayBounds.y + trayBounds.height + 5)
  }

  private revealPopup(): void {
    if (!this.popupWindow || this.popupWindow.isDestroyed()) return
    this.positionPopup()
    // resetsIn/resetProgress are computed at send time — refresh them on every open
    const quota = quotaService.getCachedQuota()
    if (quota) this.sendToPopup('quota-updated', quota)
    // Activate the app so the popup becomes key and receives blur when clicking elsewhere
    app.focus({ steal: true })
    this.popupWindow.show()
    this.popupWindow.focus()
  }

  private setupIpcHandlers(): void {
    if (this.ipcSetup) return
    this.ipcSetup = true

    // Handle content height reports from popup
    ipcMain.on('popup-content-height', (_event, height: unknown) => {
      if (typeof height !== 'number' || !Number.isFinite(height)) return
      if (this.popupWindow && !this.popupWindow.isDestroyed()) {
        const popupWidth = 320
        const maxHeight = 600
        const minHeight = 200
        const newHeight = Math.min(maxHeight, Math.max(minHeight, Math.ceil(height)))

        // Get current position
        const [x, y] = this.popupWindow.getPosition()

        // Resize the window
        this.popupWindow.setSize(popupWidth, newHeight)

        // Re-check bounds after resize
        const display = screen.getDisplayNearestPoint({ x, y })
        const displayBounds = display.workArea

        // Ensure window stays within screen bounds
        let newX = x
        let newY = y

        if (newX + popupWidth > displayBounds.x + displayBounds.width) {
          newX = displayBounds.x + displayBounds.width - popupWidth - 10
        }
        if (newY + newHeight > displayBounds.y + displayBounds.height) {
          newY = displayBounds.y + displayBounds.height - newHeight - 10
        }

        if (newX !== x || newY !== y) {
          this.popupWindow.setPosition(newX, newY)
        }
      }
    })
  }

  private setupSecurityHeaders(): void {
    if (this.securityInitialized) return
    this.securityInitialized = true

    // Add security headers to all responses
    session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
      callback({
        responseHeaders: {
          ...details.responseHeaders,
          'Content-Security-Policy': [CSP],
          'Permissions-Policy': [PERMISSIONS_POLICY],
          'X-Content-Type-Options': ['nosniff'],
          'X-Frame-Options': ['DENY'],
          'Referrer-Policy': ['strict-origin-when-cross-origin']
        }
      })
    })

    // The renderers need no camera, notifications, geolocation...
    session.defaultSession.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false))

    // Block navigation to external URLs
    app.on('web-contents-created', (_event, contents) => {
      contents.on('will-navigate', (event, navigationUrl) => {
        // Only allow navigation to local files, or the exact dev server origin in development
        const devUrl = process.env.ELECTRON_RENDERER_URL
        let allowed = false
        try {
          const parsedUrl = new URL(navigationUrl)
          allowed = parsedUrl.protocol === 'file:' || (!app.isPackaged && !!devUrl && parsedUrl.origin === new URL(devUrl).origin)
        } catch {
          allowed = false
        }
        if (!allowed) {
          logger.warn(`Blocked navigation to: ${navigationUrl}`)
          event.preventDefault()
        }
      })

      // Block new window creation
      contents.setWindowOpenHandler(({ url }) => {
        logger.warn(`Blocked new window to: ${url}`)
        return { action: 'deny' }
      })
    })
  }

  createPopupWindow(): BrowserWindow {
    // Close existing popup if any
    if (this.popupWindow && !this.popupWindow.isDestroyed()) {
      this.popupWindow.close()
    }

    const popupWidth = 320
    const popupHeight = 300 // Initial height, will be adjusted based on content

    this.popupWindow = new BrowserWindow({
      width: popupWidth,
      height: popupHeight,
      frame: false,
      resizable: false,
      movable: false,
      minimizable: false,
      maximizable: false,
      closable: true,
      alwaysOnTop: true,
      skipTaskbar: true,
      show: false,
      transparent: true,
      vibrancy: 'popover',
      visualEffectState: 'active',
      fullscreenable: false,
      webPreferences: {
        preload: join(__dirname, '../preload/index.js'),
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
        webSecurity: true,
        allowRunningInsecureContent: false,
        experimentalFeatures: false,
        enableBlinkFeatures: '',
        spellcheck: false,
        devTools: !app.isPackaged // Only enable in development
      }
    })

    // Open on whichever Space is active, including over fullscreen apps (macOS).
    // skipTransformProcessType keeps the dock icon hidden.
    this.popupWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true, skipTransformProcessType: true })
    this.popupWindow.setAlwaysOnTop(true, 'pop-up-menu')

    // Load the popup HTML
    if (app.isPackaged) {
      this.popupWindow.loadFile(join(__dirname, '../renderer/popup/index.html'))
    } else {
      const url = process.env.ELECTRON_RENDERER_URL
      if (url) {
        this.popupWindow.loadURL(`${url}/popup/index.html`)
      } else {
        this.popupWindow.loadFile(join(__dirname, '../renderer/popup/index.html'))
      }
    }

    this.popupWindow.webContents.on('before-input-event', (event, input) => {
      if (input.type !== 'keyDown') return
      const key = input.key.toLowerCase()
      if (key === 'escape') {
        event.preventDefault()
        this.hidePopup()
      } else if (input.meta && !input.alt && !input.control && !input.shift) {
        if (!['r', ',', 'q'].includes(key)) return
        event.preventDefault()
        if (key === 'r') void schedulerService.refresh(true)
        if (key === ',') this.showSettings()
        if (key === 'q') app.quit()
      }
    })

    // Hide when loses focus
    this.popupWindow.on('blur', () => this.hidePopup())

    this.popupWindow.once('ready-to-show', () => this.revealPopup())

    return this.popupWindow
  }

  showPopup(): void {
    if (!this.popupWindow || this.popupWindow.isDestroyed()) {
      this.createPopupWindow()
    } else if (this.popupWindow.isVisible()) {
      this.hidePopup()
    } else if (Date.now() - this.popupHiddenAt > 300) {
      // Clicking the tray icon blurs the popup before the click lands:
      // without this guard the toggle-close would immediately reopen it
      this.revealPopup()
    }
  }

  createSettingsWindow(): BrowserWindow {
    if (this.settingsWindow && !this.settingsWindow.isDestroyed()) {
      this.settingsWindow.focus()
      return this.settingsWindow
    }

    this.settingsWindow = new BrowserWindow({
      width: 420,
      height: 540,
      title: 'Claude Bar Settings',
      resizable: false,
      minimizable: true,
      maximizable: false,
      show: false,
      titleBarStyle: 'hiddenInset',
      vibrancy: 'window',
      webPreferences: {
        preload: join(__dirname, '../preload/index.js'),
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
        webSecurity: true,
        allowRunningInsecureContent: false,
        experimentalFeatures: false,
        enableBlinkFeatures: '',
        spellcheck: false,
        devTools: !app.isPackaged // Only enable in development
      }
    })

    // Load the settings HTML
    if (app.isPackaged) {
      this.settingsWindow.loadFile(join(__dirname, '../renderer/settings/index.html'))
    } else {
      const url = process.env.ELECTRON_RENDERER_URL
      if (url) {
        this.settingsWindow.loadURL(`${url}/settings/index.html`)
      } else {
        this.settingsWindow.loadFile(join(__dirname, '../renderer/settings/index.html'))
      }
    }

    this.settingsWindow.once('ready-to-show', () => {
      this.settingsWindow?.show()
    })

    this.settingsWindow.on('closed', () => {
      this.settingsWindow = null
    })

    return this.settingsWindow
  }

  showSettings(): void {
    this.createSettingsWindow()
  }

  // Renderer reads the locale at load: drop the popup so it's rebuilt in the new language
  closePopup(): void {
    if (this.popupWindow && !this.popupWindow.isDestroyed()) {
      this.popupWindow.close()
    }
    this.popupWindow = null
  }

  closeAll(): void {
    if (this.popupWindow && !this.popupWindow.isDestroyed()) {
      this.popupWindow.close()
    }
    if (this.settingsWindow && !this.settingsWindow.isDestroyed()) {
      this.settingsWindow.close()
    }
  }

  sendToPopup(channel: string, data: unknown): void {
    if (this.popupWindow && !this.popupWindow.isDestroyed()) {
      this.popupWindow.webContents.send(channel, data)
    }
  }
}

export const windowManager = new WindowManager()
