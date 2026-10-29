# BurnBar - Technical Documentation

Canonical project instructions for agents and developers. `CLAUDE.md` only points here.

## Consignes pour les agents

- Travail sur un VPS Linux partagé. L'app Electron ne se lance pas ici : les tests manuels (menu bar, vibrancy, Keychain, notarisation) se font sur Mac.
- Toute commande lourde (`npm ci` / `npm install`, `tsc` sur tout le projet, `vitest run` / `npm test`, `npm run build`, Playwright ou navigateur headless) passe par le verrou commun : `flock -o /tmp/fw-design-lourd.lock nice -n 19 <commande>`. Un test ciblé sur un seul fichier n'en a pas besoin.
- Lecture seule du trousseau (`Claude Code-credentials`). Ne jamais rafraîchir ni écrire cet item : ça invalide le refresh token de Claude Code.
- Ne jamais réintroduire un login OAuth in-app (Claude.ai, PKCE, `auth-store`, `safeStorage`). Voir Security Model.

## Project Overview

**BurnBar** is a macOS menu bar application built with Electron that monitors AI coding tool usage. For **Claude Code** it shows the session (5-hour) and weekly (7-day) quotas, per-model weekly quotas when the API sends them, and extra-usage overage when present; its only credential source is a read-only read of Claude Code's Keychain item. For **Codex** it shows the same session and weekly quotas, read from the official local `codex app-server`. For **Grok** and **OpenCode** it shows consumption only (cost and tokens), from their official CLIs: no official source exposes their limits. Cursor Agent is out of scope.

- **Platform**: macOS 13.0+ (`minimumSystemVersion` in `electron-builder.json`). Electron 44+ requires macOS 13.
- **Framework**: Electron 45 (`electron` ^45.1.0) + electron-vite 5
- **Language**: TypeScript 5.3
- **License**: MIT
- **Version**: see `package.json`

## Architecture

```
Main Process (Electron)
├── index.ts              # App entry, single instance lock, wake-from-sleep restart
├── tray.ts               # Menu bar title, tooltip, context menu, display modes, provider broadcast
├── tray-icon.ts          # Template gauge bitmap (session bar + weekly bar)
├── windows.ts            # Popup/settings windows, toggle + auto-hide, security hooks
├── ipc-handlers.ts       # IPC with the renderer
└── services/
    ├── keychain.ts       # READ-ONLY read of Claude Code's Keychain item
    ├── token-utils.ts    # Token redaction for logs
    ├── quota-api.ts      # Usage API, cache, account-change reset, throttling
    ├── quota-errors.ts   # HTTP / network / Keychain error classification (i18n keys)
    ├── status.ts         # Filtered public Anthropic status, main-process cache
    ├── cli-path.ts       # Login-shell PATH, CLI resolution, child-process runner
    ├── codex.ts          # Codex quotas via a short-lived `codex app-server`
    ├── consumption.ts    # Grok / OpenCode usage (cost, tokens), 15 min cadence
    ├── providers.ts      # Enabled providers, first-launch detection, menu bar choice, snapshot
    ├── settings-store.ts # Shared electron-store singleton
    ├── scheduler.ts      # Auto-refresh timer with error backoff (one per quota provider)
    ├── notifications.ts  # Threshold and reset notifications
    ├── updater.ts        # electron-updater + GitHub Releases
    └── logger.ts         # electron-log

Shared
├── types.ts              # QuotaInfo / CodexQuota / ProvidersSnapshot (main <-> renderer)
├── quota.ts              # Thresholds, getQuotaLevel(), getForecast(), formatUsage()
└── i18n.ts               # en/fr strings, t(), applyI18n()

Preload
└── index.ts              # contextBridge (`window.burnBar`)

Renderer
├── shared/tokens.css     # Light/dark design tokens
├── popup/                # Quota window (index.html, renderer.ts, styles.css)
└── settings/             # Settings window (index.html, renderer.ts, styles.css)

Tests
└── tests/                # Vitest: real modules, mocked electron / Keychain / store
    ├── cli-path.test.ts
    ├── codex.test.ts
    ├── consumption.test.ts
    ├── forecast.test.ts
    ├── keychain.test.ts
    ├── notifications.test.ts
    ├── popup-shortcuts.test.ts
    ├── providers.test.ts
    ├── quota-api.test.ts
    ├── quota-errors.test.ts
    ├── quota-level.test.ts
    ├── scheduler.test.ts
    ├── settings-store.test.ts
    ├── status.test.ts
    ├── token-utils.test.ts
    ├── tray-icon.test.ts
    ├── tray.test.ts
    └── windows-position.test.ts
```

## Key Files

