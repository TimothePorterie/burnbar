// Popup renderer script
import type { Locale } from '../../shared/i18n'
import { t, setLocale, getLocale, applyI18n } from '../../shared/i18n'
import { WARNING_THRESHOLD, CRITICAL_THRESHOLD, formatDuration, formatRetry, formatUpdated, getForecast } from '../../shared/quota'
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
const statusBanner = document.getElementById('statusBanner') as HTMLElement
const statusMessage = document.getElementById('statusMessage') as HTMLElement
let statusUrl = 'https://status.claude.com/'
let showRemaining = false

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
  network: 'error.networkGuidance',
  server: 'error.serverGuidance'
}

const PLANS: Record<string, string> = { pro: 'Pro', max: 'Max', team: 'Team', enterprise: 'Enterprise' }

// Guidance only when no data is shown: inline, it repeats the message
function showError(error: QuotaError, withGuidance = false): void {
  const guidanceKey = withGuidance ? GUIDANCE[error.type] : undefined
  const guidance = [guidanceKey ? t(guidanceKey) : '', formatRetry(error.retryAt)].filter(Boolean).join(' ')
  renderCode(errorMessage, error.message)
  renderCode(errorGuidance, guidance)
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
  row.querySelector('.quota-value')!.textContent = showRemaining
    ? activePeriod ? t('popup.remaining', { pct: Math.round(100 - period.utilization) }) : '—'
    : `${value}%`

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
      const duration = formatDuration(resetsAt.getTime() - forecast.runsOutAt.getTime())
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
  const status = quota.status
  statusBanner.hidden = !status || status.indicator === 'none'
  statusBanner.dataset.tone = status?.indicator === 'minor' ? 'warn' : 'crit'
  statusMessage.textContent = status ? t('status.incident', { name: status.incident?.name ?? t('status.disruption') }) : ''
  statusUrl = status?.incident?.url ?? 'https://status.claude.com/'
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

  // Relative age, flagged when the data is stale or the last refresh failed; exact time on hover
  lastUpdated.textContent = formatUpdated(quota.lastUpdated)
  lastUpdated.title = new Date(quota.lastUpdated).toLocaleString(getLocale())
  lastUpdated.toggleAttribute('data-warn', !!quota.stale || !!quota.error)

  // Cached data stays on screen: the alert says why it is not fresh and when the next try is
  if (quota.error) {
    showError(quota.error)
  } else {
    hideError()
  }
}

function setView(view: 'loading' | 'data' | 'error' | 'signedOut'): void {
  if (view !== 'data') statusBanner.hidden = true
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

function showSignedOut(message = t('popup.notConnectedDesc')): void {
  renderCode(document.getElementById('notConnectedDesc')!, message)
  setView('signedOut')
}

function showFetchErrorState(error: QuotaError): void {
  if (error.type === 'auth') {
    showSignedOut(error.message)
    return
  }
  setView('error')
  showError(error, true)
  // The Keychain is readable unless that is the error itself: name the account in the header
  if (error.type !== 'keychain') void loadUserInfo()
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
      showSignedOut()
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
    // May return the cache when the minimum interval has not elapsed
    const result = await window.claudeBar.refreshQuota()
    if (result.quota) {
      await loadUserInfo()
      showQuota(result.quota)
      // A throttled refresh during an error is explained by the alert, not "up to date"
      if (result.throttled && !result.quota.error) showToast(t('popup.throttled', { seconds: result.retryIn }))
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
document.getElementById('statusDetails')!.addEventListener('click', () => void window.claudeBar.openStatusPage(statusUrl))
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
  showRemaining = settings.showRemaining
  setLocale(settings.language as Locale)
  applyI18n()
  await loadQuota()
}

init()
