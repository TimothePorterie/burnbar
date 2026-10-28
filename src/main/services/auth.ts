import { safeStorage, shell } from 'electron'
import crypto from 'crypto'
import Store from 'electron-store'
import { logger } from './logger'
import { t } from '../../shared/i18n'
import { redactToken } from './token-utils'

export type AuthState = 'authenticated' | 'unauthenticated' | 'expired' | 'refreshing'

interface StoredTokens {
  accessToken: string // encrypted via safeStorage
  refreshToken: string // encrypted via safeStorage
  expiresAt: number
  scope?: string
}

interface StoredUserInfo {
  email?: string
  name?: string
  subscriptionType?: string
}

interface AuthStoreSchema {
  tokens: StoredTokens | null
  userInfo: StoredUserInfo | null
}

interface TokenResponse {
  access_token: string
  refresh_token: string
  expires_in: number
  token_type: string
}

type StateChangeCallback = (state: AuthState) => void

export class AuthService {
  private static readonly AUTH_URL = 'https://claude.ai/oauth/authorize'
  private static readonly TOKEN_URL = 'https://console.anthropic.com/v1/oauth/token'
  private static readonly CLIENT_ID = '9d1c250a-e61b-44d9-88ed-5944d1962f5e'
  private static readonly REDIRECT_URI = 'https://console.anthropic.com/oauth/code/callback'
  private static readonly SCOPES = 'user:inference user:profile'

  private store: Store<AuthStoreSchema> | null = null
  private state: AuthState = 'unauthenticated'
  private codeVerifier: string | null = null
  private stateParam: string | null = null
  private loginTimeoutId: ReturnType<typeof setTimeout> | null = null
  private refreshPromise: Promise<boolean> | null = null
  private logoutGeneration = 0
  private stateCallbacks: StateChangeCallback[] = []

  private clearLoginState(): void {
    this.codeVerifier = null
    this.stateParam = null
    if (this.loginTimeoutId) {
      clearTimeout(this.loginTimeoutId)
      this.loginTimeoutId = null
    }
  }

  initialize(): void {
    this.store = new Store<AuthStoreSchema>({
      name: 'auth-store',
      defaults: {
        tokens: null,
        userInfo: null
      }
    })

    // Check if we have stored tokens
    const tokens = this.store.get('tokens')
    if (tokens) {
      try {
        // Verify we can decrypt tokens
        this.decryptToken(tokens.accessToken)
      } catch {
        if (safeStorage.isEncryptionAvailable()) {
          logger.warn('Failed to decrypt stored auth tokens, clearing')
          this.store.set('tokens', null)
          logger.info(`Auth service initialized, state: ${this.state}`)
          return
        }
        // Keychain access not ready yet: keep the tokens, decryption is retried on use
        logger.warn('safeStorage unavailable, keeping stored auth tokens')
      }
      if (tokens.expiresAt && Date.now() > tokens.expiresAt - 5 * 60 * 1000) {
        this.setState('expired')
      } else {
        this.setState('authenticated')
      }
    }

    logger.info(`Auth service initialized, state: ${this.state}`)
  }

  async startLogin(): Promise<boolean> {
    try {
      // Generate PKCE code_verifier (43-128 chars, URL-safe)
      this.codeVerifier = this.generateCodeVerifier()
      const codeChallenge = this.generateCodeChallenge(this.codeVerifier)

      // Generate state parameter for CSRF protection
      this.stateParam = crypto.randomBytes(32).toString('hex')

      const params = new URLSearchParams({
        response_type: 'code',
        client_id: AuthService.CLIENT_ID,
        redirect_uri: AuthService.REDIRECT_URI,
        scope: AuthService.SCOPES,
        code_challenge: codeChallenge,
        code_challenge_method: 'S256',
        state: this.stateParam
      })

      const authUrl = `${AuthService.AUTH_URL}?${params.toString()}`
      await shell.openExternal(authUrl)

      // Auto-clear login state after 10 minutes if flow not completed
      if (this.loginTimeoutId) clearTimeout(this.loginTimeoutId)
      this.loginTimeoutId = setTimeout(() => {
        if (this.codeVerifier) {
          logger.info('OAuth login flow timed out after 10 minutes, clearing state')
          this.clearLoginState()
        }
      }, 10 * 60 * 1000)

      logger.info('OAuth login started, browser opened')
      return true
    } catch (error) {
      logger.error('Failed to start login:', error instanceof Error ? error.message : String(error))
      this.clearLoginState()
      return false
    }
  }

