// Settings renderer script
import type { Locale } from '../../shared/i18n'
import { t, setLocale, applyI18n } from '../../shared/i18n'

// DOM elements
const statusIndicator = document.getElementById('statusIndicator') as HTMLElement
const statusText = document.getElementById('statusText') as HTMLElement
const statusEmail = document.getElementById('statusEmail') as HTMLElement
const logoutBtn = document.getElementById('logoutBtn') as HTMLButtonElement
const loginBtn = document.getElementById('loginBtn') as HTMLButtonElement
const cliHint = document.getElementById('cliHint') as HTMLElement
const authCodeSection = document.getElementById('authCodeSection') as HTMLElement
const authCodeInput = document.getElementById('authCodeInput') as HTMLInputElement
const validateBtn = document.getElementById('validateBtn') as HTMLButtonElement
const cancelLoginBtn = document.getElementById('cancelLoginBtn') as HTMLButtonElement
const authError = document.getElementById('authError') as HTMLElement
const language = document.getElementById('language') as HTMLSelectElement
const enableNotifications = document.getElementById('enableNotifications') as HTMLInputElement
const launchAtLogin = document.getElementById('launchAtLogin') as HTMLInputElement

let authMode: 'app' | 'cli' = 'app'

const ARROW_STEPS: Record<string, number> = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }

// ARIA radiogroup: click or arrow keys select, roving tabindex
function segmented(group: HTMLElement, onChange: (value: string) => void): (value: string) => void {
  const radios = Array.from(group.querySelectorAll<HTMLButtonElement>('[role="radio"]'))
  const select = (value: string): void => {
    for (const radio of radios) {
      const on = radio.dataset.value === value
      radio.setAttribute('aria-checked', String(on))
      radio.tabIndex = on ? 0 : -1
    }
  }
  radios.forEach((radio, i) => {
    radio.addEventListener('click', () => {
      if (radio.getAttribute('aria-checked') === 'true') return
      select(radio.dataset.value!)
      onChange(radio.dataset.value!)
    })
    radio.addEventListener('keydown', (e) => {
      const step = ARROW_STEPS[e.key]
      if (!step) return
      e.preventDefault()
      const next = radios[(i + step + radios.length) % radios.length]
      next.focus()
      next.click()
    })
  })
  return select
}

// Renders `code` spans from backtick-delimited translations
function setRichText(el: HTMLElement, text: string): void {
  el.replaceChildren(...text.split('`').map((part, i) => {
    if (i % 2 === 0) return part
    const code = document.createElement('code')
    code.textContent = part
    return code
  }))
}

function showAccount(connected: boolean, detail: string): void {
  statusIndicator.classList.toggle('connected', connected)
  statusText.textContent = t(connected ? 'settings.connected' : 'settings.notConnected')
  statusEmail.textContent = detail
  // CLI credentials belong to Claude Code — login/logout happen there
  logoutBtn.hidden = !connected || authMode === 'cli'
  loginBtn.hidden = connected || authMode === 'cli' || !authCodeSection.hidden
  cliHint.hidden = authMode !== 'cli'
}

async function loadConnectionStatus(): Promise<void> {
  try {
    if (await window.claudeBar.hasCredentials()) {
      authCodeSection.hidden = true
      const userInfo = await window.claudeBar.getUserInfo()
      showAccount(true, userInfo?.email || userInfo?.name || '')
    } else {
      showAccount(false, authMode === 'cli' ? '' : t('settings.noCredentials'))
    }
  } catch (error) {
    console.error('Failed to load connection status:', error)
    showAccount(false, t('settings.credentialsError'))
  }
}

function applyLocale(lang: Locale): void {
  setLocale(lang)
  applyI18n()
  language.value = lang
  setRichText(cliHint, t('settings.cliModeHint'))
  loadConnectionStatus()
  loadUpdateInfo()
}

// Event listeners
language.addEventListener('change', async () => {
  const lang = language.value as Locale
  try {
    await window.claudeBar.setLanguage(lang)
    applyLocale(lang)
  } catch (error) {
    console.error('Failed to update language:', error)
  }
})

const selectAuthMode = segmented(document.getElementById('authMode')!, async (value) => {
  authMode = value as 'app' | 'cli'
  authCodeSection.hidden = true
  try {
    await window.claudeBar.setAuthMode(authMode)
  } catch (error) {
    console.error('Failed to update auth mode:', error)
  }
  await loadConnectionStatus()
})

const selectRefreshInterval = segmented(document.getElementById('refreshInterval')!, async (value) => {
  try {
    await window.claudeBar.setRefreshInterval(parseInt(value, 10))
  } catch (error) {
    console.error('Failed to update refresh interval:', error)
  }
})

enableNotifications.addEventListener('change', async () => {
  try {
    await window.claudeBar.setEnableNotifications(enableNotifications.checked)
  } catch (error) {
    console.error('Failed to update notifications setting:', error)
  }
})

launchAtLogin.addEventListener('change', async () => {
  try {
    await window.claudeBar.setLaunchAtLogin(launchAtLogin.checked)
  } catch (error) {
    console.error('Failed to update launch at login:', error)
  }
})

