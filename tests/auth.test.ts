import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { t } from '../src/shared/i18n'

const { store, openExternal, fetchMock } = vi.hoisted(() => ({
  store: new Map<string, unknown>(),
  openExternal: vi.fn(),
  fetchMock: vi.fn()
}))
vi.mock('electron', () => ({
  shell: { openExternal },
  safeStorage: {
    isEncryptionAvailable: () => true,
    encryptString: (value: string) => Buffer.from(value),
    decryptString: (value: Buffer) => value.toString()
  }
}))
vi.mock('electron-store', () => ({
  default: class {
    get(key: string) { return store.get(key) ?? null }
    set(key: string, value: unknown) { store.set(key, value) }
  }
}))
vi.mock('../src/main/services/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }
}))

const { AuthService } = await import('../src/main/services/auth')

beforeEach(() => {
  store.clear()
  openExternal.mockReset().mockResolvedValue(undefined)
  fetchMock.mockReset().mockRejectedValue(new DOMException('timed out', 'TimeoutError'))
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('OAuth timeouts', () => {
  it('reports a token exchange timeout with the existing message', async () => {
    const timeout = vi.spyOn(AbortSignal, 'timeout')
    const auth = new AuthService()
    auth.initialize()
    await auth.startLogin()
    const state = new URL(openExternal.mock.calls[0][0]).searchParams.get('state')
    expect(await auth.submitCode(`authorization-code#${state}`)).toEqual({
      success: false, error: t('auth.timeout')
    })
    expect(timeout).toHaveBeenCalledWith(30000)
    expect(fetchMock.mock.calls[0][1].signal).toBeInstanceOf(AbortSignal)
  })

  it('keeps authenticated tokens and state after a refresh timeout', async () => {
    const timeout = vi.spyOn(AbortSignal, 'timeout')
    const tokens = {
      accessToken: Buffer.from('access-token').toString('base64'),
      refreshToken: Buffer.from('refresh-token').toString('base64'),
      expiresAt: Date.now() + 3600000
    }
    store.set('tokens', tokens)
    const auth = new AuthService()
    auth.initialize()
    expect(await auth.refreshTokens()).toBe(false)
    expect(auth.getState()).toBe('authenticated')
    expect(store.get('tokens')).toEqual(tokens)
    expect(timeout).toHaveBeenCalledWith(30000)
  })
})
