#!/bin/sh

set -eu

ROOT_DIR=$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)

cd "$ROOT_DIR"

VERSION=$(sed -n 's|^// @version[[:space:]]*||p' src/userscript.meta.js | head -1 | tr -d '[:space:]')
DEV_VERSION=$(sed -n 's|^// @version[[:space:]]*||p' bcamplifier.dev.user.js | head -1 | tr -d '[:space:]')
PACKAGE_VERSION=$(sed -n 's|^[[:space:]]*"version":[[:space:]]*"\([^"]*\)".*|\1|p' package.json | head -1)

if [ -z "$VERSION" ]; then
    echo "src/userscript.meta.js: missing @version" >&2
    exit 1
fi

status=0

check() {
    name=$1
    value=$2
    if [ "$value" != "$VERSION" ]; then
        echo "$name: $value != $VERSION" >&2
        status=1
    fi
}

check "manifest.chrome.json" "$(sed -n 's|^[[:space:]]*"version":[[:space:]]*"\([^"]*\)".*|\1|p' manifest.chrome.json | head -1)"
check "manifest.firefox.json" "$(sed -n 's|^[[:space:]]*"version":[[:space:]]*"\([^"]*\)".*|\1|p' manifest.firefox.json | head -1)"
check "package.json" "$PACKAGE_VERSION"
check "bcamplifier.dev.user.js" "$DEV_VERSION"

# The dev loader pins a cache-busting query string on its @require. If it drifts
# from @version, Tampermonkey keeps serving a stale local bundle and the loader
# silently loads an older script.
DEV_CACHE_VERSION=$(sed -n 's|.*bcamplifier\.user\.js?v=\([^& ]*\).*|\1|p' bcamplifier.dev.user.js | head -1)
check "bcamplifier.dev.user.js ?v=" "$DEV_CACHE_VERSION"

if [ "$status" -ne 0 ]; then
    echo "Version mismatch: src/userscript.meta.js is the single source of truth ($VERSION)." >&2
    exit 1
fi

echo "versions_ok: $VERSION"
