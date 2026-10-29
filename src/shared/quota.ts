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
