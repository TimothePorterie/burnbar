import { Notification } from 'electron'
import { quotaService } from './quota-api'
import { settingsStore } from './settings-store'
import { logger } from './logger'
import { getLocale, t } from '../../shared/i18n'
import { getQuotaLevel, WARNING_THRESHOLD, type QuotaLevel } from '../../shared/quota'
import type { ExtraUsageInfo, QuotaPeriod } from '../../shared/types'

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
    if (quota.extraUsage?.isEnabled) this.checkExtraUsage(quota.extraUsage)
  }

  private checkExtraUsage(extra: ExtraUsageInfo): void {
    const previous = settingsStore.get('extraUsageNotified')
    const levels = previous && extra.usedCredits >= previous.used ? [...previous.levels] : []
    const body = t('notification.extraBody', { amount: this.formatMoney(extra.usedCredits, extra.currency) })
    const reached: ('started' | '50' | '90')[] = []
    if (extra.usedCredits > 0) reached.push('started')
    if (extra.monthlyLimit > 0) {
      if (extra.usedCredits >= extra.monthlyLimit * 0.5) reached.push('50')
      if (extra.usedCredits >= extra.monthlyLimit * 0.9) reached.push('90')
    }
    const newLevels = reached.filter((level) => !levels.includes(level))
    levels.push(...newLevels)
    // Several thresholds crossed in one fetch: announce only the highest
    const level = newLevels.at(-1)
    if (previous && level) {
      const title = level === 'started' ? t('notification.extraStarted') : t('notification.extraThreshold', {
        pct: level, limit: this.formatMoney(extra.monthlyLimit, extra.currency)
      })
      this.send(title, body)
    }
    settingsStore.set('extraUsageNotified', { used: extra.usedCredits, levels })
  }

  private formatMoney(credits: number, currency: string): string {
    try {
      return new Intl.NumberFormat(getLocale(), { style: 'currency', currency }).format(credits / 100)
    } catch {
      return `${new Intl.NumberFormat(getLocale(), { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(credits / 100)} ${currency}`
    }
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
