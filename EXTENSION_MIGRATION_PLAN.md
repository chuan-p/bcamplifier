# Bandcamplifer WebExtension Migration Plan

This document turns the current userscript into a concrete migration checklist for Chrome and Firefox extensions.

It is based on the current code in [bcamplifier.user.js](./bcamplifier.user.js).

## Bottom Line

Porting this project to WebExtensions is feasible, but the cost is meaningful.

The good news:

- most of the Bandcamp-specific parsing and UI logic can be reused
- storage and network access can be abstracted cleanly
- the app already has a single-file architecture, so there is a clear extraction path

The expensive parts:

- replacing the Tampermonkey host APIs
- reworking helper flows that currently rely on page-context injection, hidden iframes, and `postMessage`
- testing `buy`, `wishlist`, playback, and multi-tab coordination on both Chrome and Firefox
- maintaining two browser targets plus extension packaging and store metadata

## Recommendation

Do not start with a full rewrite.

Use a staged migration:

1. Extract host-independent core logic from the userscript.
2. Introduce a small host adapter layer for request, storage, and page bridging.
3. Keep the userscript working as the reference implementation.
4. Add a WebExtension wrapper after the adapter boundary is stable.

This keeps the migration reversible and avoids turning a working script into a long-lived half-port.

## Current Architecture Snapshot

The current script is about 6.8k lines and mixes Bandcamp logic with userscript host behavior.

Key areas:

