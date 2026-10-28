# Claude Bar - Technical Documentation

Canonical project instructions for agents and developers. `CLAUDE.md` only points here.

## Consignes pour les agents

- Travail sur un VPS Linux partagé. L'app Electron ne se lance pas ici : les tests manuels (menu bar, vibrancy, Keychain, notarisation) se font sur Mac.
- Toute commande lourde (`npm ci` / `npm install`, `tsc` sur tout le projet, `vitest run` / `npm test`, `npm run build`, Playwright ou navigateur headless) passe par le verrou commun : `flock -o /tmp/fw-design-lourd.lock nice -n 19 <commande>`. Un test ciblé sur un seul fichier n'en a pas besoin.
- Le mode CLI est strictement en lecture seule du Keychain (`Claude Code-credentials`). Ne jamais rafraîchir ni écrire cet item : ça invalide le refresh token de Claude Code.

## Project Overview

**Claude Bar** is a macOS menu bar application built with Electron that monitors Claude Code quotas in real time. It shows the session (5-hour) and weekly (7-day) quotas, plus an optional Opus weekly quota and extra-usage overage when the API sends them.

- **Platform**: macOS 13.0+ (`minimumSystemVersion` in `electron-builder.json`). Electron 44+ requires macOS 13.
- **Framework**: Electron 45 (`electron` ^45.1.0) + electron-vite 5
- **Language**: TypeScript 5.3
- **License**: MIT
- **Version**: see `package.json` (currently 1.7.2)

## Architecture

```
Main Process (Electron)
├── index.ts              # App entry, single instance lock, wake-from-sleep restart
├── tray.ts               # Menu bar icon, title, tooltip, context menu, display modes
├── windows.ts            # Popup/settings windows, toggle + auto-hide, security hooks
├── ipc-handlers.ts       # IPC with the renderer
└── services/
    ├── auth.ts           # In-app OAuth (PKCE), encrypted token storage, refresh
    ├── keychain.ts       # READ-ONLY read of Claude Code's Keychain item
    ├── token-utils.ts    # Token redaction for logs
    ├── quota-api.ts      # Usage API, auth routing, cache, throttling
    ├── quota-errors.ts   # HTTP / network error classification
    ├── settings-store.ts # Shared electron-store singleton
    ├── scheduler.ts      # Auto-refresh timer with error backoff
    ├── notifications.ts  # Threshold notifications
    ├── updater.ts        # electron-updater + GitHub Releases
    └── logger.ts         # electron-log

Shared
├── types.ts              # QuotaInfo / QuotaError (main <-> renderer)
├── quota.ts              # WARNING_THRESHOLD 70, CRITICAL_THRESHOLD 90, getQuotaLevel()
└── i18n.ts               # en/fr strings, t(), applyI18n()

Preload
└── index.ts              # contextBridge (`window.claudeBar`)

Renderer
├── shared/tokens.css     # Light/dark design tokens
├── popup/                # Quota window (index.html, renderer.ts, styles.css)
└── settings/             # Settings window (index.html, renderer.ts, styles.css)

Tests
└── tests/                # Vitest: real modules, mocked electron / Keychain / store
    ├── auth.test.ts
    ├── notifications.test.ts
    ├── quota-api.test.ts
    ├── quota-errors.test.ts
    ├── quota-level.test.ts
    └── token-utils.test.ts
```

## Key Files

| File | Purpose |
|------|---------|
| `src/main/index.ts` | Lifecycle, single instance lock, dock hiding, startup delays, sleep resume |
| `src/main/tray.ts` | Icon, title, tooltip, context menu, display modes |
| `src/main/windows.ts` | Popup and settings, auto-fit height, toggle, auto-hide, CSP, navigation guard |
| `src/main/services/auth.ts` | In-app OAuth (PKCE), `safeStorage`, refresh |
| `src/main/services/keychain.ts` | Reads `Claude Code-credentials` (never refreshes or writes) |
| `src/main/services/quota-api.ts` | API, `authMode` routing, cache, `resetForAccountChange`, stale flag |
| `src/main/services/notifications.ts` | One notification per upward level crossing, persisted in `notifiedLevels` |
| `src/main/services/settings-store.ts` | Shared electron-store singleton |
| `src/main/services/scheduler.ts` | Interval refresh, rate-limit cooldown, exponential backoff |
| `src/main/services/updater.ts` | Update check, download, install & restart, 6 h re-check |
| `src/main/services/logger.ts` | File logging |
| `src/preload/index.ts` | `window.claudeBar` |
| `src/renderer/shared/tokens.css` | Shared light/dark tokens |
| `src/shared/quota.ts` | Hardcoded 70% / 90% thresholds |

## Implemented Features

