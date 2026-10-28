import { execFile } from 'child_process'
import { promisify } from 'util'
import { logger } from './logger'
import { redactToken } from './token-utils'

const execFileAsync = promisify(execFile)

export interface Credentials {
  accessToken: string
  refreshToken?: string
  expiresAt?: number
  accountUuid?: string
  emailAddress?: string
  displayName?: string
  subscriptionType?: string
}

// Validate that a string looks like a valid OAuth token (alphanumeric + common token chars)
function isValidToken(token: string): boolean {
  if (!token || typeof token !== 'string') return false
  // OAuth tokens are typically base64-like strings
  return /^[A-Za-z0-9_\-\.]+$/.test(token) && token.length > 10 && token.length < 5000
}

// Validate email format
function isValidEmail(email: string): boolean {
  if (!email || typeof email !== 'string') return false
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && email.length < 256
}

// Prototype pollution-safe JSON parsing
function safeJsonParse(jsonStr: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(jsonStr)
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return null
    }
    // Check for prototype pollution attempts (only own properties, not inherited)
    if (
      Object.hasOwn(parsed, '__proto__') ||
      Object.hasOwn(parsed, 'constructor') ||
      Object.hasOwn(parsed, 'prototype')
    ) {
      logger.warn('Potential prototype pollution attempt detected in JSON')
      return null
    }
    return parsed
  } catch {
    return null
  }
}

export class KeychainService {
  private static readonly SERVICE_NAME = 'Claude Code-credentials'

  async getCredentials(): Promise<Credentials | null> {
    try {
      // Use execFile instead of exec to prevent command injection
      const { stdout } = await execFileAsync('security', [
        'find-generic-password',
        '-s',
        KeychainService.SERVICE_NAME,
        '-w'
      ])

      const jsonStr = stdout.trim()
      if (!jsonStr) {
        return null
      }

      const data = safeJsonParse(jsonStr)
      if (!data) {
        logger.error('Invalid or unsafe JSON in Keychain data')
        return null
      }

      const oauth = data.claudeAiOauth as Record<string, unknown> | undefined
      if (!oauth || typeof oauth !== 'object' || !oauth.accessToken) {
        logger.error('No claudeAiOauth credentials found in Keychain data')
        return null
      }

      const accessToken = String(oauth.accessToken)
      const refreshToken = oauth.refreshToken ? String(oauth.refreshToken) : undefined

      // Validate tokens
      if (!isValidToken(accessToken)) {
        logger.error('Invalid access token format in Keychain')
        return null
      }

      if (refreshToken && !isValidToken(refreshToken)) {
        logger.warn('Invalid refresh token format in Keychain')
      }

      const credentials: Credentials = {
        accessToken,
        refreshToken: refreshToken && isValidToken(refreshToken) ? refreshToken : undefined,
        expiresAt: typeof oauth.expiresAt === 'number' ? oauth.expiresAt : undefined,
        accountUuid: typeof data.accountUuid === 'string' ? data.accountUuid : undefined,
        emailAddress:
          typeof data.emailAddress === 'string' && isValidEmail(data.emailAddress)
            ? data.emailAddress
            : undefined,
        displayName: typeof data.displayName === 'string' ? data.displayName.slice(0, 100) : undefined,
        subscriptionType: typeof oauth.subscriptionType === 'string' ? oauth.subscriptionType : undefined
      }

      logger.debug(`Credentials loaded: token=${redactToken(accessToken)}`)
      return credentials
    } catch (error) {
      // Keychain item not found or access denied - this is expected for new users
      const errMsg = error instanceof Error ? error.message : String(error)
      if (!errMsg.includes('could not be found')) {
        logger.error('Failed to read credentials from Keychain:', errMsg)
      }
      return null
    }
  }

  async hasCredentials(): Promise<boolean> {
    try {
      await execFileAsync('security', [
        'find-generic-password',
        '-s',
        KeychainService.SERVICE_NAME
      ])
      return true
    } catch {
      return false
    }
  }

  // Read-only: Claude Code owns this Keychain item and rotates its tokens itself.
  // Refreshing here would invalidate the CLI's refresh token.
  isTokenExpired(credentials: Credentials): boolean {
    return typeof credentials.expiresAt === 'number' && Date.now() > credentials.expiresAt
  }
}

export const keychainService = new KeychainService()
