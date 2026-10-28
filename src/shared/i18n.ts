export type Locale = 'en' | 'fr'

const en: Record<string, string> = {
  // Popup
  'popup.loading': 'Loading...',
  'popup.session': 'Session (5h)',
  'popup.weekly': 'Weekly (7d)',
  'popup.opus': 'Opus (7d)',
  'popup.resetsIn': 'Resets in {time}',
  'popup.overage': 'Overage',
  'popup.noLimit': '(no limit)',
  'popup.lastUpdated': 'Updated {time}',
  'popup.settings': 'Settings',
  'popup.levelWarn': 'High',
  'popup.levelCrit': 'Critical',
  'popup.notConnected': 'Not Connected',
  'popup.notConnectedDesc': 'Log in to monitor your Claude Code quotas',
  'popup.login': 'Log In',
  'popup.cliHint': 'Or via CLI:',
  'popup.retry': 'Retry',
  'popup.refresh': 'Refresh',
  'popup.defaultUser': 'Claude User',
  'popup.throttled': 'Already up to date \u2014 retry in {seconds}s',

  // Settings
  'settings.title': 'Settings',
  'settings.language': 'Language',
  'settings.languageLabel': 'Display language',
  'settings.connection': 'Connection',
  'settings.connected': 'Connected',
  'settings.notConnected': 'Not Connected',
  'settings.noCredentials': 'No credentials found',
  'settings.logout': 'Log Out',
  'settings.loginWithClaude': 'Log In with Claude',
  'settings.authHint': 'Authenticate in your browser, then paste the code below:',
  'settings.authPlaceholder': 'Paste authorization code here',
  'settings.validate': 'Validate',
  'settings.cancel': 'Cancel',
  'settings.refreshInterval': 'Refresh Interval',
  'settings.updateEvery': 'Update quota every',
  'settings.5min': '5 minutes',
  'settings.10min': '10 minutes',
  'settings.15min': '15 minutes',
  'settings.notifications': 'Notifications',
  'settings.notificationsDesc': 'Alert when quota crosses warning (70%) or critical (90%)',
  'settings.startup': 'Startup',
  'settings.launchAtLogin': 'Launch Claude Bar at login',
  'settings.updates': 'Updates',
  'settings.checkUpdatesHint': 'Click to check for updates',
  'settings.checkUpdates': 'Check for Updates',
  'settings.installRestart': 'Install & Restart',
  'settings.downloadInstall': 'Download & Install',
  'settings.versionAvailable': 'Version {version} available',
  'settings.upToDate': 'You are up to date',
  'settings.downloading': 'Downloading\u2026 {progress}%',
  'settings.versionReady': 'Version {version} ready to install',
  'settings.updateFailed': 'Update check failed',
  'settings.downloadFailed': 'Update download failed',
  'settings.about': 'Monitor your Claude Code quotas from the menu bar',
  'settings.version': 'Claude Bar v{version}',
  'settings.error': 'Error',
  'settings.credentialsError': 'Could not check credentials',
  'settings.authMode': 'Authentication method',
  'settings.authModeApp': 'Claude Bar (OAuth)',
  'settings.authModeCli': 'Claude Code (Keychain)',
  'settings.cliHint': 'Run `claude` in a terminal to log in',
  'settings.account': 'Account',
  'settings.source': 'Source',
  'settings.cliModeHint': 'Run `claude` then `claude login` in a terminal',
  'settings.general': 'General',
  'settings.refreshShort': 'Refresh every',
  'settings.alerts': 'Alerts',
  'settings.alertsDesc': 'At 70% and 90% usage',
  'settings.openAtLogin': 'Open at login',
  'settings.checking': 'Checking\u2026',

  // Tray
  'tray.refresh': 'Refresh',
  'tray.displayMode': 'Display Mode',
  'tray.standard': 'Standard (45% / 32%)',
  'tray.detailed': 'Detailed (5h: 45% | 7d: 32%)',
  'tray.compact': 'Compact (45%)',
  'tray.timeRemaining': 'Time Remaining (4h 30m)',
  'tray.minimal': 'Minimal (icon only)',
  'tray.settings': 'Settings\u2026',
  'tray.checkUpdates': 'Check for Updates\u2026',
  'tray.quit': 'Quit Claude Bar',
  'tray.clickToView': 'Claude Bar \u2014 Click to view quotas',
  'tray.login': 'Login',
  'tray.error': 'Error',
  'tray.session': 'Session: {pct}% (resets in {resets})',
  'tray.weekly': 'Weekly: {pct}% (resets in {resets})',
  'tray.opus': 'Opus: {pct}% (resets in {resets})',
  'tray.updated': 'Updated: {time}',
  'tray.stale': 'Data may be outdated',
  'tray.detailedFmt': '5h: {five}% | 7d: {seven}%',
  'tray.detailedOpusFmt': '5h: {five}% | 7d: {seven}% | Opus: {opus}%',

  // Notifications
  'notification.prefix': 'Claude Bar \u2014 {title}',
  'notification.thresholdTitle': '{label} at {pct}%',
  'notification.critical': 'Quota almost exhausted. Consider slowing down.',
  'notification.warning': 'Quota usage is getting high.',

  // Errors
  'error.loading': 'Error loading quota',
  'error.noCredentials': 'No credentials found. Please log in.',
  'error.sessionExpired': 'Session expired. Please log in again.',
  'error.sessionExpiredSettings': 'Session expired. Please log in again from Settings.',
  'error.network': 'Unable to connect. Check your internet connection.',
  'error.timeout': 'Request timed out. Will retry automatically.',
  'error.rateLimited': 'Rate limited. Will retry automatically.',
  'error.server': 'Server error. Will retry automatically.',
  'error.unexpected': 'An unexpected error occurred.',
  'error.unexpectedResponse': 'Unexpected API response format.',
  'error.rateLimitRetrying': 'Rate limited. Retrying\u2026',
  'error.rateLimitRetryMin': 'Rate limited. Retry in {min}min.',
  'error.rateLimitRetrySec': 'Rate limited. Retry in {sec}s.',
  'error.authGuidance': 'Your session has expired or credentials are invalid.',
  'error.networkGuidance': 'Check your internet connection and try again.',
  'error.rateLimitGuidance': 'Too many requests. Will retry automatically.',
  'error.serverGuidance': 'Anthropic servers are having issues.',
  'error.authFailed': 'Authentication failed.',
  'error.invalidCodeFormat': 'Invalid code format.',
  'error.cliTokenExpired': 'Claude Code token expired. Run `claude` to refresh it.',
  'errors.unexpectedFormat': 'Unexpected response format.',

  // Auth
  'auth.noLoginInProgress': 'No login in progress. Please click "Log In" first.',
  'auth.invalidCode': 'Invalid authorization code.',
  'auth.authFailed': 'Authentication failed ({status}). Please try again.',
  'auth.incompleteToken': 'Received incomplete token data.',
  'auth.timeout': 'Request timed out. Please try again.',
  'auth.networkError': 'Network error. Please check your connection and try again.',

  // Time
  'time.now': 'Now',
  'time.daysHours': '{d}d {h}h'
}

