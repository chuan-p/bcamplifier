"""Shared helpers for the headless fixture tests.

Every fixture test launches Chrome with `--dump-dom` and asserts on
`data-bcampx-*` attributes. Chromium builds differ in whether they exit after
writing the DOM, so the timeout fallback lives here once instead of in every
script.
"""

import subprocess


def run_chrome(
    chrome_bin,
    url,
    profile_dir,
    *,
    budget=6000,
    timeout=24,
    window="1400,1600",
    resolver=None,
    extra_args=(),
):
    cmd = [
        chrome_bin,
        "--headless=new",
        "--no-sandbox",
        "--disable-gpu",
        "--no-first-run",
        "--no-default-browser-check",
        "--disable-background-networking",
        "--disable-component-update",
        f"--user-data-dir={profile_dir}",
    ]
    if window:
        cmd.append(f"--window-size={window}")

    if resolver:
        cmd.append(f"--host-resolver-rules={resolver}")
    cmd.extend(extra_args)
    cmd.extend(
        [
            f"--virtual-time-budget={budget}",
            "--dump-dom",
            url,
        ]
    )

    try:
        result = subprocess.run(cmd, capture_output=True, timeout=timeout)
        return (
            result.returncode,
            result.stdout.decode("utf-8", "ignore"),
            result.stderr.decode("utf-8", "ignore"),
        )
    except subprocess.TimeoutExpired as error:
        # Some Chromium builds keep the browser alive after --dump-dom has
        # written the page, so fall back to the captured stdout.
        return (
            0 if error.stdout else 1,
            (error.stdout or b"").decode("utf-8", "ignore"),
            (error.stderr or b"").decode("utf-8", "ignore"),
        )


def report_failed_run(label, returncode, stderr):
    print(label + "=failed")
    print("chrome_exit_code=" + str(returncode))
    if stderr:
        print(stderr)


def check_tokens(stdout, checks, label):
    """Assert that every expected token is present in the dumped DOM."""
    missing = [
        description
        for token, description in checks.items()
        if token not in stdout
    ]
    if missing:
        print(label + "=failed")
        for description in missing:
            print("missing=" + description)
        return False

    print(label + "=passed")
    return True


def run_and_check(
    chrome_bin,
    url,
    profile_dir,
    checks,
    label,
    *,
    budget=6000,
    timeout=24,
    window="1400,1600",
    resolver=None,
    extra_args=(),
):
    returncode, stdout, stderr = run_chrome(
        chrome_bin,
        url,
        profile_dir,
        budget=budget,
        timeout=timeout,
        window=window,
        resolver=resolver,
        extra_args=extra_args,
    )
    if returncode != 0:
        report_failed_run(label, returncode, stderr)
        return False, stdout
    return check_tokens(stdout, checks, label), stdout
