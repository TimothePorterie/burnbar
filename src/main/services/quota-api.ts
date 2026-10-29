import { keychainService, Credentials } from './keychain'
import { logger } from './logger'
import { statusService } from './status'
import { settingsStore, PersistedQuotaData } from './settings-store'
import { t } from '../../shared/i18n'
import { formatDuration, getQuotaLevel, IDLE_REFRESH_MAX_AGE_MS } from '../../shared/quota'
import { classifyError, classifyHttpError, classifyKeychainFailure, type QuotaErrorState } from './quota-errors'
export type { QuotaErrorType, QuotaError, QuotaPeriod, ExtraUsageInfo, QuotaInfo } from '../../shared/types'
import type { QuotaError, QuotaPeriod, QuotaInfo } from '../../shared/types'

export interface QuotaData {
  utilization: number
  resets_at: string | null
}

export interface ExtraUsageData {
  is_enabled: boolean
  used_credits: number
  monthly_limit: number
  currency: string
}

export interface UsageResponse {
  five_hour: QuotaData | null
  seven_day: QuotaData
  [key: string]: unknown
  extra_usage?: ExtraUsageData
}

const MODEL_FAMILIES = ['opus', 'sonnet', 'haiku', 'fable'] as const

const MIN_FETCH_INTERVAL_MS = 290000 // ~5min between scheduled calls; slack absorbs request latency vs setInterval ticks
const MIN_FORCE_INTERVAL_MS = 15000 // 15s absolute minimum even for manual refresh
const MIN_429_COOLDOWN_SEC = 120 // OAuth /usage returns retry-after: 0 which is misleading — use 2min floor

function isValidQuota(q: unknown): q is QuotaData {
  if (!q || typeof q !== 'object') return false
  const qObj = q as Record<string, unknown>
  return typeof qObj.utilization === 'number' && Number.isFinite(qObj.utilization) && (typeof qObj.resets_at === 'string' || qObj.resets_at === null)
}

function isValidPersistedPeriod(p: { utilization?: unknown; resetsAt?: unknown } | null | undefined): boolean {
  return !!p && isValidQuota({ utilization: p.utilization, resets_at: p.resetsAt })
}

function isValidExtraUsage(e: unknown): e is ExtraUsageData {
  if (!e || typeof e !== 'object') return false
  const eObj = e as Record<string, unknown>
  return typeof eObj.is_enabled === 'boolean' && typeof eObj.used_credits === 'number' &&
    typeof eObj.monthly_limit === 'number' && typeof eObj.currency === 'string'
}

export function isValidUsageResponse(data: unknown): data is UsageResponse {
  if (!data || typeof data !== 'object') return false
  const obj = data as Record<string, unknown>
  return (obj.five_hour === null || isValidQuota(obj.five_hour)) && isValidQuota(obj.seven_day)
}

export function formatTimeUntil(date: Date): string {
  const diffMs = date.getTime() - Date.now()
  if (Number.isNaN(diffMs)) return '—'
  if (diffMs <= 0) return t('time.now')
  return formatDuration(diffMs)
}

export function calculateResetProgress(resetsAt: Date, periodHours: number): number {
  const resetTime = resetsAt.getTime()
  if (Number.isNaN(resetTime)) return 0
  const periodMs = periodHours * 60 * 60 * 1000
  const elapsed = Date.now() - (resetTime - periodMs)
  return Math.round(Math.max(0, Math.min(100, (elapsed / periodMs) * 100)))
}

// A period whose reset time has passed has no active window until the next fetch: 0%, no reset time.
// The API may report usage beyond the limit; the displayed share stays within 0-100%.
function buildPeriod(utilization: number, resetsAt: Date, periodHours: number): QuotaPeriod {
  if (resetsAt.getTime() <= Date.now()) {
    return { utilization: 0, resetsAt: new Date(NaN), resetsIn: '—', resetProgress: 0 }
  }
  return {
    utilization: Math.min(100, Math.max(0, utilization)),
    resetsAt,
    resetsIn: formatTimeUntil(resetsAt),
    resetProgress: calculateResetProgress(resetsAt, periodHours)
  }
}

