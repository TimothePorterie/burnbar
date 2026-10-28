import Store from 'electron-store'

interface PersistedQuotaData {
  fiveHour: { utilization: number; resetsAt: string | null }
  sevenDay: { utilization: number; resetsAt: string | null }
  sevenDayOpus?: { utilization: number; resetsAt: string | null }
  fetchedAt: number
}

interface SettingsStoreSchema {
  refreshInterval: number
  launchAtLogin: boolean
  authMode: 'app' | 'cli'
  enableNotifications: boolean
  language: 'en' | 'fr'
  rateLimitedUntil: number
  lastQuotaData: PersistedQuotaData | null
  displayMode: string
  notifiedLevels: Record<string, 'normal' | 'warning' | 'critical'>
}

export type { PersistedQuotaData }

export const settingsStore = new Store<SettingsStoreSchema>({
  clearInvalidConfig: true,
  defaults: {
    refreshInterval: 300,
    launchAtLogin: false,
    authMode: 'app' as const,
    enableNotifications: true,
    language: 'en' as const,
    rateLimitedUntil: 0,
    lastQuotaData: null,
    displayMode: 'standard',
    notifiedLevels: {}
  }
})

// Migrate: bump aggressive intervals (30s, 60s) to 300s to avoid rate limiting
const currentInterval = settingsStore.get('refreshInterval')
if (currentInterval < 120) {
  settingsStore.set('refreshInterval', 300)
}
