import { Tray, Menu, nativeImage, app, BrowserWindow } from 'electron'
import { statusService } from './services/status'
import { quotaService } from './services/quota-api'
import { codexService } from './services/codex'
import { consumptionService } from './services/consumption'
import { codexScheduler, schedulerService } from './services/scheduler'
import { getEnabledProviders, getProvidersSnapshot, getTrayProvider, isProviderEnabled } from './services/providers'
import { updaterService } from './services/updater'
import { logger } from './services/logger'
import { windowManager } from './windows'
import { settingsStore } from './services/settings-store'
import { notificationService } from './services/notifications'
import { t } from '../shared/i18n'
import { formatRetry, formatUpdated, formatUsage } from '../shared/quota'
import type { CodexQuota, ModelQuota, QuotaError, QuotaInfo, QuotaPeriod } from '../shared/types'
import { renderGaugeBitmap } from './tray-icon'

type DisplayMode = 'standard' | 'detailed' | 'compact' | 'minimal' | 'time-remaining'

interface TraySource {
  name: string
  fiveHour?: QuotaPeriod
  sevenDay?: QuotaPeriod
  models: ModelQuota[]
}

// Tooltips are plain text: drop the backticks that mark `claude` as code in the popup
const plainText = (message: string): string => message.replaceAll('`', '')
const load = (source: TraySource): number => Math.max(source.fiveHour?.utilization ?? 0, source.sevenDay?.utilization ?? 0)
const barMax = (values: (number | undefined)[]): number | null =>
  values.some(value => value !== undefined) ? Math.max(...values.map(value => value ?? 0)) : null

// Popup and Settings follow provider changes
export function broadcastProviders(): void {
  void getProvidersSnapshot().then((snapshot) => {
    for (const window of BrowserWindow.getAllWindows()) {
      if (!window.isDestroyed()) window.webContents.send('providers-updated', snapshot)
    }
  })
}

export class TrayManager {
  private tray: Tray | null = null
  private onShowPopup: (() => void) | null = null
  private onShowSettings: (() => void) | null = null
  private minuteTimer: NodeJS.Timeout | null = null
  private lastNotifiedFetch = Date.now() // restored data predates this: notify only after a real fetch
  private lastNotifiedCodex = 0

  private claudeQuota(): QuotaInfo | null {
    return isProviderEnabled('claude') ? quotaService.getCachedQuota() : null
  }

  private codexQuota(): CodexQuota | null {
    return isProviderEnabled('codex') ? codexService.getCachedQuota() : null
  }

  // What the menu bar shows: one provider, or both for Highest
  private sources(): TraySource[] {
    const provider = getTrayProvider()
    const claude = provider === 'codex' ? null : this.claudeQuota()
    const codex = provider === 'claude' ? null : this.codexQuota()
    return [
      ...(claude ? [{ ...claude, name: 'Claude' }] : []),
      ...(codex ? [{ ...codex, name: 'Codex', models: [] }] : [])
    ]
  }

  private createIcon(): Electron.NativeImage {
    const sources = this.sources()
    const fiveHour = barMax(sources.map(source => source.fiveHour?.utilization))
    const sevenDay = barMax(sources.map(source => source.sevenDay?.utilization))
    const dimmed = this.needsAttention()
    const image = nativeImage.createFromBitmap(renderGaugeBitmap(fiveHour, sevenDay, 1, dimmed), {
      width: 18, height: 18, scaleFactor: 1
    })
    image.addRepresentation({
      scaleFactor: 2, width: 36, height: 36,
      buffer: renderGaugeBitmap(fiveHour, sevenDay, 2, dimmed)
    })
    image.setTemplateImage(true)
    return image
  }

