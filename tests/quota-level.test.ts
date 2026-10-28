import { describe, expect, it } from 'vitest'
import { getQuotaLevel } from '../src/shared/quota'

describe('quota levels', () => {
  it.each([
    [0, 'normal'], [69.99, 'normal'], [70, 'warning'], [89.99, 'warning'], [90, 'critical'], [100, 'critical']
  ] as const)('classifies utilization %d as %s', (utilization, level) => {
    expect(getQuotaLevel(utilization)).toBe(level)
  })
})
