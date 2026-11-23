#!/usr/bin/env node

// Integration test for the extension content-script adapter.
//
// The browser smoke test is the only other place this file runs, and it needs a
// real Chrome. This harness loads the same three files in a VM with a fake
// WebExtension namespace, so a change to extension.content.js that breaks the
// host bridge (or drops the shared error mapping) fails without a browser.

import { readFile } from "node:fs/promises";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(scriptDir, "..");

const failures = [];

function expect(label, actual, expected) {
    if (JSON.stringify(actual) !== JSON.stringify(expected)) {
        failures.push(
            `${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`,
        );
    }
}

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
                        // The real API leaves lastError set while the callback
                        // runs and clears it afterwards.
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

// Scenario 1: a healthy extension. Runtime errors still have to be translated
// into the shared guidance, and storage has to round-trip.
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

expect("the adapter publishes a host bridge", Boolean(healthy.host), true);
expect("the host identifies itself", healthy.host && healthy.host.kind, "webextension");
expect(
    "the page is marked as extension-hosted",
    healthy.documentElement.attributes["data-bcampx-host"],
    "webextension",
);

await healthy.host.storageSet("bcampx:probe", { value: 2 });
expect(
    "storage writes reach the extension and read back",
    await healthy.host.storageGet("bcampx:probe", null),
    { value: 2 },
);

let mappedMessage = "";
try {
    await healthy.host.requestJson("https://bandcamp.com/api/nothing");
} catch (error) {
    mappedMessage = error.message;
}
expect(
    "runtime errors use the shared guidance",
    mappedMessage,
    "Extension was updated or reloaded. Refresh this Bandcamp tab and try again.",
);

// Scenario 2: a full storage quota. The adapter has to surface the failure with
// the guidance the bundled core shows for the same condition, instead of the
// raw QUOTA_BYTES message.
const full = await loadAdapter(
    createFakeChrome({
        store: {},
        responses: {
            "bcampx:get-host-permissions": () => ({ ok: true, origins: [] }),
        },
        failWritesWith: "QUOTA_BYTES quota exceeded",
    }),
);

let writeError = "";
try {
    await full.host.storageSet("bcampx:probe", { value: 1 });
} catch (error) {
    writeError = error.message;
}
expect(
    "a full quota is reported with actionable guidance",
    writeError,
    "Extension storage is full. Clear this site's cached data or restart the browser and try again.",
);

if (failures.length) {
    console.log("extension_host_test=failed");
    failures.forEach((failure) => console.log(`failed=${failure}`));
    process.exit(1);
}

console.log("extension_host_test=passed");