const fr: Record<string, string> = {
  // Popup
  'popup.loading': 'Chargement\u2026',
  'popup.session': 'Session (5h)',
  'popup.weekly': 'Hebdo (7j)',
  'popup.opus': 'Opus (7j)',
  'popup.resetsIn': 'Reset dans {time}',
  'popup.overage': 'D\u00e9passement',
  'popup.noLimit': '(sans limite)',
  'popup.lastUpdated': 'Mis \u00e0 jour {time}',
  'popup.settings': 'R\u00e9glages',
  'popup.levelWarn': '\u00c9lev\u00e9',
  'popup.levelCrit': 'Critique',
  'popup.notConnected': 'Non connect\u00e9',
  'popup.notConnectedDesc': 'Connectez-vous pour suivre vos quotas Claude Code',
  'popup.login': 'Se connecter',
  'popup.cliHint': 'Ou via CLI :',
  'popup.retry': 'R\u00e9essayer',
  'popup.refresh': 'Actualiser',
  'popup.defaultUser': 'Utilisateur Claude',
  'popup.throttled': 'D\u00e9j\u00e0 \u00e0 jour \u2014 r\u00e9essayez dans {seconds}s',

  // Settings
  'settings.title': 'R\u00e9glages',
  'settings.language': 'Langue',
  'settings.languageLabel': 'Langue d\u2019affichage',
  'settings.connection': 'Connexion',
  'settings.connected': 'Connect\u00e9',
  'settings.notConnected': 'Non connect\u00e9',
  'settings.noCredentials': 'Aucun identifiant trouv\u00e9',
  'settings.logout': 'D\u00e9connexion',
  'settings.loginWithClaude': 'Se connecter avec Claude',
  'settings.authHint': 'Authentifiez-vous dans votre navigateur, puis collez le code ci-dessous\u00a0:',
  'settings.authPlaceholder': 'Collez le code d\u2019autorisation ici',
  'settings.validate': 'Valider',
  'settings.cancel': 'Annuler',
  'settings.refreshInterval': 'Fr\u00e9quence',
  'settings.updateEvery': 'Actualiser les quotas toutes les',
  'settings.5min': '5 minutes',
  'settings.10min': '10 minutes',
  'settings.15min': '15 minutes',
  'settings.notifications': 'Notifications',
  'settings.notificationsDesc': 'Alerter au franchissement de 70\u00a0% (attention) ou 90\u00a0% (critique)',
  'settings.startup': 'D\u00e9marrage',
  'settings.launchAtLogin': 'Lancer Claude Bar \u00e0 l\u2019ouverture de session',
  'settings.updates': 'Mises \u00e0 jour',
  'settings.checkUpdatesHint': 'Cliquez pour v\u00e9rifier',
  'settings.checkUpdates': 'V\u00e9rifier',
  'settings.installRestart': 'Installer et redémarrer',
  'settings.downloadInstall': 'T\u00e9l\u00e9charger et installer',
  'settings.versionAvailable': 'Version {version} disponible',
  'settings.upToDate': 'Vous \u00eates \u00e0 jour',
  'settings.downloading': 'T\u00e9l\u00e9chargement\u2026 {progress}\u00a0%',
  'settings.versionReady': 'Version {version} pr\u00eate',
  'settings.updateFailed': '\u00c9chec de la v\u00e9rification',
  'settings.downloadFailed': '\u00c9chec du t\u00e9l\u00e9chargement',
  'settings.about': 'Surveillez vos quotas Claude Code depuis la barre de menus',
  'settings.version': 'Claude Bar v{version}',
  'settings.error': 'Erreur',
  'settings.credentialsError': 'Impossible de v\u00e9rifier les identifiants',
  'settings.authMode': 'M\u00e9thode d\u2019authentification',
  'settings.authModeApp': 'Claude Bar (OAuth)',
  'settings.authModeCli': 'Claude Code (Trousseau)',
  'settings.cliHint': 'Lancez `claude` dans un terminal pour vous connecter',
  'settings.account': 'Compte',
  'settings.source': 'Source',
  'settings.cliModeHint': 'Lancez `claude` puis `claude login` dans un terminal',
  'settings.general': 'G\u00e9n\u00e9ral',
  'settings.refreshShort': 'Actualisation',
  'settings.alerts': 'Alertes',
  'settings.alertsDesc': '\u00c0 70\u00a0% et 90\u00a0% d\u2019utilisation',
  'settings.openAtLogin': 'Lancer \u00e0 l\u2019ouverture',
  'settings.checking': 'V\u00e9rification\u2026',

  // Tray
  'tray.refresh': 'Actualiser',
  'tray.displayMode': 'Mode d\u2019affichage',
  'tray.standard': 'Standard (45% / 32%)',
  'tray.detailed': 'D\u00e9taill\u00e9 (5h: 45% | 7j: 32%)',
  'tray.compact': 'Compact (45%)',
  'tray.timeRemaining': 'Temps restant (4h 30m)',
  'tray.minimal': 'Minimal (ic\u00f4ne seule)',
  'tray.settings': 'R\u00e9glages\u2026',
  'tray.checkUpdates': 'V\u00e9rifier les mises \u00e0 jour\u2026',
  'tray.quit': 'Quitter Claude Bar',
  'tray.clickToView': 'Claude Bar \u2014 Cliquer pour voir les quotas',
  'tray.login': 'Connexion',
  'tray.error': 'Erreur',
  'tray.session': 'Session : {pct}% (reset dans {resets})',
  'tray.weekly': 'Hebdo : {pct}% (reset dans {resets})',
  'tray.opus': 'Opus : {pct}% (reset dans {resets})',
  'tray.updated': 'Mis \u00e0 jour : {time}',
  'tray.stale': 'Donn\u00e9es peut-\u00eatre obsol\u00e8tes',
  'tray.detailedFmt': '5h: {five}% | 7j: {seven}%',
  'tray.detailedOpusFmt': '5h: {five}% | 7j: {seven}% | Opus: {opus}%',

  // Notifications
  'notification.prefix': 'Claude Bar \u2014 {title}',
  'notification.thresholdTitle': '{label} \u00e0 {pct}%',
  'notification.critical': 'Quota presque \u00e9puis\u00e9. Pensez \u00e0 ralentir.',
  'notification.warning': 'L\u2019utilisation du quota augmente.',

  // Errors
  'error.loading': 'Erreur de chargement',
  'error.noCredentials': 'Aucun identifiant trouv\u00e9. Veuillez vous connecter.',
  'error.sessionExpired': 'Session expir\u00e9e. Veuillez vous reconnecter.',
  'error.sessionExpiredSettings': 'Session expir\u00e9e. Reconnectez-vous depuis les R\u00e9glages.',
  'error.network': 'Connexion impossible. V\u00e9rifiez votre connexion internet.',
  'error.timeout': 'D\u00e9lai d\u00e9pass\u00e9. Nouvelle tentative automatique.',
  'error.rateLimited': 'Limite atteinte. Nouvelle tentative automatique.',
  'error.server': 'Erreur serveur. Nouvelle tentative automatique.',
  'error.unexpected': 'Une erreur inattendue est survenue.',
  'error.unexpectedResponse': 'Format de r\u00e9ponse API inattendu.',
  'error.rateLimitRetrying': 'Limite atteinte. Nouvelle tentative\u2026',
  'error.rateLimitRetryMin': 'Limite atteinte. R\u00e9essai dans {min}\u00a0min.',
  'error.rateLimitRetrySec': 'Limite atteinte. R\u00e9essai dans {sec}\u00a0s.',
  'error.authGuidance': 'Votre session a expir\u00e9 ou les identifiants sont invalides.',
  'error.networkGuidance': 'V\u00e9rifiez votre connexion internet et r\u00e9essayez.',
  'error.rateLimitGuidance': 'Trop de requ\u00eates. Nouvelle tentative automatique.',
  'error.serverGuidance': 'Les serveurs Anthropic rencontrent des probl\u00e8mes.',
  'error.authFailed': '\u00c9chec de l\u2019authentification.',
  'error.invalidCodeFormat': 'Format de code invalide.',
  'error.cliTokenExpired': 'Jeton Claude Code expir\u00e9. Lancez `claude` pour le rafra\u00eechir.',
  'errors.unexpectedFormat': 'Format de r\u00e9ponse inattendu.',

  // Auth
  'auth.noLoginInProgress': 'Aucune connexion en cours. Cliquez d\u2019abord sur \u00ab\u00a0Se connecter\u00a0\u00bb.',
  'auth.invalidCode': 'Code d\u2019autorisation invalide.',
  'auth.authFailed': '\u00c9chec de l\u2019authentification ({status}). Veuillez r\u00e9essayer.',
  'auth.incompleteToken': 'Donn\u00e9es de jeton incompl\u00e8tes.',
  'auth.timeout': 'D\u00e9lai d\u00e9pass\u00e9. Veuillez r\u00e9essayer.',
  'auth.networkError': 'Erreur r\u00e9seau. V\u00e9rifiez votre connexion et r\u00e9essayez.',

  // Time
  'time.now': 'Maintenant',
  'time.daysHours': '{d}j {h}h'
}

const translations: Record<Locale, Record<string, string>> = { en, fr }

let currentLocale: Locale = 'en'

export function setLocale(locale: Locale): void {
  currentLocale = locale
}

export function getLocale(): Locale {
  return currentLocale
}

export function t(key: string, params?: Record<string, string | number>): string {
  const str = translations[currentLocale]?.[key] ?? translations.en[key] ?? key
  if (!params) return str
  return Object.entries(params).reduce(
    (result, [k, v]) => result.replace(`{${k}}`, String(v)),
    str
  )
}

export function applyI18n(): void {
  document.documentElement.lang = currentLocale
  document.querySelectorAll('[data-i18n]').forEach((el) => {
    const key = el.getAttribute('data-i18n')!
    el.textContent = t(key)
  })
  document.querySelectorAll('[data-i18n-placeholder]').forEach((el) => {
    const key = el.getAttribute('data-i18n-placeholder')!
    ;(el as HTMLInputElement).placeholder = t(key)
  })
  document.querySelectorAll('[data-i18n-title]').forEach((el) => {
    const key = el.getAttribute('data-i18n-title')!
    el.setAttribute('title', t(key))
  })
}
