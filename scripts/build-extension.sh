#!/bin/sh

set -eu

ROOT_DIR=$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)
DIST_DIR="$ROOT_DIR/dist"

COMMON_FILES="
bcamplifier.user.js
extension.shared.js
extension.host-errors.js
extension.content.js
extension.background.js
extension.host-permission.html
extension.host-permission.js
extension.host-permission.css
README.md
LICENSE
"

build_target() {
    target="$1"
    package_name="$2"
    manifest_source="$3"
    package_ext="$4"
    target_dir="$DIST_DIR/$target"
    zip_path="$DIST_DIR/bcamplifier-$package_name.$package_ext"

    rm -rf "$target_dir" "$zip_path"
    mkdir -p "$target_dir"

    cp "$ROOT_DIR/$manifest_source" "$target_dir/manifest.json"
    python3 - "$target_dir/manifest.json" "$SCRIPT_VERSION" <<'PY'
import json
import sys

manifest_path, version = sys.argv[1:3]
with open(manifest_path, encoding="utf-8") as handle:
    manifest = json.load(handle)
manifest["version"] = version
with open(manifest_path, "w", encoding="utf-8") as handle:
    json.dump(manifest, handle, indent=2)
    handle.write("\n")
PY

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

SCRIPT_VERSION=$(sed -n 's|^// @version[[:space:]]*||p' "$ROOT_DIR/src/userscript.meta.js" | head -1 | tr -d '[:space:]')
if [ -z "$SCRIPT_VERSION" ]; then
    echo "src/userscript.meta.js is missing @version" >&2
    exit 1
fi

mkdir -p "$DIST_DIR"
node "$ROOT_DIR/scripts/build-userscript.mjs"
build_target chrome-unpacked chrome manifest.chrome.json zip
build_target firefox firefox manifest.firefox.json xpi

printf 'Built extension targets:\n'
printf '  %s\n' "$DIST_DIR/chrome-unpacked" "$DIST_DIR/firefox"
printf 'Built userscript:\n'
printf '  %s\n' "$DIST_DIR/bcamplifier.user.js"

if command -v zip >/dev/null 2>&1; then
    printf 'Built packages:\n'
    printf '  %s\n' "$DIST_DIR/bcamplifier-chrome.zip" "$DIST_DIR/bcamplifier-firefox.xpi"
fi