export class QuotaService {
  private static readonly API_URL = 'https://api.anthropic.com/api/oauth/usage'
  private static readonly BETA_HEADER = 'oauth-2025-04-20'

  private cachedQuota: QuotaInfo | null = null
  private lastFetchTime: number = 0
  private lastError: QuotaErrorState | null = null
  private _wasThrottled = false
  private rateLimitedUntil: number
  private rateLimitRemaining: number | null = null
  private pendingFetch: Promise<QuotaInfo | null> | null = null
  private accountGeneration = 0
  // Set by the scheduler: next automatic attempt, and whether idle refreshes are paused
  nextRetryAt = 0
  idlePaused = false

  constructor() {
    // Restore persisted rate limit, but clear if already expired
    const persisted = settingsStore.get('rateLimitedUntil')
    if (persisted > Date.now()) {
      this.rateLimitedUntil = persisted
      logger.info(`Restored rate limit cooldown: ${Math.ceil((persisted - Date.now()) / 1000)}s remaining`)
    } else {
      this.rateLimitedUntil = 0
      settingsStore.set('rateLimitedUntil', 0)
    }

    // Restore persisted quota data (if < 24h old)
    const lastQuota = settingsStore.get('lastQuotaData') as PersistedQuotaData | null
    if (lastQuota && Date.now() - lastQuota.fetchedAt < 24 * 60 * 60 * 1000 && isValidPersistedPeriod(lastQuota.sevenDay) &&
      (!lastQuota.fiveHour || isValidPersistedPeriod(lastQuota.fiveHour))) {
      this.cachedQuota = {
        fiveHour: lastQuota.fiveHour ? buildPeriod(lastQuota.fiveHour.utilization, new Date(lastQuota.fiveHour.resetsAt ?? NaN), 5) : undefined,
        sevenDay: buildPeriod(lastQuota.sevenDay.utilization, new Date(lastQuota.sevenDay.resetsAt ?? NaN), 7 * 24),
        models: (lastQuota.models ?? (lastQuota.sevenDayOpus
          ? [{ key: 'seven_day_opus', label: 'Opus', period: lastQuota.sevenDayOpus }] : [])).filter(model => isValidPersistedPeriod(model.period)).map(model => ({
          ...model, period: buildPeriod(model.period.utilization, new Date(model.period.resetsAt ?? NaN), 7 * 24)
        })),
        lastUpdated: new Date(lastQuota.fetchedAt)
      }
      this.lastFetchTime = lastQuota.fetchedAt
      logger.info(`Restored persisted quota: 5h=${Math.round(lastQuota.fiveHour?.utilization ?? 0)}%, 7d=${Math.round(lastQuota.sevenDay.utilization)}% (${Math.round((Date.now() - lastQuota.fetchedAt) / 60000)}min ago)`)
    }
  }

  async fetchQuota(force = false): Promise<QuotaInfo | null> {
    // If a fetch is already in progress, wait for its result (dedup concurrent calls)
    if (this.pendingFetch) {
      this._wasThrottled = false
      return this.pendingFetch
    }

    // A clock set back makes the elapsed time negative: never throttle on it
    const elapsed = Date.now() - this.lastFetchTime
    // Absolute minimum between API calls — prevents spam even on manual refresh
    if (this.cachedQuota && elapsed >= 0 && elapsed < MIN_FORCE_INTERVAL_MS) {
      this._wasThrottled = true
      return this.getCachedQuota()!
    }

    // Enforce longer minimum for scheduled (non-forced) fetches
    if (!force && this.cachedQuota && elapsed >= 0 && elapsed < MIN_FETCH_INTERVAL_MS) {
      this._wasThrottled = true
      return this.getCachedQuota()!
    }

    this._wasThrottled = false
    const request = this.doFetch()
    this.pendingFetch = request
    try {
      return await request
    } finally {
      // An account reset may have started a newer fetch meanwhile
      if (this.pendingFetch === request) this.pendingFetch = null
    }
  }

