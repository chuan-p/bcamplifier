"use strict";

if (typeof importScripts === "function") {
    importScripts("extension.shared.js");
}
const {
    isBandcampHostname,
    normalizeCustomHostPermissionPattern,
    getExtensionApi,
    callExtensionApi,
} = globalThis.__BCAMPX_EXT_SHARED__;

const runtimeApi = getExtensionApi();
const ALLOWED_FETCH_METHODS = new Set(["GET", "POST"]);
const ALLOWED_REQUEST_HEADERS = new Set(["accept", "content-type"]);
const ALLOWED_FETCH_CREDENTIALS = new Set(["include", "omit"]);
const MAX_FETCH_TIMEOUT_MS = 15000;
const HOST_PERMISSION_REQUEST_PAGE = "extension.host-permission.html";
const HOST_PERMISSION_STORAGE_KEY = "bcampx:pendingHostPermissionRequests";
const HOST_PERMISSION_REQUEST_TTL_MS = 10 * 60 * 1000;
// Mirror of the persisted host-permission requests. The MV3 service worker can
// be torn down while the permission tab is open, so the authoritative copy
// lives in storage.session and this map is only a warm cache.
const pendingHostPermissionRequests = new Map();

// Every mutation of the pending-request map is a full read-modify-write of one
// storage.session object. Two concurrent requests (two tabs asking for a
// custom domain at once) used to read the same snapshot and overwrite each
// other, losing one request and leaving its page waiting for the timeout.
// The service worker is single threaded, so one queue is enough to make the
// read-modify-write atomic.
//
// Declared here, before the startup prune below can reach it, because a `let`
// in temporal dead zone would throw during service-worker evaluation.
let pendingHostPermissionMutationQueue = Promise.resolve();

function runPendingHostPermissionMutation(task) {
    const run = () => Promise.resolve().then(task);
    const chained = pendingHostPermissionMutationQueue.then(run, run);
    pendingHostPermissionMutationQueue = chained.then(
        () => {},
        () => {},
    );
    return chained;
}

const MESSAGE_HANDLERS = {
    "bcampx:fetch": {
        handle: (message, sender) => handleFetchRequest(message, sender),
        resultKey: "response",
        fallbackError: "Network request failed.",
    },
    "bcampx:storage-get-by-prefix": {
        handle: (message, sender) => handleGetStorageByPrefix(message, sender),
        resultKey: "values",
        fallbackError: "Storage read failed.",
    },
    "bcampx:get-host-permissions": {
        handle: (_message, sender) => handleGetHostPermissions(sender),
        resultKey: "origins",
        fallbackError: "Host permission lookup failed.",
    },
    "bcampx:start-host-permission-request": {
        handle: (message, sender) =>
            handleStartHostPermissionRequest(message, sender),
        resultKey: "result",
        fallbackError: "Could not open the host permission request.",
    },
    "bcampx:host-permission-result": {
        handle: (message, sender) =>
            handleHostPermissionResult(message, sender),
        resultKey: "result",
        fallbackError: "Could not complete the host permission request.",
    },
};

if (runtimeApi && runtimeApi.runtime) {
    runtimeApi.runtime.onMessage.addListener((message, sender, sendResponse) => {
        const spec = message && message.type ? MESSAGE_HANDLERS[message.type] : null;
        if (!spec) {
            return undefined;
        }

        spec.handle(message, sender)
            .then((value) =>
                safeSendResponse(sendResponse, {
                    ok: true,
                    [spec.resultKey]: value,
                }),
            )
            .catch((error) =>
                safeSendResponse(sendResponse, {
                    ok: false,
                    error:
                        error && error.message
                            ? error.message
                            : spec.fallbackError,
                }),
            );
        return true;
    });
}

if (runtimeApi && runtimeApi.tabs && runtimeApi.tabs.onRemoved) {
    runtimeApi.tabs.onRemoved.addListener((tabId) => {
        void handleTrackedTabRemoved(tabId);
    });
}

