# Extension Release Guide

This document is the release checklist and submission prep for the WebExtension builds of BC Amplifier.

## Current Artifacts

Build both storefront packages with:

```sh
./scripts/build-extension.sh
```

This produces:

- `dist/bcamplifier-chrome.zip`
- `dist/bcamplifier-firefox.xpi`

Basic manifest smoke test:

```sh
./scripts/smoke-test-extension.sh
```

Scope check:

```sh
./scripts/check-extension-scope.sh
```

Chrome review notes:

- `CHROME_REVIEW_NOTES.md`

## Chrome Best Practices Alignment

- `Manifest V3`: Chrome build uses an MV3 service worker
- `minimum permissions`: only `storage` plus Bandcamp host access required for the feature
- `single purpose`: focused on improving the Bandcamp fan feed, not general browsing
- `narrowed injection scope`: content scripts are limited to Bandcamp feed, album, and track pages
- `secure network handling`: extension background fetches now reject non-HTTPS or non-Bandcamp URLs and only allow `GET` or `POST`
- `privacy disclosure`: no developer backend, no analytics, no ad tech, user-triggered account actions only
- `testing`: keep both smoke and fixture checks in the release path, then do a logged-in Bandcamp manual pass
- `configuration guardrail`: `check-extension-scope.sh` locks content-script injection to feed, album, and track pages

## Store Readiness Checklist

1. Confirm the icon set is current:
   - source: `assets/icon-source/icon-master.png`
   - exported: `assets/icons/icon-16.png`, `icon-32.png`, `icon-48.png`, `icon-128.png`, `icon-1024.png`
2. Rebuild packages with `./scripts/build-extension.sh`
3. Run `./scripts/smoke-test-extension.sh`
4. Manually test while logged into Bandcamp:
   - feed metadata enrichment
   - inline track playback
   - merged duplicate purchase cards
   - wishlist action
   - buy shortcut opening Bandcamp's native dialog
5. Verify manifest version matches the release you want to ship
6. Prepare at least one storefront screenshot
7. Decide whether to keep a manual Firefox add-on ID or let AMO assign one during submission

## Screenshot Assets

Use the real Bandcamp capture assets in:

- `assets/store/store-screenshot-real-02.png`
- `assets/store/store-screenshot-real-02-cropped.png`
- `assets/store/store-screenshot-real-01.png`
- `assets/store/store-screenshot-real-01-cropped.png`

Notes:

- `store-screenshot-real-02.png` is the current preferred storefront screenshot because it clearly shows both the enhanced feed card and the persistent player
- `store-screenshot-real-02-cropped.png` is only a backup variant; use it only if a storefront field or layout makes the original image awkward
- `store-screenshot-real-01.png` is the untouched full-page capture
- `store-screenshot-real-01-cropped.png` is a backup crop from the earlier capture
- do not use fixture or local test screenshots for storefront submission

## Draft Listing Copy

Name:

- `Bandcamp Feed Enhancer`

Short summary:

- `Adds release context, playback controls, and wishlist shortcuts to the Bandcamp fan feed.`

Long description:

`Bandcamp Feed Enhancer improves the Bandcamp fan feed with richer release metadata, inline tracklists, playback controls, wishlist shortcuts, and quicker access to Bandcamp's native purchase flow. It is designed for people who spend time browsing their feed and want more context without opening every release in a new tab.`

Highlights:

- `Loads release metadata directly into feed cards`
- `Shows readable inline tracklists on compatible posts`
- `Lets you play tracks from the feed with a persistent player`
- `Adds quick wishlist actions`
- `Opens Bandcamp's native buy dialog when you choose to purchase`

## Permission Justification

`storage`

- Saves local preferences and cached release metadata so the extension can avoid refetching the same information.

Host permissions:

- `https://bandcamp.com/*`
- `https://*.bandcamp.com/*`

Why they are needed:

- The feed lives on `bandcamp.com`
- Release, track, and purchase flows live on `*.bandcamp.com`
- Wishlist and buy helpers need access to the real Bandcamp release-page context
- `all_frames` is intentional because user-initiated helper actions can run inside Bandcamp iframes

## Privacy And Behavior Notes

Suggested storefront disclosure:

`The extension fetches Bandcamp release pages to extract metadata and stores cached results locally. It does not sell data or send user data to a separate backend. Wishlist actions and purchase shortcuts only run when the user clicks them. Purchases are completed through Bandcamp's own interface.`

Suggested data practices answers:

- Data collection: `No external data collection beyond requests to Bandcamp needed for the feature`
- Data sale: `No`
- Authentication data use: `Only within the user's own Bandcamp session in the browser`
- Remote backend: `None`

Suggested reviewer note:

`The extension has a single purpose: improve the Bandcamp fan feed. It only runs on Bandcamp domains. Host access is required because the feed lives on bandcamp.com while release pages and helper flows live on artist subdomains. Background requests are limited to HTTPS Bandcamp URLs, and account-affecting actions only run after explicit user clicks.`

## Remaining Decisions

- Firefox add-on ID:
  - current manifest value is `{6c7370e1-e763-4806-8659-3cc872a45ac4}`
  - a GUID is being used intentionally to avoid naming collisions and domain-ownership assumptions
- Support URL:
  - add a public support page or repository URL if you want storefront users to have a support destination
- Screenshots:
  - use `assets/store/store-screenshot-real-02.png` as the default listing screenshot
- Privacy policy:
  - use `PRIVACY_POLICY.md` as the draft source text for the listing form or hosted policy page

## Firefox Manifest Notes

The Firefox manifest now assumes AMO submission against Firefox `140.0+` and uses the built-in data-collection disclosure path.

Current `browser_specific_settings.gecko` values:

- `id`: `{6c7370e1-e763-4806-8659-3cc872a45ac4}`
- `strict_min_version`: `140.0`
- `data_collection_permissions.required`:
  - `authenticationInfo`
  - `websiteContent`

Why these were chosen:

- `authenticationInfo` because extension requests to Bandcamp use the signed-in browser session when needed
- `websiteContent` because the extension fetches Bandcamp release pages and processes their page content to extract metadata
