# Changelog

## 3.3.4 - 2026-11-24

### Changed

- Rename the Chrome and Firefox extension listings to `Bandcamplifier: Feed & UI Enhancer for Bandcamp` to improve store search discoverability.
- Modularize feed, player, and tag-index internals and harden extension checks.

## 3.3.3 - 2026-11-04

### Performance

- Own-collection feed appends take an incremental path: only the new items are built and appended, instead of rebuilding the full candidate list, card maps and signature pass.
- Source-grid mutations record dirty items, so unchanged items reuse their cached release metadata and skip the per-item signature work.
- The owned-release link index is rebuilt only when an owned link changes, not on every scroll mutation.
- Tag indexing is bounded per page (80 tag requests and 20 collection-page requests) and resumes from its stored cursor; a tab focus no longer re-reads every tag record more than once every two minutes.

### Changed

- Remove compatibility code for the unreleased legacy formats: the `bcampx:releaseTags` blob and its migration, the pre-split tag-index status fallback, and the release-cache schema 18 to 19 migration. Caches now have one record-only tag format and no schema migration path.
- Remove unused `findNeighborPlayableRelease` and unused debug state, and simplify the shared feed-sync tail.
- Tag index persistence is event-driven (page walk completion, run completion and pagehide) instead of a five-second checkpoint timer.
- Account-scoped cache entries are only refreshed when they actually carry account state; an empty or corrupt entry still revalidates.

## 3.3.2 - 2026-11-03

### Fixed

- Fix the Firefox "Allow this domain" button doing nothing when clicked. The extension no longer copies the `browser` namespace into its own object (Firefox does not expose its APIs as own enumerable properties, so the copy could be empty) and the shared facade now always lists `runtime`, `storage`, `permissions`, and `tabs`. Without `tabs`, opening the host-permission page failed before any tab appeared, so the click had no visible effect.
- A feed visit no longer refetches every cached release when the page cannot name the signed-in fan (logged out, a cookie-restricted tab, or a page shape without the identity blob). The viewer check now only invalidates an entry that actually carries account fields; an unknown viewer still hides that entry's purchase state, but the card renders from cache immediately and recovers "you own this" with one background refresh instead of blocking on a request per card on every visit.
- An account-scoped cache entry whose viewer key is missing (a response that could not name its viewer) is now stripped and refreshed instead of being trusted. Previously an anonymous visit could inherit `You own this` or a download link written by a signed-in visit. A missing viewer on either side is treated as unconfirmed, not as a match.
- A release that was cached before it was hidden is now marked unavailable when the page or its background refresh answers `404`/`410`. The cached fallback resolves without throwing, so the card used to keep its stale metadata and dead release links until the cache expired.
- Clicking a release link in a collection no longer re-downloads a page that was already checked. Navigation waits only for a check that is already running, or for the one check a never-loaded card (own collection track cards skip the automatic load) still needs; the wait is bounded, and a second click can no longer slip through to the page while the check is pending.
- On a card marked unavailable, only links into the missing release page are disabled. Artist, download and other links in the card stay usable.

### Performance

- A cached release is refreshed only when its tracklist, supporter count, description format or account fields require it. An entry with no account state also stops refetching just because the page names a different or unknown viewer, and an empty/corrupt cache entry still revalidates. Cached cards render from the stored snapshot while a background refresh runs.
- Large collection/artist feeds reuse the release metadata they already parsed, update only cards whose source changed, and append new cards instead of replacing the whole list. The source-grid observer now records dirty items: a scroll append recomputes only the new items, and own-collection appends take an incremental path that skips the all-item maps and signature pass. After the first build only appended cards are measured for auto-fetch; a full-document scan skips generated feed cards in the native purchase-merge heuristics. Artwork is lazy-loaded, and `content-visibility` now covers every feed card, not just tag results.
- The owned-release link index is rebuilt only when an owned link is added, removed or has its `href` changed, instead of on every mutation version (i.e. every scroll batch).
- Tag indexing is bounded per page instead of per background batch: 80 tag requests and 20 collection-page requests per visit, with the search refresh throttled. A tab focus no longer re-reads every tag record more than once every two minutes.
- The release cache index is repaired once per cache schema instead of every six hours, and extension prefix reads use `storage.local.getKeys()` to fetch only matching values instead of cloning the whole local storage.
- Player next/previous uses a cached collection card list (and now works for list-style collections); full-discography checks are memoized per mutation version, and a pointer gesture only starts collection playback on a tap instead of on every scroll-start.

## 3.3.1 - 2026-11-01

This is the consolidated release of the recent tag-search and tracklist work.

### Tag search

