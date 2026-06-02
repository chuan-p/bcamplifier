# Changelog

## 0.1.186 - 2026-06-02

### Added

- Play the original featured track when clicking an album cover in the new releases collection grid.
- Treat collection-grid featured tracks as a sequential playlist when Continuous mode is enabled.
- Add a dedicated `dist/chrome-unpacked` build target for local Chrome testing.

### Improved

- Start collection-grid playback immediately from Bandcamp feed preview data instead of fetching and parsing the full release page first.
- Cache feed preview lookups and normalized card playback data for faster repeated navigation.
- Keep collection-grid cover play and pause states synchronized with the shared player without injecting tracklists into the compact grid UI.
- Fall back to release-page metadata when feed preview data is unavailable or a preview stream token has expired.

### Fixed

- Refresh Previous and Next button availability immediately when Continuous mode changes.
- Avoid uncaught extension-context errors when an unpacked extension is reloaded while an older feed tab is still open.
