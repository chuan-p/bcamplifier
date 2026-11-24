#!/usr/bin/env node

// Regression test for the background prefix reader.
//
// The old implementation called storage.local.get(null) and filtered in the
// service worker. Every tag/release prefix read therefore cloned the whole
// local storage (up to 10k tag records) just to discard most of it. This test
// uses a storage mock where getKeys() works and get(null) throws, so a
// regression to the full read fails immediately.

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sharedPath = path.join(rootDir, "extension.shared.js");
const backgroundPath = path.join(rootDir, "extension.background.js");

test("background prefix reader uses getKeys() instead of get(null)", async () => {
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

    assert.equal(typeof messageListener, "function");

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
    assert.equal(releases.ok, true);
    assert.deepEqual(Object.keys(releases.values).sort(), [
        "bcampx:release:https://example/album/a",
        "bcampx:release:https://example/album/b",
    ]);

    const missing = await requestPrefix("bcampx:doesNotExist:");
    assert.equal(missing.ok, true);
    assert.deepEqual(Object.keys(missing.values || {}), []);
});