### Core
- In-app OAuth login (PKCE, S256). No CLI required.
- `authMode` (`app` | `cli`) routes quota fetch, credential status, and user info. No fallback between sources.
- English / French UI.
- Session (5 h) and weekly (7 d) quotas. Optional `seven_day_opus` (Max) and `extra_usage` overage when present.
- Menu bar icon: template image under 70%, `icon-warning.png` from 70%, `icon-critical.png` from 90%. The level is the max of the periods present.
- Auto-refresh: 5, 10, or 15 min (`300` / `600` / `900` seconds). Default 300. Any other stored value is rewritten to 300 (values under 120 s as soon as the store loads, the rest when settings load).
- Launch at login.
- Refresh button spins while a refresh runs (at least 400 ms). A toast overlays the popup for 2 s only when the refresh was throttled. It does not change the window height.
- Popup height follows content (`popup-content-height`).

### Display Modes (right-click menu)
Persisted in `displayMode`.
- **Standard**: `45% / 32%`
- **Detailed**: `5h: 45% | 7d: 32%`, or with Opus `5h: 45% | 7d: 32% | Opus: 10%`
- **Compact**: `45%` (session)
- **Time Remaining**: session `resetsIn` (title refreshes every minute in this mode only)
- **Minimal**: icon only

`five_hour.resets_at` null (no active session window) is shown as `—`.

### Gauge
One meter per quota. The fill is utilization. A 2 px tick (`.meter-pace`) marks elapsed time in the period (`resetProgress`). The tick is hidden when progress is 0. There is no second bar under the card.

Next to the reset time, warning shows **High** and critical shows **Critical** (no label under 70%). Color uses `--ok` / `--warn` / `--crit`, not the action orange.

### Design (« Terre sur verre »)
Tokens live in `src/renderer/shared/tokens.css` (light, and dark via `prefers-color-scheme`). Surfaces are translucent; the windows use native vibrancy (`popover` on the popup, `window` on settings).

`--accent` is `#D97757`. Primary buttons, the selected segment, the on switch, the update bar, and links use `--accent-strong` (derived). The plan badge border uses `--accent`. Quota meters do not.

Settings is grouped like System Settings: **Account**, **General**, **Updates**. Source is a segmented control **App | CLI**. Refresh is a segmented control **5 min | 10 min | 15 min**. Alerts and launch-at-login are switches. Language is a select.

Accessibility: meters and the update bar are `role="progressbar"` with `aria-valuenow`; `:focus-visible` uses the accent focus ring; `prefers-reduced-motion: reduce` disables animations and transitions. Segmented controls are `radiogroup` / `radio`. Switches are `role="switch"`.

### Token Management
- In-app tokens: encrypted with `safeStorage`, stored in electron-store `auth-store`. Refreshed automatically when expired.
- CLI: read-only Keychain. An expired CLI token is an auth error asking the user to run `claude`. On 401 the Keychain is re-read in case Claude Code rotated the token. No refresh endpoint is called in CLI mode.
- Logout is hidden in CLI mode.
- Login success (app mode), logout (app mode), and an `authMode` change call `resetForAccountChange()` then force a refresh. That drops the in-memory cache, `lastQuotaData`, `notifiedLevels`, and the last error, and bumps a generation counter so a response still in flight is discarded.

### Error Handling
- One retry on 401 (in-app: token refresh; CLI: Keychain re-read).
- 429: cooldown from `retry-after`, floor 2 min, cap 1 h, persisted in `rateLimitedUntil`. No token rotation.
- Proactive pause when `anthropic-ratelimit-requests-remaining` is 0, until the reset header (+ 5 s).
- `getCachedQuota()` attaches the last error. An error other than `rate_limit`, or stale data, prefixes the menu bar title with `⚠` and switches the icon to warning. The tooltip adds the error message and, when `stale` is set, the stale line. The popup alert is only for that error, not for stale data alone.
- `QuotaInfo.stale` is true when `lastUpdated` is older than twice `refreshInterval`.
- A period whose `resetsAt` is already past is shown at 0% until the next fetch (`buildPeriod`).
- Scheduler: exponential backoff on retryable errors, multiplier capped at 8× the interval. `stop()` (including wake-from-sleep) clears retry timers and the error count.
- Throttle: scheduled fetches need ~5 min since the last success (290 s). Manual refresh floor is 15 s.
- Error types: `network`, `auth`, `rate_limit`, `server`, `unknown`.

### Auto-Updates
- Packaged builds only. `autoDownload` is false.
- Check 5 s after startup, then every 6 hours. A check is skipped while status is `downloading` or `downloaded`.
- Manual check from Settings or the tray menu.
- Download progress in Settings. **Install & Restart** calls `quitAndInstall`.
- GitHub Releases (signed DMG + ZIP).

