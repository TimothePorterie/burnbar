import { beforeEach, describe, expect, it, vi } from 'vitest'

const execFile = vi.hoisted(() => vi.fn())
vi.mock('child_process', () => ({ execFile: (...args: unknown[]) => execFile(...args) }))
vi.mock('../src/main/services/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }))

const { KeychainService } = await import('../src/main/services/keychain')

type Callback = (error: Error | null, result?: { stdout: string; stderr: string }) => void
const respond = (stdout: string): void => {
  execFile.mockImplementation((...args: unknown[]) => (args.at(-1) as Callback | undefined)?.(null, { stdout, stderr: '' }))
}
const exit = (code: number | null): void => {
  execFile.mockImplementation((...args: unknown[]) => (args.at(-1) as Callback | undefined)?.(Object.assign(new Error('Command failed'), { code })))
}

beforeEach(() => execFile.mockReset())

describe('Keychain read', () => {
  it('reads valid credentials with a timeout and clears the last failure', async () => {
    const service = new KeychainService()
    exit(44)
    await service.getCredentials()
    respond(JSON.stringify({ claudeAiOauth: { accessToken: 'sk-ant-oat-valid-token' }, accountUuid: 'acc' }))
    expect(await service.getCredentials()).toMatchObject({ accessToken: 'sk-ant-oat-valid-token', accountUuid: 'acc' })
    expect(service.lastFailure).toBeNull()
    expect(execFile.mock.calls[1][2]).toEqual({ timeout: 60_000 })
  })

  it.each([
    ['not JSON', '{oops'],
    ['empty', ''],
    ['without a token', JSON.stringify({ claudeAiOauth: {} })],
    ['with a malformed token', JSON.stringify({ claudeAiOauth: { accessToken: 'short' } })]
  ])('reports an item %s as invalid', async (_case, stdout) => {
    const service = new KeychainService()
    respond(stdout)
    expect(await service.getCredentials()).toBeNull()
    expect(service.lastFailure).toBe('invalid')
  })

  it.each([
    [44, 'missing'], [128, 'denied'], [51, 'denied'], [36, 'failed'], [null, 'failed']
  ] as const)('maps security exit code %s to %s', async (code, failure) => {
    const service = new KeychainService()
    exit(code)
    expect(await service.getCredentials()).toBeNull()
    expect(service.lastFailure).toBe(failure)
  })
})
