import { app, BrowserWindow, powerMonitor } from 'electron'
import { trayManager } from './tray'
import { windowManager } from './windows'
import { schedulerService } from './services/scheduler'
import { updaterService } from './services/updater'
import { authService } from './services/auth'
import { setupIpcHandlers, loadSettings } from './ipc-handlers'
import { logger } from './services/logger'

// Prevent multiple instances
const gotTheLock = app.requestSingleInstanceLock()

if (!gotTheLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    windowManager.showPopup()
  })

  if (app.dock) {
    app.dock.hide()
  }

  process.on('unhandledRejection', (reason) => logger.error('Unhandled rejection:', reason))
  process.on('uncaughtException', (error) => logger.error('Uncaught exception:', error))

  app.whenReady().then(() => {
    logger.info(`Claude Bar v${app.getVersion()} starting...`)

    // Initialize auth service
    authService.initialize()

    // Setup IPC handlers
    setupIpcHandlers()

    // Load saved settings
    loadSettings()

    // Create tray icon
    trayManager.create({
      onShowPopup: () => windowManager.showPopup(),
      onShowSettings: () => windowManager.showSettings()
    })

    // Initialize auto-updater
    updaterService.initialize()

    // Start the scheduler (delay to allow network initialization)
    setTimeout(() => {
      schedulerService.start()
      logger.info('Scheduler started after startup delay')
    }, 2000)

    // Check for updates after a short delay (don't block startup)
    setTimeout(() => {
      updaterService.checkForUpdates()
    }, 5000)

    // Restart after wake from sleep: drops backoff timers frozen during sleep
    // (network needs a moment to reconnect)
    powerMonitor.on('resume', () => {
      logger.info('System resumed from sleep, restarting scheduler')
      schedulerService.stop()
      setTimeout(() => schedulerService.start(true), 2000)
    })

    logger.info('Claude Bar started successfully')
  }).catch((error) => {
    logger.error('Startup failed:', error)
    app.quit()
  })

  // Registering the listener keeps the menu bar app alive when windows close
  app.on('window-all-closed', () => {})

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      windowManager.showPopup()
    }
  })

  app.on('before-quit', () => {
    logger.info('Claude Bar shutting down...')
    schedulerService.stop()
    trayManager.destroy()
    windowManager.closeAll()
  })
}
