"use strict";

const runtimeApi = getExtensionApi();
const ALLOWED_FETCH_HOSTS = ["bandcamp.com"];
const ALLOWED_FETCH_METHODS = new Set(["GET", "POST"]);
const ALLOWED_REQUEST_HEADERS = new Set(["accept", "content-type"]);
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
    const controller = new AbortController();
    const timeoutId =
        request.timeoutMs > 0
            ? setTimeout(() => controller.abort(), request.timeoutMs)
            : 0;

    try {
        const response = await fetch(request.url, {
            method: request.method,
            headers: request.headers,
            body: request.body,
            credentials: "include",
            redirect: "follow",
            signal: controller.signal,
        });

        return {
            status: response.status,
            responseText: await response.text(),
        };
    } catch (error) {
        if (error && error.name === "AbortError") {
            throw new Error("Network request timed out.");
        }

        throw error;
    } finally {
        if (timeoutId) {
            clearTimeout(timeoutId);
        }
    }
}

function validateFetchRequest(message, sender) {
    if (!isTrustedRuntimeSender(sender)) {
        throw new Error("Rejected fetch request from an unknown sender.");
    }

    const url = normalizeAllowedBandcampUrl(message && message.url);
    if (!url) {
        throw new Error("Only HTTPS Bandcamp requests are allowed.");
    }

    const method = normalizeAllowedMethod(message && message.method);
    if (!method) {
        throw new Error("Only GET and POST requests are allowed.");
    }

    return {
        url,
        method,
        headers: sanitizeHeaders(message && message.headers),
        body: method === "POST" ? normalizeRequestBody(message && message.body) : undefined,
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
        return Boolean(normalizeAllowedBandcampUrl(sender.url));
    }

    return true;
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
    return entries.length ? Object.fromEntries(entries) : undefined;
}
