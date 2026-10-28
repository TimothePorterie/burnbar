import { Tray, Menu, nativeImage, app } from 'electron'
import { join } from 'path'
import { quotaService } from './services/quota-api'
import { schedulerService } from './services/scheduler'
import { updaterService } from './services/updater'
import { logger } from './services/logger'
import { windowManager } from './windows'
import { settingsStore } from './services/settings-store'
import { notificationService } from './services/notifications'
import { t, getLocale } from '../shared/i18n'

type DisplayMode = 'standard' | 'detailed' | 'compact' | 'minimal' | 'time-remaining'

export class TrayManager {
  private tray: Tray | null = null
  private onShowPopup: (() => void) | null = null
  private onShowSettings: (() => void) | null = null
  private minuteTimer: NodeJS.Timeout | null = null
  private lastNotifiedFetch = Date.now() // restored data predates this: notify only after a real fetch

  private getIconPath(type: 'normal' | 'warning' | 'critical' = 'normal'): string {
    const basePath = app.isPackaged
      ? join(process.resourcesPath, 'assets')
      : join(__dirname, '../../assets')

    switch (type) {
      case 'warning':
        return join(basePath, 'icon-warning.png')
      case 'critical':
        return join(basePath, 'icon-critical.png')
      default:
        return join(basePath, 'iconTemplate.png')
    }
  }

  create(callbacks: { onShowPopup: () => void; onShowSettings: () => void }): void {
    this.onShowPopup = callbacks.onShowPopup
    this.onShowSettings = callbacks.onShowSettings

    const iconPath = this.getIconPath()
    const icon = nativeImage.createFromPath(iconPath)
    icon.setTemplateImage(true)

    this.tray = new Tray(icon)
    this.refreshDisplay()
    this.syncMinuteTimer()

    // Left click shows popup (scheduler handles periodic refresh)
    this.tray.on('click', () => {
      if (this.onShowPopup) {
        this.onShowPopup()
      }
    })

    // Right click shows context menu
    this.tray.on('right-click', () => {
      this.showContextMenu()
    })

    // Listen for quota updates
    schedulerService.onRefresh(() => {
      this.refreshDisplay()
      // Send updated quota to popup window
      const quota = quotaService.getCachedQuota()
      if (quota) {
        windowManager.sendToPopup('quota-updated', quota)
        // Throttled, rate-limited or failed refreshes return the same lastUpdated
        const fetchedAt = quota.lastUpdated.getTime()
        if (fetchedAt > this.lastNotifiedFetch) {
          this.lastNotifiedFetch = fetchedAt
          notificationService.checkAndNotify()
        }
      }
      // Nothing to show: forward the error so the popup doesn't stay on the skeleton
      const error = quotaService.getLastError()
      if (error && !quota) {
        windowManager.sendToPopup('quota-error', error)
      }
    })

    logger.info('Tray created')
  }

  private getDisplayMode(): DisplayMode {
    return (settingsStore.get('displayMode') as DisplayMode) || 'standard'
  }

  private setDisplayMode(mode: DisplayMode): void {
    settingsStore.set('displayMode', mode)
    this.updateTitle()
    this.syncMinuteTimer()
    logger.info(`Display mode changed to: ${mode}`)
  }

  // The countdown only moves in time-remaining mode
  private syncMinuteTimer(): void {
    const needed = this.getDisplayMode() === 'time-remaining'
    if (needed && !this.minuteTimer) {
      this.minuteTimer = setInterval(() => this.updateTitle(), 60000)
    } else if (!needed && this.minuteTimer) {
      clearInterval(this.minuteTimer)
      this.minuteTimer = null
    }
  }

  refreshDisplay(): void {
    this.updateTitle()
    this.updateIcon()
    this.updateTooltip()
  }

  // Errors other than rate limits (cached data is still valid then), or data too old to trust
  private needsAttention(): boolean {
    const lastError = quotaService.getLastError()
    return (!!lastError && lastError.type !== 'rate_limit') || !!quotaService.getCachedQuota()?.stale
  }

