import { getLocale, t } from './i18n'
import type { ConsumptionInfo } from './types'

export const WARNING_THRESHOLD = 70
export const CRITICAL_THRESHOLD = 90

export type QuotaLevel = 'normal' | 'warning' | 'critical'

export function getQuotaLevel(utilization: number): QuotaLevel {
  if (utilization >= CRITICAL_THRESHOLD) return 'critical'
  if (utilization >= WARNING_THRESHOLD) return 'warning'
  return 'normal'
}

export interface QuotaForecast {
  pace: 'hot' | 'on-track' | 'spare'
  runsOutAt?: Date
}

export function getForecast(
  utilization: number, resetProgress: number, resetsAt: Date, periodHours: number
): QuotaForecast | undefined {
  if (!Number.isFinite(utilization) || !Number.isFinite(resetProgress) ||
      resetProgress < 5 || resetProgress >= 100 || utilization <= 0 ||
      !Number.isFinite(resetsAt.getTime()) || !Number.isFinite(periodHours) || periodHours <= 0) return

  const pace = utilization > resetProgress + 10 ? 'hot'
    : utilization < resetProgress - 10 ? 'spare' : 'on-track'
  const periodMs = periodHours * 60 * 60 * 1000
  const projectedMs = periodMs * resetProgress / utilization
  const runsOutAt = projectedMs < periodMs
    ? new Date(resetsAt.getTime() - periodMs + projectedMs) : undefined
  return { pace, ...(runsOutAt ? { runsOutAt } : {}) }
}

// Scheduled refreshes pause during inactivity until the data reaches this age
export const IDLE_REFRESH_MAX_AGE_MS = 30 * 60 * 1000

export function formatDuration(ms: number): string {
  const minutes = Math.max(0, Math.floor(ms / 60000))
  if (minutes >= 1440) return t('time.daysHours', { d: Math.floor(minutes / 1440), h: Math.floor(minutes / 60) % 24 })
  if (minutes >= 60) return t('time.hoursMinutes', { h: Math.floor(minutes / 60), m: minutes % 60 })
  return t('time.minutes', { m: minutes })
}

export function formatUpdated(lastUpdated: Date | string | number, now = Date.now()): string {
  const age = now - new Date(lastUpdated).getTime()
  return age < 60000 ? t('time.updatedJustNow') : t('time.updatedAgo', { age: formatDuration(age) })
}

export function formatRetry(retryAt: number | undefined, now = Date.now()): string {
  if (!retryAt) return ''
  return retryAt - now < 60000 ? t('error.retryingSoon') : t('error.nextTry', { time: formatDuration(retryAt - now) })
}

export function formatUsage(info: ConsumptionInfo): string {
  const money = new Intl.NumberFormat(getLocale(), { style: 'currency', currency: 'USD', currencyDisplay: 'narrowSymbol' })
  const tokens = new Intl.NumberFormat(getLocale(), { notation: 'compact', maximumFractionDigits: 1 })
  return t('usage.summary', { today: money.format(info.today.cost), week: money.format(info.week.cost), tokens: tokens.format(info.week.tokens) })
}
