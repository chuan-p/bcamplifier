# Greasy Fork Release Notes

This project is maintained in two modes:

- `bcamplifier.user.js`
  Public release target
- `bcamplifier.dev.user.js`
  Local development loader

## Release File

Upload this file:

- `/Users/chuanpeng/Documents/bcamplifier/bcamplifier.user.js`

Do not upload:

- `/Users/chuanpeng/Documents/bcamplifier/bcamplifier.dev.user.js`

## Why The Match Scope Is Broad

The script matches both feed pages and real Bandcamp release pages because:

- the feed itself lives on `bandcamp.com`
- release pages live on `*.bandcamp.com`
- authenticated helper flows such as per-track `wish`
- and native `buy` dialog launching

need to run in the actual release-page context

## What The Script Can Change

Only when the user clicks the relevant controls:

- per-track wishlist state
- player wishlist state

`buy` opens Bandcamp's own purchase flow in a new tab and does not auto-submit a purchase.

## Pre-Publish Checklist

1. Bump `@version`
2. Run:

```sh
node --check /Users/chuanpeng/Documents/bcamplifier/bcamplifier.user.js
```

3. Confirm there are no local-only metadata fields such as:
   - `@updateURL http://127.0.0.1...`
   - `@downloadURL http://127.0.0.1...`
4. Smoke-test:
   - feed metadata loading
   - bottom player
   - merged duplicate track-purchase cards
   - per-track `wish`
   - `buy` opening the native dialog in a new tab
5. Re-read the script description and README so the public behavior matches the public docs

## Recommended Public Description Themes

Keep the Greasy Fork description honest about:

- feed enhancement
- release metadata parsing
- playback
- wishlist shortcuts
- Bandcamp-native buy dialog launch

Avoid implying:

- automatic purchasing
- official Bandcamp integration
- long-term compatibility guarantees
