// Settings renderer script
import type { Locale } from '../../shared/i18n'
import { t, setLocale, applyI18n } from '../../shared/i18n'
import type { ProviderId, ProvidersSnapshot, QuotaError, TrayProvider } from '../../shared/types'

// DOM elements
const statusIndicator = document.getElementById('statusIndicator') as HTMLElement
const statusText = document.getElementById('statusText') as HTMLElement
const statusEmail = document.getElementById('statusEmail') as HTMLElement
const refreshAccountBtn = document.getElementById('refreshAccountBtn') as HTMLButtonElement
const accountHint = document.getElementById('accountHint') as HTMLElement
const language = document.getElementById('language') as HTMLSelectElement
const enableNotifications = document.getElementById('enableNotifications') as HTMLInputElement
const launchAtLogin = document.getElementById('launchAtLogin') as HTMLInputElement
const showRemaining = document.getElementById('showRemaining') as HTMLInputElement
const loginItemHint = document.getElementById('loginItemHint') as HTMLElement
const openLoginItemsBtn = document.getElementById('openLoginItemsBtn') as HTMLButtonElement

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
  setRichText(statusEmail, detail)
  statusEmail.classList.toggle('wrap', !connected)
  statusEmail.title = detail.replaceAll('`', '')
}

// The Keychain item exists but the session can't be used: same verdict as the popup
const isSessionError = (error: QuotaError | null): boolean => error?.type === 'auth' || error?.type === 'keychain'

async function loadConnectionStatus(recheck = false): Promise<void> {
  try {
    if (!(await window.burnBar.hasCredentials())) {
      showAccount(false, '')
      return
    }
    let error = await window.burnBar.getLastError()
    // The user may have run `claude` since the last fetch: check again before reporting a problem
    if (recheck && isSessionError(error)) {
      await window.burnBar.refreshQuota()
      error = await window.burnBar.getLastError()
    }
    const userInfo = await window.burnBar.getUserInfo()
    if (userInfo && !isSessionError(error)) {
      const plan = userInfo.subscriptionType
      const planLabel = plan && plan.charAt(0).toUpperCase() + plan.slice(1)
      showAccount(true, [userInfo.email || userInfo.name, planLabel].filter(Boolean).join(' · '))
    } else {
      showAccount(false, error && isSessionError(error) ? error.message : t('error.credentialsInvalid'))
    }
  } catch (error) {
    console.error('Failed to load connection status:', error)
    showAccount(false, t('settings.credentialsError'))
  }
}

const providerRows = Array.from(document.querySelectorAll<HTMLElement>('[data-provider]'))

// The Account section is Claude Code's Keychain session
function showProviders(snapshot: ProvidersSnapshot | null): void {
  if (!snapshot) return
  document.getElementById('accountSection')!.hidden = !snapshot.enabled.claude
  for (const row of providerRows) {
    const id = row.dataset.provider as ProviderId
    const status = snapshot.status[id]
    const error = id === 'claude' ? null : snapshot[id].error
    const label = status === 'error' && error ? error.message : t(`provider.${status}`)
    const sub = row.querySelector('.provider-status') as HTMLElement
    setRichText(sub, id === 'grok' || id === 'opencode' ? `${label} \u00b7 ${t('settings.usageOnly')}` : label)
    sub.dataset.status = status
    row.querySelector('input')!.checked = snapshot.enabled[id]
  }
}

async function loadProviders(): Promise<void> {
  try {
    showProviders(await window.burnBar.getProviders())
  } catch (error) {
    console.error('Failed to load providers:', error)
  }
}

for (const row of providerRows) {
  const input = row.querySelector('input')!
  input.addEventListener('change', async () => {
    const saved = await window.burnBar.setProviderEnabled(row.dataset.provider as ProviderId, input.checked)
    if (!saved) input.checked = !input.checked
  })
}
window.burnBar.onProvidersUpdated(showProviders)

const selectTrayProvider = segmented(document.getElementById('trayProvider')!, async (value) => {
  try {
    await window.burnBar.setTrayProvider(value as TrayProvider)
  } catch (error) {
    console.error('Failed to update menu bar provider:', error)
  }
})