// Auth event listeners
loginBtn.addEventListener('click', async () => {
  loginBtn.disabled = true
  try {
    if (await window.claudeBar.startLogin()) {
      loginBtn.hidden = true
      authCodeSection.hidden = false
      authCodeInput.value = ''
      authError.hidden = true
      authCodeInput.focus()
    }
  } catch (error) {
    console.error('Failed to start login:', error)
  } finally {
    loginBtn.disabled = false
  }
})

validateBtn.addEventListener('click', async () => {
  const code = authCodeInput.value.trim()
  if (!code) return

  validateBtn.disabled = true
  authError.hidden = true

  try {
    const result = await window.claudeBar.submitAuthCode(code)
    if (result.success) {
      await loadConnectionStatus()
    } else {
      authError.textContent = result.error || t('error.authFailed')
      authError.hidden = false
    }
  } catch (error) {
    console.error('Failed to submit auth code:', error)
    authError.textContent = t('error.unexpected')
    authError.hidden = false
  } finally {
    validateBtn.disabled = false
  }
})

authCodeInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    validateBtn.click()
  }
})

cancelLoginBtn.addEventListener('click', () => {
  authCodeSection.hidden = true
  loginBtn.hidden = false
})

logoutBtn.addEventListener('click', async () => {
  try {
    await window.claudeBar.logout()
    await loadConnectionStatus()
  } catch (error) {
    console.error('Failed to logout:', error)
  }
})

// Listen for auth state changes
window.claudeBar.onAuthStateChanged(async (state) => {
  if (state === 'authenticated' || state === 'unauthenticated') {
    await loadConnectionStatus()
  }
})

// Update UI elements
const updateText = document.getElementById('updateText') as HTMLElement
const checkUpdateBtn = document.getElementById('checkUpdateBtn') as HTMLButtonElement
const installUpdateBtn = document.getElementById('installUpdateBtn') as HTMLButtonElement
const updateProgress = document.getElementById('updateProgress') as HTMLElement
const updateProgressBar = document.getElementById('updateProgressBar') as HTMLElement
const appVersion = document.getElementById('appVersion') as HTMLElement

function updateUpdateUI(state: { status: string; version?: string; progress?: number; error?: string }): void {
  checkUpdateBtn.disabled = false
  checkUpdateBtn.hidden = false
  installUpdateBtn.disabled = false
  installUpdateBtn.hidden = true
  updateProgress.hidden = true
  updateProgress.classList.remove('indeterminate')
  updateProgress.removeAttribute('aria-valuenow')

  switch (state.status) {
    case 'checking':
      updateText.textContent = t('settings.checking')
      checkUpdateBtn.disabled = true
      updateProgress.hidden = false
      updateProgress.classList.add('indeterminate')
      break
    case 'available':
      updateText.textContent = t('settings.versionAvailable', { version: state.version ?? '' })
      checkUpdateBtn.hidden = true
      installUpdateBtn.hidden = false
      installUpdateBtn.textContent = t('settings.downloadInstall')
      break
    case 'not-available':
      updateText.textContent = t('settings.upToDate')
      break
    case 'downloading':
      updateText.textContent = t('settings.downloading', { progress: state.progress ?? 0 })
      checkUpdateBtn.hidden = true
      updateProgress.hidden = false
      updateProgress.setAttribute('aria-valuenow', String(state.progress ?? 0))
      updateProgressBar.style.width = `${state.progress ?? 0}%`
      break
    case 'downloaded':
      updateText.textContent = t('settings.versionReady', { version: state.version ?? '' })
      checkUpdateBtn.hidden = true
      installUpdateBtn.hidden = false
      installUpdateBtn.textContent = t('settings.installRestart')
      break
    case 'error':
      updateText.textContent = state.error || t('settings.updateFailed')
      break
    default:
      updateText.textContent = ''
  }
}

checkUpdateBtn.addEventListener('click', async () => {
  checkUpdateBtn.disabled = true
  try {
    await window.claudeBar.checkForUpdates()
  } catch (error) {
    console.error('Failed to check for updates:', error)
    checkUpdateBtn.disabled = false
  }
})

installUpdateBtn.addEventListener('click', async () => {
  installUpdateBtn.disabled = true
  try {
    const state = await window.claudeBar.getUpdateStatus()
    if (state.status === 'available') {
      await window.claudeBar.downloadUpdate()
    } else if (state.status === 'downloaded') {
      await window.claudeBar.installUpdate()
    }
  } catch (error) {
    console.error('Failed to install update:', error)
    installUpdateBtn.disabled = false
  }
})

// Listen for update status changes
window.claudeBar.onUpdateStatusChanged(updateUpdateUI)

// Load version and initial update state
async function loadUpdateInfo(): Promise<void> {
  try {
    const version = await window.claudeBar.getAppVersion()
    appVersion.textContent = t('settings.version', { version })

    const state = await window.claudeBar.getUpdateStatus()
    updateUpdateUI(state)
  } catch (error) {
    console.error('Failed to load update info:', error)
  }
}

window.claudeBar.onLanguageChanged(applyLocale)

// Initialize locale then load
async function init(): Promise<void> {
  const settings = await window.claudeBar.getSettings()
  authMode = settings.authMode
  selectAuthMode(settings.authMode)
  selectRefreshInterval(settings.refreshInterval.toString())
  enableNotifications.checked = settings.enableNotifications
  launchAtLogin.checked = settings.launchAtLogin
  applyLocale(settings.language as Locale)
}

init()
