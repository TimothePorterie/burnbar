import { Notification } from 'electron'
import { quotaService } from './quota-api'
import { settingsStore } from './settings-store'
import { logger } from './logger'
import { t } from '../../shared/i18n'
import { getQuotaLevel, type QuotaLevel } from '../../shared/quota'

const LEVEL_PRIORITY: Record<QuotaLevel, number> = { normal: 0, warning: 1, critical: 2 }

export class NotificationService {
  checkAndNotify(): void {
    if (!settingsStore.get('enableNotifications')) return

    const quota = quotaService.getCachedQuota()
    if (!quota) return

    // Stable keys (not translated labels) persisted across restarts, so a level
    // already notified isn't announced again on launch or language change
    const levels = { ...settingsStore.get('notifiedLevels') }
    this.checkPeriod(levels, 'fiveHour', 'popup.session', quota.fiveHour.utilization)
    this.checkPeriod(levels, 'sevenDay', 'popup.weekly', quota.sevenDay.utilization)
    if (quota.sevenDayOpus) {
      this.checkPeriod(levels, 'sevenDayOpus', 'popup.opus', quota.sevenDayOpus.utilization)
    }
    settingsStore.set('notifiedLevels', levels)
  }

  private checkPeriod(levels: Record<string, QuotaLevel>, key: string, labelKey: string, utilization: number): void {
    const newLevel = getQuotaLevel(utilization)
    const previousLevel = levels[key] ?? 'normal'
    levels[key] = newLevel

    // Only notify when crossing upward into warning or critical
    if (LEVEL_PRIORITY[newLevel] <= LEVEL_PRIORITY[previousLevel]) return

    const label = t(labelKey)
    const pct = Math.round(utilization)
    const title = t('notification.thresholdTitle', { label, pct })
    const body =
      newLevel === 'critical' ? t('notification.critical') : t('notification.warning')
    this.send(title, body)
  }

  private send(title: string, body: string): void {
    if (!Notification.isSupported()) return

    const notification = new Notification({ title: t('notification.prefix', { title }), body })
    notification.show()
    logger.info(`Notification: ${title}`)
  }
}

export const notificationService = new NotificationService()
