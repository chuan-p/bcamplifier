"use strict";

// Shared pure helpers used by extension.background.js, extension.content.js,
// and extension.host-permission.js. They are loaded in each context via
// importScripts (service worker), the content_scripts "js" array, or a plain
// <script> tag, and exposed on globalThis so every file shares one copy.
(function () {
    function isBandcampHostname(rawHostname) {
        const hostname = String(rawHostname || "").trim().toLowerCase();
        return (
            hostname === "bandcamp.com" ||
            hostname.endsWith(".bandcamp.com")
        );
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

        return parsed.origin + "/*";
    }

    globalThis.__BCAMPX_EXT_SHARED__ = {
        isBandcampHostname,
        normalizeCustomHostPermissionPattern,
    };
})();
