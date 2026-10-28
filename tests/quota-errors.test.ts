import { describe, expect, it } from 'vitest'
import { classifyError, classifyHttpError } from '../src/main/services/quota-errors'
import { t } from '../src/shared/i18n'

describe('quota error classification', () => {
  it.each([
    [401, 'auth', false],
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
      type: 'network', message: t('error.timeout'), retryable: true
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
})
