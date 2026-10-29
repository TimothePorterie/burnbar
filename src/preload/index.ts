import { contextBridge, ipcRenderer } from 'electron'
import type { QuotaInfo, QuotaError } from '../shared/types'
export type { QuotaErrorType, QuotaError, QuotaPeriod, ExtraUsageInfo, QuotaInfo } from '../shared/types'

export interface Settings {
  refreshInterval: number
  launchAtLogin: boolean
  launchAtLoginStatus?: 'not-registered' | 'enabled' | 'requires-approval' | 'not-found'
  enableNotifications: boolean
  language: 'en' | 'fr'
  theme: 'system' | 'light' | 'dark'
}

export interface UserInfo {
  email?: string
  name?: string
  subscriptionType?: string
}

const api = {
  // Quota operations
  getQuota: (): Promise<QuotaInfo | null> => ipcRenderer.invoke('get-quota'),
  refreshQuota: (): Promise<{ quota: QuotaInfo | null; throttled: boolean; retryIn: number }> =>
    ipcRenderer.invoke('refresh-quota'),
  onQuotaUpdated: (callback: (quota: QuotaInfo) => void): (() => void) => {
    const handler = (_event: Electron.IpcRendererEvent, quota: QuotaInfo): void => callback(quota)
    ipcRenderer.on('quota-updated', handler)
    return () => ipcRenderer.removeListener('quota-updated', handler)
  },

  // Credentials
  hasCredentials: (): Promise<boolean> => ipcRenderer.invoke('has-credentials'),
  getUserInfo: (): Promise<UserInfo | null> => ipcRenderer.invoke('get-user-info'),

  // Errors
  getLastError: (): Promise<QuotaError | null> => ipcRenderer.invoke('get-last-error'),
  onQuotaError: (callback: (error: QuotaError) => void): (() => void) => {
    const handler = (_event: Electron.IpcRendererEvent, error: QuotaError): void => callback(error)
    ipcRenderer.on('quota-error', handler)
    return () => ipcRenderer.removeListener('quota-error', handler)
  },

  // Settings
  getSettings: (): Promise<Settings> => ipcRenderer.invoke('get-settings'),
  setRefreshInterval: (seconds: number): Promise<boolean> =>
    ipcRenderer.invoke('set-refresh-interval', seconds),
  setLaunchAtLogin: (enabled: boolean): Promise<boolean> =>
    ipcRenderer.invoke('set-launch-at-login', enabled),
  openLoginItemsSettings: (): Promise<boolean> => ipcRenderer.invoke('open-login-items-settings'),
  setEnableNotifications: (enabled: boolean): Promise<boolean> =>
    ipcRenderer.invoke('set-enable-notifications', enabled),
  setTheme: (theme: 'system' | 'light' | 'dark'): Promise<boolean> =>
    ipcRenderer.invoke('set-theme', theme),
  setLanguage: (lang: string): Promise<boolean> =>
    ipcRenderer.invoke('set-language', lang),
  onLanguageChanged: (callback: (lang: 'en' | 'fr') => void): (() => void) => {
    const handler = (_event: Electron.IpcRendererEvent, lang: 'en' | 'fr'): void => callback(lang)
    ipcRenderer.on('language-changed', handler)
    return () => ipcRenderer.removeListener('language-changed', handler)
  },

  // Updates
  checkForUpdates: (): Promise<boolean> => ipcRenderer.invoke('check-for-updates'),
  downloadUpdate: (): Promise<boolean> => ipcRenderer.invoke('download-update'),
  installUpdate: (): Promise<boolean> => ipcRenderer.invoke('install-update'),
  getUpdateStatus: (): Promise<{ status: string; version?: string; progress?: number; error?: string }> =>
    ipcRenderer.invoke('get-update-status'),
  getAppVersion: (): Promise<string> => ipcRenderer.invoke('get-app-version'),
  onUpdateStatusChanged: (callback: (state: { status: string; version?: string; progress?: number; error?: string }) => void): (() => void) => {
    const handler = (_event: Electron.IpcRendererEvent, state: { status: string; version?: string; progress?: number; error?: string }): void => callback(state)
    ipcRenderer.on('update-status-changed', handler)
    return () => ipcRenderer.removeListener('update-status-changed', handler)
  },

  // Navigation
  openSettings: (): Promise<boolean> => ipcRenderer.invoke('open-settings'),

  // Window
  reportContentHeight: (height: number): void => {
    ipcRenderer.send('popup-content-height', height)
  },

  quitApp: (): Promise<void> => ipcRenderer.invoke('quit-app')
}

contextBridge.exposeInMainWorld('claudeBar', api)

declare global {
  interface Window {
    claudeBar: typeof api
  }
}
