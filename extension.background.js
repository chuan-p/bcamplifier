"use strict";

const runtimeApi = getExtensionApi();
const ALLOWED_FETCH_HOSTS = ["bandcamp.com"];
const ALLOWED_FETCH_METHODS = new Set(["GET", "POST"]);
const ALLOWED_REQUEST_HEADERS = new Set(["accept", "content-type"]);
const ALLOWED_FETCH_CREDENTIALS = new Set(["include", "omit"]);
const MAX_FETCH_TIMEOUT_MS = 15000;

if (runtimeApi && runtimeApi.runtime) {
    runtimeApi.runtime.onMessage.addListener((message, sender, sendResponse) => {
        if (!message || message.type !== "bcampx:fetch") {
            return undefined;
        }

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
    const request = validateFetchRequest(message, sender);
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

function validateFetchRequest(message, sender) {
    if (!isTrustedRuntimeSender(sender)) {
        throw new Error("Rejected fetch request from an unknown sender.");
    }

    const method = normalizeAllowedMethod(message && message.method);
    if (!method) {
        throw new Error("Only GET and POST requests are allowed.");
    }

    const url = normalizeAllowedFetchUrl(message && message.url, method);
    if (!url) {
        throw new Error("Only HTTPS Bandcamp requests are allowed.");
    }

    return {
        url,
        method,
        headers: sanitizeHeaders(message && message.headers),
        body: method === "POST" ? normalizeRequestBody(message && message.body) : undefined,
        credentials: normalizeAllowedCredentials(message && message.credentials, method),
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

    return true;
}

function normalizeAllowedSenderUrl(rawUrl) {
    return normalizeAllowedFetchUrl(rawUrl, "GET");
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

    const hostname = parsed.hostname.toLowerCase();
    const isAllowedHost = ALLOWED_FETCH_HOSTS.some(
        (host) => hostname === host || hostname.endsWith(`.${host}`),
    );
    if (!isAllowedHost) {
        return "";
    }

    return parsed.toString();
}

function normalizeAllowedFetchUrl(rawUrl, method) {
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

    const hostname = parsed.hostname.toLowerCase();
    const isBandcampHost = ALLOWED_FETCH_HOSTS.some(
        (host) => hostname === host || hostname.endsWith(`.${host}`),
    );
    if (isBandcampHost) {
        return parsed.toString();
    }

    return "";
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
