#!/bin/sh

set -eu

if [ "${FIREFOX_BIN:-}" ]; then
    printf '%s\n' "$FIREFOX_BIN"
    exit 0
fi

for candidate in \
    firefox \
    "/Applications/Firefox.app/Contents/MacOS/firefox"
do
    if command -v "$candidate" >/dev/null 2>&1; then
        command -v "$candidate"
        exit 0
    fi

    if [ -x "$candidate" ]; then
        printf '%s\n' "$candidate"
        exit 0
    fi
done

echo "Could not find a Firefox executable. Set FIREFOX_BIN to continue." >&2
exit 1