  async submitCode(rawCode: string): Promise<{ success: boolean; error?: string }> {
    if (!this.codeVerifier) {
      return { success: false, error: t('auth.noLoginInProgress') }
    }

    const trimmed = rawCode.trim()
    if (!trimmed || trimmed.length < 5) {
      return { success: false, error: t('auth.invalidCode') }
    }

    // The callback page provides code#state — split on #
    let code: string
    let state: string | undefined
    const hashIndex = trimmed.indexOf('#')
    if (hashIndex !== -1) {
      code = trimmed.substring(0, hashIndex)
      state = trimmed.substring(hashIndex + 1)
    } else {
      code = trimmed
      state = undefined
    }

    // CSRF protection: verify state matches what we sent
    if (!state || state !== this.stateParam) {
      logger.error('OAuth state mismatch — possible CSRF attack')
      this.clearLoginState()
      return { success: false, error: t('auth.invalidCode') }
    }

    try {
      const body: Record<string, string> = {
        grant_type: 'authorization_code',
        code,
        client_id: AuthService.CLIENT_ID,
        redirect_uri: AuthService.REDIRECT_URI,
        code_verifier: this.codeVerifier,
        state
      }

      const response = await fetch(AuthService.TOKEN_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded'
        },
        body: new URLSearchParams(body),
        signal: AbortSignal.timeout(30000)
      })

      if (!response.ok) {
        const errorText = await response.text()
        logger.error(`Token exchange failed: ${response.status} - ${errorText.slice(0, 200)}`)
        this.clearLoginState()
        return { success: false, error: t('auth.authFailed', { status: response.status }) }
      }

      const rawData = (await response.json()) as Record<string, unknown>
      const data = rawData as unknown as TokenResponse

      if (!data.access_token || !data.refresh_token) {
        logger.error('Token exchange returned incomplete data')
        this.clearLoginState()
        return { success: false, error: t('auth.incompleteToken') }
      }

      // Store encrypted tokens
      this.storeTokens(data)

      // Extract user info from token response
      this.extractUserInfoFromResponse(rawData)

      this.clearLoginState()
      this.setState('authenticated')

