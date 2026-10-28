import { t } from '../../shared/i18n'
import type { QuotaError } from '../../shared/types'

export function classifyHttpError(status: number): QuotaError {
  if (status === 401 || status === 403) {
    return { type: 'auth', message: t('error.sessionExpiredSettings'), retryable: false }
  }
  if (status === 429) {
    return { type: 'rate_limit', message: t('error.rateLimited'), retryable: true }
  }
  if (status >= 500) {
    return { type: 'server', message: t('error.server'), retryable: true }
  }
  return { type: 'unknown', message: t('error.unexpected'), retryable: true }
}

export function classifyError(error: unknown): QuotaError {
  if (error instanceof TypeError && error.message.includes('fetch')) {
    return { type: 'network', message: t('error.network'), retryable: true }
  }
  if (error instanceof DOMException && error.name === 'TimeoutError') {
    return { type: 'network', message: t('error.timeout'), retryable: true }
  }
  if (error instanceof Error && 'code' in error) {
    const code = (error as NodeJS.ErrnoException).code
    if (code === 'ENOTFOUND' || code === 'ECONNREFUSED' || code === 'ECONNRESET' || code === 'ETIMEDOUT') {
      return { type: 'network', message: t('error.network'), retryable: true }
    }
  }
  return { type: 'unknown', message: t('error.unexpected'), retryable: true }
}
