import { quotaService } from './quota-api'
import { logger } from './logger'

type RefreshCallback = () => void

const MAX_BACKOFF_MULTIPLIER = 8 // Max 8x the normal interval

export class SchedulerService {
  private intervalId: NodeJS.Timeout | null = null
  private rateLimitRetryId: NodeJS.Timeout | null = null
  private refreshIntervalMs: number = 300000
  private callbacks: Set<RefreshCallback> = new Set()
  private consecutiveErrors: number = 0
  private backoffRetryId: NodeJS.Timeout | null = null

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

  start(force = false): void {
    if (this.intervalId) {
      return
    }

    // Initial fetch
    this.refresh(force)

    // Schedule recurring fetches
    this.intervalId = setInterval(() => {
      this.refresh()
    }, this.refreshIntervalMs)
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
  }

  async refresh(force = false): Promise<void> {
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
            this.refresh()
          }, retryInMs)
        }
      } else if (quota?.error && quota.error.retryable) {
        // Got cached data back but with an error — back off
        this.handleRetryableError()
      } else if (!quota && quotaService.getLastError()?.retryable) {
        // No data at all + retryable error — back off
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

  private handleRetryableError(): void {
    this.consecutiveErrors++
    const multiplier = Math.min(2 ** (this.consecutiveErrors - 1), MAX_BACKOFF_MULTIPLIER)
    const backoffMs = this.refreshIntervalMs * multiplier

    this.stopInterval()
    if (this.backoffRetryId) return // Already scheduled

    logger.warn(`Error backoff: attempt ${this.consecutiveErrors}, retry in ${Math.ceil(backoffMs / 1000)}s (${multiplier}x)`)
    this.backoffRetryId = setTimeout(() => {
      this.backoffRetryId = null
      this.refresh()
    }, backoffMs)
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
      this.refresh()
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
