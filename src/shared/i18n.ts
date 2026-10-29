export type Locale = 'en' | 'fr'

const en: Record<string, string> = {
  'settings.showRemaining': 'Show remaining',
  'settings.showRemainingDesc': '58% left instead of 42% used',
  'tray.showRemaining': 'Show Remaining',
  'popup.remaining': '{pct}% left',
  'tray.sessionRemaining': 'Session: {pct}% left (resets in {resets})',
  'tray.weeklyRemaining': 'Weekly: {pct}% left (resets in {resets})',
  'tray.modelRemaining': '{label}: {pct}% left (resets in {resets})',
  'tray.anthropicStatus': 'Anthropic: {name}',
  'status.incident': 'Anthropic incident: {name}',
  'status.disruption': 'Service disruption',
  'status.details': 'Details',
  'popup.noSession': 'No active session',
  'popup.resetDetail': 'Reset in {time} · {absolute}',
  'popup.forecast': 'Runs out around {time}, {duration} before reset',
  'time.hoursMinutes': '{h}h {m}m',
  'time.minutes': '{m}m',
  'popup.pace.hot': 'High pace',
  'popup.pace.on-track': 'On track',
  'popup.pace.spare': 'Comfortable headroom',
  'popup.quit': 'Quit',
  'popup.refreshShortcut': 'Refresh (⌘R)',
  'popup.settingsShortcut': 'Settings (⌘,)',
  'popup.quitShortcut': 'Quit (⌘Q)',
  'notification.fiveHourReset': 'Session quota reset',
  'notification.sevenDayReset': 'Weekly quota reset',
  'notification.resetBody': 'You can resume.',
  'notification.extraStarted': 'Extra usage started',
  'notification.extraBody': '{amount} billed beyond your plan',
  'notification.extraThreshold': 'Extra usage at {pct}% of your {limit} limit',
  'tray.model': '{label}: {pct}% (resets in {resets})',
  // Popup
  'popup.session': 'Session (5h)',
  'popup.weekly': 'Weekly (7d)',
  'popup.overage': 'Overage',
  'popup.noLimit': '(no limit)',
  'popup.settings': 'Settings',
  'popup.levelWarn': 'High',
  'popup.levelCrit': 'Critical',
  'popup.notConnected': 'Claude Code is not connected',
  'popup.notConnectedDesc': 'Run `claude` in a terminal and sign in. Claude Bar reads your session in read-only mode.',
  'popup.retry': 'Retry',
  'popup.defaultUser': 'Claude User',
  'popup.throttled': 'Already up to date \u2014 retry in {seconds}s',

  // Settings
  'settings.title': 'Settings',
  'settings.language': 'Language',
  'settings.theme': 'Appearance',
  'settings.themeSystem': 'Auto',
  'settings.themeLight': 'Light',
  'settings.themeDark': 'Dark',
  'settings.languageLabel': 'Display language',
  'settings.connection': 'Connection',
  'settings.connected': 'Connected',
  'settings.notConnected': 'Not Connected',
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
  'settings.account': 'Account',
  'settings.accountHint': 'Claude Bar reads Claude Code\u2019s session read-only. To log in or switch accounts, run `claude` in a terminal.',
  'settings.refreshAccount': 'Refresh',
  'settings.loginItemApproval': 'Allow Claude Bar in System Settings > General > Login Items',
  'settings.openSystemSettings': 'Open Settings',
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
  'tray.minimal': 'Icon only',
  'tray.settings': 'Settings\u2026',
  'tray.checkUpdates': 'Check for Updates\u2026',
  'tray.quit': 'Quit Claude Bar',
  'tray.clickToView': 'Claude Bar \u2014 Click to view quotas',
  'tray.session': 'Session: {pct}% (resets in {resets})',
  'tray.weekly': 'Weekly: {pct}% (resets in {resets})',
  'tray.stale': 'Data may be outdated',
  'tray.detailedFmt': '5h: {five} | 7d: {seven}%',

  // Notifications
  'notification.thresholdTitle': '{label} at {pct}%',
  'notification.critical': 'Quota almost exhausted. Consider slowing down.',
  'notification.warning': 'Quota usage is getting high.',

  // Errors
  'error.loading': 'Couldn\u2019t load quotas. Click Retry.',
  'error.noCredentials': 'No Claude Code session found. Run `claude` to log in.',
  'error.network': 'Offline, or Anthropic can\u2019t be reached.',
  'error.timeout': 'Anthropic didn\u2019t respond in time.',
  'error.rateLimited': 'Anthropic rate limit reached.',
  'error.server': 'Anthropic server error.',
  'error.unexpected': 'Unexpected error while loading quotas.',
  'error.unexpectedResponse': 'Anthropic sent an unexpected response. Update Claude Bar if this persists.',
  'error.networkGuidance': 'Check your Wi-Fi or VPN.',
  'error.serverGuidance': 'Check status.claude.com if this persists.',
  'error.cliTokenExpired': 'Claude Code token expired. Run `claude` to refresh it.',
  'error.credentialsInvalid': 'Claude Code\u2019s saved session can\u2019t be read. Run `claude` to sign in again.',
  'error.keychainDenied': 'Keychain access was denied. Click Retry and choose Always Allow.',
  'error.keychainFailed': 'Couldn\u2019t read the Keychain. Unlock it or allow Claude Bar when macOS asks, then click Retry.',
  'error.forbidden': 'Anthropic refused this session. Run `claude` to sign in again.',
  'error.nextTry': 'Next try in {time}.',
  'error.retryingSoon': 'Next try in under a minute.',

  // Time
  'time.updatedJustNow': 'Updated just now',
  'time.updatedAgo': 'Updated {age} ago',
  'time.now': 'Now',
  'time.daysHours': '{d}d {h}h'
}

