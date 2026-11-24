#!/usr/bin/env node

// Regression test for concurrent pending host-permission queue writes in
// extension.background.js.

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sharedPath = path.join(rootDir, "extension.shared.js");
const backgroundPath = path.join(rootDir, "extension.background.js");

test("pending host-permission queue serializes concurrent saves, deletes, and prunes", async () => {
    const store = new Map();
    const WRITE_MS = 5;
    const READ_MS = 15;

    function storageGet(keys, callback) {
        setTimeout(() => {
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
        }, READ_MS);
    }

    function storageSet(items, callback) {
        setTimeout(() => {
            Object.entries(items || {}).forEach(([key, value]) => {
                store.set(key, value);
            });
            if (typeof callback === "function") callback();
        }, WRITE_MS);
    }

    const chrome = {
        runtime: {
            id: "bcampx-test-extension",
            lastError: null,
            onMessage: { addListener() {} },
            getURL: (page) => `chrome-extension://bcampx-test-extension/${page}`,
            sendMessage(_tabId, _message, callback) {
                if (typeof callback === "function") callback();
            },
        },
        storage: {
            session: { get: storageGet, set: storageSet },
            local: { get: storageGet, set: storageSet },
        },
        tabs: {
            onRemoved: { addListener() {} },
            get(_tabId, callback) {
                if (typeof callback === "function") callback(null);
            },
            update(_tabId, _props, callback) {
                if (typeof callback === "function") callback();
            },
            remove(_tabId, callback) {
                if (typeof callback === "function") callback();
            },
        },
        permissions: {
            contains(_permissions, callback) {
                if (typeof callback === "function") callback(false);
            },
            request(_permissions, callback) {
                if (typeof callback === "function") callback(false);
            },
            onAdded: { addListener() {} },
            onRemoved: { addListener() {} },
        },
    };

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
        chrome,
    };
    sandbox.globalThis = sandbox;
    vm.createContext(sandbox);

    vm.runInContext(await readFile(sharedPath, "utf8"), sandbox, {
        filename: "extension.shared.js",
    });
    vm.runInContext(await readFile(backgroundPath, "utf8"), sandbox, {
        filename: "extension.background.js",
    });

    const pendingRequest = (overrides = {}) => ({
        sourceTabId: 1,
        permissionTabId: -1,
        originPattern: "https://custom.example/*",
        createdAt: Date.now(),
        ...overrides,
    });

    const ids = ["req-1", "req-2", "req-3", "req-4"];
    await Promise.all(
        ids.map((requestId) =>
            sandbox.savePendingHostPermissionRequest(requestId, pendingRequest()),
        ),
    );

    let records = await sandbox.readPendingHostPermissionRequests();
    assert.deepEqual(Object.keys(records).sort(), ids);

    await sandbox.deletePendingHostPermissionRequest("req-2");
    records = await sandbox.readPendingHostPermissionRequests();
    assert.deepEqual(Object.keys(records).sort(), ["req-1", "req-3", "req-4"]);

    await sandbox.savePendingHostPermissionRequest(
        "stale-request",
        pendingRequest({ createdAt: Date.now() - 11 * 60 * 1000 }),
    );
    await sandbox.savePendingHostPermissionRequest("fresh-request", pendingRequest());
    await sandbox.pruneStalePendingHostPermissionRequests();
    records = await sandbox.readPendingHostPermissionRequests();
    assert.equal("stale-request" in records, false);
    assert.equal("fresh-request" in records, true);
});