- Collection and wishlist search also matches release tags. It is off by default; enable "Tag search" in the player settings menu.
- Tag matches are added to the enhanced list only. The native grid keeps Bandcamp's own results and behavior.
- Tag matches are rendered 80 at a time with a "Show more" button, so a broad query does not build every result card at once.
- Tag result cards render from the tracklist already fetched while indexing instead of downloading each release page, so a broad query no longer opens dozens of full pages.
- Rebuilding the result list pauses the page mutation observer, so one broad search does not turn every card update into another page-wide scan.
- Off-screen tag cards are skipped by the browser's renderer (`content-visibility`), so a long result list does not style, lay out or paint cards outside the viewport.
- The Tag search setting is marked experimental and shows cache progress, for example `(201/952)` tagged releases.
- The index is built in the background at a modest, adaptive pace. It continues while the page stays open and on other Bandcamp pages; `429` responses pause it for 2-15 minutes, and the learned pace is remembered.
- Tags are cached per release, so multiple tabs no longer overwrite each other's cache.
- An index is only reported complete after its tags are verified; missing or expired entries are refilled.
- Collections up to 6,000 items are indexed.

### Tracklists

- Fixed the cause of the first result cards losing their tracklist: Bandcamp's own "no matches" notice was replacing a tag card's tracklist. The enhanced list now sits outside Bandcamp's results grid, so that update cannot touch it.
- The enhanced list is centered like the grid.
- A refresh that returns no tracks keeps the previous tracklist; releases whose page has no tracklist use the compact API.
- The feed does less repeated work, so long result lists stay responsive.

### Other

- Batchcamp's selection controls stay hidden while the enhanced list is shown, and work normally in the grid.

## 3.3 - 2026-10-30

### Added

- Let the collection and wishlist search box match release tags. Bandcamp's own `search_items` index only covers titles and artists, so the script keeps a local tag index instead: the fan's item list from `/api/fancollection/1/collection_items` joined with one compact `/api/mobile/24/tralbum_details` request per release, cached in storage and shared between collections.
- Append tag-only matches to the native search results, deduplicated and after the native cards.
- Show tag-only matches in the native grid view as well (removed in 3.3.12: tags are only added to the enhanced list now).

### Improved

- Share one native-item lookup map and one search-state resolution per feed sync instead of one DOM query per tag match, skip building candidate objects for releases that are already on the page, and do no tag-search DOM work at all while the search box is empty.
- Keep a single native-release builder for the feed and tag results instead of two copies, and drop unused diagnostics and index fields.
- Build the tag index silently in bounded background runs on your own collection page: one shared budget of 80 requests per visit, at most two in flight and at least 450 ms apart, collection and wishlist progressing together, resumable across visits and retried later when a request fails.
- Back off instead of retrying when Bandcamp answers `429`: the run stops, further index and card-tracklist requests are paused, and the cooldown persists across visits with exponential steps (5 minutes up to 6 hours) until a clean run clears it.
- Keep the parsed tag index in memory so typing in the search box does not re-read storage on every keystroke, and cache the normalized tags per release so repeat keystrokes skip re-normalizing them.
- Coalesce index checkpoints into one write every five seconds plus a flush on page hide, and stop rewriting an already complete index on every visit.
- Store the item list, the progress record and the tag cache separately: checkpoints rewrite only the small progress record, the tag cache is written at most every 30 seconds, and an unchanged grid never re-reads its item list. A compact status record lets a completed, fresh index skip the background run entirely (no item-list read, no tag requests).
- Reuse the tracklist that the tag-index request already returns, and otherwise start the mobile-API tracklist request in parallel with the release page fetch while sharing one in-flight promise between the feed card and the native block. The parallel prefetch only starts after a page parse has actually come back without a tracklist, so a working page parse costs no extra request.
- Recognize `#collection-search` and `#wishlist-search` inputs when restoring "search your collection" after a release-page handoff.

### Changed

- Split the 8.8k-line core into injected fragments: `src/features/player.js` (shared audio, playback routing, player shell, media session), `src/features/track-actions.js` (wishlist/buy helper frame and bridge) and the remaining core. All fragments still compile into one IIFE, so behavior is unchanged.
- Share the headless-Chrome and fixture-server boilerplate between the fixture tests in `scripts/lib/` (test scripts shrank by about 30%), and make `src/userscript.meta.js` the single source of truth for the version: packaged manifests are stamped at build time and `check-versions.sh` guards the rest.
- Add `check-unused-symbols.mjs` and per-file syntax checks to CI so dead helpers and broken fragments fail the build.
- Merge two exact duplicate helpers (the wishlist HTML request and the page-audio pause), and let Terser emit modern syntax with a second compression pass; the release bundle is about 1% smaller.
- Block external hosts in the headless fixture runs and serve card artwork locally, so tests no longer wait on real image requests (the fan-profile run went from 30-70 s to about 14 s).

### Fixed

