#!/usr/bin/env node

// Regression test for the custom-domain permission button in Firefox.
//
// Firefox does not expose the `browser` namespace as a plain object: its APIs
// are not own enumerable properties, so `{ ...browser }` copies none of them.
// A facade built by spreading the namespace therefore lost `tabs`, and
// `tabs.create` (which opens the permission page) failed before any tab was
// shown: clicking "Allow this domain" produced no visible effect at all.
//
// This test loads the real shared/background scripts in a VM with a namespace
// that behaves like Firefox's, then drives the background handler directly and
// checks that the permission page is actually opened.

import { readFile } from "node:fs/promises";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const scriptPath = fileURLToPath(import.meta.url);
const rootDir = path.resolve(path.dirname(scriptPath), "..");
const sharedPath = path.join(rootDir, "extension.shared.js");
const backgroundPath = path.join(rootDir, "extension.background.js");

const EXTENSION_ID = "bcampx-test-extension";
const store = new Map();
const createdTabs = [];
let containsResult = false;

function storageGet(keys, callback) {
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
}

function storageSet(items, callback) {
    Object.entries(items || {}).forEach(([key, value]) => {
        store.set(key, value);
    });
    if (typeof callback === "function") {
        callback();
    }
}

// Like Firefox: the API namespaces exist, but they are not own enumerable
// properties, so spreading the namespace yields an empty object.
const firefoxBrowser = Object.create(null);
Object.defineProperties(firefoxBrowser, {
    runtime: {
        enumerable: false,
        value: {
            id: EXTENSION_ID,
            lastError: null,
            onMessage: { addListener() {} },
            getURL(page) {
                return `moz-extension://bcampx-test/${page}`;
            },
            sendMessage(_tabId, _message, callback) {
                if (typeof callback === "function") {
                    callback();
                }
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
            // Firefox resolves these with promises instead of callbacks.
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
                if (typeof callback === "function") {
                    callback(tab);
                }
                return Promise.resolve(tab);
            },
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
            sendMessage(_tabId, _message, callback) {
                if (typeof callback === "function") {
                    callback();
                }
            },
        },
    },
});

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

const failures = [];
function expect(condition, message) {
    if (!condition) {
        failures.push(message);
    }
}

const spreadKeys = Object.keys({ ...firefoxBrowser });
expect(
    spreadKeys.length === 0,
    `test namespace is not Firefox-like: spread copied ${spreadKeys.join(",")}`,
);

try {
    vm.runInContext(await readFile(sharedPath, "utf8"), sandbox, {
        filename: "extension.shared.js",
    });
    vm.runInContext(await readFile(backgroundPath, "utf8"), sandbox, {
        filename: "extension.background.js",
    });
} catch (error) {
    console.log("host_permission_firefox_api_test=failed");
    console.log(
        "failure=extension scripts did not evaluate: " +
            String((error && error.message) || error),
    );
    process.exit(1);
}

const api = sandbox.__BCAMPX_EXT_SHARED__.getExtensionApi();
expect(api && api.kind === "browser", "facade did not detect the browser namespace");
["runtime", "storage", "permissions", "tabs"].forEach((name) => {
    expect(
        Boolean(api && api[name]),
        `facade dropped the ${name} namespace`,
    );
});

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

expect(
    result && result.opened === true,
    "host permission handler did not report an opened request",
);
expect(
    createdTabs.length === 1,
    `host permission handler created ${createdTabs.length} tabs instead of 1`,
);
const createdTab = createdTabs[0];
const createdUrl = createdTab ? String(createdTab.url || "") : "";
expect(
    createdUrl.startsWith("moz-extension://bcampx-test/extension.host-permission.html"),
    `permission page URL was not opened: ${createdUrl || "(none)"}`,
);
expect(
    createdUrl.includes("requestId=req-firefox"),
    "permission page URL lost the request id",
);
expect(
    createdUrl.includes(`origin=${encodeURIComponent("https://shop.fixture.example/*")}`),
    "permission page URL lost the requested origin",
);

const pending = await sandbox.getPendingHostPermissionRequest("req-firefox");
expect(Boolean(pending), "the opened request was not persisted");
expect(
    Number(pending && pending.sourceTabId) === 7,
    "the request did not remember the source tab",
);
expect(
    Number(pending && pending.permissionTabId) === 100,
    "the request did not remember the permission tab",
);

// Already-granted domains must short-circuit without opening a tab.
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
expect(
    alreadyGranted && alreadyGranted.granted === true,
    "an already granted domain was not reported as granted",
);
expect(
    createdTabs.length === 1,
    "an already granted domain opened another tab",
);

if (failures.length) {
    console.log("host_permission_firefox_api_test=failed");
    failures.forEach((message) => console.log("failure=" + message));
    process.exit(1);
}

console.log("host_permission_firefox_api_test=passed");
