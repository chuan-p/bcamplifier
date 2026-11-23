#!/usr/bin/env node

// The backend keeps pending custom-domain permission requests in one
// storage.session object and mutates it with full read-modify-write cycles.
// Concurrent requests used to overwrite each other, so a page whose request
// was lost waited for its two-minute timeout. This test loads the real
// background script in a VM with a storage stub that leaves the
// read-modify-write window open, and checks the queue keeps every record.

import { readFile } from "node:fs/promises";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const scriptPath = fileURLToPath(import.meta.url);
const rootDir = path.resolve(path.dirname(scriptPath), "..");
const sharedPath = path.join(rootDir, "extension.shared.js");
const backgroundPath = path.join(rootDir, "extension.background.js");

const store = new Map();
const WRITE_MS = 5;
const READ_MS = 15;

function storageGet(keys, callback) {
    // Deliberately answer late: without serialization two writers both read
    // the same snapshot and the second write drops the first record.
    setTimeout(() => {
        const result = {};
        if (typeof keys === "string") {
            if (store.has(keys)) {
                result[keys] = store.get(keys);
            }
        } else if (keys === null || keys === undefined) {
            store.forEach((value, key) => {
                result[key] = value;
            });
        } else if (Array.isArray(keys)) {
            keys.forEach((key) => {
                if (store.has(key)) {
                    result[key] = store.get(key);
                }
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
        if (typeof callback === "function") {
            callback();
        }
    }, WRITE_MS);
}

const chrome = {
    runtime: {
        id: "bcampx-test-extension",
        lastError: null,
        onMessage: { addListener() {} },
        getURL(page) {
            return `chrome-extension://bcampx-test-extension/${page}`;
        },
        sendMessage(_tabId, _message, callback) {
            if (typeof callback === "function") {
                callback();
            }
        },
    },
    storage: {
        session: { get: storageGet, set: storageSet },
        local: { get: storageGet, set: storageSet },
    },
    tabs: {
        onRemoved: { addListener() {} },
        get(_tabId, callback) {
            if (typeof callback === "function") {
                callback(null);
            }
        },
        update(_tabId, _props, callback) {
            if (typeof callback === "function") {
                callback();
            }
        },
        remove(_tabId, callback) {
            if (typeof callback === "function") {
                callback();
            }
        },
    },
    permissions: {
        contains(_permissions, callback) {
            if (typeof callback === "function") {
                callback(false);
            }
        },
        request(_permissions, callback) {
            if (typeof callback === "function") {
                callback(false);
            }
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

const failures = [];
function expect(condition, message) {
    if (!condition) {
        failures.push(message);
    }
}

function pendingRequest(overrides = {}) {
    return {
        sourceTabId: 1,
        permissionTabId: -1,
        originPattern: "https://custom.example/*",
        createdAt: Date.now(),
        ...overrides,
    };
}

try {
    vm.runInContext(await readFile(sharedPath, "utf8"), sandbox, {
        filename: "extension.shared.js",
    });
    // Evaluating the background script also runs its startup prune. A
    // temporal-dead-zone error here used to break the whole service worker.
    vm.runInContext(await readFile(backgroundPath, "utf8"), sandbox, {
        filename: "extension.background.js",
    });
} catch (error) {
    console.log("host_permission_queue_test=failed");
    console.log(
        "failure=background script did not evaluate: " +
            String((error && error.message) || error),
    );
    process.exit(1);
}

const ids = ["req-1", "req-2", "req-3", "req-4"];
await Promise.all(
    ids.map((requestId) =>
        sandbox.savePendingHostPermissionRequest(
            requestId,
            pendingRequest(),
        ),
    ),
);

let records = await sandbox.readPendingHostPermissionRequests();
expect(
    Object.keys(records).length === ids.length,
    `concurrent saves retained ${Object.keys(records).length} of ${ids.length} requests`,
);
ids.forEach((requestId) => {
    expect(
        Boolean(records[requestId]),
        `concurrent saves dropped ${requestId}`,
    );
});

await sandbox.deletePendingHostPermissionRequest("req-2");
records = await sandbox.readPendingHostPermissionRequests();
expect(
    Object.keys(records).length === ids.length - 1,
    `delete left ${Object.keys(records).length} requests`,
);
expect(!("req-2" in records), "delete did not remove its own request");
["req-1", "req-3", "req-4"].forEach((requestId) => {
    expect(
        Boolean(records[requestId]),
        `delete removed an unrelated request: ${requestId}`,
    );
});

await sandbox.savePendingHostPermissionRequest(
    "stale-request",
    pendingRequest({ createdAt: Date.now() - 11 * 60 * 1000 }),
);
await sandbox.savePendingHostPermissionRequest("fresh-request", pendingRequest());
await sandbox.pruneStalePendingHostPermissionRequests();
records = await sandbox.readPendingHostPermissionRequests();
expect(!("stale-request" in records), "prune kept an expired request");
expect("fresh-request" in records, "prune dropped a fresh request");

if (failures.length) {
    console.log("host_permission_queue_test=failed");
    failures.forEach((message) => console.log("failure=" + message));
    process.exit(1);
}

console.log("host_permission_queue_test=passed");
