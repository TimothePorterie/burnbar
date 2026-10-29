// Popup renderer script
import type { Locale } from '../../shared/i18n'
import { t, setLocale, getLocale, applyI18n } from '../../shared/i18n'
import { WARNING_THRESHOLD, CRITICAL_THRESHOLD, getForecast } from '../../shared/quota'
import type { QuotaError, QuotaErrorType, QuotaInfo, QuotaPeriod } from '../../shared/types'

// DOM elements
const popup = document.getElementById('popup') as HTMLElement
const header = document.getElementById('header') as HTMLElement
const notConnected = document.getElementById('notConnected') as HTMLElement
const quotaCards = document.getElementById('quotaCards') as HTMLElement
const footer = document.getElementById('footer') as HTMLElement
const skeletonContainer = document.getElementById('skeletonContainer') as HTMLElement
const userName = document.getElementById('userName') as HTMLElement
const subscriptionBadge = document.getElementById('subscriptionBadge') as HTMLElement
const refreshBtn = document.getElementById('refreshBtn') as HTMLButtonElement

const fiveHourRow = document.getElementById('fiveHour') as HTMLElement
const sevenDayRow = document.getElementById('sevenDay') as HTMLElement
const modelQuotas = document.getElementById('modelQuotas') as HTMLElement
const modelTemplate = document.getElementById('modelQuotaTemplate') as HTMLTemplateElement
const extraUsageEl = document.getElementById('extraUsage') as HTMLElement
const extraUsageValue = document.getElementById('extraUsageValue') as HTMLElement
const lastUpdated = document.getElementById('lastUpdated') as HTMLElement

// Error elements
const errorSection = document.getElementById('errorSection') as HTMLElement
const errorMessage = document.getElementById('errorMessage') as HTMLElement
const errorGuidance = document.getElementById('errorGuidance') as HTMLElement
const errorRetryBtn = document.getElementById('errorRetryBtn') as HTMLButtonElement

const GUIDANCE: Partial<Record<QuotaErrorType, string>> = {
  auth: 'error.authGuidance',
  network: 'error.networkGuidance',
  rate_limit: 'error.rateLimitGuidance',
  server: 'error.serverGuidance'
}

const PLANS: Record<string, string> = { pro: 'Pro', max: 'Max', team: 'Team', enterprise: 'Enterprise' }

// Guidance only when no data is shown: inline, it repeats the message
function showError(error: QuotaError, withGuidance = false): void {
  const guidance = withGuidance ? GUIDANCE[error.type] : undefined
  renderCode(errorMessage, error.message)
  renderCode(errorGuidance, guidance ? t(guidance) : '')
  errorGuidance.hidden = !guidance
  errorRetryBtn.hidden = false
  errorSection.dataset.tone = error.retryable ? 'warn' : 'crit'
  errorSection.hidden = false
  reportContentHeight()
}

function hideError(): void {
  errorSection.hidden = true
  reportContentHeight()
}

function formatCredits(cents: number, currency: string): string {
  const amount = cents / 100
  if (currency.toUpperCase() === 'USD') return `$${amount.toFixed(2)}`
  return `${amount.toFixed(2)} ${currency.toUpperCase()}`
}