const fr: Record<string, string> = {
  'settings.showRemaining': 'Afficher le restant',
  'settings.showRemainingDesc': '58 % restant au lieu de 42 % utilisé',
  'tray.showRemaining': 'Afficher le restant',
  'popup.remaining': '{pct} % restant',
  'tray.sessionRemaining': 'Session : {pct} % restant (reset dans {resets})',
  'tray.weeklyRemaining': 'Hebdo : {pct} % restant (reset dans {resets})',
  'tray.modelRemaining': '{label} : {pct} % restant (reset dans {resets})',
  'tray.anthropicStatus': 'Anthropic : {name}',
  'status.incident': 'Incident Anthropic : {name}',
  'status.disruption': 'Perturbation du service',
  'status.details': 'Détails',
  'popup.noSession': 'Pas de session en cours',
  'popup.resetDetail': 'Reset dans {time} · {absolute}',
  'popup.forecast': 'Épuisé vers {time}, {duration} avant le reset',
  'time.hoursMinutes': '{h}h {m}m',
  'time.minutes': '{m}m',
  'popup.pace.hot': 'Rythme élevé',
  'popup.pace.on-track': 'Dans le rythme',
  'popup.pace.spare': 'Marge confortable',
  'popup.quit': 'Quitter',
  'popup.refreshShortcut': 'Actualiser (⌘R)',
  'popup.settingsShortcut': 'Réglages (⌘,)',
  'popup.quitShortcut': 'Quitter (⌘Q)',
  'notification.fiveHourReset': 'Quota de session réinitialisé',
  'notification.sevenDayReset': 'Quota hebdomadaire réinitialisé',
  'notification.resetBody': 'Tu peux reprendre.',
  'notification.extraStarted': 'Usage hors forfait démarré',
  'notification.extraBody': '{amount} facturés au-delà de votre forfait',
  'notification.extraThreshold': 'Usage hors forfait à {pct}% de votre limite de {limit}',
  'tray.model': '{label} : {pct}% (reset dans {resets})',
  // Popup
  'popup.session': 'Session (5h)',
  'popup.weekly': 'Hebdo (7j)',
  'popup.overage': 'D\u00e9passement',
  'popup.noLimit': '(sans limite)',
  'popup.settings': 'R\u00e9glages',
  'popup.levelWarn': '\u00c9lev\u00e9',
  'popup.levelCrit': 'Critique',
  'popup.notConnected': 'Claude Code non connecté',
  'popup.notConnectedDesc': 'Lance `claude` dans un terminal et connecte-toi. Claude Bar lit ta session en lecture seule.',
  'popup.retry': 'R\u00e9essayer',
  'popup.defaultUser': 'Utilisateur Claude',
  'popup.throttled': 'D\u00e9j\u00e0 \u00e0 jour \u2014 r\u00e9essayez dans {seconds}s',

  // Settings
  'settings.title': 'R\u00e9glages',
  'settings.language': 'Langue',
  'settings.theme': 'Apparence',
  'settings.themeSystem': 'Auto',
  'settings.themeLight': 'Clair',
  'settings.themeDark': 'Sombre',
  'settings.languageLabel': 'Langue d\u2019affichage',
  'settings.connection': 'Connexion',
  'settings.connected': 'Connect\u00e9',
  'settings.notConnected': 'Non connect\u00e9',
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
  'settings.account': 'Compte',
  'settings.accountHint': 'Claude Bar lit la session de Claude Code en lecture seule. Pour vous connecter ou changer de compte, lancez `claude` dans un terminal.',
  'settings.refreshAccount': 'Actualiser',
  'settings.loginItemApproval': 'Autorisez Claude Bar dans R\u00e9glages Syst\u00e8me > G\u00e9n\u00e9ral > Ouverture',
  'settings.openSystemSettings': 'Ouvrir les R\u00e9glages',
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
  'tray.minimal': 'Ic\u00f4ne seule',
  'tray.settings': 'R\u00e9glages\u2026',
  'tray.checkUpdates': 'V\u00e9rifier les mises \u00e0 jour\u2026',
  'tray.quit': 'Quitter Claude Bar',
  'tray.clickToView': 'Claude Bar \u2014 Cliquer pour voir les quotas',
  'tray.session': 'Session : {pct}% (reset dans {resets})',
  'tray.weekly': 'Hebdo : {pct}% (reset dans {resets})',
  'tray.stale': 'Donn\u00e9es peut-\u00eatre obsol\u00e8tes',
  'tray.detailedFmt': '5h: {five} | 7j: {seven}%',

  // Notifications
  'notification.thresholdTitle': '{label} \u00e0 {pct}%',
  'notification.critical': 'Quota presque \u00e9puis\u00e9. Pensez \u00e0 ralentir.',
  'notification.warning': 'L\u2019utilisation du quota augmente.',

  // Errors
  'error.loading': 'Impossible de charger les quotas. Cliquez sur R\u00e9essayer.',
  'error.noCredentials': 'Aucune session Claude Code trouv\u00e9e. Lancez `claude` pour vous connecter.',
  'error.network': 'Hors ligne, ou Anthropic injoignable.',
  'error.timeout': 'Anthropic n\u2019a pas r\u00e9pondu \u00e0 temps.',
  'error.rateLimited': 'Limite de requ\u00eates Anthropic atteinte.',
  'error.server': 'Erreur des serveurs Anthropic.',
  'error.unexpected': 'Erreur inattendue au chargement des quotas.',
  'error.unexpectedResponse': 'R\u00e9ponse inattendue d\u2019Anthropic. Mettez \u00e0 jour Claude Bar si cela persiste.',
  'error.networkGuidance': 'V\u00e9rifiez le Wi-Fi ou le VPN.',
  'error.serverGuidance': 'Consultez status.claude.com si cela persiste.',
  'error.cliTokenExpired': 'Jeton Claude Code expir\u00e9. Lancez `claude` pour le rafra\u00eechir.',
  'error.credentialsInvalid': 'La session enregistr\u00e9e de Claude Code est illisible. Lancez `claude` pour vous reconnecter.',
  'error.keychainDenied': 'Acc\u00e8s au trousseau refus\u00e9. Cliquez sur R\u00e9essayer puis choisissez Toujours autoriser.',
  'error.keychainFailed': 'Lecture du trousseau impossible. D\u00e9verrouillez-le ou autorisez Claude Bar quand macOS le demande, puis cliquez sur R\u00e9essayer.',
  'error.forbidden': 'Anthropic refuse cette session. Lancez `claude` pour vous reconnecter.',
  'error.nextTry': 'Nouvel essai dans {time}.',
  'error.retryingSoon': 'Nouvel essai dans moins d\u2019une minute.',

  // Time
  'time.updatedJustNow': 'Mis \u00e0 jour \u00e0 l\u2019instant',
  'time.updatedAgo': 'Mis \u00e0 jour il y a {age}',
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
