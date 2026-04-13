# Submission Checklist

This is the shortest path from the current repo state to store submission for both Chrome Web Store and AMO.

## Before Both Stores

1. Confirm the release version is aligned in:
   - `bcamplifier.user.js`
   - `manifest.chrome.json`
   - `manifest.firefox.json`
2. Rebuild packages:

```sh
./scripts/build-extension.sh
```

3. Re-run checks:

```sh
./scripts/check-extension-scope.sh
./scripts/smoke-test-extension.sh
./scripts/test-feed-fixture.sh
```

4. Use this icon set:
   - `assets/icons/icon-16.png`
   - `assets/icons/icon-32.png`
   - `assets/icons/icon-48.png`
   - `assets/icons/icon-128.png`
   - `assets/icons/icon-1024.png`
5. Use this screenshot as the default storefront image:
   - `assets/store/store-screenshot-real-02.png`
6. Keep these text sources open while submitting:
   - `STORE_LISTING.md`
   - `PRIVACY_POLICY.md`
   - `EXTENSION_RELEASE.md`
   - `CHROME_REVIEW_NOTES.md`

## Chrome Web Store

Upload package:

- `dist/bcamplifier-chrome.zip`

Where to submit:

- Developer Dashboard: `https://chrome.google.com/webstore/devconsole`
- Official publish guide: `https://developer.chrome.com/docs/webstore/publish/`

Suggested submission flow:

1. Open `https://chrome.google.com/webstore/devconsole`
2. If this is your first submission, register the developer account there and pay the one-time Chrome Web Store registration fee
3. Click `Add new item`
4. Upload `dist/bcamplifier-chrome.zip`
5. In `Store Listing`, paste the copy from `STORE_LISTING.md`
6. In `Store Listing`, upload:
   - store icon: `assets/icons/icon-128.png`
   - screenshot: `assets/store/store-screenshot-real-02.png`
7. Prepare one more required Chrome asset before final submit:
   - small promo tile, `440x280` PNG or JPEG
8. In `Privacy`, describe the extension's single purpose and data handling using `PRIVACY_POLICY.md`
9. In `Distribution`, choose public or unlisted, and pick your regions
10. In `Test instructions`, explain how a reviewer can verify feed enhancement, playback, wishlist, and buy flows
    - start from `CHROME_REVIEW_NOTES.md`
    - explicitly mention that `all_frames` is used only for Bandcamp helper iframes tied to user clicks
11. Review the permissions shown in the dashboard and make sure they match:
   - `storage`
   - `https://bandcamp.com/*`
   - `https://*.bandcamp.com/*`
12. Click `Submit for review`

Notes:

- Prefer the original screenshot over cropped variants
- Keep the description concrete and feature-focused
- State the single purpose explicitly in the listing and privacy answers
- Do not imply automatic purchases or official Bandcamp affiliation
- Chrome's listing docs say the store listing requires at least one `1280x800` screenshot and a `440x280` small promo tile

## Firefox AMO

Upload package:

- `dist/bcamplifier-firefox.xpi`

Where to submit:

- Developer Hub: `https://addons.mozilla.org/en-US/developers/`
- Official AMO publishing docs: `https://extensionworkshop.com/documentation/publish/`
- Official AMO source submission guide: `https://extensionworkshop.com/documentation/publish/source-code-submission/`

Suggested submission flow:

1. Open `https://addons.mozilla.org/en-US/developers/`
2. Click `Submit or Manage Extensions`
3. Create a new add-on submission
4. Upload `dist/bcamplifier-firefox.xpi`
5. Keep the current Firefox ID unless AMO review asks for a change:
   - `{6c7370e1-e763-4806-8659-3cc872a45ac4}`
6. Fill the listing using `STORE_LISTING.md`
7. Upload `assets/store/store-screenshot-real-02.png`
8. Paste or host the privacy policy from `PRIVACY_POLICY.md`
9. Review the Firefox data disclosure section carefully. The manifest currently declares:
   - `authenticationInfo`
   - `websiteContent`
10. If AMO asks for source code, or if you later submit minified/transpiled/generated code, upload source plus build instructions as described in the official source submission guide
11. Add reviewer notes explaining how to verify:
   - feed metadata enrichment
   - persistent player
   - wishlist action
   - Bandcamp-native buy flow
12. Submit for review

Notes:

- Firefox manifest is currently scoped to `140.0+` so it can use the built-in data collection disclosure path
- If you later minify, bundle, or otherwise reduce source readability, prepare a source-code package for AMO review
- Keep the store description aligned with the actual extension behavior shown in the screenshot

## Last Manual QA Pass

Do one final real-world check in a logged-in browser session:

1. Open the Bandcamp feed
2. Confirm metadata appears in enhanced cards
3. Confirm track playback starts and the bottom player updates
4. Confirm wishlist action still works
5. Confirm buy opens Bandcamp's native purchase flow