  create(callbacks: { onShowPopup: () => void; onShowSettings: () => void }): void {
    this.onShowPopup = callbacks.onShowPopup
    this.onShowSettings = callbacks.onShowSettings

    this.tray = new Tray(this.createIcon(), '18f3a40d-d04b-4b87-972e-79bd0432eed3')
    this.refreshDisplay()
    // Countdowns, the data age and the stale dim move without a fetch
    this.minuteTimer = setInterval(() => this.refreshDisplay(), 60000)

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
      void statusService.refresh().then(() => {
        this.updateTooltip()
        const quota = quotaService.getCachedQuota()
        if (quota) windowManager.sendToPopup('quota-updated', quota)
      })
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

    codexScheduler.onRefresh(() => {
      this.refreshDisplay()
      broadcastProviders()
      const fetchedAt = codexService.getCachedQuota()?.lastUpdated.getTime() ?? 0
      if (fetchedAt > this.lastNotifiedCodex) {
        this.lastNotifiedCodex = fetchedAt
        notificationService.checkCodex()
      }
    })

    consumptionService.onRefresh(() => {
      this.updateTooltip()
      broadcastProviders()
    })

    logger.info('Tray created')
  }

  private getDisplayMode(): DisplayMode {
    return (settingsStore.get('displayMode') as DisplayMode) || 'standard'
  }

  private setDisplayMode(mode: DisplayMode): void {
    settingsStore.set('displayMode', mode)
    this.updateTitle()
    logger.info(`Display mode changed to: ${mode}`)
  }

  refreshDisplay(): void {
    this.updateTitle()
    this.updateIcon()
    this.updateTooltip()
  }

  setShowRemaining(enabled: boolean): void {
    settingsStore.set('showRemaining', enabled)
    windowManager.closePopup()
    this.refreshDisplay()
    for (const window of BrowserWindow.getAllWindows()) {
      if (!window.isDestroyed()) window.webContents.send('show-remaining-changed', enabled)
    }
  }

  private displayPercentage(utilization: number): number {
    return Math.round(settingsStore.get('showRemaining') ? 100 - utilization : utilization)
  }

  private percent(period: QuotaPeriod | undefined): string {
    return period ? `${this.displayPercentage(period.utilization)}%` : '—'
  }

  // Errors other than rate limits (cached data is still valid then), or data too old to trust
  private attention(lastError: QuotaError | null, quota: { stale?: boolean } | null): boolean {
    return (!!lastError && (lastError.type !== 'rate_limit' || !quota)) || !!quota?.stale
  }

  // Highest dims only when both providers do: one failing provider leaves the other's data valid
  private needsAttention(): boolean {
    const provider = getTrayProvider()
    const claude = (): boolean => this.attention(quotaService.getLastError(), this.claudeQuota())
    const codex = (): boolean => this.attention(codexService.getLastError(), this.codexQuota())
    return provider === 'max' ? claude() && codex() : provider === 'claude' ? claude() : codex()
  }

  updateTitle(): void {
    if (!this.tray) return

    const sources = this.sources()
    // Highest: the title follows the most loaded provider
    const source = sources.reduce<TraySource | null>((top, item) => !top || load(item) > load(top) ? item : top, null)
    if (!source) {
      this.tray.setTitle('', { fontType: 'monospacedDigit' })
      return
    }

    const fiveHour = this.percent(source.fiveHour)
    let title: string

    switch (this.getDisplayMode()) {
      case 'detailed': {
        const both = [this.claudeQuota(), this.codexQuota()]
        title = both.every(Boolean)
          ? [{ ...both[0]!, name: 'Claude' }, { ...both[1]!, name: 'Codex' }].map(item =>
            `${item.name} ${this.percent(item.fiveHour)} / ${this.percent(item.sevenDay)}`).join(' · ')
          : [t('tray.detailedFmt', { five: fiveHour, seven: this.percent(source.sevenDay) }),
            ...source.models.map(model => `${model.label}: ${this.displayPercentage(model.period.utilization)}%`)].join(' | ')
        break
      }
      case 'compact':
        title = fiveHour
        break
      case 'minimal':
        title = ''
        break
      case 'time-remaining':
        title = source.fiveHour?.resetsIn ?? '—'
        break
      default: // standard
        title = `${fiveHour} / ${this.percent(source.sevenDay)}`
    }

    this.tray.setTitle(title, { fontType: 'monospacedDigit' })
  }