  updateTitle(): void {
    if (!this.tray) return

    const lastError = quotaService.getLastError()
    const hasError = !!lastError && lastError.type !== 'rate_limit'
    const quota = quotaService.getCachedQuota()
    if (!quota) {
      if (hasError) {
        this.tray.setTitle(`\u26a0 ${t(lastError.type === 'auth' ? 'tray.login' : 'tray.error')}`)
      } else {
        this.tray.setTitle('-- / --')
      }
      return
    }

    const fiveHour = Math.round(quota.fiveHour.utilization)
    const sevenDay = Math.round(quota.sevenDay.utilization)
    const opus = quota.sevenDayOpus ? Math.round(quota.sevenDayOpus.utilization) : null
    let title: string

    switch (this.getDisplayMode()) {
      case 'detailed':
        title = opus !== null
          ? t('tray.detailedOpusFmt', { five: fiveHour, seven: sevenDay, opus })
          : t('tray.detailedFmt', { five: fiveHour, seven: sevenDay })
        break
      case 'compact':
        title = `${fiveHour}%`
        break
      case 'minimal':
        title = ''
        break
      case 'time-remaining':
        title = quota.fiveHour.resetsIn
        break
      default: // standard
        title = `${fiveHour}% / ${sevenDay}%`
    }

    // Flag errors and stale data so an expired session doesn't hide behind old numbers
    this.tray.setTitle(this.needsAttention() ? `\u26a0 ${title}`.trim() : title)
  }

  updateIcon(): void {
    if (!this.tray) return

    if (this.needsAttention()) {
      const iconPath = this.getIconPath('warning')
      const icon = nativeImage.createFromPath(iconPath)
      this.tray.setImage(icon)
      return
    }

    const level = quotaService.getQuotaLevel()
    const iconPath = this.getIconPath(level)
    const icon = nativeImage.createFromPath(iconPath)

    if (level === 'normal') {
      icon.setTemplateImage(true)
    }

    this.tray.setImage(icon)
  }

  updateTooltip(): void {
    if (!this.tray) return

    const quota = quotaService.getCachedQuota()
    if (!quota) {
      const lastError = quotaService.getLastError()
      if (lastError) {
        this.tray.setToolTip(`Claude Bar \u2014 ${lastError.message}`)
      } else {
        this.tray.setToolTip(t('tray.clickToView'))
      }
      return
    }

    const fiveHour = Math.round(quota.fiveHour.utilization)
    const sevenDay = Math.round(quota.sevenDay.utilization)
    const lines = [
      t('tray.session', { pct: fiveHour, resets: quota.fiveHour.resetsIn }),
      t('tray.weekly', { pct: sevenDay, resets: quota.sevenDay.resetsIn })
    ]
    if (quota.sevenDayOpus) {
      lines.push(t('tray.opus', { pct: Math.round(quota.sevenDayOpus.utilization), resets: quota.sevenDayOpus.resetsIn }))
    }
    lines.push(t('tray.updated', { time: quota.lastUpdated.toLocaleTimeString(getLocale()) }))
    if (quota.error && quota.error.type !== 'rate_limit') {
      lines.push(quota.error.message)
    }
    if (quota.stale) {
      lines.push(t('tray.stale'))
    }
    this.tray.setToolTip(lines.join('\n'))
  }

  private showContextMenu(): void {
    const currentMode = this.getDisplayMode()

    const contextMenu = Menu.buildFromTemplate([
      {
        label: t('tray.refresh'),
        click: () => {
          schedulerService.refresh(true)
        }
      },
      { type: 'separator' },
      {
        label: t('tray.displayMode'),
        submenu: [
          {
            label: t('tray.standard'),
            type: 'radio',
            checked: currentMode === 'standard',
            click: () => this.setDisplayMode('standard')
          },
          {
            label: t('tray.detailed'),
            type: 'radio',
            checked: currentMode === 'detailed',
            click: () => this.setDisplayMode('detailed')
          },
          {
            label: t('tray.compact'),
            type: 'radio',
            checked: currentMode === 'compact',
            click: () => this.setDisplayMode('compact')
          },
          {
            label: t('tray.timeRemaining'),
            type: 'radio',
            checked: currentMode === 'time-remaining',
            click: () => this.setDisplayMode('time-remaining')
          },
          {
            label: t('tray.minimal'),
            type: 'radio',
            checked: currentMode === 'minimal',
            click: () => this.setDisplayMode('minimal')
          }
        ]
      },
      { type: 'separator' },
      {
        label: t('tray.settings'),
        click: () => {
          if (this.onShowSettings) {
            this.onShowSettings()
          }
        }
      },
      {
        label: t('tray.checkUpdates'),
        click: () => {
          updaterService.checkForUpdates()
        }
      },
      { type: 'separator' },
      {
        label: t('tray.quit'),
        click: () => {
          app.quit()
        }
      }
    ])

    this.tray?.popUpContextMenu(contextMenu)
  }

  getBounds(): Electron.Rectangle | null {
    return this.tray?.getBounds() ?? null
  }

  destroy(): void {
    if (this.minuteTimer) {
      clearInterval(this.minuteTimer)
      this.minuteTimer = null
    }
    if (this.tray) {
      this.tray.destroy()
      this.tray = null
    }
  }
}

export const trayManager = new TrayManager()
