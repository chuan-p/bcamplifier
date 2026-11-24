import { canUseExternalHostMethod, getExternalHostApi } from "./host-bridge.js";
import {
    CACHE_SCHEMA_VERSION,
    CONFIG,
    RELEASE_CACHE_INDEX_KEY,
    RELEASE_CACHE_INDEX_LOCK_NAME,
    RELEASE_CACHE_PREFIX,
    RELEASE_CACHE_REPAIR_KEY,
    RELEASE_SUPPORTER_COUNT_CACHE_PREFIX,
    STATE,
} from "../state.js";
import { createSerialQueue } from "./async.js";
import { cleanText } from "./text-format.js";

const storageState = {
    releaseCacheRepairAttempted: false,
};

// Storage failures are reported, not swallowed. The callers keep their
// existing fallback behaviour (a read falls back, a write that cannot be
// persisted returns false), but every failure leaves a trace on the page so
// a full quota or a torn-down extension is diagnosable instead of looking
// like "the cache just never works".
function noteStorageFailure(operation, error) {
    const message =
        error && error.message ? String(error.message) : String(error || "");
    try {
        document.documentElement.setAttribute(
            "data-bcampx-storage-error",
            cleanText(`${operation}: ${message}`).slice(0, 160),
        );
        const count = Number(
            document.documentElement.getAttribute(
                "data-bcampx-storage-error-count",
            ) || "0",
        );
        document.documentElement.setAttribute(
            "data-bcampx-storage-error-count",
            String(Number.isFinite(count) ? count + 1 : 1),
        );
    } catch (_error) {
        // Diagnostics must never break the page.
    }
}

export function storageGet(key, fallback) {
    if (canUseExternalHostMethod("storageGet")) {
        return Promise.resolve(
            getExternalHostApi().storageGet(key, fallback),
        ).catch((error) => {
            noteStorageFailure("read", error);
            return fallback;
        });
    }

    try {
        if (typeof GM_getValue === "function") {
            return Promise.resolve(GM_getValue(key, fallback));
        }
    } catch (error) {
        noteStorageFailure("read", error);
        return Promise.resolve(fallback);
    }

    return Promise.resolve(fallback);
}

export function storageGetByPrefix(prefix) {
    if (!prefix) {
        return Promise.resolve(null);
    }

    if (canUseExternalHostMethod("storageGetByPrefix")) {
        return Promise.resolve(
            getExternalHostApi().storageGetByPrefix(prefix),
        ).catch((error) => {
            noteStorageFailure("read-prefix", error);
            return null;
        });
    }

    try {
        if (
            typeof GM_listValues === "function" &&
            typeof GM_getValue === "function"
        ) {
            const values = {};
            (GM_listValues() || []).forEach((key) => {
                if (typeof key === "string" && key.startsWith(prefix)) {
                    values[key] = GM_getValue(key);
                }
            });
            return Promise.resolve(values);
        }
    } catch (error) {
        noteStorageFailure("read-prefix", error);
        return Promise.resolve(null);
    }

    return Promise.resolve(null);
}

// Resolves true when the value reached storage and false when it did not.
// Callers that only cache may ignore the result; callers that promise
// persistence (the tag index) must check it.
export function storageSet(key, value) {
    if (canUseExternalHostMethod("storageSet")) {
        return Promise.resolve(
            getExternalHostApi().storageSet(key, value),
        ).then(
            () => true,
            (error) => {
                noteStorageFailure("write", error);
                return false;
            },
        );
    }

    try {
        if (typeof GM_setValue === "function") {
            return Promise.resolve(GM_setValue(key, value)).then(
                () => true,
                (error) => {
                    noteStorageFailure("write", error);
                    return false;
                },
            );
        }
    } catch (error) {
        noteStorageFailure("write", error);
        return Promise.resolve(false);
    }

    return Promise.resolve(false);
}

export function storageDelete(key) {
    if (!key) {
        return Promise.resolve(true);
    }

    if (canUseExternalHostMethod("storageRemove")) {
        return Promise.resolve(
            getExternalHostApi().storageRemove(key),
        ).then(
            () => true,
            (error) => {
                noteStorageFailure("delete", error);
                return false;
            },
        );
    }

    try {
        if (typeof GM_deleteValue === "function") {
            return Promise.resolve(GM_deleteValue(key)).then(
                () => true,
                (error) => {
                    noteStorageFailure("delete", error);
                    return false;
                },
            );
        }
    } catch (error) {
        noteStorageFailure("delete", error);
        return Promise.resolve(false);
    }

    return Promise.resolve(false);
}

// Per-release cache entries are only pruned when a new one is written:
// expired entries first, then the oldest ones beyond the configured cap.
// Without this the cache grows until the storage quota is exhausted.
//
// The index is one object shared by every release write, including the
// concurrent ones (the release queue runs four fetches at a time) and the
// other tabs. A plain read-modify-write therefore loses the keys another
// writer added in between, and a lost key is never pruned again because
// cleanup only walks the index. The lock name and repair policy constants
// are declared with the other cache constants at the top of this file.

