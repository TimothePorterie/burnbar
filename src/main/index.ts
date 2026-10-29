import { app, BrowserWindow, powerMonitor } from 'electron'
import { trayManager } from './tray'
import { windowManager } from './windows'
import { codexScheduler, schedulerService } from './services/scheduler'
import { consumptionService } from './services/consumption'
import { detectProviders } from './services/providers'
import { updaterService } from './services/updater'
import { setupIpcHandlers, loadSettings } from './ipc-handlers'
import { logger } from './services/logger'

// Prevent multiple instances
const gotTheLock = app.requestSingleInstanceLock()

if (!gotTheLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    windowManager.showSettings()
  })

  if (app.dock) {
    app.dock.hide()
  }

  process.on('unhandledRejection', (reason) => logger.error('Unhandled rejection:', reason))
  process.on('uncaughtException', (error) => logger.error('Uncaught exception:', error))

  app.whenReady().then(() => {
    logger.info(`BurnBar v${app.getVersion()} starting...`)

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

    // First launch turns on the installed tools before anything is fetched
    const detected = detectProviders().catch(error => logger.error('Provider detection failed:', error))

    // Start the schedulers (delay to allow network initialization)
    setTimeout(() => {
      void detected.then(() => {
        trayManager.refreshDisplay()
        schedulerService.start()
        codexScheduler.start()
        consumptionService.start()
        logger.info('Schedulers started after startup delay')
      })
    }, 2000)

    // Check for updates after a short delay (don't block startup)
    setTimeout(() => {
      updaterService.checkForUpdates()
    }, 5000)

    // Restart after wake from sleep: drops backoff timers frozen during sleep
    // (network needs a moment to reconnect)
    powerMonitor.on('resume', () => {
      logger.info('System resumed from sleep, restarting scheduler')
      for (const scheduler of [schedulerService, codexScheduler]) {
        scheduler.stop()
        setTimeout(() => scheduler.start(true), 2000)
      }
    })

    powerMonitor.on('lock-screen', () => {
      schedulerService.setScreenLocked(true)
      codexScheduler.setScreenLocked(true)
    })
    powerMonitor.on('unlock-screen', () => {
      for (const scheduler of [schedulerService, codexScheduler]) {
        scheduler.setScreenLocked(false)
        void scheduler.refresh()
      }
    })
    // Back from another login session: the idle pause may have let the data age (throttle still applies)
    powerMonitor.on('user-did-become-active', () => {
      void schedulerService.refresh()
      void codexScheduler.refresh()
    })

    logger.info('BurnBar started successfully')
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
    logger.info('BurnBar shutting down...')
    schedulerService.stop()
    codexScheduler.stop()
    consumptionService.stop()
    trayManager.destroy()
    windowManager.closeAll()
  })
}
