import { execFile } from 'child_process'
import { accessSync, constants, readdirSync } from 'fs'
import { homedir, userInfo } from 'os'
import { delimiter, join } from 'path'
import { logger } from './logger'

const MARKER = '__BURNBAR_PATH__'

export class CliNotFoundError extends Error {}

let pathPromise: Promise<string> | null = null

// An app opened from the Finder does not inherit the login shell's PATH
function loginShellPath(): Promise<string> {
  const shell = process.env.SHELL || userInfo().shell || '/bin/sh'
  return new Promise((resolve) => {
    execFile(shell, ['-ilc', `printf '${MARKER}%s${MARKER}' "$PATH"`], { timeout: 5000 }, (error, stdout) => {
      const match = String(stdout ?? '').match(new RegExp(`${MARKER}(.*)${MARKER}`))
      if (!match) logger.warn('Could not read the login shell PATH:', error?.message ?? 'no output')
      resolve(match?.[1] ?? '')
    })
  })
}

function nvmBins(home: string): string[] {
  try {
    return readdirSync(join(home, '.nvm/versions/node')).sort().reverse().map(version => join(home, '.nvm/versions/node', version, 'bin'))
  } catch {
    return []
  }
}

async function buildPath(): Promise<string> {
  const home = homedir()
  const dirs = [
    ...(await loginShellPath()).split(delimiter),
    ...(process.env.PATH ?? '').split(delimiter),
    join(home, '.local/bin'), '/opt/homebrew/bin', '/usr/local/bin', join(home, '.bun/bin'), join(home, '.volta/bin'),
    ...nvmBins(home)
  ]
  return [...new Set(dirs.filter(Boolean))].join(delimiter)
}

// Computed once, on first use
export function getCliPath(): Promise<string> {
  pathPromise ??= buildPath()
  return pathPromise
}

export async function resolveCli(name: string): Promise<string | null> {
  for (const dir of (await getCliPath()).split(delimiter)) {
    try {
      accessSync(join(dir, name), constants.X_OK)
      return join(dir, name)
    } catch {
      // not in this directory
    }
  }
  return null
}

// Child processes get the full PATH too: codex is a node script
export async function cliEnv(): Promise<NodeJS.ProcessEnv> {
  return { ...process.env, PATH: await getCliPath() }
}

export async function runCli(name: string, args: string[], timeoutMs: number): Promise<string> {
  const bin = await resolveCli(name)
  if (!bin) throw new CliNotFoundError(name)
  const env = await cliEnv()
  return new Promise((resolve, reject) => {
    execFile(bin, args, { env, timeout: timeoutMs, maxBuffer: 32 * 1024 * 1024 }, (error, stdout) => {
      if (error) reject(error)
      else resolve(stdout)
    })
  })
}
