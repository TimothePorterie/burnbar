import { describe, expect, it } from 'vitest'
import { getForecast } from '../src/shared/quota'

const reset = new Date('2026-11-02T17:00:00Z')
const HOUR = 3600000

describe('quota forecast', () => {
  it('projects exhaustion from the start of the session window', () => {
    const forecast = getForecast(80, 40, reset, 5)
    expect(forecast?.pace).toBe('hot')
    expect(forecast?.runsOutAt?.getTime()).toBe(reset.getTime() - 2.5 * HOUR)
  })

  it('uses the weekly window duration', () => {
    expect(getForecast(80, 40, reset, 168)?.runsOutAt?.getTime()).toBe(reset.getTime() - 84 * HOUR)
  })

  it.each([
    [61, 50, 'hot'], [60, 50, 'on-track'], [50, 50, 'on-track'],
    [40, 50, 'on-track'], [39, 50, 'spare']
  ] as const)('classifies %d%% usage at %d%% elapsed as %s', (usage, progress, pace) => {
    expect(getForecast(usage, progress, reset, 5)?.pace).toBe(pace)
  })

  it('never projects exhaustion at or after reset', () => {
    expect(getForecast(50, 50, reset, 5)?.runsOutAt).toBeUndefined()
    expect(getForecast(30, 50, reset, 5)?.runsOutAt).toBeUndefined()
  })

  it('waits until at least 5% of the window has elapsed', () => {
    expect(getForecast(80, 4.99, reset, 5)).toBeUndefined()
    expect(getForecast(80, 5, reset, 5)?.pace).toBe('hot')
  })

  it('omits forecasts for unused, expired or invalid periods', () => {
    expect(getForecast(0, 50, reset, 5)).toBeUndefined()
    expect(getForecast(80, 100, reset, 5)).toBeUndefined()
    expect(getForecast(80, 50, new Date(NaN), 5)).toBeUndefined()
    expect(getForecast(NaN, 50, reset, 5)).toBeUndefined()
    expect(getForecast(80, NaN, reset, 5)).toBeUndefined()
    expect(getForecast(80, 50, reset, 0)).toBeUndefined()
  })
})

describe('relative time formatting', () => {
  const now = Date.parse('2026-10-29T12:00:00Z')

  it('formats the data age and the next try', async () => {
    const { formatRetry, formatUpdated } = await import('../src/shared/quota')
    const { setLocale } = await import('../src/shared/i18n')
    setLocale('en')
    expect(formatUpdated(now - 30_000, now)).toBe('Updated just now')
    expect(formatUpdated(now + HOUR, now)).toBe('Updated just now')
    expect(formatUpdated(new Date(now - 25 * HOUR - 60_000), now)).toBe('Updated 1d 1h ago')
    expect(formatRetry(undefined, now)).toBe('')
    expect(formatRetry(now - 1000, now)).toBe('Next try in under a minute.')
    expect(formatRetry(now + 2 * HOUR + 5 * 60_000, now)).toBe('Next try in 2h 5m.')
    setLocale('fr')
    expect(formatUpdated(now - 25 * 60_000, now)).toBe('Mis à jour il y a 25m')
    expect(formatRetry(now + 10 * 60_000, now)).toBe('Nouvel essai dans 10m.')
    setLocale('en')
  })
})
