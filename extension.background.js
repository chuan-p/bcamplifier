"use strict";

const runtimeApi = getExtensionApi();
const ALLOWED_FETCH_HOSTS = ["bandcamp.com"];
const ALLOWED_FETCH_METHODS = new Set(["GET", "POST"]);
const ALLOWED_REQUEST_HEADERS = new Set(["accept", "content-type"]);
const ALLOWED_FETCH_CREDENTIALS = new Set(["include", "omit"]);
const MAX_FETCH_TIMEOUT_MS = 15000;
const HOST_PERMISSION_REQUEST_PAGE = "extension.host-permission.html";
const pendingHostPermissionRequests = new Map();

if (runtimeApi && runtimeApi.runtime) {
    runtimeApi.runtime.onMessage.addListener((message, sender, sendResponse) => {
        if (!message || !message.type) {
            return undefined;
        }

        if (message.type === "bcampx:fetch") {
            handleFetchRequest(message, sender)
                .then((response) => sendResponse({ ok: true, response }))
                .catch((error) =>
                    sendResponse({
                        ok: false,
                        error:
                            error && error.message
                                ? error.message
                                : "Network request failed.",
                    }),
                );
            return true;
        }

        if (message.type === "bcampx:get-host-permissions") {
            handleGetHostPermissions(sender)
                .then((origins) => sendResponse({ ok: true, origins }))
                .catch((error) =>
                    sendResponse({
                        ok: false,
                        error:
                            error && error.message
                                ? error.message
                                : "Host permission lookup failed.",
                    }),
                );
            return true;
        }

        if (message.type === "bcampx:start-host-permission-request") {
            handleStartHostPermissionRequest(message, sender)
                .then((result) => sendResponse({ ok: true, result }))
                .catch((error) =>
                    sendResponse({
                        ok: false,
                        error:
                            error && error.message
                                ? error.message
                                : "Could not open the host permission request.",
                    }),
                );
            return true;
        }

        if (message.type === "bcampx:host-permission-result") {
            handleHostPermissionResult(message, sender)
                .then((result) => sendResponse({ ok: true, result }))
                .catch((error) =>
                    sendResponse({
                        ok: false,
                        error:
                            error && error.message
                                ? error.message
                                : "Could not complete the host permission request.",
                    }),
                );
            return true;
        }

        return undefined;
    });
}

function getExtensionApi() {
    if (globalThis.browser && globalThis.browser.runtime) {
        return { kind: "browser", ...globalThis.browser };
    }

    if (globalThis.chrome && globalThis.chrome.runtime) {
        return { kind: "chrome", ...globalThis.chrome };
    }

    return null;
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

    pendingHostPermissionRequests.set(requestId, {
        sourceTabId,
        originPattern,
    });

    const pageUrl = new URL(runtimeApi.runtime.getURL(HOST_PERMISSION_REQUEST_PAGE));
    pageUrl.searchParams.set("requestId", requestId);
    pageUrl.searchParams.set("origin", originPattern);
    await createTab({
        url: pageUrl.toString(),
        active: true,
    });

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

    const pending = pendingHostPermissionRequests.get(requestId);
    if (!pending) {
        await closeSenderTab(sender);
        return { requestId, ignored: true };
    }

    pendingHostPermissionRequests.delete(requestId);
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

    const originPattern = normalizeCustomHostPermissionPattern(parsed.toString());
    if (!originPattern) {
        return "";
    }

    if (!(await hasOptionalOriginPermission(originPattern))) {
        throw new Error(`Host permission required for ${originPattern}`);
    }

    return parsed.toString();
}

function normalizeCustomHostPermissionPattern(rawUrl) {
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

    if (!parsed.hostname || isBandcampHostname(parsed.hostname)) {
        return "";
    }

    return `${parsed.origin}/*`;
}

function normalizeRequestId(rawRequestId) {
    const requestId = String(rawRequestId || "").trim();
    return requestId ? requestId : "";
}

function isBandcampHostname(rawHostname) {
    const hostname = String(rawHostname || "").trim().toLowerCase();
    return ALLOWED_FETCH_HOSTS.some(
        (host) => hostname === host || hostname.endsWith(`.${host}`),
    );
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
        if (typeof key !== "string" || value == null) {
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
    const permissions = runtimeApi && runtimeApi.permissions;
    if (!permissions || typeof permissions[methodName] !== "function") {
        return Promise.reject(
            new Error(`permissions.${methodName} is unavailable.`),
        );
    }

    if (runtimeApi.kind === "browser") {
        try {
            return payload === undefined
                ? Promise.resolve(permissions[methodName]())
                : Promise.resolve(permissions[methodName](payload));
        } catch (error) {
            return Promise.reject(error);
        }
    }

    return new Promise((resolve, reject) => {
        const callback = (result) => {
            const error = runtimeApi.runtime && runtimeApi.runtime.lastError;
            if (error) {
                reject(new Error(error.message || `${methodName} failed.`));
                return;
            }

            resolve(result);
        };

        if (payload === undefined) {
            permissions[methodName](callback);
            return;
        }

        permissions[methodName](payload, callback);
    });
}

function createTab(createProperties) {
    const tabs = runtimeApi && runtimeApi.tabs;
    if (!tabs || typeof tabs.create !== "function") {
        return Promise.reject(new Error("tabs.create is unavailable."));
    }

    if (runtimeApi.kind === "browser") {
        try {
            return Promise.resolve(tabs.create(createProperties));
        } catch (error) {
            return Promise.reject(error);
        }
    }

    return new Promise((resolve, reject) => {
        tabs.create(createProperties, (tab) => {
            const error = runtimeApi.runtime && runtimeApi.runtime.lastError;
            if (error) {
                reject(new Error(error.message || "Could not create a tab."));
                return;
            }

            resolve(tab);
        });
    });
}

function sendMessageToTab(tabId, message) {
    const tabs = runtimeApi && runtimeApi.tabs;
    if (!tabs || typeof tabs.sendMessage !== "function") {
        return Promise.reject(new Error("tabs.sendMessage is unavailable."));
    }

    if (!Number.isInteger(tabId) || tabId < 0) {
        return Promise.reject(new Error("Invalid tab id."));
    }

    if (runtimeApi.kind === "browser") {
        return Promise.resolve(tabs.sendMessage(tabId, message));
    }

    return new Promise((resolve, reject) => {
        tabs.sendMessage(tabId, message, (response) => {
            const error = runtimeApi.runtime && runtimeApi.runtime.lastError;
            if (error) {
                reject(new Error(error.message || "Could not message the tab."));
                return;
            }

            resolve(response);
        });
    });
}

function closeSenderTab(sender) {
    const tabId = getSenderTabId(sender);
    if (tabId < 0) {
        return Promise.resolve();
    }

    const tabs = runtimeApi && runtimeApi.tabs;
    if (!tabs || typeof tabs.remove !== "function") {
        return Promise.resolve();
    }

    if (runtimeApi.kind === "browser") {
        return Promise.resolve(tabs.remove(tabId)).catch(() => {});
    }

    return new Promise((resolve) => {
        tabs.remove(tabId, () => {
            void (runtimeApi.runtime && runtimeApi.runtime.lastError);
            resolve();
        });
    });
}
