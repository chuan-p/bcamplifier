#!/usr/bin/env node

// Regression test for the custom-domain permission button in Firefox, where
// `browser` namespaces are non-enumerable properties.

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sharedPath = path.join(rootDir, "extension.shared.js");
const backgroundPath = path.join(rootDir, "extension.background.js");

test("Firefox non-enumerable browser namespace opens permission tab and short-circuits when granted", async () => {
    const EXTENSION_ID = "bcampx-test-extension";
    const store = new Map();
    const createdTabs = [];
    let containsResult = false;

    function storageGet(keys, callback) {
        const result = {};
        if (typeof keys === "string") {
            if (store.has(keys)) result[keys] = store.get(keys);
        } else if (keys === null || keys === undefined) {
            store.forEach((value, key) => {
                result[key] = value;
            });
        } else if (Array.isArray(keys)) {
            keys.forEach((key) => {
                if (store.has(key)) result[key] = store.get(key);
            });
        }
        callback(result);
    }

    function storageSet(items, callback) {
        Object.entries(items || {}).forEach(([key, value]) => {
            store.set(key, value);
        });
        if (typeof callback === "function") callback();
    }

    const firefoxBrowser = Object.create(null);
    Object.defineProperties(firefoxBrowser, {
        runtime: {
            enumerable: false,
            value: {
                id: EXTENSION_ID,
                lastError: null,
                onMessage: { addListener() {} },
                getURL: (page) => `moz-extension://bcampx-test/${page}`,
                sendMessage(_tabId, _message, callback) {
                    if (typeof callback === "function") callback();
                },
            },
        },
        storage: {
            enumerable: false,
            value: {
                session: { get: storageGet, set: storageSet },
                local: { get: storageGet, set: storageSet },
            },
        },
        permissions: {
            enumerable: false,
            value: {
                contains(_permissions, callback) {
                    if (typeof callback === "function") {
                        callback(containsResult);
                        return undefined;
                    }
                    return Promise.resolve(containsResult);
                },
                request(_permissions, callback) {
                    if (typeof callback === "function") {
                        callback(containsResult);
                        return undefined;
                    }
                    return Promise.resolve(containsResult);
                },
                onAdded: { addListener() {} },
                onRemoved: { addListener() {} },
            },
        },
        tabs: {
            enumerable: false,
            value: {
                onRemoved: { addListener() {} },
                create(properties, callback) {
                    const tab = { id: 100 + createdTabs.length, ...properties };
                    createdTabs.push(tab);
                    if (typeof callback === "function") callback(tab);
                    return Promise.resolve(tab);
                },
                get(_tabId, callback) {
                    if (typeof callback === "function") callback(null);
                },
                update(_tabId, _props, callback) {
                    if (typeof callback === "function") callback();
                },
                remove(_tabId, callback) {
                    if (typeof callback === "function") callback();
                },
                sendMessage(_tabId, _message, callback) {
                    if (typeof callback === "function") callback();
                },
            },
        },
    });

    assert.equal(Object.keys({ ...firefoxBrowser }).length, 0);

    const sandbox = {
        console,
        setTimeout,
        clearTimeout,
        URL,
        URLSearchParams,
        Promise,
        Map,
        Set,
        Date,
        JSON,
        String,
        Number,
        Object,
        Array,
        Error,
        RegExp,
        browser: firefoxBrowser,
    };
    sandbox.globalThis = sandbox;
    vm.createContext(sandbox);

    vm.runInContext(await readFile(sharedPath, "utf8"), sandbox, {
        filename: "extension.shared.js",
    });
    vm.runInContext(await readFile(backgroundPath, "utf8"), sandbox, {
        filename: "extension.background.js",
    });

    const api = sandbox.__BCAMPX_EXT_SHARED__.getExtensionApi();
    assert.equal(api?.kind, "browser");
    for (const name of ["runtime", "storage", "permissions", "tabs"]) {
        assert.ok(api[name], `facade dropped ${name}`);
    }

    const sender = {
        id: EXTENSION_ID,
        url: "https://bandcamp.com/feed",
        tab: { id: 7 },
    };

    const result = await sandbox.handleStartHostPermissionRequest(
        {
            type: "bcampx:start-host-permission-request",
            requestId: "req-firefox",
            url: "https://shop.fixture.example/album/synthetic-release",
            originPattern: "https://shop.fixture.example/*",
        },
        sender,
    );

    assert.equal(result?.opened, true);
    assert.equal(createdTabs.length, 1);
    const createdUrl = String(createdTabs[0]?.url || "");
    assert.ok(
        createdUrl.startsWith("moz-extension://bcampx-test/extension.host-permission.html"),
    );
    assert.ok(createdUrl.includes("requestId=req-firefox"));
    assert.ok(
        createdUrl.includes(`origin=${encodeURIComponent("https://shop.fixture.example/*")}`),
    );

    const pending = await sandbox.getPendingHostPermissionRequest("req-firefox");
    assert.equal(Number(pending?.sourceTabId), 7);
    assert.equal(Number(pending?.permissionTabId), 100);

    containsResult = true;
    const alreadyGranted = await sandbox.handleStartHostPermissionRequest(
        {
            type: "bcampx:start-host-permission-request",
            requestId: "req-granted",
            url: "https://shop.fixture.example/album/synthetic-release",
            originPattern: "https://shop.fixture.example/*",
        },
        sender,
    );
    assert.equal(alreadyGranted?.granted, true);
    assert.equal(createdTabs.length, 1);
});
