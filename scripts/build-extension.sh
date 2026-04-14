#!/bin/sh

set -eu

ROOT_DIR=$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)
DIST_DIR="$ROOT_DIR/dist"

COMMON_FILES="
bcamplifier.user.js
extension.content.js
extension.background.js
README.md
LICENSE
"

build_target() {
    target="$1"
    manifest_source="$2"
    package_ext="$3"
    target_dir="$DIST_DIR/$target"
    zip_path="$DIST_DIR/bcamplifier-$target.$package_ext"

    rm -rf "$target_dir" "$zip_path"
    mkdir -p "$target_dir"

    cp "$ROOT_DIR/$manifest_source" "$target_dir/manifest.json"

    for file in $COMMON_FILES; do
        cp "$ROOT_DIR/$file" "$target_dir/$file"
    done

    mkdir -p "$target_dir/assets"
    cp -R "$ROOT_DIR/assets/icons" "$target_dir/assets/icons"

    if command -v zip >/dev/null 2>&1; then
        (
            cd "$target_dir"
            zip -qr "$zip_path" .
        )
    fi
}

mkdir -p "$DIST_DIR"
cp "$ROOT_DIR/bcamplifier.user.js" "$DIST_DIR/bcamplifier.user.js"
build_target chrome manifest.chrome.json zip
build_target firefox manifest.firefox.json xpi

printf 'Built extension targets:\n'
printf '  %s\n' "$DIST_DIR/chrome" "$DIST_DIR/firefox"
printf 'Built userscript:\n'
printf '  %s\n' "$DIST_DIR/bcamplifier.user.js"

if command -v zip >/dev/null 2>&1; then
    printf 'Built packages:\n'
    printf '  %s\n' "$DIST_DIR/bcamplifier-chrome.zip" "$DIST_DIR/bcamplifier-firefox.xpi"
fi
