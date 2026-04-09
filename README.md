# BC Amplifier

BC Amplifier is a Tampermonkey userscript that turns the Bandcamp fan feed into something much more usable: better release context, inline tracklists, feed playback, wishlist actions, and lighter purchase shortcuts.

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

Recommended workflow:

- keep `bcamplifier.user.js` as the release-style script
- use `bcamplifier.dev.user.js` during active development
- bump `@version` in `bcamplifier.user.js` whenever you want Tampermonkey to see a new build

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
