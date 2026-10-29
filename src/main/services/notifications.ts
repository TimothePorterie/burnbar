import { Notification } from 'electron'
import { quotaService } from './quota-api'
import { settingsStore } from './settings-store'
import { logger } from './logger'
import { t } from '../../shared/i18n'
import { getQuotaLevel, WARNING_THRESHOLD, type QuotaLevel } from '../../shared/quota'
import type { QuotaPeriod } from '../../shared/types'

const LEVEL_PRIORITY: Record<QuotaLevel, number> = { normal: 0, warning: 1, critical: 2 }

export class NotificationService {
  checkAndNotify(): void {
    if (!settingsStore.get('enableNotifications')) return
    const quota = quotaService.getCachedQuota()
    if (!quota || quota.error || quota.stale) return

    const levels = { ...settingsStore.get('notifiedLevels') }
    const resets = { ...settingsStore.get('resetNotifications') }
    for (const [key, period, label] of [
      ['fiveHour', quota.fiveHour, t('popup.session')],
      ['sevenDay', quota.sevenDay, t('popup.weekly')]
    ] as const) {
      let previous: (typeof resets)[string] | undefined = resets[key]
      // Fire once the stored reset time has passed, even if the API has no new window yet
      if (previous && Date.now() >= previous.resetsAt && previous.utilization >= WARNING_THRESHOLD) {
        this.send(t(`notification.${key}Reset`), t('notification.resetBody'))
        previous = undefined
        delete resets[key]
      }
      if (!period) continue
      const resetsAt = new Date(period.resetsAt).getTime()
      if (Number.isFinite(resetsAt)) {
        resets[key] = { resetsAt, utilization: previous?.resetsAt === resetsAt
          ? Math.max(previous.utilization, period.utilization) : period.utilization }
      }
      this.checkPeriod(levels, key, label, period)
    }
    for (const model of quota.models) {
      this.checkPeriod(levels, model.key, model.label, model.period)
    }
    delete levels.sevenDayOpus
    settingsStore.set('notifiedLevels', levels)
    settingsStore.set('resetNotifications', resets)
  }

  private checkPeriod(levels: Record<string, QuotaLevel>, key: string, label: string, period: QuotaPeriod): void {
    const newLevel = getQuotaLevel(period.utilization)
    const previousLevel = levels[key] ?? (key === 'seven_day_opus' ? levels.sevenDayOpus : undefined) ?? 'normal'
    levels[key] = newLevel
    if (LEVEL_PRIORITY[newLevel] <= LEVEL_PRIORITY[previousLevel]) return

    const title = t('notification.thresholdTitle', { label, pct: Math.round(period.utilization) })
    const body = newLevel === 'critical' ? t('notification.critical') : t('notification.warning')
    this.send(title, body)
  }

  private send(title: string, body: string): void {
    if (!Notification.isSupported()) return
    new Notification({ title, body }).show()
    logger.info(`Notification: ${title}`)
  }
}

export const notificationService = new NotificationService()
