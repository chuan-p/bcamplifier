#!/usr/bin/env node

// Regression test for the custom-domain permission page on Firefox-like
// non-enumerable `browser` namespaces.

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sharedPath = path.join(rootDir, "extension.shared.js");
const pagePath = path.join(rootDir, "extension.host-permission.js");

test("host permission page requests permission, notifies background, and closes tab", async () => {
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
                listeners.get("click")?.();
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
                getURL: (page) => `moz-extension://bcampx-test/${page}`,
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
                getCurrent: () => Promise.resolve({ id: 55 }),
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
            querySelector: (selector) => elements.get(selector) || null,
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

    vm.runInContext(await readFile(sharedPath, "utf8"), sandbox, {
        filename: "extension.shared.js",
    });
    vm.runInContext(await readFile(pagePath, "utf8"), sandbox, {
        filename: "extension.host-permission.js",
    });

    assert.equal(domainLabel.textContent, ORIGIN_PATTERN);
    assert.equal(allowButton.disabled, false);

    allowButton.click();
    await new Promise((resolve) => setTimeout(resolve, 20));

    const requestCall = permissionRequests.find((call) => call.method === "request");
    assert.ok(requestCall);
    assert.deepEqual(Array.from(requestCall.details?.origins || []), [ORIGIN_PATTERN]);

    const resultMessage = runtimeMessages.find(
        (message) => message?.type === "bcampx:host-permission-result",
    );
    assert.equal(resultMessage?.granted, true);
    assert.equal(resultMessage?.requestId, "req-page");
    assert.deepEqual(removedTabs, [55]);
    assert.match(statusNode.textContent, /returning to bandcamp/i);
});
