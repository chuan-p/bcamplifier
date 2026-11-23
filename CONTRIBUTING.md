# Contributing

Thanks for your interest in improving Bandcamplifer.

## Before You Start

- Check the existing issues before opening a new one.
- Keep changes focused. Small pull requests are much easier to review than broad refactors.
- If you are changing feature behavior, update the relevant public docs in the same pull request.

## Development Setup

1. Clone the repository.
2. Install the build and test dependencies:

```sh
npm install
```

Browser-driven smoke tests additionally need a Chromium download:

```sh
npx playwright install chromium
```

3. Build the generated userscript:

```sh
npm run build
```

4. Start a local web server from the repository root:

```sh
python3 -m http.server 8000 --bind 127.0.0.1
```

5. Install [`bcamplifier.dev.user.js`](./bcamplifier.dev.user.js) in Tampermonkey for local iteration.
6. If you are testing the extension build, run:

```sh
npm run build:extension
```

## Validation

Run the checks that match your change before opening a pull request:

```sh
npm test                          # parsing, formatting and extension unit tests
npm run test:fixtures             # headless Chrome fixture tests
npm run build
node --check bcamplifier.user.js
./scripts/check-versions.sh
./scripts/check-extension-scope.sh
npm run build:extension
./scripts/smoke-test-extension.sh
```

The generated files (`bcamplifier.user.js`, `extension.host-errors.js`) are
committed, so rebuild before committing or CI will report them as stale.

## Releasing

The version lives in `src/userscript.meta.js` and is copied everywhere else by
one command:

```sh
npm run bump -- 3.3.4
npm run build
npm run build:extension
```

If a browser-dependent check cannot run in your environment, mention that clearly in the pull request.

## Pull Requests

- Describe the user-visible problem and the fix.
- Mention any Bandcamp flows you tested manually.
- Include screenshots when UI changes are visible in the feed or player.
- Avoid unrelated formatting-only churn unless it directly helps the change.

## Scope

Bandcamplifer intentionally stays focused on Bandcamp feed enhancement. Please keep new ideas aligned with that goal:

- richer feed context
- playback ergonomics
- Bandcamp-native wishlist and buy helpers
- maintainability of the shared userscript and extension core

## Communication

By participating in this project, you agree to follow the expectations in [`CODE_OF_CONDUCT.md`](./CODE_OF_CONDUCT.md).
