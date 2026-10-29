import { describe, expect, it } from 'vitest'
import { classifyError, classifyHttpError, classifyKeychainFailure } from '../src/main/services/quota-errors'
import { setLocale, t } from '../src/shared/i18n'

describe('quota error classification', () => {
  it.each([
    [401, 'auth', true],
    [403, 'auth', false],
    [429, 'rate_limit', true],
    [500, 'server', true],
    [503, 'server', true],
    [400, 'unknown', true],
    [404, 'unknown', true]
  ] as const)('classifies HTTP %i from its status', (status, type, retryable) => {
    expect(classifyHttpError(status)).toMatchObject({ type, retryable })
  })

  it('recognizes the native AbortSignal timeout reason', () => {
    expect(classifyError(new DOMException('The operation timed out', 'TimeoutError'))).toEqual({
      type: 'network', key: 'error.timeout', retryable: true
    })
  })

  it.each(['ENOTFOUND', 'ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT'])('preserves %s network errors', (code) => {
    expect(classifyError(Object.assign(new Error('connection failed'), { code }))).toMatchObject({
      type: 'network', retryable: true
    })
  })

  it('preserves fetch failures and unexpected errors', () => {
    expect(classifyError(new TypeError('fetch failed'))).toMatchObject({ type: 'network', retryable: true })
    expect(classifyError(new Error('unexpected'))).toMatchObject({ type: 'unknown', retryable: true })
    expect(classifyError(null)).toMatchObject({ type: 'unknown', retryable: true })
  })

  it('uses keys translated in English and French', () => {
    const states = [
      ...[401, 403, 429, 500, 404].map(classifyHttpError),
      ...(['missing', 'invalid', 'denied', 'failed'] as const).map(classifyKeychainFailure),
      classifyError(new TypeError('fetch failed')), classifyError(null),
      classifyError(new DOMException('timed out', 'TimeoutError'))
    ]
    for (const { key } of states) {
      setLocale('en')
      const en = t(key)
      setLocale('fr')
      expect(en).not.toBe(key)
      expect(t(key)).not.toBe(en)
    }
    setLocale('en')
  })

  it.each([
    ['missing', 'auth', 'error.noCredentials', false],
    ['invalid', 'auth', 'error.credentialsInvalid', false],
    ['denied', 'keychain', 'error.keychainDenied', true],
    ['failed', 'keychain', 'error.keychainFailed', true]
  ] as const)('maps a %s Keychain read to a %s error', (failure, type, key, retryable) => {
    expect(classifyKeychainFailure(failure)).toEqual({ type, key, retryable })
  })
})
