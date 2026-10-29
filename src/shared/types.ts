export type QuotaErrorType = 'network' | 'auth' | 'keychain' | 'rate_limit' | 'server' | 'unknown'

export interface QuotaError {
  type: QuotaErrorType
  message: string
  retryable: boolean
  retryAt?: number // next automatic attempt (epoch ms), when one is scheduled
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

export interface ModelQuota {
  key: string
  label: string
  period: QuotaPeriod
}

export interface AnthropicStatus {
  indicator: 'none' | 'minor' | 'major' | 'critical'
  incident?: { name: string; url: string }
}

export interface QuotaInfo {
  status?: AnthropicStatus
  fiveHour?: QuotaPeriod
  sevenDay: QuotaPeriod
  models: ModelQuota[]
  extraUsage?: ExtraUsageInfo
  lastUpdated: Date
  error?: QuotaError
  stale?: boolean // data older than 2x the refresh interval (longer while idle refreshes are paused)
}

export type ProviderId = 'claude' | 'codex' | 'grok' | 'opencode'
export type TrayProvider = 'claude' | 'codex' | 'max'
export type ProviderStatus = 'connected' | 'installed' | 'not-installed' | 'not-connected' | 'error'

export interface CodexQuota {
  fiveHour?: QuotaPeriod
  sevenDay?: QuotaPeriod
  plan?: string
  resetsAvailable: number
  limitReached: boolean
  lastUpdated: Date
  error?: QuotaError
  stale?: boolean
}

export interface UsageTotals {
  cost: number // USD
  tokens: number
}

export interface ConsumptionInfo {
  today: UsageTotals
  week: UsageTotals // today and the 6 previous days
  lastUpdated: Date
}

export interface ProviderView<T> {
  data: T | null
  error: QuotaError | null
}

export interface ProvidersSnapshot {
  enabled: Record<ProviderId, boolean>
  status: Record<ProviderId, ProviderStatus>
  codex: ProviderView<CodexQuota>
  grok: ProviderView<ConsumptionInfo>
  opencode: ProviderView<ConsumptionInfo>
}
