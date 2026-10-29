import type { AnthropicStatus } from '../../shared/types'
import { logger } from './logger'

export const STATUS_PAGE_URL = 'https://status.claude.com/'
const REFRESH_INTERVAL_MS = 5 * 60 * 1000
const INDICATORS = ['none', 'minor', 'major', 'critical'] as const
const COMPONENT_LEVELS: Record<string, number> = {
  operational: 0, degraded_performance: 1, under_maintenance: 1, partial_outage: 2, major_outage: 3
}

interface StatusSummary {
  components: { id: string; name: string; status: string }[]
  incidents: {
    id?: string
    name: string
    shortlink?: string
    status: string
    impact: string
    components: { id: string }[]
  }[]
}

export function isStatusPageUrl(url: unknown): url is string {
  return typeof url === 'string' &&
    (url.startsWith(STATUS_PAGE_URL) || url.startsWith('https://status.anthropic.com/'))
}

export function filterStatus(summary: StatusSummary): AnthropicStatus {
  const components = summary.components.filter(component =>
    /^(Claude Code|Claude API \(api\.anthropic\.com\)|claude\.ai)$/i.test(component.name))
  const relevantIds = new Set(components.map(component => component.id))
  const incidents = summary.incidents.filter(incident =>
    !['resolved', 'postmortem'].includes(incident.status) &&
    incident.components.some(component => relevantIds.has(component.id)))
  const impact = (value: string): number => Math.max(1, INDICATORS.indexOf(value as AnthropicStatus['indicator']))
  incidents.sort((a, b) => impact(b.impact) - impact(a.impact))
  const level = Math.max(0, ...components.map(component => COMPONENT_LEVELS[component.status] ?? 1),
    ...incidents.map(incident => impact(incident.impact)))
  const incident = incidents[0]
  return {
    indicator: INDICATORS[level],
    ...(incident ? { incident: {
      name: incident.name,
      url: isStatusPageUrl(incident.shortlink) ? incident.shortlink
        : incident.id ? `${STATUS_PAGE_URL}incidents/${encodeURIComponent(incident.id)}` : STATUS_PAGE_URL
    } } : {})
  }
}

export class StatusService {
  private status: AnthropicStatus | undefined
  private lastAttempt = -Infinity
  private pending: Promise<void> | null = null

  getStatus(): AnthropicStatus | undefined {
    return this.status
  }

  async refresh(): Promise<void> {
    if (this.pending) return this.pending
    if (Date.now() - this.lastAttempt < REFRESH_INTERVAL_MS) return
    this.lastAttempt = Date.now()
    this.pending = this.fetchStatus()
    try {
      await this.pending
    } finally {
      this.pending = null
    }
  }

  private async fetchStatus(): Promise<void> {
    try {
      const response = await fetch(`${STATUS_PAGE_URL}api/v2/summary.json`, { signal: AbortSignal.timeout(10_000) })
      if (!response.ok) throw new Error(`Status HTTP ${response.status}`)
      this.status = filterStatus(await response.json() as StatusSummary)
    } catch (error) {
      this.status = undefined
      logger.debug('Anthropic status unavailable:', error)
    }
  }
}

export const statusService = new StatusService()
