import { ipcMain, app, BrowserWindow, shell, nativeTheme } from 'electron'
import { keychainService } from './services/keychain'
import { quotaService, QuotaInfo } from './services/quota-api'
import { codexScheduler, schedulerService } from './services/scheduler'
import { consumptionService } from './services/consumption'
import { getProvidersSnapshot, PROVIDER_IDS, setProviderEnabled } from './services/providers'
import { updaterService } from './services/updater'
import { logger } from './services/logger'
import { windowManager } from './windows'
import { broadcastProviders, trayManager } from './tray'
import { isStatusPageUrl } from './services/status'
import { settingsStore as store } from './services/settings-store'
import type { Locale } from '../shared/i18n'
import type { ProviderId, TrayProvider } from '../shared/types'
import { setLocale } from '../shared/i18n'

// Input validation helpers
const VALID_REFRESH_INTERVALS = [300, 600, 900] as const

function isValidRefreshInterval(value: unknown): value is number {
  return typeof value === 'number' && VALID_REFRESH_INTERVALS.includes(value as 300 | 600 | 900)
}

function isValidBoolean(value: unknown): value is boolean {
  return typeof value === 'boolean'
}

const VALID_LANGUAGES = ['en', 'fr'] as const
const VALID_THEMES = ['system', 'light', 'dark'] as const

function isValidTheme(value: unknown): value is 'system' | 'light' | 'dark' {
  return typeof value === 'string' && VALID_THEMES.includes(value as 'system' | 'light' | 'dark')
}

const VALID_TRAY_PROVIDERS = ['claude', 'codex', 'max'] as const

function isValidTrayProvider(value: unknown): value is TrayProvider {
  return typeof value === 'string' && VALID_TRAY_PROVIDERS.includes(value as TrayProvider)
}

function isValidProvider(value: unknown): value is ProviderId {
  return typeof value === 'string' && PROVIDER_IDS.includes(value as ProviderId)
}

function isValidLanguage(value: unknown): value is Locale {
  return typeof value === 'string' && VALID_LANGUAGES.includes(value as Locale)
}

function broadcast(channel: string, data: unknown): void {
  BrowserWindow.getAllWindows().forEach((win) => {
    if (!win.isDestroyed()) {
      win.webContents.send(channel, data)
    }
  })
}

// macOS 13+: 'requires-approval' means the user must allow the app in System Settings > General > Login Items
function loginItemStatus(): Electron.LoginItemSettings['status'] | undefined {
  return app.isPackaged ? app.getLoginItemSettings().status : undefined
}

