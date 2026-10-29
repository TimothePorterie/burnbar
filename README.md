# Claude Bar

<p align="center">
  <img src="https://img.shields.io/badge/platform-macOS%2013%2B-lightgrey" alt="Platform: macOS 13+">
  <img src="https://img.shields.io/badge/electron-45-blue" alt="Electron 45">
  <img src="https://img.shields.io/badge/license-MIT-green" alt="License: MIT">
</p>

<p align="center">
  <strong>Monitor your Claude Code quotas directly from the macOS menu bar.</strong>
</p>

<!-- Screenshot is out of date. The current popup uses the shared light/dark tokens,
     one meter per quota with an elapsed-time tick, High/Critical labels, a pace
     badge and a "runs out" line on the session and weekly cards, and compact
     per-model rows when the API sends them. There is no in-app login. It does
     not show trend arrows, a statistics block, a separate reset bar, or pause.
     Leave this file in place until a new capture is taken on a Mac. -->
<p align="center">
  <img src="assets/screenshot.png" alt="Claude Bar Screenshot" width="400">
</p>

---

## Features

### Core
- **Menu Bar Gauge** — A template icon drawn in the app: a thick bar for the 5-hour session, a thin bar for the weekly quota. The title uses monospaced digits. With nothing cached, the title is empty.
- **Detailed Popup** — Session (5h) and weekly (7d) quotas. Per-model weekly quotas (Opus, Sonnet, Haiku, Fable) when the API sends them, plus overage when your plan reports it.
- **Forecast** — On the session and weekly cards: a pace badge, the reset as `Reset in 2h 11m · 12:12` (a weekday on the weekly card), and `Runs out around … before reset` when the quota would hit 100% before the window ends.
- **Levels** — Under 70% is normal. From 70% the popup says **High**; from 90% it says **Critical**. These levels are not configurable. Each model uses the same thresholds.
- **Auto Refresh** — 5, 10, or 15 minutes
- **Visual Feedback** — The refresh button spins while loading. If a refresh is throttled, a toast overlays the popup
- **Tooltips** — Hover the menu bar icon for each quota, the time until it resets, and when the numbers were last updated
- **Keyboard** — In the popup: Esc closes, ⌘R refreshes, ⌘, opens Settings, ⌘Q quits. The footer has a Quit button.
- **Dark Mode** — Follows the macOS appearance
- **Lightweight** — Runs quietly in the background with minimal resource usage
- **Native Feel** — Uses macOS vibrancy effects for a native look
- **Languages** — English and French

