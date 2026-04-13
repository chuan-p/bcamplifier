#!/bin/sh

set -eu

if [ "${CHROME_BIN:-}" ]; then
    printf '%s\n' "$CHROME_BIN"
    exit 0
fi

for candidate in \
    google-chrome \
    chromium \
    chromium-browser \
    chrome \
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
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

echo "Could not find a Chrome or Chromium executable. Set CHROME_BIN to continue." >&2
exit 1
