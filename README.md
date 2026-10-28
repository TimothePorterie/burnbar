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
     one meter per quota with an elapsed-time tick, and High/Critical text labels.
     It does not show trend arrows, a statistics block, a separate reset bar, or pause.
     Leave this file in place until a new capture is taken on a Mac. -->
<p align="center">
  <img src="assets/screenshot.png" alt="Claude Bar Screenshot" width="400">
</p>

---

## Features

### Core
- **In-App Login** — Log in directly from Claude Bar with OAuth (no CLI needed)
- **Menu Bar Display** — Shows your current quota usage right in the menu bar
- **Detailed Popup** — Session (5h) and weekly (7d) quotas, plus an Opus weekly quota and overage when your plan reports them
- **Levels** — Under 70% is normal. From 70% the popup says **High**; from 90% it says **Critical**. The menu bar icon changes with the same thresholds. These levels are not configurable.
- **Auto Refresh** — 5, 10, or 15 minutes
- **Visual Feedback** — The refresh button spins while loading. If a refresh is throttled, a toast overlays the popup
- **Tooltips** — Hover the menu bar icon for each quota, the time until it resets, and when the numbers were last updated
- **Dark Mode** — Follows the macOS appearance
- **Lightweight** — Runs quietly in the background with minimal resource usage
- **Native Feel** — Uses macOS vibrancy effects for a native look
- **Languages** — English and French

### Display Modes
Choose your preferred menu bar format (right-click → Display Mode):
- **Standard**: `45% / 32%`
- **Detailed**: `5h: 45% | 7d: 32%` (adds `| Opus: 10%` when that quota exists)
- **Compact**: `45%` (session usage)
- **Time Remaining**: `4h 30m` (time until the session resets)
- **Minimal**: Icon only, no text

### Gauge
Each quota is a single meter. The fill is how much of the quota you have used. A tick on the same meter shows how far the current period has elapsed.

### Notifications
- A system notification the first time a quota crosses 70%, and again at 90% (once per level, remembered across restarts)
- Toggle on/off in Settings. The label states the fixed 70% and 90% levels.

### Auto-Updates
- Automatic check on startup, then about every 6 hours
- **Check for Updates** in Settings and in the menu bar menu (hidden while a download is in progress and when an update is ready to install)
- Background download with a progress bar
- **Install & Restart** from Settings

## Requirements

- macOS 13.0 or later
- A Claude Pro or Max subscription

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

### Option 1: Log in from Claude Bar (Recommended)

1. Launch Claude Bar
2. Click the menu bar icon — the popup shows a **Log In** button
3. Click **Log In** — your browser opens to authenticate with Claude
4. Copy the authorization code and paste it back in Settings
5. Done! Claude Bar starts monitoring your quotas

### Option 2: Use Claude Code CLI credentials

If you already use Claude Code CLI, Claude Bar can read your existing credentials:

1. Make sure you're logged in via the CLI:
   ```bash
   claude
   ```
2. In Claude Bar, go to **Settings → Account → Source** and select **CLI**
3. Claude Bar reads the CLI credentials from the macOS Keychain. It does not refresh or replace them. If the token expires, run `claude` again so Claude Code can rotate it.

## Usage

| Action | Result |
|--------|--------|
| **Left-click** on menu bar icon | Opens or closes the quota popup |
| **Right-click** on menu bar icon | Context menu (Refresh, Display Mode, Settings, Check for Updates, Quit) |
| **Refresh** (popup button or menu) | Fetches quota data, at most once every 15 seconds |

### Menu Bar Display

In the standard display mode the menu bar shows two percentages:
- **First number**: Session quota (5-hour window)
- **Second number**: Weekly quota (7-day window)

Other formats are listed under Display Modes.

### Quota Levels

| Usage | Meaning |
|-------|---------|
| Below 70% | Normal |
| 70% or more | High |
| 90% or more | Critical |

Thresholds are fixed.

### Settings

Access settings via right-click → Settings. The window is grouped into Account, General, and Updates:

- **Source**: Claude Bar (OAuth) or CLI (Keychain). Only the selected source is used.
- **Language**: English or French
- **Refresh every**: 5, 10, or 15 minutes
- **Alerts**: System notifications at 70% and 90%
- **Open at login**
- **Updates**: Check, download, and install with one click

## How It Works

Claude Bar authenticates via OAuth with the Anthropic API. You can log in from the app (tokens encrypted via macOS `safeStorage`) or reuse Claude Code CLI credentials from the macOS Keychain. It periodically calls:

```
GET https://api.anthropic.com/api/oauth/usage
```

No API keys or manual configuration required.

### Sleep and Wake

- The first quota fetch waits about 2 seconds after launch so the network can come up
- After the Mac wakes, monitoring restarts a couple of seconds later

### Token Management

| Source | Storage | Token refresh |
|--------|---------|---------------|
| **Claude Bar (OAuth)** | Encrypted via `safeStorage` | Automatic |
| **CLI (Keychain)** | macOS Keychain, read-only | By Claude Code (`claude`). Claude Bar never writes this item. |

Switching source, logging in, or logging out clears the cached quota and fetches again.

### Security

- **Context Isolation**: The renderer cannot access Node.js
- **Preload Bridge**: All IPC via a secure contextBridge
- **Encrypted Token Storage**: In-app tokens encrypted via macOS `safeStorage`
- **Keychain**: CLI credentials are read, never written
- **PKCE OAuth Flow**: Authorization code flow with a code challenge
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
│   │   ├── services/   # Auth, Keychain, API, Scheduler, Notifications, Updater
│   │   ├── tray.ts     # Menu bar icon
│   │   └── windows.ts  # Popup and Settings windows
│   ├── preload/        # Secure IPC bridge
│   └── renderer/       # Popup, Settings, shared tokens
├── tests/              # Vitest unit tests
├── assets/             # Icons
└── scripts/            # Icon generation scripts
```

### Running Tests

```bash
npm run test           # Run all tests
npm run test:watch     # Run tests in watch mode
npm run test:coverage  # Run tests with coverage report
```

## Troubleshooting

### "Not Connected" message

Click **Log In** in the popup or Settings. Or authenticate with Claude Code (`claude`) and select **CLI** as the source in Settings.

### Quota not updating

Right-click the menu bar icon and choose **Refresh**. A manual refresh is ignored if the last one was less than 15 seconds ago. If it still fails, check the network connection.

### "Cannot open application" on an unsigned build

Official release DMGs are notarized. A DMG you built locally without signing can be blocked by Gatekeeper. In that case:

```bash
xattr -cr /Applications/Claude\ Bar.app
codesign --force --deep --sign - /Applications/Claude\ Bar.app
```

### App not starting

If the app fails to start, try removing it from Login Items and re-adding it through Settings.

## License

MIT License — see [LICENSE](LICENSE) for details.

## Acknowledgments

- Built with [Electron](https://www.electronjs.org/) and [electron-vite](https://electron-vite.org/)
- Inspired by the need to keep an eye on Claude Code usage without interrupting workflow

---

<p align="center">
  Made with ❤️ for Claude Code users
</p>
