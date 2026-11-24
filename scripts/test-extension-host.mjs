#!/usr/bin/env node

// Integration test for the extension content-script adapter.
//
// Loads the shared/error/content scripts in a VM with a fake WebExtension
// namespace, verifying host bridge publication, storage round-trip, and
// shared runtime/quota error guidance.

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function createFakeChrome({ store, responses, failWritesWith = "" }) {
    const chrome = {
        runtime: {
            lastError: null,
            getURL: (assetPath) => `chrome-extension://fake/${assetPath}`,
            onMessage: { addListener: () => {} },
            sendMessage: callbackApi((message) => {
                const respond = responses[message.type];
                if (!respond) {
                    return { ok: false, error: "unexpected message" };
                }
                return respond(message);
            }),
        },
        storage: {
            onChanged: { addListener: () => {} },
            local: {
                get: callbackApi((keys) => {
                    const values = {};
                    for (const key of keys) {
                        if (key in store) {
                            values[key] = store[key];
                        }
                    }
                    return values;
                }),
                set: (items, callback) => {
                    if (failWritesWith) {
                        chrome.runtime.lastError = { message: failWritesWith };
                        setTimeout(() => {
                            callback();
                            chrome.runtime.lastError = null;
                        }, 0);
                        return;
                    }
                    Object.assign(store, items);
                    setTimeout(callback, 0);
                },
                remove: callbackApi((key) => {
                    delete store[key];
                }),
            },
        },
        permissions: {
            onAdded: { addListener: () => {} },
            contains: callbackApi(() => true),
        },
        tabs: { create: callbackApi(() => ({ id: 1 })) },
    };

    function callbackApi(fn) {
        return (...args) => {
            const callback = args[args.length - 1];
            const result = fn(...args.slice(0, -1));
            if (typeof callback === "function") {
                setTimeout(() => callback(result), 0);
            }
            return undefined;
        };
    }

    return chrome;
}

function createDocumentElement() {
    return {
        attributes: {},
        setAttribute(name, value) {
            this.attributes[name] = String(value);
        },
        getAttribute(name) {
            return name in this.attributes ? this.attributes[name] : null;
        },
    };
}

async function loadAdapter(chrome) {
    const documentElement = createDocumentElement();
    const sandbox = {
        chrome,
        console,
        setTimeout,
        clearTimeout,
        Promise,
        URL,
        Map,
        Set,
        Object,
        Array,
        String,
        Boolean,
        Number,
        Error,
        Math,
        Date,
        JSON,
    };
    sandbox.globalThis = sandbox;
    sandbox.window = sandbox;
    sandbox.document = { documentElement };

    const context = vm.createContext(sandbox);
    for (const file of [
        "extension.shared.js",
        "extension.host-errors.js",
        "extension.content.js",
    ]) {
        const source = await readFile(path.join(rootDir, file), "utf8");
        vm.runInContext(source, context, { filename: file });
    }

    return { host: context.__BCAMPX_HOST__, documentElement };
}

test("healthy extension publishes host bridge, round-trips storage, and maps runtime errors", async () => {
    const healthy = await loadAdapter(
        createFakeChrome({
            store: {},
            responses: {
                "bcampx:get-host-permissions": () => ({ ok: true, origins: [] }),
                "bcampx:storage-get-by-prefix": () => ({ ok: true, values: {} }),
                "bcampx:fetch": () => ({
                    ok: false,
                    error: "Receiving end does not exist.",
                }),
            },
        }),
    );

    assert.ok(healthy.host);
    assert.equal(healthy.host.kind, "webextension");
    assert.equal(healthy.documentElement.attributes["data-bcampx-host"], "webextension");

    await healthy.host.storageSet("bcampx:probe", { value: 2 });
    assert.deepEqual(await healthy.host.storageGet("bcampx:probe", null), { value: 2 });

    await assert.rejects(
        () => healthy.host.requestJson("https://bandcamp.com/api/nothing"),
        {
            message:
                "Extension was updated or reloaded. Refresh this Bandcamp tab and try again.",
        },
    );
});

test("full storage quota is reported with actionable guidance", async () => {
    const full = await loadAdapter(
        createFakeChrome({
            store: {},
            responses: {
                "bcampx:get-host-permissions": () => ({ ok: true, origins: [] }),
            },
            failWritesWith: "QUOTA_BYTES quota exceeded",
        }),
    );

    await assert.rejects(
        () => full.host.storageSet("bcampx:probe", { value: 1 }),
        {
            message:
                "Extension storage is full. Clear this site's cached data or restart the browser and try again.",
        },
    );
});