### Tooltips
- Session and weekly percentages, and Opus when present, each with time until reset.
- Last updated time.
- Last error message (except `rate_limit`) and `tray.stale` when `stale` is set.

## Not Yet Implemented

- History service (`history.ts`): no usage history, charts, or statistics.
- Trend arrows.
- Adaptive refresh.
- Pause mode.
- Time-to-critical estimate.
- Configurable thresholds (70 / 90 are constants in `src/shared/quota.ts`; the popup repeats `70` and `90` in `renderPeriod`).

## Data Flow

1. Startup loads settings, initializes the logger and auth, hides the dock icon.
2. `QuotaService` uses `AuthService` or `KeychainService` from `authMode`.
3. The usage API call applies the rate-limit rules above.
4. Tray title, tooltip, and icon update. The popup receives `quota-updated` or, when there is an error and no quota, `quota-error`.
5. The popup reports its height and the window resizes.
6. The scheduler repeats at `refreshInterval`.

Startup waits 2 s before the first scheduler start, and 5 s before the first update check. On `powerMonitor` `resume`, the scheduler is stopped and started again after 2 s (`start(true)`).

## API Integration

```typescript
// Quota
GET https://api.anthropic.com/api/oauth/usage
Authorization: Bearer {accessToken}
anthropic-beta: oauth-2025-04-20

// In-app authorize (PKCE)
GET https://claude.ai/oauth/authorize
// code_challenge_method=S256, redirect_uri=https://console.anthropic.com/oauth/code/callback

// In-app token exchange and refresh
POST https://console.anthropic.com/v1/oauth/token
Content-Type: application/x-www-form-urlencoded
// grant_type=authorization_code | refresh_token, client_id of this app
```

CLI mode never calls a token endpoint. Claude Code owns refresh.

## Keychain Structure

Item name: `Claude Code-credentials` (read with `security find-generic-password`).

```json
{
  "claudeAiOauth": {
    "accessToken": "...",
    "refreshToken": "...",
    "expiresAt": 1234567890,
    "subscriptionType": "pro"
  },
  "accountUuid": "...",
  "emailAddress": "...",
  "displayName": "..."
}
```

## Quota Levels

| Level | Utilization | Menu bar | Popup label |
|-------|-------------|----------|-------------|
| Normal | < 70% | Template icon | (none) |
| Warning | >= 70% | `icon-warning.png` | High |
| Critical | >= 90% | `icon-critical.png` | Critical |

Thresholds: `WARNING_THRESHOLD` / `CRITICAL_THRESHOLD` in `src/shared/quota.ts`. Not user-configurable.

## IPC Channels

| Channel | Direction | Purpose |
|---------|-----------|---------|
| `get-quota` | renderer -> main | Cached quota |
| `refresh-quota` | renderer -> main | Force refresh. Returns `{ quota, throttled, retryIn }` |
| `has-credentials` | renderer -> main | Login status for the active `authMode` |
| `get-user-info` | renderer -> main | User details for the active source |
| `get-settings` | renderer -> main | Settings exposed to the renderer |
| `set-refresh-interval` | renderer -> main | 300, 600, or 900 |
| `set-launch-at-login` | renderer -> main | Login item |
| `set-auth-mode` | renderer -> main | `app` or `cli`. On change: `resetForAccountChange` + refresh |
| `set-enable-notifications` | renderer -> main | Threshold notifications |
| `set-language` | renderer -> main | `en` or `fr`. Closes the popup, refreshes the tray, broadcasts `language-changed` |
| `get-last-error` | renderer -> main | Last quota error |
| `auth-start-login` | renderer -> main | Start OAuth (opens the browser) |
| `auth-submit-code` | renderer -> main | Submit the code. Success in app mode resets the account |
| `auth-logout` | renderer -> main | Clear in-app tokens. In app mode, resets the account |
| `auth-get-state` | renderer -> main | Auth state |
| `auth-state-changed` | main -> renderer | Auth state broadcast |
| `check-for-updates` | renderer -> main | Update check |
| `download-update` | renderer -> main | Download |
| `install-update` | renderer -> main | Install and restart |
| `get-update-status` | renderer -> main | Current update state |
| `get-app-version` | renderer -> main | Version string |
| `update-status-changed` | main -> renderer | Update state broadcast |
| `language-changed` | main -> renderer | Locale broadcast. Preload: `onLanguageChanged` |
| `open-settings` | renderer -> main | Open settings from the popup |
| `popup-content-height` | renderer -> main | Popup height (`ipcMain.on`) |
| `quota-updated` | main -> renderer | Quota broadcast |
| `quota-error` | main -> renderer | Error broadcast when nothing is cached |