- Derive cover art from the item art id when the page's item cache carries no art URL, and refresh stored index entries that were written before that fallback existed.
- Render tag matches that are already on the page from their native card, so the first page of a collection keeps its cover art, preview data, download links and tracklist.
- Reuse the existing card when Bandcamp's slower native search response returns the same purchase, and reuse tag-block cards across syncs, instead of replacing cards whose tracklists had already loaded.
- Keep an already rendered tracklist when a release refresh comes back empty or fails, and bump the release-cache schema so entries written by older builds are fetched again instead of rendering without tracks.
- Build the tracklist from the mobile release API when a release page yields none; that response also carries playable stream redirects, so the rows stay usable.
- Hide Bandcamp's own "There are no matches for ..." notice while tag results are shown; it used to sit directly under the tag cards and read like their tracklist.

## 3.2 - 2026-10-08

### Security

- Require an origin-bound handshake before the hidden release-page helper performs wishlist reads or writes. A crafted release URL with `bcampx-helper` hash parameters could previously toggle the visitor's wishlist with their cookies and read the result back from any page.

### Fixed

- Keep singles from your own collection as separate cards when Bandcamp's infinite loader mutates the source grid and the feed reconciles, not just during the initial build.
- Render release dates from date-only values in local time so users west of UTC no longer see the previous day, while full timestamps keep their own instant and impossible dates such as `2026-02-30` fall back to the raw text.
- Bound supporter-count pagination on the exact-count refresh path and stop trusting an empty page that still reports more results.
- Contain a feed-build failure so the player, card scanning, and observer setup still initialize for the rest of the page load, reset the building flag, and re-validate the source grid when a build throws.
- Send credentials when the userscript fetches release HTML through `GM_xmlhttpRequest`, matching the extension path.
- Attach the feed-card buy handler once per link instead of stacking a new listener on every re-render.
- Keep polling for Bandcamp's buy dialog while auto-filling the minimum price instead of giving up after the first probe.
- Persist pending host-permission requests across MV3 service-worker restarts and notify the requesting tab when the permission tab is closed.
- Prune expired and oldest-first release cache entries so local storage no longer grows without bound.
- Only poll for cross-tab pause requests when no push subscription is available, and only in the top frame.

### Changed

- Cap release-cache entries with `CONFIG.maxReleaseCacheEntries`, supporter refresh pagination with `CONFIG.maxSupporterRefreshPages`, and grant the userscript `GM_deleteValue`.
- Serve fixture tests from a temporary docroot instead of the repository root, and isolate the Chrome profile they use.
- Add `scripts/test-helper-auth-fixture.sh`, own-collection sync cases, a build-failure isolation fixture, and a release-date formatting unit test as regression coverage, run every fixture test in CI, and fail CI when the committed `bcamplifier.user.js` does not match a fresh build from `src/`.

## 3.1 - 2026-08-17

### Changed

- Keep singles in your own Bandcamp collection as standalone tracks instead of merging adjacent singles from the same album.
- Use native collection data for single-track previews and play them on demand without crawling release pages upfront.
- Minify the released userscript with Terser to shrink the distribution size.
- Bump version to 3.1.

### Fixed

- Never merge collection items on your own Bandcamp collection page. Single-track purchases reported as album tralbums share a release URL with their album neighbours, so merging them dropped every purchase's download link except the first one.

## 0.3.0 - 2026-06-25

### Added

- Add the enhanced release feed to Bandcamp fan collection and wishlist pages, including search results and delayed-loaded items.
- Reuse native collection downloads, wishlist state, preorder labels, preview tracks, and collection counts in enhanced cards.
- Add an optional collection-count setting with bounded, cached supporter pagination.

### Improved

- Preserve enhanced card state across collection, wishlist, followers, and following tab switches without rebuilding or rescanning clean grids.
- Render cached tracklists immediately while refreshing expiring Bandcamp preview URLs in the background.
- Make player title navigation restore the source fan tab and scroll to the exact track below Bandcamp's sticky tabs.
- Keep enhanced feeds centered and synchronized with Bandcamp search, list/grid switching, and infinite loading.

### Fixed

- Prevent native Bandcamp cards from being injected into or compressed between enhanced cards.
- Fix missing tracklists after list/grid switches and delayed wishlist or collection loading.
- Fix player wishlist actions on fan wishlist cards.
- Fix stale preview URLs causing `410 Gone` playback failures.
- Fix stuck supporter counts and refresh controls during tab switches or background requests.
- Fix fan search clearing, follower/following enhancement leakage, localized collection-count parsing, and repeated tab-switch work.

## 0.2.9 - 2026-06-23

### Improved

- Make the shared player title behave like a native selectable link while preserving click-to-scroll behavior.
- Reduce shared player DOM churn during playback updates.
- Keep artist/label feed scans local to the feed container and ignore Bandcamplifier's own UI mutations during page scanning.

### Fixed

- Preserve text selection in the shared player during playback events.
- Restore Space key activation for the shared player title link.

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
