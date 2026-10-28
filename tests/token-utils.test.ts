import { describe, expect, it } from 'vitest'
import { redactToken } from '../src/main/services/token-utils'

describe('redactToken', () => {
  it.each(['', 'short', '123456789'])('fully redacts a short token: %s', (token) => {
    expect(redactToken(token)).toBe('[REDACTED]')
  })

  it('keeps only the first and last four characters', () => {
    expect(redactToken('1234567890')).toBe('1234...7890')
    expect(redactToken('abcd-private-token-wxyz')).toBe('abcd...wxyz')
  })
})