- initialization and feed-only bootstrapping: [bcamplifier.user.js](./bcamplifier.user.js#L833)
- global playback bridge and cross-tab coordination: [bcamplifier.user.js](./bcamplifier.user.js#L195), [bcamplifier.user.js](./bcamplifier.user.js#L387)
- shared audio and player shell: [bcamplifier.user.js](./bcamplifier.user.js#L257), [bcamplifier.user.js](./bcamplifier.user.js#L4914), [bcamplifier.user.js](./bcamplifier.user.js#L5491)
- DOM discovery and card enhancement: [bcamplifier.user.js](./bcamplifier.user.js#L1289), [bcamplifier.user.js](./bcamplifier.user.js#L2219)
- lazy fetch/render of release data: [bcamplifier.user.js](./bcamplifier.user.js#L2570)
- release parsing and normalization: [bcamplifier.user.js](./bcamplifier.user.js#L2804), [bcamplifier.user.js](./bcamplifier.user.js#L2861)
- track action helper messaging: [bcamplifier.user.js](./bcamplifier.user.js#L1111), [bcamplifier.user.js](./bcamplifier.user.js#L4054)
- buy-dialog and wishlist helper injection: [bcamplifier.user.js](./bcamplifier.user.js#L892), [bcamplifier.user.js](./bcamplifier.user.js#L950), [bcamplifier.user.js](./bcamplifier.user.js#L4102), [bcamplifier.user.js](./bcamplifier.user.js#L4133)
- userscript storage and network wrappers: [bcamplifier.user.js](./bcamplifier.user.js#L2725), [bcamplifier.user.js](./bcamplifier.user.js#L2754), [bcamplifier.user.js](./bcamplifier.user.js#L6458), [bcamplifier.user.js](./bcamplifier.user.js#L6470)

## Migration Cost By Area

### 1. Host API Replacement

Current userscript dependencies:

- `GM_xmlhttpRequest`
- `GM_getValue`
- `GM_setValue`

Migration target:

- `browser.storage.local` or `chrome.storage.local`
- content-script to background message passing for cross-origin requests, or extension-permitted `fetch`

Estimated cost:

- low to medium

Main work:

- create a `hostApi` abstraction
- replace direct GM calls with adapter-backed methods
- normalize promise behavior across Chrome and Firefox APIs

Risk:

- low

Notes:

- this is the easiest part of the migration and a good first milestone

### 2. Feed UI And Card Enhancement

This includes scanning feed cards, injecting new UI, replacing the `supported by` area, and rendering metadata and tracklists.

Relevant code:

- [bcamplifier.user.js](./bcamplifier.user.js#L1289)
- [bcamplifier.user.js](./bcamplifier.user.js#L2219)
- [bcamplifier.user.js](./bcamplifier.user.js#L2570)
- [bcamplifier.user.js](./bcamplifier.user.js#L6042)

Estimated cost:

- low to medium

Main work:

- convert current userscript entrypoint into a content script entrypoint
- preserve injected styles and DOM structure
- ensure Shadow DOM or style scoping decisions stay compatible with both browsers

Risk:

- medium

Why:

- this logic is reusable, but it is tightly coupled to page structure and should remain tested after the host change

### 3. Release Fetching And Caching

This includes fetching Bandcamp album and track pages, parsing HTML, normalizing data, caching, and refresh heuristics.

Relevant code:

- [bcamplifier.user.js](./bcamplifier.user.js#L2570)
- [bcamplifier.user.js](./bcamplifier.user.js#L2725)
- [bcamplifier.user.js](./bcamplifier.user.js#L2754)
- [bcamplifier.user.js](./bcamplifier.user.js#L2804)
- [bcamplifier.user.js](./bcamplifier.user.js#L2861)

Estimated cost:

- medium

Main work:

- move cross-origin requests behind extension permissions
- decide whether fetch should happen in the content script or background
- keep caching keys and schema stable to avoid behavioral drift

Risk:

- medium

Why:

- request permissions and cookie behavior need validation in both browsers

### 4. Wishlist And Buy Helper Flows

This is the most migration-sensitive area.

Today the script:

- loads track pages through helper URLs
- injects page-context scripts
- reads page state and Bandcamp globals
- posts results back to the parent page
- opens Bandcamp's own buy dialog in a new tab

Relevant code:

- [bcamplifier.user.js](./bcamplifier.user.js#L892)
- [bcamplifier.user.js](./bcamplifier.user.js#L950)
- [bcamplifier.user.js](./bcamplifier.user.js#L1111)
- [bcamplifier.user.js](./bcamplifier.user.js#L4054)
- [bcamplifier.user.js](./bcamplifier.user.js#L4102)
- [bcamplifier.user.js](./bcamplifier.user.js#L4133)

Estimated cost:

- high

Main work:

- re-implement page-context access as an explicit bridge between content script and injected page script
- validate whether hidden iframes remain viable in the extension model
- confirm user gesture requirements for opening tabs and dialogs
- re-test login state and same-origin assumptions on real Bandcamp pages

Risk:

- high

Why:

- these flows depend on Bandcamp internals, not just DOM selectors
- this is the area most likely to regress after the migration

### 5. Audio And Cross-Tab Coordination

This includes:

- shared audio ownership
- intercepting native Bandcamp playback
- pausing when another tab owns playback
- player shell synchronization
- media session integration

Relevant code:

- [bcamplifier.user.js](./bcamplifier.user.js#L195)
- [bcamplifier.user.js](./bcamplifier.user.js#L257)
- [bcamplifier.user.js](./bcamplifier.user.js#L387)
- [bcamplifier.user.js](./bcamplifier.user.js#L4712)
- [bcamplifier.user.js](./bcamplifier.user.js#L4914)
- [bcamplifier.user.js](./bcamplifier.user.js#L5307)

Estimated cost:

- medium to high

Main work:

- keep current storage-based ownership protocol or replace it with extension messaging
- verify audio autoplay and resume behavior in both browsers
- test native-player suppression carefully

Risk:

- medium to high

Why:

- audio and tab coordination are sensitive to small event-order changes

### 6. Packaging, Permissions, And Distribution

Extension-only work:

- `manifest.json`
- icons and store assets
- host permissions for `bandcamp.com` and `*.bandcamp.com`
- content script registration
- background/service worker setup if needed
- AMO and Chrome Web Store metadata and review notes

Estimated cost:

- medium

Risk:

- medium

Why:

- store packaging is not hard technically, but it adds release process overhead that does not exist in the current Greasy Fork workflow

## Estimated Effort

These are rough engineering estimates for one person already familiar with the codebase.

### Option A: Migration Spike

Goal:

- prove architecture
- replace GM storage and request APIs
- load the enhancer as a content script
- leave `wishlist` and `buy` disabled if needed

Estimated effort:

- 1 to 2 days

Output:

- a private/dev extension that enhances the feed but may not support every action

### Option B: Functional Beta

Goal:

- full feed enhancement
- working caching
- working shared player
- first-pass `wishlist` and `buy` support

Estimated effort:

- 4 to 7 days

Output:

- usable extension builds for Chrome and Firefox
- likely some rough edges in helper flows and multi-tab behavior

### Option C: Public-Ready Release

Goal:

- Chrome and Firefox builds
- reliable `wishlist` and `buy` behavior
- test pass on core feed flows
- release assets and store metadata

Estimated effort:

- 1.5 to 3 weeks

Output:

- publishable extensions
- repeatable release workflow

## Concrete Work Breakdown

### Phase 0: Prep

- create a new `src/` layout and stop treating the userscript file as the only source of truth
- identify host-specific code paths and wrap them in one adapter module
- preserve current userscript behavior while refactoring

Deliverable:

- a no-behavior-change refactor that still ships the userscript

### Phase 1: Host Adapter Extraction

- add `storage.get` and `storage.set`
- add `net.requestHtml` and `net.requestJson`
- add a `bridge` abstraction for page-script communication
- replace direct GM calls with adapter calls

Deliverable:

- the userscript still works, but the core no longer calls GM APIs directly

### Phase 2: Content Script Port

- create extension content script bootstrap
- load the core enhancer on matching Bandcamp pages
- move style injection and player mounting into extension-friendly entrypoints

Deliverable:

- extension can render feed enhancements locally

### Phase 3: Background Request Layer

- decide whether release fetches run in the content script or background
- add message passing where needed
- implement extension storage backend

Deliverable:

- release metadata fetch and cache work in the extension

### Phase 4: Action Bridge Rewrite

- replace helper iframe assumptions with an explicit page bridge
- keep a minimal injected page script only where Bandcamp globals or in-page functions are required
- revalidate `wishlist` and `buy` semantics

Deliverable:

- track actions work in extension mode

### Phase 5: Browser Compatibility Sweep

- test Chrome stable
- test Firefox stable
- patch browser API differences with a thin compatibility wrapper
- review manifest permissions and optional permissions

Deliverable:

- same feature set works in both browsers or documented fallbacks exist

### Phase 6: Release Packaging

- add extension manifests
- add icons and listing assets
- document install and debug workflow
- define versioning and release steps

Deliverable:

- installable packages and release checklist

## What Can Be Reused With Minimal Changes

- release parsing and normalization logic
- tracklist rendering
- card enhancement DOM logic
- merge logic for adjacent track purchase cards
- player UI rendering
- most of the CSS

These should be treated as the reusable core.

## What Will Probably Need Rework

- helper iframe workflow
- injected page-script bootstrapping
- cross-origin request plumbing
- storage coordination between tabs
- extension packaging and browser API wrappers

## Main Risks

### Risk 1: `wishlist` Stops Working Reliably

Cause:

- current logic reads Bandcamp page data and security crumbs from the live page context

Mitigation:

- isolate this flow behind one bridge module
- test on both album and track pages while logged in

### Risk 2: `buy` Flow Breaks On User Gesture Or Popup Rules

Cause:

- extension context changes how tabs and dialogs are opened

Mitigation:

- keep this action initiated directly from a user click
- prototype early before refactoring too much else

### Risk 3: Cross-Tab Playback Becomes Flaky

Cause:

- current ownership is storage-heartbeat based and sensitive to timing

Mitigation:

- preserve the current protocol first
- only replace it with runtime messaging if there is a demonstrated benefit

### Risk 4: Migration Bloats Into A Rewrite

Cause:

- current file is monolithic and it is tempting to redesign everything during the move

Mitigation:

- forbid aesthetic rewrites during extraction
- move code first, then improve structure after parity

## Suggested First Implementation Slice

If we actually start building this, the best first slice is:

1. Extract `storageGet`, `storageSet`, `requestHtml`, and `requestJson` into adapters.
2. Create a small extension that injects the existing enhancer as a content script.
3. Get metadata enrichment and tracklist rendering working.
4. Leave `wishlist` and `buy` behind a temporary feature flag until the bridge is rebuilt.

This gives the fastest proof that the port is viable without getting stuck in the hardest flows first.

## Decision Summary

If the goal is easier installation and broader distribution, the migration is worth considering.

If the goal is raw speed or Bandcamp DOM stability, the migration alone will not deliver much.

The real cost is not the parser or UI. The real cost is rebuilding the host boundary around a script that currently relies on Tampermonkey plus Bandcamp page internals.
