import { CONFIG } from "../state.js";
import { normalizeReleaseUrl } from "./url.js";

export function getExternalHostApi() {
    const host = globalThis.__BCAMPX_HOST__;
    if (!host || typeof host !== "object") {
        return null;
    }

    return host;
}

export function canUseExternalHostMethod(methodName) {
    const host = getExternalHostApi();
    return !!(host && typeof host[methodName] === "function");
}

export function isWebExtensionHost() {
    const host = getExternalHostApi();
    return !!(host && host.kind === "webextension");
}

export function hasExtensionHostPermission(rawUrl) {
    const releaseUrl = normalizeReleaseUrl(rawUrl || "");
    if (!releaseUrl || !isWebExtensionHost()) {
        return false;
    }

    const host = getExternalHostApi();
    return !!(
        host &&
        typeof host.hasHostPermission === "function" &&
        host.hasHostPermission(releaseUrl)
    );
}

export function getHostRequestOptions(baseOptions = {}) {
    return {
        method: baseOptions.method || "GET",
        data: baseOptions.data,
        headers: baseOptions.headers,
        credentials: baseOptions.credentials,
        timeoutMs: CONFIG.fetchTimeoutMs,
    };
}

function extractMissingCustomDomainHostPermissionPattern(error) {
    const message =
        error && error.message ? String(error.message) : "";
    const match = message.match(
        /Host permission required for (https:\/\/[^\s]+\/\*)/i,
    );
    return match ? match[1] : "";
}

export function isMissingCustomDomainHostPermissionError(error) {
    return Boolean(extractMissingCustomDomainHostPermissionPattern(error));
}