  wasThrottled(): boolean {
    return this._wasThrottled
  }

  getThrottleRemainingMs(): number {
    const forceInterval = Math.max(0, MIN_FORCE_INTERVAL_MS - (Date.now() - this.lastFetchTime))
    const rateLimit = this.getRateLimitRemainingMs()
    return Math.max(forceInterval, rateLimit)
  }

  private async doFetch(): Promise<QuotaInfo | null> {
    if (Date.now() < this.rateLimitedUntil) {
      this._wasThrottled = true
      if (this.cachedQuota) {
        return this.getCachedQuota()!
      }
      // Cooldown restored at startup with nothing cached: surface it instead of an endless skeleton
      this.lastError = classifyHttpError(429)
      return null
    }
    return this.doApiFetch()
  }

  /**
   * Read Claude Code's Keychain tokens (never refreshed here).
   * Sets lastError when returning null.
   */
  private async getCredentials(): Promise<Credentials | null> {
    const credentials = await keychainService.getCredentials()
    if (!credentials) {
      logger.error('No credentials available in Keychain')
      this.lastError = classifyKeychainFailure(keychainService.lastFailure ?? 'missing')
      return null
    }
    if (keychainService.isTokenExpired(credentials)) {
      logger.warn('CLI token expired — waiting for Claude Code to refresh it')
      this.lastError = classifyHttpError(401)
      return null
    }
    // Claude Code switched account: drop the previous account's data
    const account = credentials.accountUuid ?? credentials.emailAddress ?? null
    const knownAccount = settingsStore.get('lastAccount')
    if (account && knownAccount && account !== knownAccount) {
      logger.info('Claude Code account changed — resetting quota data')
      this.resetForAccountChange()
    }
    if (account) settingsStore.set('lastAccount', account)
    return credentials
  }

  // After a 401: re-read the Keychain in case Claude Code rotated the token
  private async refreshCredentials(current: Credentials): Promise<Credentials | null> {
    const latest = await keychainService.getCredentials()
    if (!latest || latest.accessToken === current.accessToken || keychainService.isTokenExpired(latest)) {
      return null
    }
    return latest
  }

