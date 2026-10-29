import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

vi.mock('../src/main/services/logger', () => ({ logger: { warn: vi.fn() } }))

const { HOME, SHELL, PATH } = process.env
let home: string

const executable = (path: string, body: string): void => {
  mkdirSync(join(path, '..'), { recursive: true })
  writeFileSync(path, `#!/bin/sh\n${body}\n`)
  chmodSync(path, 0o755)
}

// Login shell that prints rc noise around the marked PATH, and counts its runs
const fakeShell = (path: string): void => executable(join(home, 'shell'),
  `echo run >> "${home}/runs"\necho 'Welcome!'\nPATH="${path}"\neval "$2"\necho bye`)

const load = async (): Promise<typeof import('../src/main/services/cli-path')> => {
  vi.resetModules()
  return import('../src/main/services/cli-path')
}

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'burnbar-path-'))
  process.env.HOME = home
  process.env.SHELL = join(home, 'shell')
  process.env.PATH = '/usr/bin:/bin'
})

afterEach(() => {
  // Keys one by one: replacing process.env would detach it from the real environment homedir() reads
  Object.assign(process.env, { HOME, SHELL, PATH })
  rmSync(home, { recursive: true, force: true })
})

describe('cli-path', () => {
  it('uses the login shell PATH once, then the usual install directories', async () => {
    fakeShell(`${home}/shellbin:/usr/bin`)
    mkdirSync(join(home, '.nvm/versions/node/v22.1.0/bin'), { recursive: true })
    mkdirSync(join(home, '.nvm/versions/node/v24.14.0/bin'), { recursive: true })
    const { getCliPath } = await load()
    const dirs = (await getCliPath()).split(':')
    expect(dirs.slice(0, 3)).toEqual([`${home}/shellbin`, '/usr/bin', '/bin'])
    expect(dirs).toEqual(expect.arrayContaining([
      `${home}/.local/bin`, '/opt/homebrew/bin', '/usr/local/bin', `${home}/.bun/bin`, `${home}/.volta/bin`
    ]))
    expect(dirs.indexOf(`${home}/.nvm/versions/node/v24.14.0/bin`)).toBeLessThan(dirs.indexOf(`${home}/.nvm/versions/node/v22.1.0/bin`))
    expect(new Set(dirs).size).toBe(dirs.length)
    await getCliPath()
    expect(readFileSync(join(home, 'runs'), 'utf8')).toBe('run\n')
  })

  it('resolves tools from the shell PATH and the fallbacks, and passes the PATH to children', async () => {
    fakeShell(`${home}/shellbin`)
    executable(join(home, 'shellbin/codex'), 'echo "$PATH"')
    executable(join(home, '.local/bin/grok'), 'echo grok')
    writeFileSync(join(home, '.local/bin/opencode'), 'not executable')
    const { resolveCli, runCli, CliNotFoundError } = await load()
    expect(await resolveCli('codex')).toBe(join(home, 'shellbin/codex'))
    expect(await resolveCli('grok')).toBe(join(home, '.local/bin/grok'))
    expect(await resolveCli('opencode')).toBeNull()
    expect((await runCli('codex', [], 5000)).trim().split(':')).toContain(`${home}/.local/bin`)
    await expect(runCli('opencode', [], 5000)).rejects.toBeInstanceOf(CliNotFoundError)
  })

  it('falls back to the known directories when the shell fails', async () => {
    process.env.SHELL = join(home, 'missing-shell')
    executable(join(home, '.bun/bin/opencode'), 'echo ok')
    const { resolveCli } = await load()
    expect(await resolveCli('opencode')).toBe(join(home, '.bun/bin/opencode'))
  })
})
