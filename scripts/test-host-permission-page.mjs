#!/usr/bin/env node

// Regression test for the custom-domain permission page.
//
// The page is the only place allowed to call permissions.request(), because
// Firefox requires a user input handler. It used to build its API facade by
// spreading the `browser` namespace, which is not a plain object in Firefox:
// the facade had no `permissions` and no `tabs`, so the request failed before
// the browser was ever asked and the tab closed without granting anything.
//
// This test runs the real page script against a Firefox-like namespace plus a
// minimal DOM stub, clicks "Allow access", and checks the request reaches the
// browser and reports back.

import { readFile } from "node:fs/promises";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const scriptPath = fileURLToPath(import.meta.url);
const rootDir = path.resolve(path.dirname(scriptPath), "..");
const sharedPath = path.join(rootDir, "extension.shared.js");
const pagePath = path.join(rootDir, "extension.host-permission.js");

const EXTENSION_ID = "bcampx-test-extension";
const ORIGIN_PATTERN = "https://shop.fixture.example/*";

const permissionRequests = [];
const runtimeMessages = [];
const removedTabs = [];

function createElementStub(id) {
    const listeners = new Map();
    return {
        id,
        textContent: "",
        disabled: false,
        addEventListener(type, handler) {
            listeners.set(type, handler);
        },
        click() {
            const handler = listeners.get("click");
            if (handler) {
                handler();
            }
        },
    };
}

const allowButton = createElementStub("allow-button");
const cancelButton = createElementStub("cancel-button");
const statusNode = createElementStub("status");
const domainLabel = createElementStub("domain-label");
const elements = new Map([
    ["#allow-button", allowButton],
    ["#cancel-button", cancelButton],
    ["#status", statusNode],
    ["#domain-label", domainLabel],
]);

const firefoxBrowser = Object.create(null);
Object.defineProperties(firefoxBrowser, {
    runtime: {
        enumerable: false,
        value: {
            id: EXTENSION_ID,
            lastError: null,
            getURL(page) {
                return `moz-extension://bcampx-test/${page}`;
            },
            sendMessage(message) {
                runtimeMessages.push(message);
                return Promise.resolve({ ok: true });
            },
        },
    },
    permissions: {
        enumerable: false,
        value: {
            contains(details) {
                permissionRequests.push({ method: "contains", details });
                return Promise.resolve(false);
            },
            request(details) {
                permissionRequests.push({ method: "request", details });
                return Promise.resolve(true);
            },
            onAdded: { addListener() {} },
            onRemoved: { addListener() {} },
        },
    },
    tabs: {
        enumerable: false,
        value: {
            getCurrent() {
                return Promise.resolve({ id: 55 });
            },
            remove(tabId) {
                removedTabs.push(tabId);
                return Promise.resolve();
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
    document: {
        querySelector(selector) {
            return elements.get(selector) || null;
        },
    },
    window: {
        location: {
            search: `?requestId=req-page&origin=${encodeURIComponent(ORIGIN_PATTERN)}`,
        },
        close() {
            throw new Error("window.close() reached before tabs.remove()");
        },
    },
};
sandbox.globalThis = sandbox;
vm.createContext(sandbox);

const failures = [];
function expect(condition, message) {
    if (!condition) {
        failures.push(message);
    }
}

try {
    vm.runInContext(await readFile(sharedPath, "utf8"), sandbox, {
        filename: "extension.shared.js",
    });
    vm.runInContext(await readFile(pagePath, "utf8"), sandbox, {
        filename: "extension.host-permission.js",
    });
} catch (error) {
    console.log("host_permission_page_test=failed");
    console.log(
        "failure=page script did not evaluate: " +
            String((error && error.message) || error),
    );
    process.exit(1);
}

expect(
    domainLabel.textContent === ORIGIN_PATTERN,
    `the page did not show the requested domain: ${domainLabel.textContent}`,
);
expect(
    allowButton.disabled === false,
    "the page disabled the allow button before the user clicked it",
);

allowButton.click();
await new Promise((resolve) => setTimeout(resolve, 20));

const requestCall = permissionRequests.find((call) => call.method === "request");
expect(Boolean(requestCall), "clicking Allow access never called permissions.request()");
expect(
    Boolean(
        requestCall &&
            Array.isArray(requestCall.details && requestCall.details.origins) &&
            requestCall.details.origins[0] === ORIGIN_PATTERN,
    ),
    `permissions.request() asked for the wrong origins: ${JSON.stringify(
        requestCall && requestCall.details,
    )}`,
);

const resultMessage = runtimeMessages.find(
    (message) => message && message.type === "bcampx:host-permission-result",
);
expect(Boolean(resultMessage), "the page did not report the result to the background");
expect(
    Boolean(resultMessage && resultMessage.granted === true),
    "the granted permission was not reported as granted",
);
expect(
    Boolean(resultMessage && resultMessage.requestId === "req-page"),
    "the result message lost the request id",
);
expect(
    removedTabs.length === 1 && removedTabs[0] === 55,
    `the page closed ${removedTabs.length} tabs instead of its own`,
);
expect(
    /returning to bandcamp/i.test(statusNode.textContent),
    `the page did not confirm the granted access: ${statusNode.textContent}`,
);

if (failures.length) {
    console.log("host_permission_page_test=failed");
    failures.forEach((message) => console.log("failure=" + message));
    process.exit(1);
}

console.log("host_permission_page_test=passed");