void pruneStalePendingHostPermissionRequests();

async function handleTrackedTabRemoved(tabId) {
    const records = await readPendingHostPermissionRequests();

    await Promise.all(
        Object.entries(records).map(async ([requestId, pending]) => {
            if (!pending || typeof pending !== "object") {
                await deletePendingHostPermissionRequest(requestId);
                return;
            }

            if (pending.sourceTabId === tabId) {
                await deletePendingHostPermissionRequest(requestId);
                return;
            }

            if (pending.permissionTabId !== tabId) {
                return;
            }

            await deletePendingHostPermissionRequest(requestId);
            try {
                await sendMessageToTab(pending.sourceTabId, {
                    type: "bcampx:host-permission-result",
                    requestId,
                    originPattern: pending.originPattern,
                    granted: false,
                    alreadyGranted: false,
                    error: "Permission request was cancelled.",
                });
            } catch (_error) {
                // The requesting tab may already be gone.
            }
        }),
    );
}

// Every mutation of the pending-request map is a full read-modify-write of one
// storage.session object; the queue that serialises them is declared at the
// top of this file, before the startup prune runs.

async function readPendingHostPermissionRequests() {
    const area = getSessionStorageArea();
    if (!area) {
        return Object.fromEntries(pendingHostPermissionRequests);
    }

    try {
        const stored = await callStorageAreaMethod(
            area,
            "get",
            HOST_PERMISSION_STORAGE_KEY,
        );
        const records =
            stored && typeof stored[HOST_PERMISSION_STORAGE_KEY] === "object"
                ? stored[HOST_PERMISSION_STORAGE_KEY]
                : {};
        syncPendingHostPermissionCache(records);
        return records;
    } catch (_error) {
        return Object.fromEntries(pendingHostPermissionRequests);
    }
}

function syncPendingHostPermissionCache(records) {
    pendingHostPermissionRequests.clear();
    Object.entries(records || {}).forEach(([requestId, record]) => {
        pendingHostPermissionRequests.set(requestId, record);
    });
}

async function writePendingHostPermissionRequests(records) {
    syncPendingHostPermissionCache(records);

    const area = getSessionStorageArea();
    if (!area) {
        return;
    }

    try {
        await callStorageAreaMethod(area, "set", {
            [HOST_PERMISSION_STORAGE_KEY]: records,
        });
    } catch (_error) {
        // The in-memory mirror still serves this worker's lifetime.
    }
}

async function getPendingHostPermissionRequest(requestId) {
    const records = await readPendingHostPermissionRequests();
    const pending = records[requestId];
    return pending && typeof pending === "object" ? pending : null;
}

function savePendingHostPermissionRequest(requestId, pending) {
    return runPendingHostPermissionMutation(async () => {
        const records = await readPendingHostPermissionRequests();
        records[requestId] = pending;
        await writePendingHostPermissionRequests(records);
    });
}

function deletePendingHostPermissionRequest(requestId) {
    return runPendingHostPermissionMutation(async () => {
        const records = await readPendingHostPermissionRequests();
        if (!(requestId in records)) {
            pendingHostPermissionRequests.delete(requestId);
            return;
        }

        delete records[requestId];
        await writePendingHostPermissionRequests(records);
    });
}

function pruneStalePendingHostPermissionRequests() {
    return runPendingHostPermissionMutation(async () => {
        const records = await readPendingHostPermissionRequests();
        const now = Date.now();
        let changed = false;

        Object.entries(records).forEach(([requestId, pending]) => {
            const createdAt = Number(pending && pending.createdAt) || 0;
            if (
                !createdAt ||
                now - createdAt > HOST_PERMISSION_REQUEST_TTL_MS
            ) {
                delete records[requestId];
                changed = true;
            }
        });

        if (changed) {
            await writePendingHostPermissionRequests(records);
        }
    });
}

