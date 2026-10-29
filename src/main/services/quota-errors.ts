import type { QuotaErrorType } from '../../shared/types'
import type { KeychainFailure } from './keychain'

// The message is translated when read, so a language change also applies to the current error
export interface QuotaErrorState {
  type: QuotaErrorType
  key: string
  retryable: boolean
}

export function classifyHttpError(status: number): QuotaErrorState {
  if (status === 401) {
    return { type: 'auth', key: 'error.cliTokenExpired', retryable: true }
  }
  if (status === 403) {
    return { type: 'auth', key: 'error.forbidden', retryable: false }
  }
  if (status === 429) {
    return { type: 'rate_limit', key: 'error.rateLimited', retryable: true }
  }
  if (status >= 500) {
    return { type: 'server', key: 'error.server', retryable: true }
  }
  return { type: 'unknown', key: 'error.unexpectedResponse', retryable: true }
}

export function classifyError(error: unknown): QuotaErrorState {
  if (error instanceof TypeError && error.message.includes('fetch')) {
    return { type: 'network', key: 'error.network', retryable: true }
  }
  if (error instanceof DOMException && error.name === 'TimeoutError') {
    return { type: 'network', key: 'error.timeout', retryable: true }
  }
  if (error instanceof Error && 'code' in error) {
    const code = (error as NodeJS.ErrnoException).code
    if (code === 'ENOTFOUND' || code === 'ECONNREFUSED' || code === 'ECONNRESET' || code === 'ETIMEDOUT') {
      return { type: 'network', key: 'error.network', retryable: true }
    }
  }
  return { type: 'unknown', key: 'error.unexpected', retryable: true }
}

export function classifyKeychainFailure(failure: KeychainFailure): QuotaErrorState {
  switch (failure) {
    case 'invalid': return { type: 'auth', key: 'error.credentialsInvalid', retryable: false }
    case 'denied': return { type: 'keychain', key: 'error.keychainDenied', retryable: true }
    case 'failed': return { type: 'keychain', key: 'error.keychainFailed', retryable: true }
    default: return { type: 'auth', key: 'error.noCredentials', retryable: false }
  }
}