| File | Purpose |
|------|---------|
| `src/main/index.ts` | Lifecycle, single instance lock, dock hiding, startup delays, sleep resume |
| `src/main/tray.ts` | Title, tooltip, context menu, display modes, template gauge |
| `src/main/tray-icon.ts` | `renderGaugeBitmap`: thick session bar, thin weekly bar |
| `src/main/windows.ts` | Popup and settings, auto-fit height, toggle, auto-hide, shortcuts, CSP, navigation guard |
| `src/main/services/keychain.ts` | Reads `Claude Code-credentials` (never refreshes or writes) |
| `src/main/services/quota-api.ts` | API, Keychain credentials, cache, `resetForAccountChange`, stale flag, `buildPeriod` |
| `src/main/services/codex.ts` | `codex app-server` JSON-RPC read, parsing, Codex cache and errors |
| `src/main/services/consumption.ts` | Grok and OpenCode usage, Grok per-session cache |
| `src/main/services/providers.ts` | `providers` / `trayProvider` settings, detection, `getProvidersSnapshot()` |
| `src/main/services/cli-path.ts` | PATH for CLIs when launched from the Finder |
| `src/main/services/status.ts` | Anthropic status fetch, component filter, 5 min cache |
| `src/main/services/notifications.ts` | Upward level crossings in `notifiedLevels`, reset notices in `resetNotifications` |
| `src/main/services/settings-store.ts` | Shared electron-store singleton, Claude Bar settings copy, legacy-login migration |
| `src/main/services/scheduler.ts` | Interval refresh, rate-limit cooldown, exponential backoff; `schedulerService` (Claude) and `codexScheduler` |
| `src/main/services/updater.ts` | Update check, download, install & restart, 6 h re-check |
| `src/main/services/logger.ts` | File logging |
| `src/preload/index.ts` | `window.burnBar` |
| `src/renderer/shared/tokens.css` | Shared light/dark tokens |
| `src/shared/quota.ts` | Hardcoded 70% / 90% thresholds and `getForecast()` |

## Implemented Features

### Core
- Credentials are the Keychain item `Claude Code-credentials` only. Claude Code must be installed and signed in (`claude`). There is no in-app OAuth login.
- English / French UI.
- Session (5 h) and weekly (7 d) quotas. `QuotaInfo.fiveHour` is optional: `five_hour: null` is valid. The popup reset line then says "No active session" and the tray title uses `—`. A present window with `resets_at: null` still has a period (`resetsIn` is `—`); the popup reset line is "No active session". Utilization is clamped to 0–100% (`buildPeriod`).
- `models: ModelQuota[]` is built from the whitelist `MODEL_FAMILIES` (`opus`, `sonnet`, `haiku`, `fable`) and the keys `seven_day_<family>`. Other windows (`seven_day_oauth_apps`, `seven_day_routines`, `seven_day_cowork`, and anything else) are ignored. Optional `extra_usage` overage when `is_enabled`.
- A persisted `sevenDayOpus` with no `models` array is restored as one Opus model (`key: seven_day_opus`). The next successful save writes `models` and drops `sevenDayOpus`.
- Menu bar icon: template image from `renderGaugeBitmap` (18×18 at 1x, 36×36 at 2x). The thick bar is the session utilization, the thin bar is the weekly utilization. A missing value draws an empty track. No level PNG. `Tray` is created with the fixed GUID `18f3a40d-d04b-4b87-972e-79bd0432eed3` so macOS can remember the item position.
- Stale data, or an error other than a `rate_limit` that still has cached quota, draws the icon at 35% alpha. The title has no `⚠` prefix. `setTitle` uses `{ fontType: 'monospacedDigit' }`. With no cached quota the title is empty.
- If the tray item reports `getBounds().width === 0` (hidden item), the popup opens at the top right of the primary display's work area. A visible item centers the popup under the icon, on that display.
- Auto-refresh: 5, 10, or 15 min (`300` / `600` / `900` seconds). Default 300. Any other stored value is rewritten to 300 (values under 120 s as soon as the store loads, the rest when settings load).
- Adaptive refresh skips scheduled ticks after 10 min of system inactivity or while the screen is locked, until the last successful quota is 30 min old (`IDLE_REFRESH_MAX_AGE_MS`). The configured interval is never shortened. While ticks are skipped the scheduler sets `quotaService.idlePaused`, so the data is not flagged stale before 30 min + one interval. Unlocking, `user-did-become-active` (macOS session switch), and every popup open request a non-forced refresh through the existing throttle; manual and forced refreshes always run. The scheduler logs the first skipped tick and the next refresh.
- Launch at login. Packaged builds sync the switch from Login Items at startup (`openAtLogin`, or on when `status === 'requires-approval'`). That status shows a hint and a button. The button sends `open-login-items-settings`, which opens `x-apple.systempreferences:com.apple.LoginItems-Settings.extension`. In development the status is omitted and the hint stays hidden.
- Refresh button spins while a refresh runs (at least 400 ms). A toast overlays the popup for 2 s only when the refresh was throttled and the cached data carries no error (a throttled refresh during an error is explained by the alert). It does not change the window height.
- Popup height follows content (`popup-content-height`).
- Popup shortcuts, on `before-input-event` (keydown, ⌘ without alt, control, or shift): Esc hides, ⌘R force-refreshes, ⌘, opens Settings, ⌘Q quits. The footer Quit button calls `quit-app`.
- Signed-out popup: heading "Claude Code is not connected", the hint to run `claude` (backticks rendered as `<code>`), and Retry. The same view is used when an auth error arrives and nothing is cached; the hint is then that error's message (unreadable session, expired token, 403). Backticks in error text and in the Settings account hint are also `<code>`. The header has no placeholder text: it shows the account name once user info loads (not read for a `keychain` error).
- A second launch (`second-instance`) opens Settings.
- `lastAccount` stores `accountUuid`, or `emailAddress` when there is no uuid. `getCredentials` calls `resetForAccountChange()` when a stored value differs. That drops the in-memory cache, `lastQuotaData`, `notifiedLevels`, `resetNotifications`, `extraUsageNotified`, and the last error, and bumps a generation counter so a response still in flight is discarded. The fetch that noticed the change then continues. The popup reloads user info on every `quota-updated`. Settings reloads the account block and the login-item hint on focus. The account block is "Connected" only when the Keychain item exists, its credentials are readable, and the last error is not `auth` or `keychain`; otherwise it is "Not Connected" with that error's message (or the unreadable-session message). On focus and on Account Refresh, a current `auth` / `keychain` error triggers `refresh-quota` first, so a fixed session shows as connected; otherwise only the Keychain status is re-read.

