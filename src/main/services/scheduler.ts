import { powerMonitor } from 'electron'
import { quotaService } from './quota-api'
import { logger } from './logger'
import { IDLE_REFRESH_MAX_AGE_MS } from '../../shared/quota'

type RefreshCallback = () => void

const MAX_BACKOFF_MULTIPLIER = 8 // Max 8x the normal interval

export class SchedulerService {
  private intervalId: NodeJS.Timeout | null = null
  private rateLimitRetryId: NodeJS.Timeout | null = null
  private refreshIntervalMs: number = 300000
  private callbacks: Set<RefreshCallback> = new Set()
  private consecutiveErrors: number = 0
  private backoffRetryId: NodeJS.Timeout | null = null
  private screenLocked = false
  private skippingIdleRefresh = false
  private inFlight: Promise<void> | null = null

  setRefreshInterval(seconds: number): void {
    this.refreshIntervalMs = seconds * 1000
    if (this.intervalId) {
      this.stop()
      this.start()
    }
  }

  onRefresh(callback: RefreshCallback): void {
    this.callbacks.add(callback)
  }

  setScreenLocked(locked: boolean): void {
    this.screenLocked = locked
  }

  start(force = false): void {
    if (this.intervalId) {
      return
    }

    // Initial fetch
    this.refreshScheduled(force)

    // Schedule recurring fetches
    this.restartInterval()
  }

  stop(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId)
      this.intervalId = null
    }
    this.clearRetryTimers()
    this.consecutiveErrors = 0
  }

  private clearRetryTimers(): void {
    if (this.rateLimitRetryId) {
      clearTimeout(this.rateLimitRetryId)
      this.rateLimitRetryId = null
    }
    if (this.backoffRetryId) {
      clearTimeout(this.backoffRetryId)
      this.backoffRetryId = null
    }
    quotaService.nextRetryAt = 0
  }

  // Concurrent callers (popup open, manual refresh, timer) share one run
  refresh(force = false): Promise<void> {
    this.inFlight ??= this.runRefresh(force).finally(() => { this.inFlight = null })
    return this.inFlight
  }

  private async runRefresh(force: boolean): Promise<void> {
    if (this.skippingIdleRefresh) {
      logger.info('Quota refresh resumed after inactivity')
      this.skippingIdleRefresh = false
      quotaService.idlePaused = false
    }
    try {
      const quota = await quotaService.fetchQuota(force)

      // Check if we got rate limited (429) or proactively throttled (0 remaining)
      const cooldownMs = quotaService.getRateLimitRemainingMs()
      if (cooldownMs > 0) {
        // Stop the regular interval to avoid noise during cooldown
        this.stopInterval()

        // Trust the server's retry-after value + small 2s buffer
        const retryInMs = cooldownMs + 2000

        if (!this.rateLimitRetryId) {
          const lastError = quotaService.getLastError()
          const reason = lastError?.type === 'rate_limit' ? 'Rate limited (retry-after)' : 'Proactive throttle'
          logger.info(`${reason} — retry in ${Math.ceil(retryInMs / 1000)}s`)
          this.rateLimitRetryId = setTimeout(() => {
            this.rateLimitRetryId = null
            quotaService.nextRetryAt = 0
            this.refreshScheduled()
          }, retryInMs)
          quotaService.nextRetryAt = Date.now() + retryInMs
        }
      } else if (quotaService.wasThrottled()) {
        // Served from cache without a request: keep the current backoff and timers
      } else if ((quota ? quota.error : quotaService.getLastError())?.retryable) {
        // Retryable error, with or without cached data — back off
        this.handleRetryableError()
      } else {
        // Success — reset backoff and restart interval
        this.consecutiveErrors = 0
        this.clearRetryTimers()
        this.restartInterval()
      }

      this.notifyCallbacks()
    } catch (error) {
      logger.error('Scheduled refresh failed:', error)
      this.handleRetryableError()
      this.notifyCallbacks()
    }
  }

  private refreshScheduled(force = false): void {
    const lastUpdated = quotaService.getCachedQuota()?.lastUpdated.getTime()
    if (!force && lastUpdated !== undefined && Date.now() - lastUpdated < IDLE_REFRESH_MAX_AGE_MS
      && (this.screenLocked || powerMonitor.getSystemIdleTime() >= 600)) {
      if (!this.skippingIdleRefresh) logger.info('Scheduled quota refresh skipped during inactivity')
      this.skippingIdleRefresh = true
      quotaService.idlePaused = true
      this.restartInterval()
      return
    }
    void this.refresh(force)
  }

  private handleRetryableError(): void {
    this.consecutiveErrors++
    const multiplier = Math.min(2 ** (this.consecutiveErrors - 1), MAX_BACKOFF_MULTIPLIER)
    const backoffMs = this.refreshIntervalMs * multiplier

    this.stopInterval()
    if (this.backoffRetryId) return // Already scheduled

    logger.warn(`Error backoff: attempt ${this.consecutiveErrors}, retry in ${Math.ceil(backoffMs / 1000)}s (${multiplier}x)`)
    this.backoffRetryId = setTimeout(() => {
      this.backoffRetryId = null
      quotaService.nextRetryAt = 0
      this.refreshScheduled()
    }, backoffMs)
    quotaService.nextRetryAt = Date.now() + backoffMs
  }

  private stopInterval(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId)
      this.intervalId = null
    }
  }

  private restartInterval(): void {
    if (this.intervalId) return // Already running
    this.intervalId = setInterval(() => {
      this.refreshScheduled()
    }, this.refreshIntervalMs)
  }

  private notifyCallbacks(): void {
    for (const callback of this.callbacks) {
      try {
        callback()
      } catch (error) {
        logger.error('Refresh callback error:', error)
      }
    }
  }
}

export const schedulerService = new SchedulerService()
