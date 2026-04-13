# Store Listing Draft

This file contains copy you can paste into Chrome Web Store and AMO listing forms.

## Name

`Bandcamplifer`

## Short Summary

`Adds release context, playback controls, and wishlist shortcuts to the Bandcamp fan feed.`

## Long Description

`Bandcamplifer improves the Bandcamp fan feed with richer release metadata, readable inline tracklists, persistent playback controls, wishlist shortcuts, and quicker access to Bandcamp's native purchase flow. It is built for people who browse their feed often and want more context without opening every release in a separate tab.`

`The extension loads release information directly into feed cards, keeps a player visible while you browse, and makes common actions easier to reach. It stays focused on the Bandcamp experience rather than replacing it.`

Single purpose:

- `Improve the Bandcamp fan feed with richer release context and faster Bandcamp-native actions.`
- `The extension only runs on Bandcamp feed, album, and track pages required for feed enhancement and user-initiated helper flows.`

Features:

- `Loads release metadata directly into feed cards`
- `Shows inline tracklists on compatible posts`
- `Keeps playback controls visible with a persistent bottom player`
- `Adds quick wishlist actions`
- `Opens Bandcamp's native buy dialog when you choose to purchase`

## Permission Justification

`storage`

- Stores local settings and cached metadata so the extension can avoid refetching the same release information repeatedly.

Host permissions:

- `https://bandcamp.com/*`
- `https://*.bandcamp.com/*`

Reason:

- The feed runs on `bandcamp.com`.
- Release and track pages run on `*.bandcamp.com`.
- Metadata loading, wishlist helpers, and purchase shortcuts depend on those Bandcamp pages.
- Some user-initiated helper flows run in Bandcamp iframes or tabs, so the extension needs to load on the real Bandcamp page context where those actions happen.

## Privacy Disclosure

`The extension fetches Bandcamp release pages to extract metadata and stores cached results locally in the browser. It only runs on Bandcamp domains needed for the feed and helper flows. It does not send data to a separate developer backend, does not sell data, and does not use third-party analytics or advertising trackers. Wishlist actions and purchase shortcuts only run when the user clicks them. Purchases are completed through Bandcamp's own interface.`

## Screenshot Assets

- `assets/store/store-screenshot-real-02.png`
- `assets/store/chrome-promo-tile-440x280.png`

Recommended default:

- use `assets/store/store-screenshot-real-02.png` first
- use `assets/store/chrome-promo-tile-440x280.png` for the Chrome promo slot
