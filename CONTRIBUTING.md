# Contributing

Thanks for your interest in improving Bandcamplifer.

## Before You Start

- Check the existing issues before opening a new one.
- Keep changes focused. Small pull requests are much easier to review than broad refactors.
- If you are changing feature behavior, update the relevant public docs in the same pull request.

## Development Setup

1. Clone the repository.
2. Start a local web server from the repository root:

```sh
python3 -m http.server 8000 --bind 127.0.0.1
```

3. Install [`bcamplifier.dev.user.js`](./bcamplifier.dev.user.js) in Tampermonkey for local iteration.
4. If you are testing the extension build, run:

```sh
./scripts/build-extension.sh
```

## Validation

Run the checks that match your change before opening a pull request:

```sh
node --check bcamplifier.user.js
./scripts/check-extension-scope.sh
./scripts/build-extension.sh
./scripts/smoke-test-extension.sh
./scripts/test-feed-fixture.sh
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
