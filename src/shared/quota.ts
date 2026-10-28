export const WARNING_THRESHOLD = 70
export const CRITICAL_THRESHOLD = 90

export type QuotaLevel = 'normal' | 'warning' | 'critical'

export function getQuotaLevel(utilization: number): QuotaLevel {
  if (utilization >= CRITICAL_THRESHOLD) return 'critical'
  if (utilization >= WARNING_THRESHOLD) return 'warning'
  return 'normal'
}