      logger.info(`OAuth login successful, token: ${redactToken(data.access_token)}`)
      return { success: true }
    } catch (error) {
      this.clearLoginState()

      if (error instanceof Error && error.name === 'TimeoutError') {
        logger.error('Token exchange timed out')
        return { success: false, error: t('auth.timeout') }
      }

      logger.error('Token exchange error:', error instanceof Error ? error.message : String(error))
      return { success: false, error: t('auth.networkError') }
    }
  }

  async refreshTokens(): Promise<boolean> {
    if (!this.store) return false

    const tokens = this.store.get('tokens')
    if (!tokens?.refreshToken) {
      logger.warn('No refresh token available for auth service')
      return false
    }

    // If a refresh is already in progress, all callers await the same promise
    if (this.refreshPromise) {
      logger.debug('Auth token refresh already in progress, awaiting existing promise')
      return this.refreshPromise
    }

    this.refreshPromise = this.doRefreshTokens(tokens.refreshToken)
    try {
      return await this.refreshPromise
    } finally {
      this.refreshPromise = null
    }
  }

  private async doRefreshTokens(encryptedRefreshToken: string): Promise<boolean> {
    const generation = this.logoutGeneration
    const previousState = this.state
    this.setState('refreshing')

    try {
      let refreshToken: string
      try {
        refreshToken = this.decryptToken(encryptedRefreshToken)
      } catch {
        logger.error('Failed to decrypt refresh token')
        this.setState('expired')
        return false
      }

      const response = await fetch(AuthService.TOKEN_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded'
        },
        body: new URLSearchParams({
          grant_type: 'refresh_token',
          refresh_token: refreshToken,
          client_id: AuthService.CLIENT_ID
        }),
        signal: AbortSignal.timeout(30000)
      })

      // User logged out while the request was in flight — don't resurrect the session
      if (generation !== this.logoutGeneration) return false

      if (!response.ok) {
        const errorText = await response.text()
        logger.error(`Auth token refresh failed: ${response.status} - ${errorText.slice(0, 200)}`)
        // A server error says nothing about the refresh token either: keep it and retry later
        this.setState(response.status >= 500 ? previousState : 'expired')
        return false
      }

      const rawData = (await response.json()) as Record<string, unknown>
      const data = rawData as unknown as TokenResponse

      if (!data.access_token || !data.refresh_token) {
        logger.error('Token refresh returned incomplete data')
        this.setState('expired')
        return false
      }

      if (generation !== this.logoutGeneration) return false

      this.storeTokens(data)
      this.extractUserInfoFromResponse(rawData)
      this.setState('authenticated')

      logger.info('Auth token refreshed successfully')
      return true
    } catch (error) {
      if (error instanceof Error && error.name === 'TimeoutError') {
        logger.error('Auth token refresh timed out')
      } else {
        logger.error('Auth token refresh error:', error instanceof Error ? error.message : String(error))
      }
      // Network failure says nothing about the refresh token's validity — keep prior state
      if (generation === this.logoutGeneration) this.setState(previousState)
      return false
    }
  }

  async getValidAccessToken(): Promise<string | null> {
    if (!this.store) return null

    const tokens = this.store.get('tokens')
    if (!tokens) return null

    let accessToken: string
    try {
      accessToken = this.decryptToken(tokens.accessToken)
    } catch {
      logger.error('Failed to decrypt access token')
      return null
    }

    // Check if expired (with 5min buffer)
    if (tokens.expiresAt && Date.now() > tokens.expiresAt - 5 * 60 * 1000) {
      logger.info('Auth access token expired, attempting refresh...')
      const refreshed = await this.refreshTokens()
      if (!refreshed) return null

      // Re-read after refresh
      const updatedTokens = this.store.get('tokens')
      if (!updatedTokens) return null

      try {
        return this.decryptToken(updatedTokens.accessToken)
      } catch {
        return null
      }
    }

    return accessToken
  }

  logout(): void {
    if (!this.store) return

    this.logoutGeneration++
    this.store.set('tokens', null)
    this.store.set('userInfo', null)
    this.clearLoginState()
    this.setState('unauthenticated')

    logger.info('User logged out from auth service')
  }

  getState(): AuthState {
    return this.state
  }

  getUserInfo(): StoredUserInfo | null {
    if (!this.store) return null
    return this.store.get('userInfo')
  }

  hasTokens(): boolean {
    if (!this.store) return false
    return this.store.get('tokens') !== null
  }

  onStateChange(callback: StateChangeCallback): void {
    this.stateCallbacks.push(callback)
  }

  private setState(newState: AuthState): void {
    if (this.state === newState) return
    const oldState = this.state
    this.state = newState
    logger.debug(`Auth state: ${oldState} -> ${newState}`)
    for (const callback of this.stateCallbacks) {
      try {
        callback(newState)
      } catch (error) {
        logger.error('Auth state callback error:', error instanceof Error ? error.message : String(error))
      }
    }
  }

  private generateCodeVerifier(): string {
    // 32 random bytes -> 43 chars base64url
    return crypto.randomBytes(32).toString('base64url')
  }

  private generateCodeChallenge(verifier: string): string {
    return crypto.createHash('sha256').update(verifier).digest('base64url')
  }

  private encryptToken(token: string): string {
    if (!safeStorage.isEncryptionAvailable()) {
      throw new Error('safeStorage encryption not available — cannot store tokens securely')
    }
    return safeStorage.encryptString(token).toString('base64')
  }

  private decryptToken(encrypted: string): string {
    if (!safeStorage.isEncryptionAvailable()) {
      throw new Error('safeStorage encryption not available — cannot decrypt tokens')
    }
    return safeStorage.decryptString(Buffer.from(encrypted, 'base64'))
  }

  private extractUserInfoFromResponse(rawData: Record<string, unknown>): void {
    if (!this.store) return

    const userInfo: StoredUserInfo = this.store.get('userInfo') || {}
    let updated = false

    // Try common field names for subscription type
    for (const key of ['subscription_type', 'subscriptionType', 'plan', 'tier']) {
      if (typeof rawData[key] === 'string' && rawData[key]) {
        userInfo.subscriptionType = rawData[key] as string
        updated = true
        break
      }
    }

    // Try common field names for email
    for (const key of ['email', 'email_address', 'emailAddress']) {
      if (typeof rawData[key] === 'string' && rawData[key]) {
        userInfo.email = rawData[key] as string
        updated = true
        break
      }
    }

    // Try common field names for name
    for (const key of ['name', 'display_name', 'displayName']) {
      if (typeof rawData[key] === 'string' && rawData[key]) {
        userInfo.name = rawData[key] as string
        updated = true
        break
      }
    }

    if (updated) {
      this.store.set('userInfo', userInfo)
      logger.debug(`User info from token response: ${JSON.stringify(userInfo)}`)
    }
  }

  private storeTokens(data: TokenResponse): void {
    if (!this.store) return

    this.store.set('tokens', {
      accessToken: this.encryptToken(data.access_token),
      refreshToken: this.encryptToken(data.refresh_token),
      expiresAt: Date.now() + data.expires_in * 1000,
      scope: AuthService.SCOPES
    })
  }

}

export const authService = new AuthService()
