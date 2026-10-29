import { describe, it, expect, vi, beforeEach } from 'vitest'

const data: Record<string, unknown> = {}
const { rmSync } = vi.hoisted(() => ({ rmSync: vi.fn() }))
vi.mock('fs', () => ({ rmSync }))
vi.mock('electron', () => ({ app: { getPath: () => '/user-data' } }))
vi.mock('electron-store', () => ({
  default: class {
    get = (key: string) => data[key]
    set = (key: string, value: unknown) => { data[key] = value }
    has = (key: string) => key in data
    delete = (key: string) => { delete data[key] }
  }
}))

beforeEach(() => {
  vi.resetModules()
  rmSync.mockReset()
  for (const key of Object.keys(data)) delete data[key]
  data.refreshInterval = 300
})

describe('settings-store migration', () => {
  it('drops the legacy authMode key and the in-app auth store', async () => {
    data.authMode = 'app'
    await import('../src/main/services/settings-store')
    expect('authMode' in data).toBe(false)
    expect(rmSync).toHaveBeenCalledWith('/user-data/auth-store.json', { force: true })
  })

  it('does nothing once migrated', async () => {
    await import('../src/main/services/settings-store')
    expect(rmSync).not.toHaveBeenCalled()
  })
})