function getSessionStorageArea() {
    const storage = runtimeApi && runtimeApi.storage;
    if (!storage) {
        return null;
    }

    return storage.session || null;
}

function callStorageAreaMethod(area, methodName, payload) {
    return callExtensionApi(
        runtimeApi,
        area,
        methodName,
        payload === undefined ? [] : [payload],
        { unavailableMessage: `storage.${methodName} is unavailable.` },
    );
}

function safeSendResponse(sendResponse, payload) {
    try {
        sendResponse(payload);
    } catch (_error) {
        // The originating tab may have navigated away; there is nothing to
        // respond to, and a second throw here would be an unhandled rejection.
    }
}

async function handleFetchRequest(message, sender) {
    const request = await validateFetchRequest(message, sender);
    const maxAttempts = request.method === "GET" ? 2 : 1;
    let lastError = null;

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
        const controller =
            typeof AbortController === "function"
                ? new AbortController()
                : null;
        const timeoutId =
            request.timeoutMs > 0
                ? setTimeout(() => {
                      if (controller && typeof controller.abort === "function") {
                          controller.abort();
                      }
                  }, request.timeoutMs)
                : 0;

        try {
            const response = await fetch(request.url, {
                method: request.method,
                headers: request.headers,
                body: request.body,
                credentials: request.credentials,
                redirect: "follow",
                signal: controller ? controller.signal : undefined,
            });

            return {
                status: response.status,
                responseText: await response.text(),
            };
        } catch (error) {
            if (error && error.name === "AbortError") {
                throw new Error("Network request timed out.");
            }

            lastError = error;
            if (!shouldRetryFetchError(request, error, attempt, maxAttempts)) {
                throw normalizeFetchError(error);
            }
        } finally {
            if (timeoutId) {
                clearTimeout(timeoutId);
            }
        }
    }

    throw normalizeFetchError(lastError);
}

async function handleGetStorageByPrefix(message, sender) {
    if (!isTrustedRuntimeSender(sender)) {
        throw new Error("Rejected storage read from an unknown sender.");
    }
    const prefix = String((message && message.prefix) || "");
    if (!prefix.startsWith("bcampx:")) {
        throw new Error("Rejected unexpected storage prefix.");
    }
    const storage = runtimeApi && runtimeApi.storage && runtimeApi.storage.local;
    if (!storage || typeof storage.get !== "function") {
        throw new Error("storage.local is unavailable.");
    }

    // getKeys() lets us read only the matching values. The old get(null)
    // path cloned every tag/release record just to throw most of them away;
    // on a large tag cache that is a multi-megabyte service-worker copy for
    // every prefix read.
    if (typeof storage.getKeys === "function") {
        try {
            const keys = await readStorageKeys(storage);
            if (Array.isArray(keys)) {
                const matching = keys.filter(
                    (key) =>
                        typeof key === "string" && key.startsWith(prefix),
                );
                if (!matching.length) {
                    return {};
                }
                return (await callStorageAreaMethod(storage, "get", matching)) || {};
            }
        } catch (_error) {
            // Older platforms can expose getKeys without the expected shape;
            // fall back to the full read below.
        }
    }

    const items = await callStorageAreaMethod(storage, "get", null);
    const values = {};
    Object.keys(items || {}).forEach((key) => {
        if (key.startsWith(prefix)) {
            values[key] = items[key];
        }
    });
    return values;
}

function readStorageKeys(storage) {
    // Chrome MV3 and Firefox both return a promise here. If a platform
    // exposes a callback-only shape, the result is not an array and the
    // caller falls back to the full read.
    return Promise.resolve().then(() => storage.getKeys());
}

async function handleGetHostPermissions(sender) {
    if (!isTrustedRuntimeSender(sender)) {
        throw new Error("Rejected host permission lookup from an unknown sender.");
    }

    return getGrantedCustomHostPermissionOrigins();
}