  updateIcon(): void {
    if (!this.tray) return

    this.tray.setImage(this.createIcon())
  }

  private periodLines(fiveHour: QuotaPeriod | undefined, sevenDay: QuotaPeriod | undefined): string[] {
    const suffix = settingsStore.get('showRemaining') ? 'Remaining' : ''
    return [
      fiveHour
        ? t(`tray.session${suffix}`, { pct: this.displayPercentage(fiveHour.utilization), resets: fiveHour.resetsIn })
        : t('popup.noSession'),
      ...(sevenDay ? [t(`tray.weekly${suffix}`, { pct: this.displayPercentage(sevenDay.utilization), resets: sevenDay.resetsIn })] : [])
    ]
  }

  private ageLines(quota: { lastUpdated: Date; error?: QuotaError; stale?: boolean }): string[] {
    return [
      formatUpdated(quota.lastUpdated),
      ...(quota.error ? [plainText(quota.error.message), formatRetry(quota.error.retryAt)] : []),
      ...(quota.stale ? [t('tray.stale')] : [])
    ].filter(Boolean)
  }

  private errorLines(error: QuotaError | null): string[] {
    return error ? [plainText(error.message), formatRetry(error.retryAt)].filter(Boolean) : ['—']
  }

  private claudeLines(quota: QuotaInfo): string[] {
    const suffix = settingsStore.get('showRemaining') ? 'Remaining' : ''
    return [
      ...this.periodLines(quota.fiveHour, quota.sevenDay),
      ...quota.models.map(model => t(`tray.model${suffix}`, {
        label: model.label, pct: this.displayPercentage(model.period.utilization), resets: model.period.resetsIn
      })),
      ...(quota.status && quota.status.indicator !== 'none'
        ? [t('tray.anthropicStatus', { name: quota.status.incident?.name ?? t('status.disruption') })] : []),
      ...this.ageLines(quota)
    ]
  }

  updateTooltip(): void {
    if (!this.tray) return

    const enabled = getEnabledProviders()
    const quota = this.claudeQuota()
    if (!enabled.codex && !enabled.grok && !enabled.opencode) {
      const lastError = quotaService.getLastError()
      if (quota) this.tray.setToolTip(this.claudeLines(quota).join('\n'))
      else if (lastError) this.tray.setToolTip([t('tray.error', { message: plainText(lastError.message) }), formatRetry(lastError.retryAt)].filter(Boolean).join('\n'))
      else this.tray.setToolTip(t('tray.clickToView'))
      return
    }

    // One block per enabled provider
    const blocks: string[][] = []
    if (enabled.claude) blocks.push(['Claude Code', ...(quota ? this.claudeLines(quota) : this.errorLines(quotaService.getLastError()))])
    if (enabled.codex) {
      const codex = codexService.getCachedQuota()
      blocks.push(['Codex', ...(codex ? [
        ...this.periodLines(codex.fiveHour, codex.sevenDay),
        ...(codex.limitReached ? [t('codex.limitReached')] : []),
        ...(codex.resetsAvailable > 0 ? [t(codex.resetsAvailable === 1 ? 'codex.resetAvailable' : 'codex.resetsAvailable', { count: codex.resetsAvailable })] : []),
        ...this.ageLines(codex)
      ] : this.errorLines(codexService.getLastError()))])
    }
    const usage = (['grok', 'opencode'] as const).filter(id => enabled[id]).flatMap((id) => {
      const { data, error } = consumptionService.getView(id)
      const name = id === 'grok' ? 'Grok' : 'OpenCode'
      return [`${name}: ${data ? formatUsage(data) : plainText(error?.message ?? '\u2014')}`,
        ...(data && error ? [plainText(error.message)] : [])]
    })
    if (usage.length) blocks.push(usage)
    this.tray.setToolTip(blocks.map(lines => lines.join('\n')).join('\n\n'))
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
      {
        label: t('tray.showRemaining'),
        type: 'checkbox',
        checked: settingsStore.get('showRemaining'),
        click: (item) => this.setShowRemaining(item.checked)
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
