# Chrome Review Notes

This file is written for Chrome Web Store reviewers and for release prep.

## Single Purpose

Bandcamplifier has one purpose: improve the Bandcamp fan feed with richer release context and faster Bandcamp-native actions. It only runs on Bandcamp pages needed for that workflow.

## Permissions

Required permission:

- `storage`
  - saves local settings and cached release metadata in the browser

Host permissions:

- `https://bandcamp.com/*`
- `https://*.bandcamp.com/*`

Why host access is needed:

- the feed UI lives on `bandcamp.com`
- Bandcamp release and track pages live on `*.bandcamp.com`
- user-initiated wishlist and buy helpers run inside real Bandcamp release-page contexts
- content-script injection is limited to feed, album, and track pages rather than every Bandcamp page
- Bandcamp label custom domains are intentionally not enhanced so the extension can stay limited to Bandcamp-owned hosts

## Security Notes

- Manifest version is `3`
- extension pages use a background service worker
- extension network requests are limited to HTTPS Bandcamp URLs
- the background fetch bridge only accepts `GET` and `POST`
- only `Accept` and `Content-Type` headers are forwarded
- there is no developer-owned backend, analytics SDK, or advertising tracker

## Data Handling

- release metadata is fetched from Bandcamp pages
- settings and cached metadata are stored locally with `chrome.storage.local`
- wishlist and purchase-related flows only run after explicit user clicks
- purchases are completed through Bandcamp's own interface

## Reviewer Test Flow

1. Sign in to a Bandcamp account in Chrome.
2. Open `https://bandcamp.com/feed`.
3. Confirm feed cards gain extra metadata such as release date, location, or tracklist details.
4. Play a track from the feed and confirm the bottom player appears and stays in sync while browsing.
5. Click a wishlist control and confirm it only acts after the click.
6. Click a buy shortcut and confirm it opens Bandcamp's own purchase flow in a new tab or window.

## Paste-Ready Test Instructions

`Sign in to Bandcamp, open https://bandcamp.com/feed, and wait for feed cards to gain extra release metadata such as dates, locations, and track details. Play a track from the feed to confirm the persistent bottom player appears and stays in sync while browsing. Click a wishlist control to verify that account-affecting actions only occur after an explicit user click. Click a buy shortcut to verify that the extension opens Bandcamp's own purchase flow in a new tab or window. The extension only injects on Bandcamp feed, album, and track pages under bandcamp.com and *.bandcamp.com; background requests are limited to HTTPS Bandcamp URLs. Label custom-domain pages are intentionally not enhanced to keep permissions narrower.`

## Why `all_frames` Is Enabled

The extension injects into helper iframes opened on Bandcamp track or album pages so that user-initiated wishlist and buy flows can run in Bandcamp's own page context. It is not used to access unrelated sites.