async function handleStartHostPermissionRequest(message, sender) {
    if (!isTrustedRuntimeSender(sender)) {
        throw new Error("Rejected host permission request from an unknown sender.");
    }

    const requestId = normalizeRequestId(message && message.requestId);
    if (!requestId) {
        throw new Error("Host permission request is missing an id.");
    }

    const originPattern = normalizeCustomHostPermissionPattern(
        (message && message.originPattern) || (message && message.url) || "",
    );
    if (!originPattern) {
        throw new Error("Only HTTPS Bandcamp custom domains can be requested.");
    }

    if (await hasOptionalOriginPermission(originPattern)) {
        return {
            requestId,
            originPattern,
            granted: true,
            alreadyGranted: true,
        };
    }

    const sourceTabId = getSenderTabId(sender);
    if (sourceTabId < 0) {
        throw new Error("Could not identify the Bandcamp tab for this request.");
    }

    const pageUrl = new URL(runtimeApi.runtime.getURL(HOST_PERMISSION_REQUEST_PAGE));
    pageUrl.searchParams.set("requestId", requestId);
    pageUrl.searchParams.set("origin", originPattern);
    await savePendingHostPermissionRequest(requestId, {
        sourceTabId,
        permissionTabId: -1,
        originPattern,
        createdAt: Date.now(),
    });

    try {
        const createdTab = await createTab({
            url: pageUrl.toString(),
            active: true,
        });
        const pending = await getPendingHostPermissionRequest(requestId);
        if (pending) {
            pending.permissionTabId =
                createdTab && Number.isInteger(createdTab.id)
                    ? createdTab.id
                    : -1;
            await savePendingHostPermissionRequest(requestId, pending);
        }
    } catch (error) {
        await deletePendingHostPermissionRequest(requestId);
        throw error;
    }

    return {
        requestId,
        originPattern,
        granted: false,
        alreadyGranted: false,
        opened: true,
    };
}

async function handleHostPermissionResult(message, sender) {
    if (!isTrustedExtensionPageSender(sender)) {
        throw new Error("Rejected host permission result from an unknown sender.");
    }

    const requestId = normalizeRequestId(message && message.requestId);
    if (!requestId) {
        throw new Error("Host permission result is missing an id.");
    }

    const pending = await getPendingHostPermissionRequest(requestId);
    if (!pending) {
        await closeSenderTab(sender);
        return { requestId, ignored: true };
    }

    await deletePendingHostPermissionRequest(requestId);
    const originPattern =
        normalizeCustomHostPermissionPattern(
            (message && message.originPattern) || pending.originPattern,
        ) || pending.originPattern;
    const granted =
        Boolean(message && message.granted) &&
        Boolean(originPattern) &&
        (await hasOptionalOriginPermission(originPattern));
    const errorMessage =
        message && message.error
            ? String(message.error)
            : granted
              ? ""
              : "Permission was not granted.";

    await Promise.allSettled([
        sendMessageToTab(pending.sourceTabId, {
            type: "bcampx:host-permission-result",
            requestId,
            originPattern,
            granted,
            alreadyGranted: Boolean(message && message.alreadyGranted),
            error: errorMessage,
        }),
        closeSenderTab(sender),
    ]);

    return {
        requestId,
        originPattern,
        granted,
        alreadyGranted: Boolean(message && message.alreadyGranted),
    };
}

async function validateFetchRequest(message, sender) {
    if (!isTrustedRuntimeSender(sender)) {
        throw new Error("Rejected fetch request from an unknown sender.");
    }

    const method = normalizeAllowedMethod(message && message.method);
    if (!method) {
        throw new Error("Only GET and POST requests are allowed.");
    }

    const url = await normalizeAllowedFetchUrl(message && message.url);
    if (!url) {
        throw new Error("Only HTTPS Bandcamp requests are allowed.");
    }

    return {
        url,
        method,
        headers: sanitizeHeaders(message && message.headers),
        body:
            method === "POST"
                ? normalizeRequestBody(message && message.body)
                : undefined,
        credentials: normalizeAllowedCredentials(
            message && message.credentials,
            method,
        ),
        timeoutMs: normalizeTimeoutMs(message && message.timeoutMs),
    };
}

