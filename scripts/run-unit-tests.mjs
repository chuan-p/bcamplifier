#!/usr/bin/env node

// Run every test that does not need a browser: the parsing/formatting units and
// the extension bridge units. The browser fixture tests stay opt-in because they
// need Chrome and a local server (see scripts/test-*-fixture.sh).
//
// `npm test` runs this file so a contributor does not have to copy the list of
// commands out of CI.

import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));

const tests = [
    "test-async.mjs",
    "test-text-format.mjs",
    "test-release-data.mjs",
    "test-tag-index-writes.mjs",
    "test-storage-prefix.mjs",
    "test-host-errors.mjs",
    "test-extension-host.mjs",
    "test-host-permission-queue.mjs",
    "test-host-permission-firefox-api.mjs",
    "test-host-permission-page.mjs",
];

let failed = 0;

for (const test of tests) {
    const testPath = path.join(scriptDir, test);
    process.stdout.write(`\n# ${test}\n`);
    const result = spawnSync(process.execPath, [testPath], {
        stdio: "inherit",
        cwd: path.resolve(scriptDir, ".."),
    });
    if (result.status !== 0) {
        failed += 1;
    }
}

if (failed) {
    console.error(`\n${failed} test file(s) failed.`);
    process.exit(1);
}

console.log("\nAll unit tests passed.");
