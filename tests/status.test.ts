import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { filterStatus, isStatusPageUrl, StatusService, STATUS_PAGE_URL } from '../src/main/services/status'

vi.mock('../src/main/services/logger', () => ({ logger: { debug: vi.fn() } }))

const component = (id: string, name: string, status = 'operational') => ({ id, name, status })
const components = [
  component('code', 'Claude Code'), component('api', 'Claude API (api.anthropic.com)'), component('web', 'claude.ai'),
  component('console', 'Claude Console (platform.claude.com)'), component('cowork', 'Claude Cowork'),
  component('gov', 'Claude for Government')
]
const incident = (id: string, impact = 'minor', status = 'investigating') => ({
  id: 'incident-1', name: 'API errors', shortlink: 'https://stspg.io/example', status, impact, components: [{ id }]
})
const fetchMock = vi.fn()

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-10-29T10:00:00Z'))
  fetchMock.mockReset()
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('Anthropic status filtering', () => {
  it('ignores the global indicator and unrelated outages and incidents', () => {
    expect(filterStatus({
      components: components.map(c => c.id === 'cowork' ? { ...c, status: 'major_outage' } : c),
      incidents: [incident('console', 'critical'), incident('cowork'), incident('gov')]
    })).toEqual({ indicator: 'none' })
  })

  it.each(['code', 'api', 'web'])('includes unresolved incidents affecting %s', id => {
    expect(filterStatus({ components, incidents: [incident(id, 'major')] })).toEqual({
      indicator: 'major', incident: { name: 'API errors', url: `${STATUS_PAGE_URL}incidents/incident-1` }
    })
  })

  it.each(['resolved', 'postmortem'])('ignores %s incidents', status => {
    expect(filterStatus({ components, incidents: [incident('code', 'critical', status)] })).toEqual({ indicator: 'none' })
  })

  it.each([
    ['degraded_performance', 'minor'], ['partial_outage', 'major'], ['major_outage', 'critical'], ['under_maintenance', 'minor']
  ])('maps relevant component %s without an incident', (status, indicator) => {
    expect(filterStatus({ components: [component('code', 'Claude Code', status)], incidents: [] })).toEqual({ indicator })
  })

  it('selects the most severe incident and preserves the worst component severity', () => {
    expect(filterStatus({
      components: [component('code', 'Claude Code', 'major_outage')],
      incidents: [incident('code'), { ...incident('code', 'major'), name: 'More severe', shortlink: `${STATUS_PAGE_URL}incidents/abc` }]
    })).toEqual({ indicator: 'critical', incident: { name: 'More severe', url: `${STATUS_PAGE_URL}incidents/abc` } })
  })

  it('shows an active incident even before component degradation is recorded', () => {
    expect(filterStatus({ components, incidents: [incident('code', 'none', 'monitoring')] }).indicator).toBe('minor')
  })

  it.each([
    [STATUS_PAGE_URL, true], ['https://status.anthropic.com/incidents/abc', true],
    ['https://status.claude.com.evil.test/', false], ['https://status.claude.com@evil.test/', false],
    ['http://status.claude.com/', false], ['javascript:alert(1)', false], [null, false]
  ])('validates the external URL %s', (url, expected) => {
    expect(isStatusPageUrl(url)).toBe(expected)
  })
})

describe('StatusService', () => {
  it('fetches in the main process with a 10-second timeout and caches for 5 minutes', async () => {
    const timeout = vi.spyOn(AbortSignal, 'timeout')
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ components, incidents: [] })))
    const service = new StatusService()
    await service.refresh()
    expect(fetchMock).toHaveBeenCalledWith(`${STATUS_PAGE_URL}api/v2/summary.json`, { signal: expect.any(AbortSignal) })
    expect(timeout).toHaveBeenCalledWith(10_000)
    expect(service.getStatus()).toEqual({ indicator: 'none' })
    await vi.advanceTimersByTimeAsync(299_999)
    await service.refresh()
    expect(fetchMock).toHaveBeenCalledTimes(1)
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ components, incidents: [incident('code')] })))
    await vi.advanceTimersByTimeAsync(1)
    await service.refresh()
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(service.getStatus()?.indicator).toBe('minor')
    timeout.mockRestore()
  })

  it('coalesces concurrent refreshes', async () => {
    let resolve!: (response: Response) => void
    fetchMock.mockReturnValue(new Promise<Response>(done => { resolve = done }))
    const service = new StatusService()
    const first = service.refresh()
    const second = service.refresh()
    expect(fetchMock).toHaveBeenCalledTimes(1)
    resolve(new Response(JSON.stringify({ components, incidents: [] })))
    await Promise.all([first, second])
    expect(service.getStatus()?.indicator).toBe('none')
  })

  it('clears a previous incident on network failure and throttles failed attempts', async () => {
    const service = new StatusService()
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ components, incidents: [incident('code')] })))
    await service.refresh()
    expect(service.getStatus()?.indicator).toBe('minor')
    await vi.advanceTimersByTimeAsync(300_000)
    fetchMock.mockRejectedValue(new Error('offline'))
    await expect(service.refresh()).resolves.toBeUndefined()
    expect(service.getStatus()).toBeUndefined()
    await service.refresh()
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it.each([new Response('', { status: 503 }), new Response('invalid JSON')])('silently handles HTTP or parsing failures', async response => {
    fetchMock.mockResolvedValueOnce(response)
    const service = new StatusService()
    await expect(service.refresh()).resolves.toBeUndefined()
    expect(service.getStatus()).toBeUndefined()
  })
})
