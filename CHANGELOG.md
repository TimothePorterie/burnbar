# Changelog

All notable changes to this project are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

Planned as 2.0.0.

### Changed

- **BREAKING:** Claude Bar is now **BurnBar**: new name, icon, menu bar gauge, and repository (`TimothePorterie/burnbar`). The bundle identifier stays `com.claude-bar.app`, so updates and macOS permissions carry over. On first launch BurnBar copies Claude Bar's settings.
- **BREAKING:** The in-app Claude.ai login and the App / CLI source switch are removed. Claude Code must be installed and signed in (`claude`); BurnBar reads its Keychain item read-only and never refreshes or writes it. Leftover login data is deleted once. [Anthropic's terms](https://code.claude.com/docs/en/legal-and-compliance) do not allow third-party apps to offer Claude.ai login or store Claude.ai tokens.
- The menu bar icon is a template gauge (thick bar: session, thin bar: weekly), dimmed when data is stale or a refresh failed, instead of the warning and critical icons and the `⚠` title prefix. The title uses monospaced digits.
- Settings are grouped into Account, Providers, General, and Updates.
- Adaptive refresh: scheduled refreshes pause while the Mac is idle or locked until the data is 30 minutes old, then resume on unlock, on return to the session, and when the popup opens.
- Errors say what happened and what to do, show the next automatic retry, and follow a language change.

### Added

- **Codex**: session and weekly quotas, plan, available limit resets, and "usage limit reached", read from the official `codex app-server`. Same forecast, levels, and notifications as Claude Code.
- **Grok** and **OpenCode**: spend and tokens for today and the last 7 days, from their official CLIs. No quota is shown: neither tool exposes one.
- Providers: first launch turns on the installed tools; one switch per tool in Settings with its status; **Menu bar shows** Claude, Codex, or the highest of the two. Collapsible popup sections.
- CLI lookup in the login shell's `PATH`, Homebrew, `~/.local/bin`, Bun, Volta, and nvm, for an app opened from the Finder.
- Forecast on the session and weekly cards: pace badge (High pace, On track, Comfortable headroom), absolute reset time, and "Runs out around …" when the current rate reaches 100% before the reset.
- Per-model weekly quotas (Opus, Sonnet, Haiku, Fable) when the API reports them.
- Notifications when a session or weekly window resets after reaching 70%.
- Extra-usage notifications: when billing beyond the plan starts, then at 50% and 90% of the monthly limit.
- Anthropic status: a popup banner and tooltip line for incidents affecting Claude Code, the Claude API, or claude.ai.
- **Show remaining**: percentages as "58% left" in the menu bar, tooltip, and popup.
- Appearance setting: Auto, Light, or Dark.
- Popup shortcuts (Esc, ⌘R, ⌘,, ⌘Q) and a Quit button.
- A hint and a button when macOS needs approval for Open at login.
- High-contrast and reduced-transparency styles.

### Fixed

- Keychain reads time out and report a missing, unreadable, or denied item separately; a denied read retries with backoff.
- Expired windows show 0% until the next fetch, utilization is clamped to 0–100%, a clock set back no longer blocks refreshes, and a corrupt cache is not restored.
- Settings no longer shows "Connected" while the session is unusable, and the popup no longer stays on "Loading…".
- A Claude Code account change drops the previous account's data and notification state.

## [1.8.0] - 2026-10-28

### Changed

- Redesigned popup and settings with native vibrancy, shared light and dark tokens, one meter per quota with an elapsed-time marker, and text levels next to colors.
- Electron 45. macOS 13 or later is now required.
- Release builds use electron-builder's built-in notarization.

### Fixed

- Account switching, stale data, and error handling: cached data is flagged when outdated, errors stay visible over cached data, and late responses for a previous account are dropped.
- Language changes apply to the menu bar right away.

[Unreleased]: https://github.com/TimothePorterie/burnbar/compare/v1.8.0...HEAD
[1.8.0]: https://github.com/TimothePorterie/burnbar/releases/tag/v1.8.0