### Providers
Four providers: `claude`, `codex` (quotas), `grok`, `opencode` (consumption only). Each has its own state (data, error, last success) and its own actionable messages; a failing provider never changes another one's data, title, dim, or errors.

- **Detection**: on first launch (`providers` absent from the store) `detectProviders()` turns on each provider that is installed: Claude when its Keychain item exists (`has-credentials`), the others when their binary resolves on the CLI PATH. Nothing found keeps Claude on so the popup shows its sign-in hint. `trayProvider` is set to `claude` when Claude is on, otherwise `codex`. Schedulers start after detection.
- **Settings > Providers** (FR **Outils**): one switch per provider with its status: Connected, Installed (Grok/OpenCode, plus "usage only, no quota"), Not installed, Not connected, or the error message. Switching on runs a forced read; switching off stops it (Claude and Codex schedulers are stopped). Toggling closes the popup so it is rebuilt with the new sections. The Account section (Claude's Keychain session) is hidden while Claude is off. **Menu bar shows**: `Claude | Codex | Highest` (`trayProvider`: `claude`, `codex`, `max`).
- **Menu bar**: `getTrayProvider()` falls back to an enabled quota provider (`max` needs both on). `max` draws each gauge bar at the higher of the two values and the title from the more loaded provider (highest of its session / weekly). The icon dims under `max` only when both providers need attention.
- **CLI PATH** (`cli-path.ts`): an app opened from the Finder has no shell PATH. On first need, `$SHELL -ilc` prints the login PATH between markers (5 s timeout, once, cached), then `process.env.PATH`, `~/.local/bin`, `/opt/homebrew/bin`, `/usr/local/bin`, `~/.bun/bin`, `~/.volta/bin`, and every `~/.nvm/versions/node/*/bin` (newest first). Child processes get this PATH (`codex` is a node script).
- **Codex** (`codex.ts`): spawns `codex app-server` (JSON-RPC over stdio), sends `initialize` (`clientInfo: { name: 'burnbar', version }`), `initialized`, then `account/rateLimits/read`, and kills the process as soon as the answer arrives, or after 20 s. It never reads `~/.codex/auth.json` or any token. Schema: `codex app-server generate-json-schema --out <dir>` (`v2/GetAccountRateLimitsResponse.json`). `rateLimits.primary` / `secondary` map by `windowDurationMins` (≤ 24 h is the session, else weekly; defaults 300 / 10080), `usedPercent` is the utilization, `resetsAt` is epoch seconds. Windows go through the same `buildPeriod` / `getForecast` as Claude. `planType` becomes a badge (`Team`, `Plus`, `Pro`…; unknown values show none). `rateLimitResetCredits.availableCount > 0` shows "N resets available". `rateLimitReachedType` or `spendControlReached` shows "Codex usage limit reached." Driven by `codexScheduler` (same interval, idle pause, backoff, stale rule and throttle as Claude: 290 s scheduled, 15 s forced). Not persisted across restarts.
- **Codex errors**: binary missing → `codex.notInstalled` (status `not-installed`, data dropped); JSON-RPC error mentioning auth/login → `codex.notConnected` ("Run `codex login`", status `not-connected`, data dropped); network-like RPC error → `codex.network`; 20 s → `codex.timeout`; invalid result, exit without answer, other errors → `codex.failed` (cached data kept, flagged by the error and the age line).
- **Grok** (`consumption.ts`): `grok sessions list` only lists the sessions of the current directory, and worktrees that no longer exist cannot be listed at all. BurnBar therefore discovers session IDs from the directory names `~/.grok/sessions/<project>/<uuid>/` and uses the mtime of `usage.json` (or of the directory) as the change key: no file content is read and no token is used. Sessions modified since the start of the 7-day window are read with `grok usage <id>` (JSON: `updatedAt`, `session.totalTokens`, `session.costUsdTicks`, 1e10 ticks = 1 USD). Results are cached by `(id, mtime)`, so only changed sessions run the CLI again. Approximation: a session counts entirely on the local day of its `updatedAt`. An unreadable session keeps the others and shows `grok.failed` (totals may be incomplete).
- **OpenCode**: `opencode stats --json --days 0 --standalone` (today) and `--days 7 --standalone` (local midnight six days ago to now). `--standalone` runs a private server that exits with the command; the default mode goes through a persistent `opencode serve --service`. Tokens are input + output + reasoning + cache read + cache write; cost is USD.
- **Consumption cadence**: at most every 15 minutes (timer, popup open and manual refresh all share the floor); switching a tool on forces a read. Grok and OpenCode run independently; a missing binary is `*.notInstalled` (data dropped), any other failure is `*.failed` (previous totals kept). There is no quota, forecast, or notification for them.
- **Status pages**: only Anthropic's. `status.openai.com/api/v2/summary.json` answers but carries no `incidents` and no Codex CLI component (only "Codex in ChatGPT Desktop"), so Codex has no status banner.

### Display Modes (right-click menu)
`showRemaining` (default false) switches displayed percentages to rounded `100 - utilization` in Standard, Detailed, Compact, tooltips, every popup quota row, and collapsed section summaries, for Claude and Codex. The setting is available in General and as a tray checkbox. Changing it closes the popup, refreshes the tray, and broadcasts `show-remaining-changed` to keep Settings synchronized. Missing sessions stay `—` in remaining mode. Gauges, levels, colors, forecasts, and the Time Remaining / Icon only titles retain their existing meaning.

Persisted in `displayMode`. Every mode uses the provider chosen by `trayProvider` (see Providers).
- **Standard**: `45% / 32%` (session `—` when `fiveHour` is absent)
- **Detailed**: `5h: 45% | 7d: 32%`, then each model as `| Opus: 10%` in whitelist order. With Claude and Codex both on and holding data: `Claude 45% / 32% · Codex 22% / 12%` (no models)
- **Compact**: session percentage, or `—`
- **Time Remaining**: session `resetsIn`, or `—`

Title, icon, and tooltip are redrawn every minute in every mode, so countdowns, the data age, and the stale dim move without a fetch.
- **Icon only**: empty title. The menu label is "Icon only". The stored value stays `minimal`.

### Gauge
One meter per quota. The fill is utilization. A 2 px tick (`.meter-pace`) marks elapsed time in the period (`resetProgress`). The tick is hidden when progress is 0. There is no second bar under the card.

Next to the reset time, warning shows **High** and critical shows **Critical** (no label under 70%). Color uses `--ok` / `--warn` / `--crit`, not the action orange. Model rows are compact: label, meter, level, percentage. Their reset text is the row `title`. They have no pace badge and no forecast line.

### Forecast
`getForecast()` in `src/shared/quota.ts`. Pace is `hot` when utilization is more than 10 points above `resetProgress`, `spare` when more than 10 below, otherwise `on-track`. `runsOutAt` is set when a linear projection reaches 100% before `resetsAt`. No forecast when `resetProgress` is under 5 or at 100, when utilization is 0, or when the inputs are not finite.

The session card (`periodHours` 5) and the weekly card (168) show it. The reset line is `Reset in {time} · {absolute}` (`popup.resetDetail`). The absolute time is hour and minute; the weekly card also includes a short weekday. The badge is "High pace", "On track", or "Comfortable headroom". When `runsOutAt` is set, a line reads `Runs out around {time}, {duration} before reset`.

### Notifications
Same 70 / 90 thresholds, per session, per weekly window, and per model. One notification per upward level crossing, stored in `notifiedLevels`. The title is `{label} at {pct}%` (`notification.thresholdTitle`). The body is the warning or critical string. The title does not include the app name.

Session and weekly only: when the stored `resetNotifications` time for that window has passed and the max utilization recorded for that `resetsAt` was >= 70%, one notification — "Session quota reset" or "Weekly quota reset", body "You can resume." The same Alerts switch (`enableNotifications`) gates both. `checkAndNotify` returns immediately when there is no quota, an error, or `stale`. On that check, a legacy `notifiedLevels.sevenDayOpus` value is applied to `seven_day_opus` and the old key is deleted.

Codex uses the same thresholds, reset notices and Alerts switch, with keys `codex.fiveHour` / `codex.sevenDay` in `notifiedLevels` and `resetNotifications`. Titles are "Codex session at 75%" / "Codex weekly at 75%", and "Codex session quota reset" / "Codex weekly quota reset". `checkCodex()` runs after a Codex refresh that produced new data, and ignores errors and stale data. Grok and OpenCode never notify.

Extra usage uses the same Alerts switch: a notification when billed credits first become positive, then once at 50% and 90% of a positive monthly limit. Amounts are converted from cents and formatted with the current locale and reported currency, falling back to a decimal amount and currency code if invalid. `extraUsageNotified` stores the last amount and notified levels across restarts; a decrease in credits starts a new cycle. The first valid reading records reached levels without notifying. Missing or disabled extra usage is ignored, as are errors and stale quota data.

### Design (« Terre sur verre »)
Tokens live in `src/renderer/shared/tokens.css` (light, and dark via `prefers-color-scheme`). Surfaces are translucent; the windows use native vibrancy (`popover` on the popup, `window` on settings).

`--accent` is `#D97757`. Primary buttons, the selected segment, the on switch, the update bar, and links use `--accent-strong` (derived). The plan badge border uses `--accent`. Quota meters do not.

The popup has one section per enabled provider, in this order: Claude Code, Codex, then **Usage** (FR **Consommation**) with one line per tool, `Today $1.69 · 7d $12.40 · 2.3M tokens` (`formatUsage`: narrow-symbol USD and compact tokens in the current locale; the tokens are the 7-day total; the data age is the row tooltip). Each section head is a button: tool name, plan badge (`#subscriptionBadge` for Claude, `#codexPlan`), Codex's reset credits, and a chevron. Clicking collapses the section; collapsed, the head shows `session / weekly` (warning color when stale or failing). The collapsed state is kept in `localStorage` (`collapsed.<sectionId>`). The Codex section reuses the quota cards and its own age line ("Updated 5m ago"); with nothing cached it shows a skeleton until the first answer, then the error alert. The header shows the Claude account name, or `BurnBar` when Claude is off. With Claude alone, its signed-out state is the full-page card; with other providers, it is an alert inside the Claude section. With nothing enabled, the popup says to open Settings. The popup is at most 600 px tall and scrolls beyond that.

Settings is grouped like System Settings: **Account**, **Providers**, **General**, **Updates**. The window is 420 × 850. Account is the Keychain status (dot, "Connected" / "Not Connected", email or display name, plan), a Refresh button, and the `claude` hint. Refresh is a segmented control **5 min | 10 min | 15 min**. Alerts and launch-at-login are switches. Appearance is a segmented control **Auto | Light | Dark** (`theme`): it sets `nativeTheme.themeSource`, which switches `prefers-color-scheme` in every window and the native vibrancy, so `tokens.css` needs no theme class. Language is a select. The login-item hint row is hidden unless `launchAtLoginStatus` is `requires-approval`.

Accessibility: meters and the update bar are `role="progressbar"` with `aria-valuenow`; `:focus-visible` uses the accent focus ring; `prefers-reduced-motion: reduce` disables animations and transitions. `prefers-contrast: more` sets secondary ink to `--ink`, hairline to `currentColor`, and a 1 px border on `.meter`. `prefers-reduced-transparency: reduce` uses an opaque surface (`#fff`, `#292826` in dark) and an opaque page background (`#F5F3EF`, `#1F1E1D` in dark). Segmented controls are `radiogroup` / `radio`. Switches are `role="switch"`.

### Token Management
- Read-only Keychain. An expired token is an auth error asking the user to run `claude`. On 401 the Keychain is re-read in case Claude Code rotated the token. No token endpoint is called.
- On store load, if the legacy `authMode` key is present: delete it, delete `auth-store.json` under `userData`, and set `lastQuotaData` to null and `notifiedLevels` to `{}`. This runs before the quota cache is restored, so a quota saved for the old in-app account is not shown.
- An account change calls `resetForAccountChange()` as described under Core.

### Error Handling
- Errors are stored as an i18n key (`QuotaErrorState` in `quota-errors.ts`) and translated by `getLastError()`, so a language change also applies to the current error. Every message says what happens and what to do.
- Keychain read (`security find-generic-password`, 60 s timeout): `KeychainService.lastFailure` is `missing` (exit 44) → auth `error.noCredentials`; `invalid` (empty, not JSON, no or malformed token) → auth `error.credentialsInvalid`; `denied` (exit 128 or 51) → `keychain` `error.keychainDenied`; `failed` (any other exit, timeout, locked Keychain) → `keychain` `error.keychainFailed`. The two `keychain` errors are retryable (backoff spaces out the macOS prompts). An expired token is auth `error.cliTokenExpired`, without an API call.
- One retry on 401: Keychain re-read. A still-failing 401 is an auth error (`error.cliTokenExpired`). 403 is auth `error.forbidden`. Other 4xx and a body that is not JSON or has an unexpected shape are `unknown` `error.unexpectedResponse`. 5xx is `server`. A rejected fetch is `network` (`error.network`, or `error.timeout` for the 15 s timeout).
- 429: cooldown from `retry-after`, floor 2 min, cap 1 h, persisted in `rateLimitedUntil`. No token rotation.
- Proactive pause when `anthropic-ratelimit-requests-remaining` is 0, until the reset header (+ 5 s).
- `QuotaError.retryAt` is the next automatic attempt: the later of the scheduler's backoff or rate-limit timer (`quotaService.nextRetryAt`) and `rateLimitedUntil`, when in the future. It is shown as "Next try in {time}." (or "under a minute") in the popup alert and the tooltip.
- `getCachedQuota()` attaches the last error. The menu bar icon is drawn at 35% alpha when data is stale, or when there is an error that is not a `rate_limit` still backed by cached quota. The tooltip adds the error message (backticks removed), the next try, and, when `stale` is set, the stale line. With cached quota, the popup alert shows any error, including `rate_limit`, with the next try; the data stays on screen. An auth error with nothing cached shows the signed-out view instead of the alert. Any other error with nothing cached shows the alert plus guidance (`network`, `server`) and the next try.
- The popup footer is the data age ("Updated just now", "Updated 25m ago", exact time on hover), in the warning color when the data is stale or the last refresh failed.
- `QuotaInfo.stale` is true when `lastUpdated` is older than twice `refreshInterval`, or 30 min + one interval while idle refreshes are paused.
- A period whose `resetsAt` is already past has no active window until the next fetch: 0%, `resetsAt` invalid, `resetsIn` `—`, no pace tick (`buildPeriod`). The popup says "No active session".
- A persisted `lastQuotaData` with an invalid weekly or session period is not restored; invalid model periods are dropped.
- Scheduler: concurrent `refresh()` calls share one run. Exponential backoff on retryable errors, multiplier capped at 8× the interval. A refresh answered from the cache without a request (throttle) leaves the backoff and timers unchanged. `stop()` (including wake-from-sleep) clears retry timers and the error count.
- Throttle: scheduled fetches need ~5 min since the last success (290 s). Manual refresh floor is 15 s. A clock set back (negative elapsed time) never throttles.
- Opening the popup resends the cached quota, or the last error when nothing is cached, then requests a non-forced refresh.
- Error types: `network`, `auth`, `keychain`, `rate_limit`, `server`, `unknown`. Codex, Grok and OpenCode errors use the same `QuotaErrorState` keys (see Providers).

### Auto-Updates
- Packaged builds only. `autoDownload` is false. `autoInstallOnAppQuit` is true.
- Check 5 s after startup, then every 6 hours. A check is skipped while status is `downloading` or `downloaded`.
- Manual check from Settings or the tray menu. The tray item stays visible; the check itself returns immediately in those two statuses. Settings hides the check button while status is `available` (the button is Download & Install), `downloading`, or `downloaded` (Install & Restart).
- Download progress in Settings. **Install & Restart** calls `quitAndInstall`.
- GitHub Releases (signed DMG + ZIP).

### Tooltips
The main process fetches `https://status.claude.com/api/v2/summary.json` alongside quota refreshes, without delaying quotas, with a 10 s timeout and at most one attempt every 5 min. Only the components named `Claude Code`, `Claude API (api.anthropic.com)`, and `claude.ai` count. Relevant unresolved incidents or non-operational components set `QuotaInfo.status`; unrelated incidents and the global indicator are ignored. A disruption adds an Anthropic tooltip line and a popup banner under the header, warning for minor and critical-colored for major/critical. Details opens the incident URL, or the status page, through validated IPC. Network failures clear status to unknown and only log at debug level; no system notification is sent.

- "No active session" when `fiveHour` is absent, otherwise the session percentage and time until reset. Weekly percentage and time until reset. Each model the same way.
- Data age ("Updated 25m ago").
- Last error message (any type, backticks removed), the next try when scheduled, and `tray.stale` when `stale` is set.
- With nothing cached: `BurnBar —` plus the error message and the next try, or `tray.clickToView` when there is no error.

With Claude alone, the tooltip is exactly the list above. Otherwise it has one block per enabled provider, separated by a blank line: `Claude Code` then its lines (or its error and next try, or `—`); `Codex` then session, weekly, limit reached, reset credits, age, error, next try, stale; then one block with `Grok: Today … · 7d … · … tokens` and `OpenCode: …` (or the tool's error).

## Not Yet Implemented

- History service (`history.ts`): no usage history, charts, or statistics.
- Trend arrows.
- Pause mode.
- Time-to-critical estimate (the forecast projects 100%, not 70% or 90%).
- Configurable thresholds (70 / 90 are constants in `src/shared/quota.ts`. The Alerts subtitle in Settings still says 70% and 90%).
- Codex: no persistence across restarts, no account-change reset of `codex.*` notification levels, no status banner (see Providers).
- Quotas for Grok and OpenCode (no official source).

## Data Flow

1. Startup loads settings (the legacy `authMode` migration runs when the store module loads), hides the dock icon, creates the tray, and runs first-launch provider detection.
2. `QuotaService` reads `KeychainService` and calls the usage API. In parallel and independently, `codexScheduler` reads `codex app-server` and `consumptionService` runs the Grok / OpenCode CLIs.
3. The usage API call applies the rate-limit rules above. A changed `lastAccount` resets the previous account inside that fetch.
4. Tray title, tooltip, and icon update. The popup receives `quota-updated` or, when there is an error and no quota, `quota-error` (Claude), and `providers-updated` (Codex, Grok, OpenCode, enabled flags, statuses; Settings receives it too).
5. The popup reports its height and the window resizes.
6. The Claude and Codex schedulers repeat at `refreshInterval`; consumption every 15 min.

Startup waits 2 s (and for detection) before the first scheduler start, and 5 s before the first update check. On `powerMonitor` `resume`, both schedulers are stopped and started again after 2 s (`start(true)`). Lock, unlock and `user-did-become-active` apply to both. ⌘R and the popup refresh button force both quota providers; consumption keeps its 15 min floor. The tray menu Refresh forces Claude only. A second instance opens Settings.

## API Integration

```typescript
// Quota
GET https://api.anthropic.com/api/oauth/usage
Authorization: Bearer {accessToken}
anthropic-beta: oauth-2025-04-20
```

The access token is the one in `Claude Code-credentials`. This app never calls a token endpoint. Claude Code owns refresh.

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

`lastAccount` is `accountUuid`, or `emailAddress` when `accountUuid` is absent. `has-credentials` checks that the item exists. `get-user-info` returns `email`, `name` (`displayName`), and `subscriptionType`.

## Quota Levels

| Level | Utilization | Popup label |
|-------|-------------|-------------|
| Normal | < 70% | (none) |
| Warning | >= 70% | High |
| Critical | >= 90% | Critical |

Thresholds: `WARNING_THRESHOLD` / `CRITICAL_THRESHOLD` in `src/shared/quota.ts`. Not user-configurable. Each meter is leveled on its own. The menu bar icon is the template gauge at every level; see Core for the 35% dim.

## IPC Channels

| Channel | Direction | Purpose |
|---------|-----------|---------|
| `get-quota` | renderer -> main | Cached Claude quota, including optional filtered Anthropic `status` |
| `get-providers` | renderer -> main | `ProvidersSnapshot`: enabled flags, statuses, Codex quota / error, Grok and OpenCode usage / error |
| `set-provider-enabled` | renderer -> main | Provider id and boolean. Starts or stops its refresh, closes the popup, refreshes the tray, broadcasts `providers-updated` |
| `set-tray-provider` | renderer -> main | `claude`, `codex`, or `max` |
| `providers-updated` | main -> renderer | `ProvidersSnapshot` broadcast (popup and Settings). Preload: `onProvidersUpdated` |
| `refresh-quota` | renderer -> main | Force refresh of Claude and Codex (consumption keeps its floor). Returns Claude's `{ quota, throttled, retryIn }` |
| `has-credentials` | renderer -> main | Keychain item `Claude Code-credentials` exists |
| `get-user-info` | renderer -> main | Email, display name, subscription type from that item |
| `get-settings` | renderer -> main | `refreshInterval`, `launchAtLogin`, `launchAtLoginStatus` (packaged only), `enableNotifications`, `showRemaining`, `language`, `theme`, `trayProvider` |
| `set-refresh-interval` | renderer -> main | 300, 600, or 900 (Claude and Codex) |
| `set-launch-at-login` | renderer -> main | Stores the flag. Packaged builds also call `setLoginItemSettings` |
| `open-login-items-settings` | renderer -> main | Opens System Settings → Login Items |
| `set-enable-notifications` | renderer -> main | Threshold, reset, and extra-usage notifications (Claude and Codex) |
| `set-show-remaining` | renderer -> main | Boolean; updates remaining percentages, refreshes tray, closes popup |
| `open-status-page` | renderer -> main | Opens only URLs starting with `https://status.claude.com/` or `https://status.anthropic.com/` |
| `show-remaining-changed` | main -> renderer | Boolean preference broadcast; preload `onShowRemainingChanged` |
| `set-theme` | renderer -> main | `system`, `light`, or `dark`. Stores it and sets `nativeTheme.themeSource` |
| `set-language` | renderer -> main | `en` or `fr`. Closes the popup, refreshes the tray, broadcasts `language-changed` |
| `get-last-error` | renderer -> main | Last quota error, translated, with `retryAt` when a retry is scheduled |
| `check-for-updates` | renderer -> main | Update check |
| `download-update` | renderer -> main | Download |
| `install-update` | renderer -> main | Install and restart |
| `get-update-status` | renderer -> main | Current update state |
| `get-app-version` | renderer -> main | Version string |
| `open-settings` | renderer -> main | Open settings from the popup |
| `quit-app` | renderer -> main | `app.quit()` |
| `popup-content-height` | renderer -> main | Popup height (`ipcMain.on`) |
| `quota-updated` | main -> renderer | Quota broadcast |
| `quota-error` | main -> renderer | Error broadcast when nothing is cached |
| `update-status-changed` | main -> renderer | Update state broadcast |
| `language-changed` | main -> renderer | Locale broadcast. Preload: `onLanguageChanged` |

## Settings (electron-store)

```typescript
{
  refreshInterval: number       // 300 | 600 | 900, default 300
  launchAtLogin: boolean        // default false; packaged builds sync it from Login Items at startup
  enableNotifications: boolean  // default true
  showRemaining: boolean        // default false; display remaining percentages
  language: 'en' | 'fr'         // default 'en'
  theme: 'system' | 'light' | 'dark' // default 'system', applied to nativeTheme.themeSource at startup
  displayMode: 'standard' | 'detailed' | 'compact' | 'minimal' | 'time-remaining'
  rateLimitedUntil: number      // internal
  lastQuotaData: object | null  // internal, restored if younger than 24 h
  notifiedLevels: object        // internal, per period: 'normal' | 'warning' | 'critical' (Codex: 'codex.fiveHour', 'codex.sevenDay')
  resetNotifications: object    // internal, fiveHour / sevenDay / codex.fiveHour / codex.sevenDay: { resetsAt, utilization }
  extraUsageNotified?: { used: number; levels: ('started' | '50' | '90')[] } // internal, absent until first reading
  lastAccount: string | null    // internal, accountUuid or emailAddress
  providers?: Record<'claude' | 'codex' | 'grok' | 'opencode', boolean> // absent until first-launch detection
  trayProvider: 'claude' | 'codex' | 'max' // default 'claude'; set by detection
}
```

The renderer `Settings` type is `refreshInterval`, `launchAtLogin`, optional `launchAtLoginStatus` (`not-registered` | `enabled` | `requires-approval` | `not-found`), `enableNotifications`, `showRemaining`, `language`, `theme`, and `trayProvider`. `launchAtLoginStatus` is read from the system on packaged builds and is not stored.

`displayMode: 'minimal'` is the Icon only menu item.

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

### Testing on the Mac

The app is developed on the VPS but only runs on macOS. On the Mac, one command copies the VPS working tree (uncommitted changes included, no `.git`), installs when `package-lock.json` changed, builds, relaunches the app, and tails its log:

```bash
ssh debian@vps-lanacool cat Projets/burnbar/scripts/mac-dev.sh | sh
```

`VPS_HOST`, `VPS_DIR`, and `MAC_DIR` (default `~/burnbar-dev`) override the defaults. The log is `/tmp/burnbar-dev.log`.

### Images

No npm dependency: both scripts load an existing `playwright-core` from `PLAYWRIGHT_CORE` (and an optional `CHROMIUM` executable).

- `scripts/render-icons.mjs`: `assets/app-icon.svg` to `assets/icon.png` (1024×1024).
- `scripts/render-readme-shots.mjs`: `assets/readme/popup.png`, the README image. It launches the built app (`npm run build` first) under xvfb with a temporary HOME, fake `security` / `codex` / `grok` / `opencode` binaries, and a stubbed `fetch` for the usage API, captures the popup in light and dark at 2x, and composes them under a menu bar on a warm backdrop (rendered at 1.5x, ~360 KB). Inter (OFL, in `~/.local/share/fonts`) replaces the system font through CSS injected for the capture only. Run it through the heavy-command lock.

README logos are `assets/logo-readme-light.svg` / `assets/logo-readme-dark.svg` (`<picture>` with `prefers-color-scheme`). Release notes go in `CHANGELOG.md` (Keep a Changelog).

## CI

- `.github/workflows/ci.yml`: on every PR and push to `main` (Ubuntu, Node 22, no Electron binary): `npm ci`, `npm run typecheck`, `npm test`, `npm run build`.
- `.github/workflows/release.yml`: on a `v*` tag or `workflow_dispatch` (macOS). `npm run typecheck` and `npm test`, then a signed notarized publish. The draft release is created first and published after upload, because electron-builder creating it during parallel uploads produced duplicates.
- Actions are pinned by commit SHA.
- Notarization is `mac.notarize: true` in `electron-builder.json`. CI decodes `APPLE_API_KEY_BASE64` to a file, exports `APPLE_API_KEY`, and sets `APPLE_API_KEY_ID` and `APPLE_API_ISSUER` (secret `APPLE_API_ISSUER_ID`). With no API key, electron-builder's built-in notarize reads `APPLE_KEYCHAIN_PROFILE`.
- `electron-builder` is ^26.18.0. Stay on >= 26.16.1: older versions pass the wrong password to `security set-key-partition-list` and break `CSC_LINK` signing on macOS 26 runners.

## Build Output

- DMG and ZIP for `arm64` and `x64`, under `release/`.
- App ID stays `com.claude-bar.app` on purpose (renaming it would make macOS treat BurnBar as a new app).
- Fuses are the `electronFuses` block in `electron-builder.json` (`runAsNode`, `enableNodeOptionsEnvironmentVariable`, and `enableNodeCliInspectArguments` false; embedded asar integrity, `onlyLoadAppFromAsar`, and cookie encryption true).

## Security Model

- **Fuses**: see `electronFuses` above.
- **Entitlements** (`entitlements.mac.plist`): `allow-jit` and `network.client` only.
- **Context isolation**: on. **Node integration**: off. **Sandbox**: on.
- **Preload**: `contextBridge.exposeInMainWorld` only.
- **No in-app login.** [Anthropic's terms](https://code.claude.com/docs/en/legal-and-compliance) (Authentication and credential use) forbid a third-party app from offering Claude.ai login and from collecting or storing Claude.ai tokens. The removed flow reused Claude Code's `client_id`. Do not add that flow back: no authorize URL, no token endpoint, no `safeStorage` token store, no `authMode`.
- **Keychain**: read-only. Claude Code owns the item and its refresh.
- **Other providers**: official local CLIs only, never an undocumented API with the user's token (same rule as the removed in-app login). Codex: `codex app-server`, never `~/.codex/auth.json`. Grok: `grok usage <id>`; session IDs come from directory names under `~/.grok/sessions/` (names and mtimes only). OpenCode: `opencode stats --standalone`. Every child process has a timeout (Codex 20 s, Grok / OpenCode 20 s each, login shell 5 s) and is killed after use: no daemon is left behind.
- **CSP**: `<meta>` in each renderer HTML. `connect-src` is `'self'` and `https://api.anthropic.com` only. `onHeadersReceived` sets the same CSP, but that header does not apply to `loadFile` pages.
- **Navigation**: `will-navigate` allows `file:` and, in development, the exact `ELECTRON_RENDERER_URL` origin. New windows are denied. Permission requests are denied.

## File Locations

All app files are under Electron `userData` (in development, `~/Library/Application Support/burnbar/`):

- **Settings**: `config.json` (electron-store default name)
- **Logs**: `logs/burnbar.log` (max 5 MB)
- **CLI credentials**: macOS Keychain item `Claude Code-credentials`

BurnBar was named Claude Bar until 2.0.0. When `config.json` is missing, the store first copies `<appData>/claude-bar/config.json` (the previous app's settings); the usual migrations (interval floor, legacy `authMode`, see Token Management) then run on it.

`auth-store.json` is not a current store. The legacy migration deletes it when `authMode` is still in `config.json`.

## Dependencies

**Runtime:** `electron-store`, `electron-log`, `electron-updater`.

**Dev:** `electron` ^45.1.0, `electron-vite` ^5.0.0 (Vite 5–7 only; Vite 8 needs electron-vite 6), `electron-builder` ^26.18.0, `typescript` ^5.3.0, `vite` ^7, `vitest` ^4.

Local installs: npm `allowScripts` can skip Electron's postinstall, so `node_modules/electron/dist` may be missing after `npm ci`. Run `npm install-scripts approve electron` once.

## Known Issues

- Local notarization needs `APPLE_KEYCHAIN_PROFILE=claude-bar-notarize-apikey` exported explicitly (the old `scripts/notarize.js` picked it implicitly).
- Under Linux / xvfb (smoke tests), `setSize` never shrinks the non-resizable popup, and `nativeTheme` does not switch `prefers-color-scheme`. macOS is not affected.