  private async doApiFetch(): Promise<QuotaInfo | null> {
    // Throttle from the request start: a slow response must not make the next tick look too early
    const startedAt = Date.now()
    try {
      const credentials = await this.getCredentials()

      if (!credentials) return null
      const generation = this.accountGeneration

      const response = await this.fetchOnce(credentials)
      if (!response) return this.getCachedQuota()

      // A body that is not JSON is the same failure as an unexpected shape, not a generic error
      const rawData: unknown = await response.json().catch(() => undefined)
      if (!isValidUsageResponse(rawData)) {
        logger.error('Invalid API response shape:', String(JSON.stringify(rawData)).slice(0, 200))
        this.lastError = { type: 'unknown', key: 'error.unexpectedResponse', retryable: true }
        return this.getCachedQuota()
      }
      const data = rawData

      // Account changed while the request was in flight: drop the previous account's data
      if (generation !== this.accountGeneration) return null

      this.cachedQuota = {
        fiveHour: data.five_hour ? buildPeriod(data.five_hour.utilization, new Date(data.five_hour.resets_at ?? NaN), 5) : undefined,
        sevenDay: buildPeriod(data.seven_day.utilization, new Date(data.seven_day.resets_at ?? NaN), 7 * 24),
        // Per-model weekly windows only: the response also carries non-model ones (oauth_apps, routines, cowork)
        models: MODEL_FAMILIES.flatMap((name) => {
          const key = `seven_day_${name}`
          const value = (data as unknown as Record<string, unknown>)[key]
          if (!isValidQuota(value)) return []
          const label = name[0].toUpperCase() + name.slice(1)
          return [{ key, label, period: buildPeriod(value.utilization, new Date(value.resets_at ?? NaN), 7 * 24) }]
        }),
        lastUpdated: new Date()
      }

      // Parse optional extra usage / overage info
      if (isValidExtraUsage(data.extra_usage)) {
        this.cachedQuota.extraUsage = {
          isEnabled: data.extra_usage.is_enabled,
          usedCredits: data.extra_usage.used_credits,
          monthlyLimit: data.extra_usage.monthly_limit,
          currency: data.extra_usage.currency
        }
      }

      this.lastFetchTime = startedAt
      this.lastError = null
      // Only clear rate limit cooldown if we still have budget remaining
      if (this.rateLimitRemaining === null || this.rateLimitRemaining > 0) {
        this.rateLimitedUntil = 0
        settingsStore.set('rateLimitedUntil', 0)
      }

      // Persist quota data for next startup
      const persistedData: PersistedQuotaData = {
        fiveHour: data.five_hour ? { utilization: data.five_hour.utilization, resetsAt: data.five_hour.resets_at } : undefined,
        sevenDay: { utilization: data.seven_day.utilization, resetsAt: data.seven_day.resets_at },
        models: this.cachedQuota.models.map(model => ({
          ...model, period: { utilization: model.period.utilization, resetsAt: Number.isFinite(model.period.resetsAt.getTime()) ? model.period.resetsAt.toISOString() : null }
        })),
        fetchedAt: this.cachedQuota.lastUpdated.getTime()
      }
      settingsStore.set('lastQuotaData', persistedData)

      const { models, extraUsage } = this.cachedQuota
      const modelsLog = models.map(model => `, ${model.label}=${Math.round(model.period.utilization)}%`).join('')
      const overageLog = extraUsage?.isEnabled ? `, overage=${(extraUsage.usedCredits / 100).toFixed(2)} ${extraUsage.currency}` : ''
      logger.info(
        `Quota fetched (API): 5h=${Math.round(data.five_hour?.utilization ?? 0)}%, 7d=${Math.round(data.seven_day.utilization)}%${modelsLog}${overageLog}`
      )

      return this.getCachedQuota()
    } catch (error) {
      logger.error('Failed to fetch quota:', error)
      this.lastError = classifyError(error)
      return this.getCachedQuota()
    }
  }

