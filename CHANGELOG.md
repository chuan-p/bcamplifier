# Changelog

## 0.2.9 - 2026-06-23

### Improved

- Make the shared player title behave like a native selectable link while preserving click-to-scroll behavior.
- Reduce shared player DOM churn during playback updates.
- Keep artist/label feed scans local to the feed container and ignore Bandcamplifier's own UI mutations during page scanning.

### Fixed

- Preserve text selection in the shared player during playback events.

## 0.2.8 - 2026-06-11

### Added

- Respect user login session when scraping release pages (`credentials: "include"`) so that "You own this" is correctly detected for owned releases in artist page cards.
- "You own this" link detection on artist page custom cards using `CSS.escape` selector matching.
- Auto-fill minimum price setting (`autoFillMinimumPrice`) for the buy dialog.
- Feed card buy buttons now show price text (e.g. "buy now ($7)") from cached release data and intercept clicks to open the buy dialog.
- Release page buy button auto-fill: clicking any format's `.buyItem` fills the dialog's price input.
- Artist page detection now also matches `/audio` paths.

### Fixed

- Extension `requestHtml` now passes `credentials: "include"` instead of `"omit"` when fetching through the background script, fixing ownership detection for extension users.

## 0.2.7 - 2026-06-11

## 0.2.7 - 2026-06-11

### Added

- Allow `@connect *` so Tampermonkey users can fetch release data from arbitrary Bandcamp custom domains.

### Fixed

- Fix Firefox `permissions.request()` not responding to "Allow this domain" clicks by preserving the user gesture chain (remove redundant `contains` check before `request`).
- Fix `sendMessageToTab` rejecting in Firefox when `setupRuntimeMessageBridge` returns `undefined`; return `null` to signal the message was handled.

### Removed

- Remove dead embedded player (`/EmbeddedPlayer/v=2/...`) canonical-URL fallback path—the static HTML of the embedded player page never contains the metadata the code tried to extract (`#shareurl`, `data-player-data`, `og:url`), so this code path always ran a wasted HTTP request before failing.

## 0.2.6 - 2026-06-09

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
