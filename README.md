# BC Amplifier

BC Amplifier is a Tampermonkey userscript that enriches Bandcamp feed cards with release details loaded from the linked album or track page.

## Features

- Matches `https://bandcamp.com/feed*` and `https://bandcamp.com/*/feed*`.
- Detects feed cards from album or track links, including cards added by infinite scroll.
- Fetches release pages only when a card enters the viewport or when you click the details button.
- Caches release metadata locally by URL to avoid repeated requests.
- Shows title, artist, release date, location, tags, description, and a short track list when available.
- Degrades safely with a retry button and an "Open release" link if parsing or network requests fail.

## Install

1. Install Tampermonkey in your browser.
2. Open `bcamplifier.user.js`.
3. Copy the file into a new Tampermonkey script, or use Tampermonkey's local file import flow.
4. Visit your Bandcamp feed while logged in.

## Local Development

For day-to-day testing, the smoother workflow is to install `bcamplifier.user.js` from your local HTTP server and let Tampermonkey update it by version number.

Start a local static server from this directory:

```sh
python3 -m http.server 8000 --bind 127.0.0.1
```

Then open this URL in your browser and install the script from Tampermonkey:

`http://127.0.0.1:8000/bcamplifier.user.js`

This script now includes:

- `@updateURL http://127.0.0.1:8000/bcamplifier.user.js`
- `@downloadURL http://127.0.0.1:8000/bcamplifier.user.js`

That means future updates can come from the same local URL without editing script headers. While developing:

- edit `bcamplifier.user.js`
- bump the `@version` when you want Tampermonkey to treat it as a new release
- let Tampermonkey check for updates automatically, or trigger "Check for userscript updates" if you want it immediately

Use only one of these Tampermonkey scripts at a time:

- `bcamplifier.user.js` installed from `http://127.0.0.1:8000/bcamplifier.user.js` for local development with automatic updates.
- `bcamplifier.dev.user.js` only if you specifically want the `@require`-based loader approach.

## Configuration

Edit the `CONFIG` object near the top of `bcamplifier.user.js`:

- `autoFetchOnVisible`: fetch details when cards approach the viewport.
- `expandAfterAutoFetch`: show details automatically after a viewport-triggered fetch.
- `cacheTtlMs`: local cache lifetime.
- `maxTracks`: maximum number of track names shown.
- `maxDescriptionLength`: maximum description length shown in the feed.

## Notes

Bandcamp does not expose a public fan-feed API for this use case, so this script uses conservative DOM detection and parses linked release pages. If Bandcamp changes its page structure, selectors may need a small update.
