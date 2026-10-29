import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  store: {} as Record<string, unknown>,
  keychain: false,
  installed: new Set<string>(),
  lastError: null as { type: string } | null
}))
vi.mock('../src/main/services/settings-store', () => ({
  settingsStore: {
    get: (key: string) => mocks.store[key],
    set: (key: string, value: unknown) => { mocks.store[key] = value }
  }
}))
vi.mock('../src/main/services/logger', () => ({ logger: { info: vi.fn() } }))
vi.mock('../src/main/services/keychain', () => ({ keychainService: { hasCredentials: async () => mocks.keychain } }))
vi.mock('../src/main/services/cli-path', () => ({ resolveCli: async (name: string) => mocks.installed.has(name) ? `/bin/${name}` : null }))
vi.mock('../src/main/services/quota-api', () => ({ quotaService: { getLastError: () => mocks.lastError } }))
vi.mock('../src/main/services/codex', () => ({
  codexService: { status: null, getCachedQuota: () => null, getLastError: () => ({ type: 'auth', message: 'Run codex login', retryable: false }) }
}))
vi.mock('../src/main/services/consumption', () => ({
  consumptionService: { getView: () => ({ data: null, error: null, status: null }) }
}))

const { detectProviders, getProvidersSnapshot, getTrayProvider, isProviderEnabled, setProviderEnabled } = await import('../src/main/services/providers')

beforeEach(() => {
  mocks.store = { trayProvider: 'claude' }
  mocks.keychain = false
  mocks.installed = new Set()
  mocks.lastError = null
})

describe('detectProviders', () => {
  it('turns on what is installed on first launch and picks the menu bar provider', async () => {
    mocks.installed = new Set(['codex', 'opencode'])
    await detectProviders()
    expect(mocks.store.providers).toEqual({ claude: false, codex: true, grok: false, opencode: true })
    expect(mocks.store.trayProvider).toBe('codex')
  })

  it('keeps Claude when its Keychain item exists', async () => {
    mocks.keychain = true
    mocks.installed = new Set(['codex'])
    await detectProviders()
    expect(mocks.store.providers).toMatchObject({ claude: true, codex: true })
    expect(mocks.store.trayProvider).toBe('claude')
  })

  it('keeps Claude on when nothing is found, and runs only once', async () => {
    await detectProviders()
    expect(mocks.store.providers).toEqual({ claude: true, codex: false, grok: false, opencode: false })
    mocks.installed = new Set(['grok'])
    await detectProviders()
    expect(isProviderEnabled('grok')).toBe(false)
  })
})

describe('getTrayProvider', () => {
  it.each([
    ['claude', { claude: true, codex: true }, 'claude'],
    ['codex', { claude: true, codex: true }, 'codex'],
    ['max', { claude: true, codex: true }, 'max'],
    ['max', { claude: true, codex: false }, 'claude'],
    ['max', { claude: false, codex: true }, 'codex'],
    ['codex', { claude: true, codex: false }, 'claude'],
    ['claude', { claude: false, codex: true }, 'codex']
  ])('choice %s with %o shows %s', (choice, enabled, expected) => {
    mocks.store = { trayProvider: choice, providers: { grok: false, opencode: false, ...enabled } }
    expect(getTrayProvider()).toBe(expected)
  })
})

describe('getProvidersSnapshot', () => {
  it('reports each provider on its own', async () => {
    mocks.store.providers = { claude: true, codex: true, grok: true, opencode: false }
    mocks.keychain = true
    mocks.installed = new Set(['codex'])
    mocks.lastError = { type: 'network' }
    setProviderEnabled('opencode', true)
    const snapshot = await getProvidersSnapshot()
    expect(snapshot.enabled).toEqual({ claude: true, codex: true, grok: true, opencode: true })
    expect(snapshot.status).toEqual({ claude: 'connected', codex: 'installed', grok: 'not-installed', opencode: 'not-installed' })
    expect(snapshot.codex.error?.message).toBe('Run codex login')
    mocks.lastError = { type: 'auth' }
    expect((await getProvidersSnapshot()).status.claude).toBe('not-connected')
  })
})