## Settings (electron-store)

```typescript
{
  refreshInterval: number       // 300 | 600 | 900, default 300
  launchAtLogin: boolean        // default false; packaged builds sync it from Login Items at startup
  authMode: 'app' | 'cli'       // default 'app'
  enableNotifications: boolean  // default true
  language: 'en' | 'fr'         // default 'en'
  displayMode: 'standard' | 'detailed' | 'compact' | 'minimal' | 'time-remaining'
  rateLimitedUntil: number      // internal
  lastQuotaData: object | null  // internal, restored if younger than 24 h
  notifiedLevels: object        // internal, per period: 'normal' | 'warning' | 'critical'
}
```

The renderer `Settings` type is only the five user-facing fields (`refreshInterval`, `launchAtLogin`, `authMode`, `enableNotifications`, `language`).

## Development Commands

```bash
npm run dev            # electron-vite dev
npm run build          # production bundle
npm run dist           # DMG (arm64 + x64)
npm run release        # build + publish to GitHub
npm run typecheck      # tsc -p tsconfig.json && tsc -p tsconfig.node.json
npm run test           # vitest run
npm run test:watch
npm run test:coverage
```

`npm run typecheck` runs in CI before the tests.

## CI

- `.github/workflows/ci.yml`: on every PR and push to `main` (Ubuntu, Node 22, no Electron binary): `npm ci`, `npm run typecheck`, `npm test`, `npm run build`.
- `.github/workflows/release.yml`: on a `v*` tag or `workflow_dispatch` (macOS). `npm run typecheck` and `npm test`, then a signed notarized publish. The draft release is created first and published after upload, because electron-builder creating it during parallel uploads produced duplicates.
- Actions are pinned by commit SHA.
- Notarization is `mac.notarize: true` in `electron-builder.json`. CI decodes `APPLE_API_KEY_BASE64` to a file, exports `APPLE_API_KEY`, and sets `APPLE_API_KEY_ID` and `APPLE_API_ISSUER` (secret `APPLE_API_ISSUER_ID`). With no API key, electron-builder's built-in notarize reads `APPLE_KEYCHAIN_PROFILE`.
- `electron-builder` is ^26.18.0. Stay on >= 26.16.1: older versions pass the wrong password to `security set-key-partition-list` and break `CSC_LINK` signing on macOS 26 runners.

## Build Output

- DMG and ZIP for `arm64` and `x64`, under `release/`.
- App ID: `com.claude-bar.app`.
- Fuses are the `electronFuses` block in `electron-builder.json` (`runAsNode`, `enableNodeOptionsEnvironmentVariable`, and `enableNodeCliInspectArguments` false; embedded asar integrity, `onlyLoadAppFromAsar`, and cookie encryption true).

## Security Model

- **Fuses**: see `electronFuses` above.
- **Entitlements** (`entitlements.mac.plist`): `allow-jit` and `network.client` only.
- **Context isolation**: on. **Node integration**: off. **Sandbox**: on.
- **Preload**: `contextBridge.exposeInMainWorld` only.
- **PKCE**: S256. In-app tokens via `safeStorage` (login is refused if encryption is unavailable).
- **Keychain**: read-only.
- **CSP**: `<meta>` in each renderer HTML. `connect-src` allows `api.anthropic.com` and `console.anthropic.com` only. `onHeadersReceived` also sets CSP, but that header does not apply to `loadFile` pages.
- **Navigation**: `will-navigate` allows `file:` and, in development, the exact `ELECTRON_RENDERER_URL` origin. New windows are denied. Permission requests are denied.

## File Locations

All app files are under Electron `userData` (in development, `~/Library/Application Support/claude-bar/`):

- **Settings**: `config.json` (electron-store default name)
- **Logs**: `logs/claude-bar.log` (max 5 MB)
- **Auth tokens**: `auth-store.json` (encrypted fields via `safeStorage`)
- **CLI credentials**: macOS Keychain item `Claude Code-credentials`

## Dependencies

**Runtime:** `electron-store`, `electron-log`, `electron-updater`.

**Dev:** `electron` ^45.1.0, `electron-vite` ^5.0.0 (Vite 5–7 only; Vite 8 needs electron-vite 6), `electron-builder` ^26.18.0, `typescript` ^5.3.0, `vite` ^7, `vitest` ^4.

Local installs: npm `allowScripts` can skip Electron's postinstall, so `node_modules/electron/dist` may be missing after `npm ci`. Run `npm install-scripts approve electron` once.

## Known Issues

- Local notarization needs `APPLE_KEYCHAIN_PROFILE=claude-bar-notarize-apikey` exported explicitly (the old `scripts/notarize.js` picked it implicitly).
