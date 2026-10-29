import Store from 'electron-store'
import { app } from 'electron'
import { rmSync } from 'fs'
import { join } from 'path'

interface PersistedQuotaPeriod {
  utilization: number
  resetsAt: string | null
}

interface PersistedQuotaData {
  fiveHour?: PersistedQuotaPeriod
  sevenDay: { utilization: number; resetsAt: string | null }
  sevenDayOpus?: PersistedQuotaPeriod
  models?: { key: string; label: string; period: PersistedQuotaPeriod }[]
  fetchedAt: number
}

interface SettingsStoreSchema {
  refreshInterval: number
  launchAtLogin: boolean
  enableNotifications: boolean
  language: 'en' | 'fr'
  rateLimitedUntil: number
  lastQuotaData: PersistedQuotaData | null
  displayMode: string
  resetNotifications: Record<string, { resetsAt: number; utilization: number }>
  notifiedLevels: Record<string, 'normal' | 'warning' | 'critical'>
  lastAccount: string | null
}

export type { PersistedQuotaData }

export const settingsStore = new Store<SettingsStoreSchema>({
  clearInvalidConfig: true,
  defaults: {
    refreshInterval: 300,
    launchAtLogin: false,
    enableNotifications: true,
    language: 'en' as const,
    rateLimitedUntil: 0,
    lastQuotaData: null,
    displayMode: 'standard',
    resetNotifications: {},
    notifiedLevels: {},
    lastAccount: null
  }
})

// Migrate: bump aggressive intervals (30s, 60s) to 300s to avoid rate limiting
const currentInterval = settingsStore.get('refreshInterval')
if (currentInterval < 120) {
  settingsStore.set('refreshInterval', 300)
}

// Migrate: in-app OAuth login was removed; drop its leftovers once
const legacyStore = settingsStore as unknown as Store<Record<string, unknown>>
if (legacyStore.has('authMode')) {
  legacyStore.delete('authMode')
  // The cached quota may belong to the in-app account rather than Claude Code's
  settingsStore.set('lastQuotaData', null)
  settingsStore.set('notifiedLevels', {})
  rmSync(join(app.getPath('userData'), 'auth-store.json'), { force: true })
}