function renderCode(element: HTMLElement, message: string): void {
  element.replaceChildren(...message.split(/(`[^`]+`)/g).map(part => {
    if (!part.startsWith('`') || !part.endsWith('`')) return document.createTextNode(part)
    const code = document.createElement('code')
    code.textContent = part.slice(1, -1)
    return code
  }))
}

function renderPeriod(row: HTMLElement, activePeriod: QuotaPeriod | undefined, periodHours = 168): void {
  const period = activePeriod ?? { utilization: 0, resetsAt: new Date(NaN), resetsIn: '—', resetProgress: 0 }
  const value = Math.round(period.utilization)
  const level = value >= CRITICAL_THRESHOLD ? 'crit' : value >= WARNING_THRESHOLD ? 'warn' : 'ok'
  row.dataset.level = level
  row.style.setProperty('--v', `${Math.min(100, Math.max(0, value))}%`)
  row.style.setProperty('--pace', `${period.resetProgress}%`)
  row.toggleAttribute('data-nopace', period.resetProgress <= 0)
  row.querySelector('.meter')!.setAttribute('aria-valuenow', String(value))
  row.querySelector('.quota-value')!.textContent = `${value}%`

  const resetsAt = new Date(period.resetsAt)
  const hasReset = Number.isFinite(resetsAt.getTime())
  const absolute = hasReset ? resetsAt.toLocaleString(getLocale(), {
    ...(periodHours === 168 ? { weekday: 'short' as const } : {}), hour: '2-digit', minute: '2-digit'
  }) : '—'
  const reset = !activePeriod || !hasReset ? t('popup.noSession')
    : t('popup.resetDetail', { time: period.resetsIn, absolute })
  const resetEl = row.querySelector('.quota-reset')
  if (resetEl) resetEl.textContent = reset
  else row.title = reset
  const levelEl = row.querySelector('.quota-level')
  if (levelEl) levelEl.textContent = level === 'ok' ? '' : t(level === 'crit' ? 'popup.levelCrit' : 'popup.levelWarn')
  const forecast = getForecast(period.utilization, period.resetProgress, resetsAt, periodHours)
  const badge = row.querySelector('.pace-badge') as HTMLElement | null
  if (badge) {
    badge.hidden = !forecast
    badge.textContent = forecast ? t(`popup.pace.${forecast.pace}`) : ''
    badge.dataset.pace = forecast?.pace
  }
  const alert = row.querySelector('.quota-forecast') as HTMLElement | null
  if (alert) {
    alert.hidden = !forecast?.runsOutAt
    if (forecast?.runsOutAt) {
      const minutes = Math.floor((resetsAt.getTime() - forecast.runsOutAt.getTime()) / 60000)
      const duration = minutes >= 1440
        ? t('time.daysHours', { d: Math.floor(minutes / 1440), h: Math.floor(minutes / 60) % 24 })
        : minutes >= 60
          ? t('time.hoursMinutes', { h: Math.floor(minutes / 60), m: minutes % 60 })
          : t('time.minutes', { m: minutes })
      alert.textContent = t('popup.forecast', {
        time: forecast.runsOutAt.toLocaleString(getLocale(), {
          ...(periodHours === 168 ? { weekday: 'short' as const } : {}), hour: '2-digit', minute: '2-digit'
        }),
        duration
      })
    }
  }
}

function updateQuotaDisplay(quota: QuotaInfo): void {
  renderPeriod(fiveHourRow, quota.fiveHour, 5)
  renderPeriod(sevenDayRow, quota.sevenDay)

  modelQuotas.replaceChildren(...quota.models.map(model => {
    const row = modelTemplate.content.firstElementChild!.cloneNode(true) as HTMLElement
    row.querySelector('.quota-label')!.textContent = model.label
    row.querySelector('.meter')!.setAttribute('aria-label', model.label)
    renderPeriod(row, model.period)
    return row
  }))
  modelQuotas.hidden = quota.models.length === 0

  // Extra usage / overage
  const extra = quota.extraUsage
  if (extra?.isEnabled) {
    const used = formatCredits(extra.usedCredits, extra.currency)
    extraUsageValue.textContent = extra.monthlyLimit > 0
      ? `${used} / ${formatCredits(extra.monthlyLimit, extra.currency)}`
      : `${used} ${t('popup.noLimit')}`
  }
  extraUsageEl.hidden = !extra?.isEnabled

  const time = new Date(quota.lastUpdated).toLocaleTimeString(getLocale(), { hour: '2-digit', minute: '2-digit' })
  lastUpdated.textContent = t('popup.lastUpdated', { time })

  // Show error banner for real errors, not for rate limits (cached data is still valid)
  if (quota.error && quota.error.type !== 'rate_limit') {
    showError(quota.error)
  } else {
    hideError()
  }
}

function setView(view: 'loading' | 'data' | 'error' | 'signedOut'): void {
  popup.setAttribute('aria-busy', String(view === 'loading'))
  header.hidden = view === 'signedOut'
  skeletonContainer.hidden = view !== 'loading'
  quotaCards.hidden = view !== 'data'
  footer.hidden = view !== 'data'
  notConnected.hidden = view !== 'signedOut'
  if (view === 'signedOut') errorSection.hidden = true
  reportContentHeight()
}

function showQuota(quota: QuotaInfo): void {
  setView('data')
  updateQuotaDisplay(quota)
}

function showFetchErrorState(error: QuotaError): void {
  if (error.type === 'auth') {
    setView('signedOut')
    return
  }
  setView('error')
  showError(error, true)
}

async function loadUserInfo(): Promise<void> {
  try {
    const userInfo = await window.claudeBar.getUserInfo()
    userName.textContent = userInfo?.name || userInfo?.email || t('popup.defaultUser')
    const plan = PLANS[(userInfo?.subscriptionType ?? '').toLowerCase().replace(/^claude_/, '')]
    subscriptionBadge.textContent = plan ?? ''
    subscriptionBadge.hidden = !plan
  } catch (error) {
    console.error('Failed to load user info:', error)
  }
}

async function loadQuota(): Promise<void> {
  try {
    // Check cache first — show data immediately if available (avoids skeleton flash)
    const cachedQuota = await window.claudeBar.getQuota()
    if (cachedQuota) {
      await loadUserInfo()
      showQuota(cachedQuota)
      return
    }

    setView('loading')

    const hasCredentials = await window.claudeBar.hasCredentials()

    if (!hasCredentials) {
      setView('signedOut')
      return
    }

    await loadUserInfo()

    const lastError = await window.claudeBar.getLastError()
    if (lastError) showFetchErrorState(lastError)
  } catch (error) {
    console.error('Failed to load quota:', error)
    showFetchErrorState({ type: 'unknown', message: t('error.loading'), retryable: true })
  }
}

const toast = document.getElementById('toast') as HTMLElement
let toastTimer: ReturnType<typeof setTimeout> | null = null

// Overlay: does not change the window height
function showToast(message: string): void {
  if (toastTimer) clearTimeout(toastTimer)
  toast.textContent = message
  toast.classList.add('show')
  toastTimer = setTimeout(() => toast.classList.remove('show'), 2000)
}

async function refreshQuota(): Promise<void> {
  refreshBtn.classList.add('loading')
  refreshBtn.disabled = true

  try {
    // First, show refreshed cached data (with recalculated times)
    const cached = await window.claudeBar.getQuota()
    if (cached) showQuota(cached)

    // Then attempt an API refresh (may return cache if min interval not elapsed)
    const result = await window.claudeBar.refreshQuota()
    if (result.throttled) {
      showToast(t('popup.throttled', { seconds: result.retryIn }))
    } else if (result.quota) {
      await loadUserInfo()
      showQuota(result.quota)
    } else {
      const error = await window.claudeBar.getLastError()
      if (error) showFetchErrorState(error)
    }
  } catch (error) {
    console.error('Failed to refresh quota:', error)
  } finally {
    // Brief spin then stop — gives visible feedback even on instant cache return
    setTimeout(() => {
      refreshBtn.classList.remove('loading')
      refreshBtn.disabled = false
    }, 400)
  }
}

// Event listeners
refreshBtn.addEventListener('click', refreshQuota)
errorRetryBtn.addEventListener('click', refreshQuota)

const openSettings = (): void => void window.claudeBar.openSettings()
document.getElementById('signedOutRetryBtn')!.addEventListener('click', refreshQuota)
document.getElementById('signedOutSettingsLink')!.addEventListener('click', openSettings)
document.getElementById('quitBtn')!.addEventListener('click', () => void window.claudeBar.quitApp())
document.getElementById('settingsLink')!.addEventListener('click', openSettings)

// Listen for quota updates from main process
// Claude Code may have switched account since the popup was built
window.claudeBar.onQuotaUpdated(async (quota) => {
  await loadUserInfo()
  showQuota(quota)
})

// Listen for quota errors from main process
window.claudeBar.onQuotaError(showFetchErrorState)

// Report content height to resize window
function reportContentHeight(): void {
  requestAnimationFrame(() => {
    window.claudeBar.reportContentHeight(popup.scrollHeight)
  })
}

// Initialize locale then load
async function init(): Promise<void> {
  const settings = await window.claudeBar.getSettings()
  setLocale(settings.language as Locale)
  applyI18n()
  renderCode(document.getElementById('notConnectedDesc')!, t('popup.notConnectedDesc'))
  await loadQuota()
}

init()