function isTrustedRuntimeSender(sender) {
    if (!sender || typeof sender !== "object") {
        return false;
    }

    if (
        runtimeApi &&
        runtimeApi.runtime &&
        runtimeApi.runtime.id &&
        sender.id &&
        sender.id !== runtimeApi.runtime.id
    ) {
        return false;
    }

    if (sender.url) {
        return Boolean(normalizeAllowedSenderUrl(sender.url));
    }

    return false;
}

function isTrustedExtensionPageSender(sender) {
    if (!sender || typeof sender !== "object") {
        return false;
    }

    if (
        runtimeApi &&
        runtimeApi.runtime &&
        runtimeApi.runtime.id &&
        sender.id &&
        sender.id !== runtimeApi.runtime.id
    ) {
        return false;
    }

    if (typeof sender.url !== "string" || !sender.url) {
        return false;
    }

    try {
        const parsed = new URL(sender.url);
        const expected = new URL(runtimeApi.runtime.getURL(HOST_PERMISSION_REQUEST_PAGE));
        return (
            parsed.protocol === expected.protocol &&
            parsed.host === expected.host &&
            parsed.pathname === expected.pathname
        );
    } catch (_error) {
        return false;
    }
}

function getSenderTabId(sender) {
    return sender && sender.tab && Number.isInteger(sender.tab.id)
        ? sender.tab.id
        : -1;
}

function normalizeAllowedSenderUrl(rawUrl) {
    return normalizeAllowedBandcampUrl(rawUrl);
}

function normalizeAllowedBandcampUrl(rawUrl) {
    if (typeof rawUrl !== "string" || !rawUrl) {
        return "";
    }

    let parsed;
    try {
        parsed = new URL(rawUrl);
    } catch (_error) {
        return "";
    }

    if (parsed.protocol !== "https:") {
        return "";
    }

    if (!isBandcampHostname(parsed.hostname)) {
        return "";
    }

    return parsed.toString();
}

async function normalizeAllowedFetchUrl(rawUrl) {
    if (typeof rawUrl !== "string" || !rawUrl) {
        return "";
    }

    let parsed;
    try {
        parsed = new URL(rawUrl);
    } catch (_error) {
        return "";
    }

    if (parsed.protocol !== "https:") {
        return "";
    }

    if (isBandcampHostname(parsed.hostname)) {
        return parsed.toString();
    }

    const originPattern = `${parsed.origin}/*`;
    if (!(await hasOptionalOriginPermission(originPattern))) {
        throw new Error(`Host permission required for ${originPattern}`);
    }

    return parsed.toString();
}

function normalizeRequestId(rawRequestId) {
    const requestId = String(rawRequestId || "").trim();
    return requestId ? requestId : "";
}

async function hasOptionalOriginPermission(originPattern) {
    const normalized = normalizeCustomHostPermissionPattern(originPattern);
    if (!normalized) {
        return false;
    }

    return Boolean(
        await callPermissionsMethod("contains", {
            origins: [normalized],
        }),
    );
}

async function getGrantedCustomHostPermissionOrigins() {
    const details = await callPermissionsMethod("getAll");
    const origins =
        details && Array.isArray(details.origins) ? details.origins : [];

    return Array.from(
        new Set(
            origins
                .map((originPattern) =>
                    normalizeCustomHostPermissionPattern(originPattern),
                )
                .filter(Boolean),
        ),
    );
}

