#!/usr/bin/env node

// Regression test for the background prefix reader.
//
// The old implementation called storage.local.get(null) and filtered in the
// service worker. Every tag/release prefix read therefore cloned the whole
// local storage (up to 10k tag records) just to discard most of it. This test
// uses a storage mock where getKeys() works and get(null) throws, so a
// regression to the full read fails immediately.

import { readFile } from "node:fs/promises";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const scriptPath = fileURLToPath(import.meta.url);
const rootDir = path.resolve(path.dirname(scriptPath), "..");
const sharedPath = path.join(rootDir, "extension.shared.js");
const backgroundPath = path.join(rootDir, "extension.background.js");

const store = new Map([
    ["bcampx:release:https://example/album/a", { fetchedAt: 1 }],
    ["bcampx:release:https://example/album/b", { fetchedAt: 2 }],
    ["bcampx:tagIndex:a", { items: [] }],
    ["bcampx:userSettings", { enableTagSearch: false }],
]);

let messageListener = null;
const browser = {
    runtime: {
        id: "bcampx-test-extension",
        lastError: null,
        getURL: (page) => `moz-extension://bcampx-test/${page}`,
        onMessage: {
            addListener(listener) {
                messageListener = listener;
            },
        },
        sendMessage() {},
    },
    storage: {
        local: {
            async getKeys() {
                return Array.from(store.keys());
            },
            async get(keys) {
                if (keys === null) {
                    throw new Error("full storage read is not allowed");
                }
                const values = {};
                for (const key of keys || []) {
                    if (store.has(key)) {
                        values[key] = store.get(key);
                    }
                }
                return values;
            },
            async set() {},
        },
    },
};

const context = vm.createContext({
    browser,
    console,
    URL,
    setTimeout,
    clearTimeout,
    Promise,
});
vm.runInContext(await readFile(sharedPath, "utf8"), context);
vm.runInContext(await readFile(backgroundPath, "utf8"), context);

if (typeof messageListener !== "function") {
    console.error("storage_prefix_test=failed");
    console.error("background did not register an onMessage listener");
    process.exit(1);
}

function requestPrefix(prefix) {
    return new Promise((resolve, reject) => {
        let timer = 0;
        const done = (payload) => {
            if (timer) {
                clearTimeout(timer);
                timer = 0;
            }
            resolve(payload);
        };
        const started = messageListener(
            { type: "bcampx:storage-get-by-prefix", prefix },
            {
                id: "bcampx-test-extension",
                url: "https://bandcamp.com/fixture",
            },
            done,
        );
        if (started !== true) {
            reject(new Error("message channel was not kept open"));
            return;
        }
        timer = setTimeout(
            () => reject(new Error("prefix request timed out")),
            3000,
        );
    });
}

const releases = await requestPrefix("bcampx:release:");
if (
    releases.ok !== true ||
    !releases.values ||
    Object.keys(releases.values).length !== 2 ||
    !Object.prototype.hasOwnProperty.call(
        releases.values,
        "bcampx:release:https://example/album/a",
    )
) {
    console.error("storage_prefix_test=failed");
    console.error(JSON.stringify(releases));
    process.exit(1);
}

const missing = await requestPrefix("bcampx:doesNotExist:");
if (missing.ok !== true || Object.keys(missing.values || {}).length !== 0) {
    console.error("storage_prefix_test=failed");
    console.error(JSON.stringify(missing));
    process.exit(1);
}

console.log("storage_prefix_test=passed");
