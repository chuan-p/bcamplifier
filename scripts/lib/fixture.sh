# Shared fixture environment for the headless tests.
#
# Usage:
#   . "$ROOT_DIR/scripts/lib/fixture.sh"
#   fixture_start "$ROOT_DIR" "$PORT" "$SERVER_LOG"
#
# Serves only `fixtures/` and the built userscript from a temporary docroot, so
# the test server never exposes .git, node_modules, or local signing keys.
# `fixture_cleanup` is installed as an EXIT trap by `fixture_start`.

fixture_start() {
    fixture_root=$1
    fixture_port=$2
    fixture_log=$3
    fixture_docroot=$(mktemp -d "${TMPDIR:-/tmp}/bcampx-fixture-docroot.XXXXXX")
    fixture_profile=$(mktemp -d "${TMPDIR:-/tmp}/bcampx-chrome-profile.XXXXXX")

    mkdir -p "$fixture_docroot/fixtures"
    cp -R "$fixture_root/fixtures/." "$fixture_docroot/fixtures/"
    cp "$fixture_root/bcamplifier.user.js" "$fixture_docroot/bcamplifier.user.js"

    python3 -m http.server "$fixture_port" --bind 127.0.0.1 \
        --directory "$fixture_docroot" >"$fixture_log" 2>&1 &
    fixture_server_pid=$!

    trap 'fixture_cleanup' EXIT INT TERM
}

fixture_start_process() {
    fixture_root=$1
    fixture_port=$2
    fixture_log=$3
    shift 3
    fixture_docroot=""
    fixture_profile=$(mktemp -d "${TMPDIR:-/tmp}/bcampx-chrome-profile.XXXXXX")

    "$@" >"$fixture_log" 2>&1 &
    fixture_server_pid=$!

    trap 'fixture_cleanup' EXIT INT TERM
}

fixture_cleanup() {
    if [ -n "${fixture_server_pid:-}" ]; then
        kill "$fixture_server_pid" >/dev/null 2>&1 || true
    fi
    if [ -n "${fixture_docroot:-}" ]; then
        rm -rf "$fixture_docroot"
    fi
    if [ -n "${fixture_profile:-}" ]; then
        rm -rf "$fixture_profile"
    fi
}

# Run an inline Python snippet with the shared Chrome helpers importable.
fixture_python() {
    PYTHONPATH="$fixture_root/scripts/lib${PYTHONPATH:+:$PYTHONPATH}" \
        python3 "$@"
}