function normalizeAllowedMethod(rawMethod) {
    const method = String(rawMethod || "GET").trim().toUpperCase();
    if (!ALLOWED_FETCH_METHODS.has(method)) {
        return "";
    }

    return method;
}

function normalizeRequestBody(body) {
    if (body == null) {
        return undefined;
    }

    if (typeof body !== "string") {
        throw new Error("Only string request bodies are allowed.");
    }

    return body;
}

function normalizeAllowedCredentials(rawCredentials, method) {
    const defaultCredentials = method === "GET" ? "omit" : "include";
    const credentials = String(rawCredentials || defaultCredentials)
        .trim()
        .toLowerCase();
    if (!ALLOWED_FETCH_CREDENTIALS.has(credentials)) {
        return defaultCredentials;
    }

    return credentials;
}

function shouldRetryFetchError(request, error, attempt, maxAttempts) {
    if (!request || request.method !== "GET" || attempt >= maxAttempts) {
        return false;
    }

    return isLikelyNetworkFetchError(error);
}

function isLikelyNetworkFetchError(error) {
    if (!error) {
        return false;
    }

    if (error.name === "TypeError") {
        return true;
    }

    return /Failed to fetch/i.test(error.message || "");
}

function normalizeFetchError(error) {
    if (!error) {
        return new Error("Network request failed.");
    }

    if (error.name === "AbortError") {
        return new Error("Network request timed out.");
    }

    if (!isLikelyNetworkFetchError(error)) {
        return error;
    }

    if (typeof navigator !== "undefined" && navigator && navigator.onLine === false) {
        return new Error("Browser appears to be offline.");
    }

    return new Error(
        "Network blocked or unavailable. This can be caused by browser privacy settings, another extension, VPN/proxy software, or Bandcamp/network issues.",
    );
}

function normalizeTimeoutMs(rawTimeoutMs) {
    const timeoutMs = Number(rawTimeoutMs || 0);
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
        return 0;
    }

    return Math.min(Math.round(timeoutMs), MAX_FETCH_TIMEOUT_MS);
}

function sanitizeHeaders(headers) {
    if (!headers || typeof headers !== "object") {
        return undefined;
    }

    const entries = Object.entries(headers).filter(([key, value]) => {
        if (typeof key !== "string" || typeof value !== "string") {
            return false;
        }

        return ALLOWED_REQUEST_HEADERS.has(key.toLowerCase());
    });
    if (!entries.length) {
        return undefined;
    }

    const sanitized = {};
    entries.forEach(([key, value]) => {
        sanitized[key] = value;
    });
    return sanitized;
}

function callPermissionsMethod(methodName, payload) {
    return callExtensionApi(
        runtimeApi,
        runtimeApi && runtimeApi.permissions,
        methodName,
        payload === undefined ? [] : [payload],
        { unavailableMessage: `permissions.${methodName} is unavailable.` },
    );
}

function createTab(createProperties) {
    return callExtensionApi(
        runtimeApi,
        runtimeApi && runtimeApi.tabs,
        "create",
        [createProperties],
        {
            unavailableMessage: "tabs.create is unavailable.",
            fallbackMessage: "Could not create a tab.",
        },
    );
}

function sendMessageToTab(tabId, message) {
    if (!Number.isInteger(tabId) || tabId < 0) {
        return Promise.reject(new Error("Invalid tab id."));
    }

    return callExtensionApi(
        runtimeApi,
        runtimeApi && runtimeApi.tabs,
        "sendMessage",
        [tabId, message],
        {
            unavailableMessage: "tabs.sendMessage is unavailable.",
            fallbackMessage: "Could not message the tab.",
        },
    );
}

function closeSenderTab(sender) {
    const tabId = getSenderTabId(sender);
    if (tabId < 0) {
        return Promise.resolve();
    }

    return callExtensionApi(
        runtimeApi,
        runtimeApi && runtimeApi.tabs,
        "remove",
        [tabId],
        { ignoreErrors: true },
    );
}
