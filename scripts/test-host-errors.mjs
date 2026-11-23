#!/usr/bin/env node

// The host error mapping is shipped twice: inside the userscript bundle and as
// a generated helper the extension loads. This test proves both copies answer
// the same way, so the two runtimes cannot drift apart again.

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import vm from "node:vm";
import { fileURLToPath } from "node:url";
import { describeHostError } from "../src/utils/host-errors.js";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(scriptDir, "..");

const extensionPath = path.join(rootDir, "extension.host-errors.js");
const extensionContext = vm.createContext({});
vm.runInContext(await readFile(extensionPath, "utf8"), extensionContext, {
    filename: extensionPath,
});
const extensionApi = extensionContext.__BCAMPX_HOST_ERRORS__;

test("source module and generated extension copy map host errors identically", () => {
    const contextLost = "Extension context invalidated.";
    const storageMissing = "storage.local.set is unavailable.";
    const storageFull = "QUOTA_BYTES quota exceeded";

    assert.equal(
        describeHostError(contextLost),
        "Extension was updated or reloaded. Refresh this Bandcamp tab and try again.",
    );
    assert.equal(
        extensionApi.describeHostError(contextLost),
        describeHostError(contextLost),
    );
    assert.equal(
        describeHostError(storageMissing),
        "Extension storage is unavailable. Refresh the tab or restart the browser and try again.",
    );
    assert.equal(
        extensionApi.describeHostError(storageMissing),
        describeHostError(storageMissing),
    );
    assert.equal(
        describeHostError(storageFull),
        "Extension storage is full. Clear this site's cached data or restart the browser and try again.",
    );
    assert.equal(
        extensionApi.describeHostError(storageFull),
        describeHostError(storageFull),
    );
    assert.equal(describeHostError("HTTP 500"), "");
    assert.equal(describeHostError(""), "");
    assert.deepEqual(Object.keys(extensionApi), ["describeHostError"]);
});

test("consumers delegate to host-errors instead of duplicating patterns", async () => {
    const consumers = {
        core: await readFile(path.join(rootDir, "src", "bcamplifier.core.js"), "utf8"),
        releasePage: await readFile(
            path.join(rootDir, "src", "features", "release-page.js"),
            "utf8",
        ),
        content: await readFile(path.join(rootDir, "extension.content.js"), "utf8"),
    };

    for (const [name, source] of Object.entries(consumers)) {
        assert.ok(
            !source.includes("Receiving end does not exist"),
            `${name} must not inline the context-lost pattern`,
        );
    }
    assert.ok(
        !consumers.content.includes("Extension storage is unavailable"),
        "the extension adapter delegates to the generated helper",
    );
    assert.ok(
        consumers.content.includes("__BCAMPX_HOST_ERRORS__"),
        "the extension adapter reads the generated helper",
    );
});