  /**
   * Single API call with one Keychain re-read retry on 401.
   * No exponential backoff, no multi-retry loop.
   */
  private async fetchOnce(credentials: Credentials): Promise<Response | null> {
    const doRequest = (creds: Credentials): Promise<Response> => fetch(QuotaService.API_URL, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${creds.accessToken}`,
        'anthropic-beta': QuotaService.BETA_HEADER,
        'Content-Type': 'application/json'
      },
      signal: AbortSignal.timeout(15000)
    })

    try {
      let response = await doRequest(credentials)

      if (response.ok) {
        this.applyRateLimitHeaders(response)
        return response
      }

      // On 401, re-read the Keychain once
      if (response.status === 401) {
        logger.warn('Authentication failed — re-reading Keychain')
        const refreshed = await this.refreshCredentials(credentials)
        if (refreshed) {
          response = await doRequest(refreshed)
          if (response.ok) {
            this.applyRateLimitHeaders(response)
            return response
          }
        }
        this.lastError = classifyHttpError(401)
        return null
      }

      if (response.status === 429) {
        const retryAfter = response.headers.get('retry-after')
        const serverSec = retryAfter ? parseInt(retryAfter, 10) || 0 : 0
        const cooldownSec = Math.max(Math.min(serverSec, 3600), MIN_429_COOLDOWN_SEC)
        this.rateLimitedUntil = Date.now() + cooldownSec * 1000
        settingsStore.set('rateLimitedUntil', this.rateLimitedUntil)
        this.applyRateLimitHeaders(response)
        logger.warn(`Rate limited (429), cooldown ${cooldownSec}s (retry-after=${serverSec}s)`)
        this.lastError = classifyHttpError(429)
        return null
      }

      // All other errors — no retry
      const errorText = await response.text()
      logger.error(`API error: ${response.status} - ${errorText.slice(0, 200)}`)
      this.lastError = classifyHttpError(response.status)
      return null
    } catch (error) {
      logger.error('Network error:', error)
      this.lastError = classifyError(error)
      return null
    }
  }

  /**
   * Parse rate limit headers and proactively throttle when budget is exhausted.
   * Note: the OAuth /usage endpoint may not return these headers.
   */
  private applyRateLimitHeaders(response: Response): void {
    const remainingStr = response.headers.get('anthropic-ratelimit-requests-remaining')
    const resetStr = response.headers.get('anthropic-ratelimit-requests-reset')

    if (remainingStr != null) {
      this.rateLimitRemaining = parseInt(remainingStr, 10)
      logger.info(`Rate limit budget: remaining=${remainingStr}, reset=${resetStr ?? '?'}`)
    }

    // Proactive throttle: if no requests remain, pause until the reset time
    if (this.rateLimitRemaining != null && this.rateLimitRemaining <= 0 && resetStr) {
      const resetTime = new Date(resetStr).getTime()
      if (!isNaN(resetTime) && resetTime > Date.now()) {
        // Add a small buffer (5s) to avoid racing with the server clock
        const proactiveCooldownUntil = resetTime + 5000
        if (proactiveCooldownUntil > this.rateLimitedUntil) {
          this.rateLimitedUntil = proactiveCooldownUntil
          settingsStore.set('rateLimitedUntil', this.rateLimitedUntil)
          const cooldownSec = Math.ceil((proactiveCooldownUntil - Date.now()) / 1000)
          logger.warn(`Proactive throttle: 0 requests remaining, pausing API calls for ${cooldownSec}s until reset`)
        }
      }
    }
  }

  getLastError(): QuotaError | null {
    if (!this.lastError) return null
    const { type, key, retryable } = this.lastError
    const retryAt = Math.max(this.nextRetryAt, this.rateLimitedUntil)
    return { type, message: t(key), retryable, ...(retryAt > Date.now() ? { retryAt } : {}) }
  }

  getRateLimitRemainingMs(): number {
    return Math.max(0, this.rateLimitedUntil - Date.now())
  }

  // Forget everything tied to the previous account
  resetForAccountChange(): void {
    this.accountGeneration++
    this.pendingFetch = null
    this.cachedQuota = null
    this.lastFetchTime = 0
    this.lastError = null
    settingsStore.set('lastQuotaData', null)
    settingsStore.set('notifiedLevels', {})
    settingsStore.set('resetNotifications', {})
    settingsStore.delete('extraUsageNotified')
  }

  getCachedQuota(): QuotaInfo | null {
    if (!this.cachedQuota) return null
    // Recalculate time-dependent fields on every read
    const { fiveHour, sevenDay, models } = this.cachedQuota
    const intervalMs = settingsStore.get('refreshInterval') * 1000
    // Paused idle refreshes let the data age on purpose: it is not stale until that pause should have ended
    const staleAfterMs = this.idlePaused ? IDLE_REFRESH_MAX_AGE_MS + intervalMs : 2 * intervalMs
    const result: QuotaInfo = {
      ...this.cachedQuota,
      status: statusService.getStatus(),
      error: this.getLastError() ?? undefined,
      stale: Date.now() - this.cachedQuota.lastUpdated.getTime() > staleAfterMs,
      fiveHour: fiveHour ? buildPeriod(fiveHour.utilization, fiveHour.resetsAt, 5) : undefined,
      sevenDay: buildPeriod(sevenDay.utilization, sevenDay.resetsAt, 7 * 24),
      models: models.map(model => ({ ...model, period: buildPeriod(model.period.utilization, model.period.resetsAt, 7 * 24) }))
    }
    return result
  }

  getQuotaLevel(): 'normal' | 'warning' | 'critical' {
    const quota = this.getCachedQuota()
    if (!quota) {
      return 'normal'
    }

    const maxUtilization = Math.max(quota.fiveHour?.utilization ?? 0, quota.sevenDay.utilization,
      ...quota.models.map(model => model.period.utilization))

    return getQuotaLevel(maxUtilization)
  }
}

export const quotaService = new QuotaService()
