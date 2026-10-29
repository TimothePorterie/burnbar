import { settingsStore } from './settings-store'
import { keychainService } from './keychain'
import { quotaService } from './quota-api'
import { codexService } from './codex'
import { consumptionService } from './consumption'
import { resolveCli } from './cli-path'
import { logger } from './logger'
import type { ProviderId, ProviderStatus, ProvidersSnapshot, TrayProvider } from '../../shared/types'

export const PROVIDER_IDS: ProviderId[] = ['claude', 'codex', 'grok', 'opencode']
const CLI_NAMES = ['codex', 'grok', 'opencode'] as const

export function isProviderEnabled(id: ProviderId): boolean {
  return settingsStore.get('providers')?.[id] ?? id === 'claude'
}

export function getEnabledProviders(): Record<ProviderId, boolean> {
  return Object.fromEntries(PROVIDER_IDS.map(id => [id, isProviderEnabled(id)])) as Record<ProviderId, boolean>
}

export function setProviderEnabled(id: ProviderId, enabled: boolean): void {
  settingsStore.set('providers', { ...getEnabledProviders(), [id]: enabled })
}

// First launch: turn on what is installed (Claude: its Keychain item). Nothing found keeps Claude on for its sign-in hint.
export async function detectProviders(): Promise<void> {
  if (settingsStore.get('providers')) return
  const [claude, ...clis] = await Promise.all([
    keychainService.hasCredentials().catch(() => false),
    ...CLI_NAMES.map(name => resolveCli(name).then(Boolean))
  ])
  const [codex, grok, opencode] = clis
  const enabled = { claude: claude || !clis.some(Boolean), codex, grok, opencode }
  settingsStore.set('providers', enabled)
  settingsStore.set('trayProvider', enabled.claude || !codex ? 'claude' : 'codex')
  logger.info(`Providers detected: ${PROVIDER_IDS.filter(id => enabled[id]).join(', ') || 'none'}`)
}

// The menu bar falls back to an enabled quota provider
export function getTrayProvider(): TrayProvider {
  const choice = settingsStore.get('trayProvider')
  const claude = isProviderEnabled('claude')
  const codex = isProviderEnabled('codex')
  if (choice === 'max' && claude && codex) return 'max'
  if (choice === 'codex' && codex) return 'codex'
  return claude || !codex ? 'claude' : 'codex'
}

async function claudeStatus(): Promise<ProviderStatus> {
  const type = quotaService.getLastError()?.type
  return await keychainService.hasCredentials().catch(() => false) && type !== 'auth' && type !== 'keychain'
    ? 'connected' : 'not-connected'
}

async function cliStatus(name: (typeof CLI_NAMES)[number], known: ProviderStatus | null): Promise<ProviderStatus> {
  return known ?? (await resolveCli(name) ? 'installed' : 'not-installed')
}

export async function getProvidersSnapshot(): Promise<ProvidersSnapshot> {
  const grok = consumptionService.getView('grok')
  const opencode = consumptionService.getView('opencode')
  const [claude, codex, grokStatus, opencodeStatus] = await Promise.all([
    claudeStatus(),
    cliStatus('codex', codexService.status),
    cliStatus('grok', grok.status),
    cliStatus('opencode', opencode.status)
  ])
  return {
    enabled: getEnabledProviders(),
    status: { claude, codex, grok: grokStatus, opencode: opencodeStatus },
    codex: { data: codexService.getCachedQuota(), error: codexService.getLastError() },
    grok: { data: grok.data, error: grok.error },
    opencode: { data: opencode.data, error: opencode.error }
  }
}
