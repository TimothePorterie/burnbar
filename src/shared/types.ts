export type QuotaErrorType = 'network' | 'auth' | 'rate_limit' | 'server' | 'unknown'

export interface QuotaError {
  type: QuotaErrorType
  message: string
  retryable: boolean
}

export interface QuotaPeriod {
  utilization: number
  resetsAt: Date
  resetsIn: string
  resetProgress: number
}

export interface ExtraUsageInfo {
  isEnabled: boolean
  usedCredits: number
  monthlyLimit: number
  currency: string
}

export interface QuotaInfo {
  fiveHour: QuotaPeriod
  sevenDay: QuotaPeriod
  sevenDayOpus?: QuotaPeriod
  extraUsage?: ExtraUsageInfo
  lastUpdated: Date
  error?: QuotaError
  stale?: boolean // data older than 2x the refresh interval
}
