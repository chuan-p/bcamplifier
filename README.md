# Bandcamplifer

Bandcamplifer is a Tampermonkey userscript and browser extension that turns the Bandcamp fan feed into something much more usable: better release context, inline tracklists, feed playback, wishlist actions, and lighter purchase shortcuts.

## What It Does

- Enriches feed cards with release metadata loaded from linked album or track pages.
- Replaces the `supported by` column with a readable tracklist on compatible cards.
- Lets you play tracks from the feed and keeps a custom bottom player in sync.
- Adds per-track `wish` actions in the inline tracklist.
- Opens Bandcamp's native buy dialog for a track from the feed.
- Merges adjacent duplicate `bought a track` cards for the same fan and release.

## Public Release

The Greasy Fork upload target is:

- [bcamplifier.user.js](/Users/chuanpeng/Documents/bcamplifier/bcamplifier.user.js)

The main script is now release-oriented:

- it no longer points to a local `127.0.0.1` `@updateURL`
- it keeps the full `@match` scope needed for helper flows on real Bandcamp release pages
- it preserves `buy` support

Why the broad `@match` is still needed:

- the feed UI runs on `bandcamp.com`
- track and album pages run on `*.bandcamp.com`
- `wishlist` and `buy` helpers need to execute on the real release page context, not only on the feed page

## Permissions And Behavior

This script uses:

- `GM_xmlhttpRequest`
- `GM_getValue`
- `GM_setValue`

And it will:

- fetch release HTML from Bandcamp pages to parse metadata
- cache parsed release data locally
- create hidden helper iframes for some authenticated per-track actions
- open a new Bandcamp tab for `buy`, then auto-open the native purchase dialog there

It can change Bandcamp account state when you use these controls:

- per-track `wish`
- bottom-player wishlist button

It does not auto-buy anything. The `buy` shortcut opens Bandcamp's own purchase UI and leaves final confirmation to the user.

## Install

1. Install Tampermonkey.
2. Install [bcamplifier.user.js](/Users/chuanpeng/Documents/bcamplifier/bcamplifier.user.js).
3. Open Bandcamp while logged in.
4. Visit your fan feed.

## Local Development

Use the dev loader for local work:

- [bcamplifier.dev.user.js](/Users/chuanpeng/Documents/bcamplifier/bcamplifier.dev.user.js)

Start a local server from this directory:

```sh
python3 -m http.server 8000 --bind 127.0.0.1
```

Then install the dev loader in Tampermonkey. It will `@require` your local working copy.

The dev loader now:

- has its own local `@updateURL` and `@downloadURL`
- points `@require` at `http://127.0.0.1:8000/bcamplifier.user.js`
- matches the same Bandcamp page scope as the main script, so helper flows like `wish` and `buy` still work during development

Recommended workflow:

- keep `bcamplifier.user.js` as the release-style script
- use `bcamplifier.dev.user.js` during active development
- bump `@version` in `bcamplifier.user.js` whenever you want Tampermonkey to see a new build

## Experimental Extension Mode

This branch also includes a dual-target WebExtension scaffold for Chrome and Firefox:

- [manifest.chrome.json](/Users/chuanpeng/Documents/bcamplifier/manifest.chrome.json)
- [manifest.firefox.json](/Users/chuanpeng/Documents/bcamplifier/manifest.firefox.json)
- [extension.content.js](/Users/chuanpeng/Documents/bcamplifier/extension.content.js)
- [extension.background.js](/Users/chuanpeng/Documents/bcamplifier/extension.background.js)
- [scripts/build-extension.sh](/Users/chuanpeng/Documents/bcamplifier/scripts/build-extension.sh)

Current intent:

- keep `bcamplifier.user.js` as the shared core entrypoint
- let `extension.content.js` provide storage and network adapters
- let `extension.background.js` handle extension-permission fetches

Build the browser-specific extension directories first:

```sh
./scripts/build-extension.sh
```

Release prep notes for the extension targets:

- [EXTENSION_RELEASE.md](/Users/chuanpeng/Documents/bcamplifier/EXTENSION_RELEASE.md)

Quick start:

- Chrome: open `chrome://extensions`, enable Developer mode, click Load unpacked, and select `dist/chrome`
- Firefox: open `about:debugging#/runtime/this-firefox`, click Load Temporary Add-on, and select [dist/firefox/manifest.json](/Users/chuanpeng/Documents/bcamplifier/dist/firefox/manifest.json)

Current status of the scaffold:

- the Chrome and Firefox manifests validate
- the core script can run with extension-provided storage and request adapters
- Chrome unpacked loading has been smoke-tested without manifest errors
- full logged-in Bandcamp interaction still needs in-browser manual verification
- the package build now emits storefront-ready archives for both targets

Browser-target specifics:

- Chrome build uses a Manifest V3 background service worker
- Firefox build uses a Manifest V3 background script for better current compatibility

Validation helpers:

- `./scripts/smoke-test-extension.sh` checks that the Chrome build loads without manifest-level errors
- `./scripts/test-feed-fixture.sh` serves a local feed fixture and verifies that the shared core injects and renders enhancement UI

## Configuration

Edit the `CONFIG` object near the top of [bcamplifier.user.js](/Users/chuanpeng/Documents/bcamplifier/bcamplifier.user.js):

- `autoFetchOnVisible`
- `expandAfterAutoFetch`
- `cacheTtlMs`
- `maxTracks`
- `maxDescriptionLength`
- `autoExpandTracks`
- `enableTrackRowActions`

## Known Tradeoffs

- The script relies on Bandcamp's current DOM and helper flows.
- `buy` support depends on Bandcamp's native track page purchase dialog continuing to exist in roughly the same shape.
- Some helper features require the broader `@match` scope and will not work if the script is limited to feed URLs only.
- If Bandcamp changes feed or release markup, selectors may need maintenance.

## Publishing Notes

Before uploading to Greasy Fork, review:

- [GREASYFORK_RELEASE.md](/Users/chuanpeng/Documents/bcamplifier/GREASYFORK_RELEASE.md)

Before submitting the extension builds, review:

- [EXTENSION_RELEASE.md](/Users/chuanpeng/Documents/bcamplifier/EXTENSION_RELEASE.md)

## License

MIT. See [LICENSE](/Users/chuanpeng/Documents/bcamplifier/LICENSE).
