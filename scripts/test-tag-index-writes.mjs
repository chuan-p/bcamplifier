#!/usr/bin/env node

// Unit tests for the tag index persistence contract.

import assert from "node:assert/strict";
import test from "node:test";

const attrs = {};
globalThis.document = {
    documentElement: {
        setAttribute(name, value) {
            attrs[name] = String(value);
        },
        getAttribute(name) {
            return name in attrs ? attrs[name] : null;
        },
        removeAttribute(name) {
            delete attrs[name];
        },
    },
};
globalThis.window = {
    setTimeout,
    clearTimeout,
    location: { href: "https://bandcamp.com/fixture-fan" },
    localStorage: { getItem: () => null },
};

const storage = { writesSucceed: true, writes: 0, reads: 0 };
globalThis.__BCAMPX_HOST__ = {
    storageGet: async (_key, fallback) => {
        storage.reads += 1;
        return fallback;
    },
    storageGetByPrefix: async () => {
        storage.reads += 1;
        return {};
    },
    storageSet: async () => {
        storage.writes += 1;
        if (!storage.writesSucceed) {
            throw new Error("QUOTA_BYTES quota exceeded");
        }
    },
    storageRemove: async () => {},
};

const { STATE } = await import("../src/state.js");
const { flushTagIndexWrites, saveFanTagIndexStatus } = await import(
    "../src/data/tag-index.js"
);

function resetFixture() {
    for (const key of Object.keys(attrs)) {
        delete attrs[key];
    }
    storage.writesSucceed = true;
    storage.writes = 0;
    storage.reads = 0;
    STATE.releaseTagCacheInitialized = true;
    STATE.releaseTagCache = {};
    STATE.releaseTagPendingWrites = new Map();
    STATE.fanTagIndexCache = new Map();
    STATE.tagIndexSeedIds = {};
    STATE.tagIndexDirty = new Map();
}

function makeIndex() {
    return {
        items: [],
        token: "",
        itemsComplete: false,
        itemsUpdatedAt: 1,
        refreshSeen: [],
        failures: {},
    };
}

function queueWrite(index) {
    STATE.tagIndexDirty.set("1:collection", {
        fanId: 1,
        kind: "collection",
        index,
        itemsChanged: true,
    });
}

test("a refused index write is reported on the page", async () => {
    resetFixture();
    storage.writesSucceed = false;
    queueWrite(makeIndex());
    await flushTagIndexWrites();

    assert.equal(
        attrs["data-bcampx-tag-index-write-error"],
        "the browser refused the write (storage full or unavailable)",
    );
    assert.ok(storage.writes > 0);
});

test("a successful index write stays quiet", async () => {
    resetFixture();
    queueWrite(makeIndex());
    await flushTagIndexWrites();

    assert.equal(attrs["data-bcampx-tag-index-write-error"], undefined);
});

test("saveFanTagIndexStatus reports storage success or refusal", async () => {
    resetFixture();
    storage.writesSucceed = false;
    assert.equal(await saveFanTagIndexStatus(1, "collection", makeIndex()), false);

    storage.writesSucceed = true;
    assert.equal(await saveFanTagIndexStatus(1, "collection", makeIndex()), true);
});