Claude Bar does not log you in. [Anthropic's terms](https://code.claude.com/docs/en/legal-and-compliance) (Authentication and credential use) forbid a third-party app from offering Claude.ai login or from collecting and storing Claude.ai tokens. Sign in with Claude Code. Claude Bar only reads that session.

### Display Modes
Choose your preferred menu bar format (right-click → Display Mode):
- **Standard**: `45% / 32%`
- **Detailed**: `5h: 45% | 7d: 32%`, plus `| Opus: 10%` (and Sonnet, Haiku, or Fable) when that quota exists
- **Compact**: `45%` (session usage)
- **Time Remaining**: `4h 30m` (time until the session resets)
- **Icon only**: icon only, no text (the stored value is still `minimal`)

With no active session window, the session slot in the title is `—`.

### Gauge
Each quota is a single meter. The fill is how much of the quota you have used. A tick on the same meter shows how far the current period has elapsed. A model row is the label, the meter, the percentage, and the level.

### Notifications
- A system notification the first time a quota crosses 70%, and again at 90% (once per level, remembered across restarts). This includes each model quota.
- When a session or weekly window resets, one notification if that window had reached 70% or more (`Session quota reset` / `Weekly quota reset`). The title is the message, with no app name in front.
- The same Alerts switch covers both. Nothing is sent while the last fetch failed or the cached numbers are stale.

### Auto-Updates
- Automatic check on startup, then about every 6 hours. A check is skipped while a download is in progress or an update is already downloaded.
- **Check for Updates** in Settings and in the menu bar menu. In Settings the check button is hidden while a download is in progress, while an update is available to download, and when an update is ready to install.
- Background download with a progress bar
- **Install & Restart** from Settings

## Requirements

- macOS 13.0 or later
- Claude Code installed, and signed in with `claude`

## Installation

### From DMG (Recommended)

1. Download the latest DMG from [Releases](https://github.com/TimothePorterie/claude-bar/releases):
   - **Apple Silicon (M1/M2/M3):** `Claude Bar-x.x.x-arm64.dmg`
   - **Intel:** `Claude Bar-x.x.x-x64.dmg`
2. Open the DMG and drag **Claude Bar** to your Applications folder
3. Launch Claude Bar from Applications

Release builds are signed and notarized. The Gatekeeper workaround below is only for an unsigned build you produced yourself.

### From Source

```bash
# Clone the repository
git clone https://github.com/TimothePorterie/claude-bar.git
cd claude-bar

# Install dependencies
npm install

# Run in development mode
npm run dev

# Or build the DMG
npm run dist
```

## Setup

1. Install [Claude Code](https://code.claude.com) and sign in:
   ```bash
   claude
   ```
2. Launch Claude Bar
3. If macOS asks for Keychain access to `Claude Code-credentials`, choose **Always Allow**

Claude Bar reads that item and does not refresh or replace it. If the token expires, run `claude` again so Claude Code can rotate it.

## Usage

| Action | Result |
|--------|--------|
| **Left-click** on menu bar icon | Opens or closes the quota popup |
| **Right-click** on menu bar icon | Context menu (Refresh, Display Mode, Settings, Check for Updates, Quit) |
| **Refresh** (popup button, ⌘R, or menu) | Fetches quota data, at most once every 15 seconds |
| **Esc** | Closes the popup |
| **⌘,** | Opens Settings |
| **⌘Q** or **Quit** in the popup footer | Quits Claude Bar |
| **Launch Claude Bar again** | Opens Settings (the app is already running) |

### Menu Bar Display

In the standard display mode the menu bar shows two percentages:
- **First number**: Session quota (5-hour window). `—` when there is no active session.
- **Second number**: Weekly quota (7-day window)

The icon is dimmed when the cached numbers are stale, or when the last fetch failed for a reason other than a rate limit that still has data to show. Other formats are listed under Display Modes.

### Quota Levels

| Usage | Meaning |
|-------|---------|
| Below 70% | Normal |
| 70% or more | High |
| 90% or more | Critical |

Thresholds are fixed.

### Settings

Access settings via right-click → Settings, or ⌘, from the popup. The window is grouped into Account, General, and Updates:

- **Account**: connected or not, from the Keychain. Email or name, and the plan when present. A hint to run `claude`. **Refresh** re-reads that status.
- **Language**: English or French
- **Refresh every**: 5, 10, or 15 minutes
- **Alerts**: System notifications at 70% and 90%, and the reset notification
- **Open at login**. If macOS still needs approval, a hint and a button open System Settings → General → Login Items.
- **Updates**: Check, download, and install with one click

## How It Works

Claude Bar reads Claude Code's session from the macOS Keychain and periodically calls:

```
GET https://api.anthropic.com/api/oauth/usage
```

It never calls a token endpoint. Claude Code owns refresh. No API keys or manual configuration required.

### Sleep and Wake

- The first quota fetch waits about 2 seconds after launch so the network can come up
- After the Mac wakes, monitoring restarts a couple of seconds later

### Token Management

| Source | Storage | Token refresh |
|--------|---------|---------------|
| **Claude Code (Keychain)** | macOS Keychain item `Claude Code-credentials`, read-only | By Claude Code (`claude`). Claude Bar never writes this item. |

A Claude Code account change (a different account id, or the email when there is no id) drops the cached quota during the fetch that sees the new account, then stores that account's numbers.

### Security

- **Context Isolation**: The renderer cannot access Node.js
- **Preload Bridge**: All IPC via a secure contextBridge
- **Keychain**: Claude Code credentials are read, never written. Claude Bar does not collect or store Claude.ai tokens.
- **Signed Updates**: Release builds are signed and notarized

## Development

```bash
# Install dependencies
npm install

# Start development server with hot reload
npm run dev

# Build for production
npm run build

# Create distributable DMG
npm run dist

# Build and publish release to GitHub (creates release, uploads DMGs + metadata)
npm run release
```

### Project Structure

```
claude-bar/
├── src/
│   ├── main/           # Electron main process
│   │   ├── services/   # Keychain, API, scheduler, notifications, updater
│   │   ├── tray.ts     # Menu bar title, tooltip, context menu
│   │   ├── tray-icon.ts # Template gauge bitmap
│   │   └── windows.ts  # Popup and Settings windows
│   ├── preload/        # Secure IPC bridge
│   └── renderer/       # Popup, Settings, shared tokens
├── tests/              # Vitest unit tests
├── assets/             # App icon and screenshot
└── scripts/            # App icon and screenshot generators, mac-dev.sh (run on the Mac)
```

### Running Tests

```bash
npm run test           # Run all tests
npm run test:watch     # Run tests in watch mode
npm run test:coverage  # Run tests with coverage report
```

## Troubleshooting

### "Claude Code is not connected"

Run `claude` in a terminal and sign in, then click **Retry** in the popup. If macOS asks for Keychain access, choose **Always Allow**.

### Quota not updating

Right-click the menu bar icon and choose **Refresh**. A manual refresh is ignored if the last one was less than 15 seconds ago. If it still fails, check the network connection.

### "Cannot open application" on an unsigned build

Official release DMGs are notarized. A DMG you built locally without signing can be blocked by Gatekeeper. In that case:

```bash
xattr -cr /Applications/Claude\ Bar.app
codesign --force --deep --sign - /Applications/Claude\ Bar.app
```

### App not starting

If the app fails to start, try removing it from Login Items and re-adding it through Settings. If macOS is waiting for approval, Settings shows a hint and a button that opens System Settings → General → Login Items.

## License

MIT License — see [LICENSE](LICENSE) for details.

## Acknowledgments

- Built with [Electron](https://www.electronjs.org/) and [electron-vite](https://electron-vite.org/)
- Inspired by the need to keep an eye on Claude Code usage without interrupting workflow

---

<p align="center">
  Made with ❤️ for Claude Code users
</p>