const runReleaseCacheIndexTask = createSerialQueue();

function withReleaseCacheIndexLock(task) {
    const execute = () => runReleaseCacheIndexTask(task);
    const locks =
        typeof navigator === "object" && navigator ? navigator.locks : null;
    if (!locks || typeof locks.request !== "function") {
        return execute();
    }

    // Web Locks are origin-scoped, so this also serialises the index
    // against another tab running the same content script. If the lock
    // cannot be taken at all, the callback never ran and the in-process
    // queue is still a correct fallback.
    let started = false;
    return new Promise((resolve, reject) => {
        locks
            .request(RELEASE_CACHE_INDEX_LOCK_NAME, () => {
                started = true;
                return execute();
            })
            .then(resolve, (error) => {
                if (started) {
                    reject(error);
                    return;
                }
                execute().then(resolve, reject);
            });
    });
}

export function trackReleaseCacheEntry(cacheKey) {
    if (!cacheKey) {
        return Promise.resolve();
    }

    return withReleaseCacheIndexLock(() =>
        trackReleaseCacheEntryLocked(cacheKey),
    );
}

async function trackReleaseCacheEntryLocked(cacheKey) {
    const rawIndex = await storageGet(RELEASE_CACHE_INDEX_KEY, null);
    const index =
        rawIndex && typeof rawIndex === "object" ? { ...rawIndex } : {};
    index[cacheKey] = Date.now();

    // Entries written before the index was repaired (or whose index update
    // was lost) are invisible to the cap below. Rebuilding from the real
    // keys is expensive, so it runs at most a few times per day.
    await repairReleaseCacheIndex(index);

    const maxEntries = Math.max(
        0,
        Math.floor(Number(CONFIG.maxReleaseCacheEntries) || 0),
    );
    const maxAgeMs = Math.max(
        Number(CONFIG.cacheTtlMs) || 0,
        Number(CONFIG.supporterCountCacheTtlMs) || 0,
    );
    const now = Date.now();

    let entries = Object.entries(index).filter(([, fetchedAt]) => {
        const timestamp = Number(fetchedAt) || 0;
        return timestamp > 0 && (!maxAgeMs || now - timestamp <= maxAgeMs);
    });
    entries.sort((left, right) => Number(left[1]) - Number(right[1]));
    if (maxEntries && entries.length > maxEntries) {
        entries = entries.slice(entries.length - maxEntries);
    }

    const nextIndex = {};
    entries.forEach(([key, fetchedAt]) => {
        nextIndex[key] = fetchedAt;
    });

    const removedKeys = Object.keys(index).filter(
        (key) => !(key in nextIndex),
    );
    if (removedKeys.length) {
        await Promise.all(removedKeys.map((key) => storageDelete(key)));
    }

    await storageSet(RELEASE_CACHE_INDEX_KEY, nextIndex);
}

async function repairReleaseCacheIndex(index) {
    // Enumerating every cached value is expensive, and the index lock keeps
    // it correct afterwards. Repair once per cache schema version and after
    // an interrupted earlier repair, not every few hours: each enumeration
    // reads all release and supporter values, and in the extension a prefix
    // read copies the whole local storage first.
    if (storageState.releaseCacheRepairAttempted) {
        return;
    }
    storageState.releaseCacheRepairAttempted = true;
    const marker = await storageGet(RELEASE_CACHE_REPAIR_KEY, null);
    const repairedVersion =
        Number(marker && marker.schemaVersion) || 0;
    if (repairedVersion === CACHE_SCHEMA_VERSION) {
        return;
    }

    const [releaseValues, supporterValues] = await Promise.all([
        storageGetByPrefix(RELEASE_CACHE_PREFIX),
        storageGetByPrefix(RELEASE_SUPPORTER_COUNT_CACHE_PREFIX),
    ]);
    if (
        (!releaseValues || typeof releaseValues !== "object") &&
        (!supporterValues || typeof supporterValues !== "object")
    ) {
        // The host cannot enumerate keys; keep using the index alone and
        // remember the attempt so a write does not retry it every time.
        await storageSet(RELEASE_CACHE_REPAIR_KEY, {
            schemaVersion: CACHE_SCHEMA_VERSION,
            at: Date.now(),
        });
        return;
    }

    const addEntries = (values) => {
        Object.entries(values || {}).forEach(([key, value]) => {
            if (Object.prototype.hasOwnProperty.call(index, key)) {
                return;
            }
            const fetchedAt = Number(value && value.fetchedAt) || 0;
            if (fetchedAt > 0) {
                index[key] = fetchedAt;
            }
        });
    };
    addEntries(releaseValues);
    addEntries(supporterValues);
    await storageSet(RELEASE_CACHE_REPAIR_KEY, {
        schemaVersion: CACHE_SCHEMA_VERSION,
        at: Date.now(),
    });
}
