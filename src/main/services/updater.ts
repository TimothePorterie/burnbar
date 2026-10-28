import { autoUpdater, UpdateInfo } from 'electron-updater'
import { BrowserWindow, app } from 'electron'
import { logger } from './logger'
import { t } from '../../shared/i18n'

export type UpdateStatus =
  | 'idle'
  | 'checking'
  | 'available'
  | 'not-available'
  | 'downloading'
  | 'downloaded'
  | 'error'

export interface UpdateState {
  status: UpdateStatus
  version?: string
  progress?: number
  error?: string
}

class UpdaterService {
  private state: UpdateState = { status: 'idle' }
  private initialized = false

  initialize(): void {
    if (this.initialized) return

    // Only enable auto-update in packaged builds
    if (!app.isPackaged) {
      logger.info('Auto-updater disabled in development mode')
      return
    }

    this.initialized = true

    autoUpdater.logger = null // We use our own logger
    autoUpdater.autoDownload = false
    autoUpdater.autoInstallOnAppQuit = true

    autoUpdater.on('checking-for-update', () => {
      this.setState({ status: 'checking' })
      logger.info('Checking for updates...')
    })

    autoUpdater.on('update-available', (info: UpdateInfo) => {
      this.setState({ status: 'available', version: info.version })
      logger.info(`Update available: v${info.version}`)
    })

    autoUpdater.on('update-not-available', (info: UpdateInfo) => {
      this.setState({ status: 'not-available', version: info.version })
      logger.info(`No update available (current: v${app.getVersion()}, latest: v${info.version})`)
    })

    autoUpdater.on('download-progress', (progress) => {
      this.setState({
        status: 'downloading',
        progress: Math.round(progress.percent)
      })
    })

    autoUpdater.on('update-downloaded', (info: UpdateInfo) => {
      this.setState({ status: 'downloaded', version: info.version })
      logger.info(`Update downloaded: v${info.version}, ready to install`)
    })

    autoUpdater.on('error', (err: Error) => {
      this.setState({ status: 'error', error: err.message })
      logger.error('Auto-updater error:', err.message)
    })

    setInterval(() => this.checkForUpdates(), 6 * 60 * 60 * 1000)

    logger.info('Auto-updater initialized')
  }

  async checkForUpdates(): Promise<void> {
    if (!this.initialized) {
      logger.debug('Auto-updater not initialized, skipping check')
      return
    }
    // A downloaded update waits for install: a new check would reset the status
    if (this.state.status === 'downloading' || this.state.status === 'downloaded') return

    try {
      await autoUpdater.checkForUpdates()
    } catch (error) {
      logger.error('Failed to check for updates:', error instanceof Error ? error.message : String(error))
      this.setState({ status: 'error', error: t('settings.updateFailed') })
    }
  }

  async downloadUpdate(): Promise<void> {
    if (!this.initialized) return

    try {
      await autoUpdater.downloadUpdate()
    } catch (error) {
      logger.error('Failed to download update:', error instanceof Error ? error.message : String(error))
      this.setState({ status: 'error', error: t('settings.downloadFailed') })
    }
  }

  installUpdate(): void {
    if (!this.initialized) return
    logger.info('Installing update and restarting...')
    autoUpdater.quitAndInstall()
  }

  getState(): UpdateState {
    return { ...this.state }
  }

  private setState(state: UpdateState): void {
    this.state = state
    // Broadcast to all renderer windows
    BrowserWindow.getAllWindows().forEach((win) => {
      if (!win.isDestroyed()) {
        win.webContents.send('update-status-changed', this.state)
      }
    })
  }
}

export const updaterService = new UpdaterService()