function applyLocale(lang: Locale): void {
  setLocale(lang)
  applyI18n()
  language.value = lang
  setRichText(accountHint, t('settings.accountHint'))
  loadConnectionStatus()
  loadUpdateInfo()
  void loadProviders()
}

// Event listeners
showRemaining.addEventListener('change', async () => {
  const saved = await window.burnBar.setShowRemaining(showRemaining.checked)
  if (!saved) showRemaining.checked = !showRemaining.checked
})
window.burnBar.onShowRemainingChanged(enabled => { showRemaining.checked = enabled })
language.addEventListener('change', async () => {
  const lang = language.value as Locale
  try {
    await window.burnBar.setLanguage(lang)
    applyLocale(lang)
  } catch (error) {
    console.error('Failed to update language:', error)
  }
})

refreshAccountBtn.addEventListener('click', async () => {
  refreshAccountBtn.disabled = true
  await loadConnectionStatus(true)
  refreshAccountBtn.disabled = false
})

const selectTheme = segmented(document.getElementById('theme')!, async (value) => {
  try {
    await window.burnBar.setTheme(value as 'system' | 'light' | 'dark')
  } catch (error) {
    console.error('Failed to update theme:', error)
  }
})

const selectRefreshInterval = segmented(document.getElementById('refreshInterval')!, async (value) => {
  try {
    await window.burnBar.setRefreshInterval(parseInt(value, 10))
  } catch (error) {
    console.error('Failed to update refresh interval:', error)
  }
})

enableNotifications.addEventListener('change', async () => {
  try {
    await window.burnBar.setEnableNotifications(enableNotifications.checked)
  } catch (error) {
    console.error('Failed to update notifications setting:', error)
  }
})

launchAtLogin.addEventListener('change', async () => {
  try {
    await window.burnBar.setLaunchAtLogin(launchAtLogin.checked)
  } catch (error) {
    console.error('Failed to update launch at login:', error)
  }
  await loadLoginItemStatus()
})

openLoginItemsBtn.addEventListener('click', () => void window.burnBar.openLoginItemsSettings())

// Re-check when the user comes back: login item approval, or a Claude Code login in the meantime
window.addEventListener('focus', () => {
  void loadLoginItemStatus()
  void loadConnectionStatus(true)
  void loadProviders()
})

async function loadLoginItemStatus(): Promise<void> {
  try {
    const settings = await window.burnBar.getSettings()
    showRemaining.checked = settings.showRemaining
    loginItemHint.hidden = settings.launchAtLoginStatus !== 'requires-approval'
  } catch (error) {
    console.error('Failed to load login item status:', error)
  }
}

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
    await window.burnBar.checkForUpdates()
  } catch (error) {
    console.error('Failed to check for updates:', error)
    checkUpdateBtn.disabled = false
  }
})

installUpdateBtn.addEventListener('click', async () => {
  installUpdateBtn.disabled = true
  try {
    const state = await window.burnBar.getUpdateStatus()
    if (state.status === 'available') {
      await window.burnBar.downloadUpdate()
    } else if (state.status === 'downloaded') {
      await window.burnBar.installUpdate()
    }
  } catch (error) {
    console.error('Failed to install update:', error)
    installUpdateBtn.disabled = false
  }
})

// Listen for update status changes
window.burnBar.onUpdateStatusChanged(updateUpdateUI)

// Load version and initial update state
async function loadUpdateInfo(): Promise<void> {
  try {
    const version = await window.burnBar.getAppVersion()
    appVersion.textContent = t('settings.version', { version })

    const state = await window.burnBar.getUpdateStatus()
    updateUpdateUI(state)
  } catch (error) {
    console.error('Failed to load update info:', error)
  }
}

window.burnBar.onLanguageChanged(applyLocale)

// Initialize locale then load
async function init(): Promise<void> {
  const settings = await window.burnBar.getSettings()
  selectRefreshInterval(settings.refreshInterval.toString())
  selectTheme(settings.theme)
  selectTrayProvider(settings.trayProvider)
  enableNotifications.checked = settings.enableNotifications
  showRemaining.checked = settings.showRemaining
  launchAtLogin.checked = settings.launchAtLogin
  loginItemHint.hidden = settings.launchAtLoginStatus !== 'requires-approval'
  applyLocale(settings.language as Locale)
}

init()
