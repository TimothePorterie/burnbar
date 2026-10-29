import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

const data: Record<string, unknown> = {}
const { paths, info } = vi.hoisted(() => ({ paths: { appData: '', userData: '' }, info: vi.fn() }))
vi.mock('electron', () => ({ app: { getPath: (name: keyof typeof paths) => paths[name] } }))
vi.mock('../src/main/services/logger', () => ({ logger: { info } }))
vi.mock('electron-store', () => ({
  default: class {
    constructor() {
      const config = join(paths.userData, 'config.json')
      if (existsSync(config)) Object.assign(data, JSON.parse(readFileSync(config, 'utf8')))
    }
    get = (key: string) => data[key]
    set = (key: string, value: unknown) => { data[key] = value }
    has = (key: string) => key in data
    delete = (key: string) => { delete data[key] }
  }
}))

beforeEach(() => {
  vi.resetModules()
  info.mockReset()
  paths.appData = mkdtempSync(join(tmpdir(), 'burnbar-store-'))
  paths.userData = join(paths.appData, 'burnbar')
  for (const key of Object.keys(data)) delete data[key]
  data.refreshInterval = 300
})

afterEach(() => rmSync(paths.appData, { recursive: true, force: true }))

describe('settings-store app rename migration', () => {
  it('copies settings before constructing the store without changing the old directory or logs', async () => {
    const legacyDirectory = join(paths.appData, 'claude-bar')
    mkdirSync(join(legacyDirectory, 'logs'), { recursive: true })
    const config = '{ "refreshInterval": 600, "language": "fr", "showRemaining": true }\n'
    writeFileSync(join(legacyDirectory, 'config.json'), config)
    writeFileSync(join(legacyDirectory, 'logs', 'previous.log'), 'previous logs')

    const { settingsStore } = await import('../src/main/services/settings-store')

    expect(readFileSync(join(paths.userData, 'config.json'), 'utf8')).toBe(config)
    expect(settingsStore.get('refreshInterval')).toBe(600)
    expect(settingsStore.get('language')).toBe('fr')
    expect(settingsStore.get('showRemaining')).toBe(true)
    expect(readFileSync(join(legacyDirectory, 'config.json'), 'utf8')).toBe(config)
    expect(readFileSync(join(legacyDirectory, 'logs', 'previous.log'), 'utf8')).toBe('previous logs')
    expect(existsSync(join(paths.userData, 'logs'))).toBe(false)
    expect(info).toHaveBeenCalledOnce()
  })

  it('keeps existing BurnBar settings when the old settings also exist', async () => {
    mkdirSync(join(paths.appData, 'claude-bar'), { recursive: true })
    writeFileSync(join(paths.appData, 'claude-bar', 'config.json'), '{"refreshInterval":600}')
    mkdirSync(paths.userData)
    const config = '{"refreshInterval":900}'
    writeFileSync(join(paths.userData, 'config.json'), config)

    const { settingsStore } = await import('../src/main/services/settings-store')

    expect(readFileSync(join(paths.userData, 'config.json'), 'utf8')).toBe(config)
    expect(settingsStore.get('refreshInterval')).toBe(900)
    expect(info).not.toHaveBeenCalled()
  })

  it('leaves first installs to the store when no legacy config exists', async () => {
    await import('../src/main/services/settings-store')
    expect(existsSync(paths.userData)).toBe(false)
    expect(info).not.toHaveBeenCalled()
  })
})

describe('settings-store migration', () => {
  it('drops the legacy authMode key and the in-app auth store', async () => {
    data.authMode = 'app'
    mkdirSync(paths.userData)
    const authStore = join(paths.userData, 'auth-store.json')
    writeFileSync(authStore, '{}')
    await import('../src/main/services/settings-store')
    expect('authMode' in data).toBe(false)
    expect(existsSync(authStore)).toBe(false)
  })

  it('does nothing once migrated', async () => {
    mkdirSync(paths.userData)
    const authStore = join(paths.userData, 'auth-store.json')
    writeFileSync(authStore, '{}')
    await import('../src/main/services/settings-store')
    expect(readFileSync(authStore, 'utf8')).toBe('{}')
  })
})