export function setupIpcHandlers(): void {
  // Get quota data (cache only)
  ipcMain.handle('get-quota', async (): Promise<QuotaInfo | null> => {
    try {
      return quotaService.getCachedQuota()
    } catch (error) {
      logger.error('IPC get-quota error:', error)
      return null
    }
  })

  // Force refresh quota (bypass min-interval); consumption keeps its 15 min floor
  ipcMain.handle('refresh-quota', async () => {
    try {
      void consumptionService.refresh()
      await Promise.all([schedulerService.refresh(true), codexScheduler.refresh(true)])
      return {
        quota: quotaService.getCachedQuota(),
        throttled: quotaService.wasThrottled(),
        retryIn: Math.ceil(quotaService.getThrottleRemainingMs() / 1000)
      }
    } catch (error) {
      logger.error('IPC refresh-quota error:', error)
      return { quota: null, throttled: false, retryIn: 0 }
    }
  })

  // Check if credentials exist
  ipcMain.handle('has-credentials', async (): Promise<boolean> => {
    try {
      return await keychainService.hasCredentials()
    } catch (error) {
      logger.error('IPC has-credentials error:', error)
      return false
    }
  })

  // Get user info
  ipcMain.handle(
    'get-user-info',
    async (): Promise<{ email?: string; name?: string; subscriptionType?: string } | null> => {
      try {
        const credentials = await keychainService.getCredentials()
        if (!credentials) return null

        return {
          email: credentials.emailAddress,
          name: credentials.displayName,
          subscriptionType: credentials.subscriptionType
        }
      } catch (error) {
        logger.error('IPC get-user-info error:', error)
        return null
      }
    }
  )

  // Settings handlers
  ipcMain.handle('get-settings', () => {
    try {
      return {
        refreshInterval: store.get('refreshInterval'),
        launchAtLogin: store.get('launchAtLogin'),
        launchAtLoginStatus: loginItemStatus(),
        enableNotifications: store.get('enableNotifications'),
        language: store.get('language'),
        theme: store.get('theme'),
        showRemaining: store.get('showRemaining'),
        trayProvider: store.get('trayProvider')
      }
    } catch (error) {
      logger.error('IPC get-settings error:', error)
      return {
        refreshInterval: 300,
        launchAtLogin: false,
        enableNotifications: true,
        language: 'en',
        theme: 'system',
        showRemaining: false,
        trayProvider: 'claude'
      }
    }
  })

  ipcMain.handle('get-providers', async () => {
    try {
      return await getProvidersSnapshot()
    } catch (error) {
      logger.error('IPC get-providers error:', error)
      return null
    }
  })

  ipcMain.handle('set-provider-enabled', (_event, id: unknown, enabled: unknown) => {
    if (!isValidProvider(id) || !isValidBoolean(enabled)) {
      logger.warn(`Invalid provider toggle rejected: ${id}=${enabled}`)
      return false
    }
    setProviderEnabled(id, enabled)
    // Rebuilt with the new sections on next open
    windowManager.closePopup()
    const scheduler = id === 'claude' ? schedulerService : id === 'codex' ? codexScheduler : null
    scheduler?.stop()
    if (scheduler && enabled) scheduler.start(true)
    else if (enabled) void consumptionService.refresh(true)
    trayManager.refreshDisplay()
    broadcastProviders()
    logger.info(`Provider ${id}: ${enabled ? 'on' : 'off'}`)
    return true
  })

  ipcMain.handle('set-tray-provider', (_event, provider: unknown) => {
    if (!isValidTrayProvider(provider)) {
      logger.warn(`Invalid tray provider rejected: ${provider}`)
      return false
    }
    store.set('trayProvider', provider)
    trayManager.refreshDisplay()
    logger.info(`Menu bar shows '${provider}'`)
    return true
  })

  ipcMain.handle('open-status-page', async (_event, url: unknown) => {
    if (!isStatusPageUrl(url)) return false
    try {
      await shell.openExternal(url)
      return true
    } catch (error) {
      logger.debug('Could not open status page:', error)
      return false
    }
  })

  ipcMain.handle('set-show-remaining', (_event, enabled: unknown) => {
    if (!isValidBoolean(enabled)) return false
    trayManager.setShowRemaining(enabled)
    return true
  })

  ipcMain.handle('set-refresh-interval', (_event, seconds: unknown) => {
    if (!isValidRefreshInterval(seconds)) {
      logger.warn(`Invalid refresh interval rejected: ${seconds}`)
      return false
    }

    try {
      store.set('refreshInterval', seconds)
      schedulerService.setRefreshInterval(seconds)
      codexScheduler.setRefreshInterval(seconds)
      logger.info(`Refresh interval set to ${seconds}s`)
      return true
    } catch (error) {
      logger.error('IPC set-refresh-interval error:', error)
      return false
    }
  })

  ipcMain.handle('set-launch-at-login', (_event, enabled: unknown) => {
    if (!isValidBoolean(enabled)) {
      logger.warn(`Invalid launch-at-login value rejected: ${enabled}`)
      return false
    }

    try {
      store.set('launchAtLogin', enabled)
      if (app.isPackaged) {
        app.setLoginItemSettings({ openAtLogin: enabled })
        if (loginItemStatus() === 'requires-approval') logger.warn('Login item requires approval in System Settings')
      } else {
        logger.debug('Skipping setLoginItemSettings in development mode')
      }
      logger.info(`Launch at login: ${enabled}`)
      return true
    } catch (error) {
      logger.error('IPC set-launch-at-login error:', error)
      return false
    }
  })

  ipcMain.handle('open-login-items-settings', async () => {
    try {
      await shell.openExternal('x-apple.systempreferences:com.apple.LoginItems-Settings.extension')
      return true
    } catch (error) {
      logger.error('IPC open-login-items-settings error:', error)
      return false
    }
  })

  ipcMain.handle('set-enable-notifications', (_event, enabled: unknown) => {
    if (!isValidBoolean(enabled)) {
      logger.warn(`Invalid enable-notifications value rejected: ${enabled}`)
      return false
    }

    try {
      store.set('enableNotifications', enabled)
      logger.info(`Notifications: ${enabled}`)
      return true
    } catch (error) {
      logger.error('IPC set-enable-notifications error:', error)
      return false
    }
  })

  // themeSource drives prefers-color-scheme in every window and the native vibrancy appearance
  ipcMain.handle('set-theme', (_event, theme: unknown) => {
    if (!isValidTheme(theme)) {
      logger.warn(`Invalid theme rejected: ${theme}`)
      return false
    }
    store.set('theme', theme)
    nativeTheme.themeSource = theme
    logger.info(`Theme set to '${theme}'`)
    return true
  })

  ipcMain.handle('set-language', (_event, lang: unknown) => {
    if (!isValidLanguage(lang)) {
      logger.warn(`Invalid language rejected: ${lang}`)
      return false
    }

    try {
      store.set('language', lang)
      setLocale(lang)
      windowManager.closePopup()
      trayManager.refreshDisplay()
      broadcast('language-changed', lang)
      logger.info(`Language set to '${lang}'`)
      return true
    } catch (error) {
      logger.error('IPC set-language error:', error)
      return false
    }
  })

  // Get last error
  ipcMain.handle('get-last-error', () => {
    try {
      return quotaService.getLastError()
    } catch (error) {
      logger.error('IPC get-last-error error:', error)
      return null
    }
  })

  // Update handlers
  ipcMain.handle('check-for-updates', async () => {
    try {
      await updaterService.checkForUpdates()
      return true
    } catch (error) {
      logger.error('IPC check-for-updates error:', error)
      return false
    }
  })

  ipcMain.handle('download-update', async () => {
    try {
      await updaterService.downloadUpdate()
      return true
    } catch (error) {
      logger.error('IPC download-update error:', error)
      return false
    }
  })

  ipcMain.handle('install-update', () => {
    try {
      updaterService.installUpdate()
      return true
    } catch (error) {
      logger.error('IPC install-update error:', error)
      return false
    }
  })

  ipcMain.handle('get-update-status', () => {
    try {
      return updaterService.getState()
    } catch (error) {
      logger.error('IPC get-update-status error:', error)
      return { status: 'idle' }
    }
  })

  ipcMain.handle('get-app-version', () => {
    return app.getVersion()
  })

  // Open settings window from popup
  ipcMain.handle('open-settings', () => {
    try {
      windowManager.showSettings()
      return true
    } catch (error) {
      logger.error('IPC open-settings error:', error)
      return false
    }
  })

  ipcMain.handle('quit-app', () => app.quit())
}

export function loadSettings(): void {
  try {
    const refreshInterval = store.get('refreshInterval')
    if (isValidRefreshInterval(refreshInterval)) {
      schedulerService.setRefreshInterval(refreshInterval)
      codexScheduler.setRefreshInterval(refreshInterval)
    } else if (refreshInterval != null) {
      // Migrate obsolete value (e.g. 120s) to default
      store.set('refreshInterval', 300)
      logger.info(`Migrated invalid refresh interval ${refreshInterval}s → 300s`)
    }

    // The system Login Items list is the source of truth (the user can change it in System Settings)
    if (app.isPackaged) {
      const { openAtLogin, status } = app.getLoginItemSettings()
      store.set('launchAtLogin', openAtLogin || status === 'requires-approval')
    }

    const theme = store.get('theme')
    nativeTheme.themeSource = isValidTheme(theme) ? theme : 'system'

    const language = store.get('language')
    if (isValidLanguage(language)) {
      setLocale(language)
    }

    logger.info('Settings loaded')
  } catch (error) {
    logger.error('Failed to load settings:', error)
  }
}
