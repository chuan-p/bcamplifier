#!/usr/bin/env node

import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(scriptDir, "..");
const distDir = path.join(rootDir, "dist");
const metaPath = path.join(rootDir, "src", "userscript.meta.js");
const corePath = path.join(rootDir, "src", "bcamplifier.core.js");
const playerStylesPath = path.join(rootDir, "src", "styles", "player.css");
const enhancementStylesPath = path.join(
    rootDir,
    "src",
    "styles",
    "enhancements.css",
);
const playerIconsPath = path.join(rootDir, "src", "ui", "player-icons.js");
const textFormatUtilsPath = path.join(
    rootDir,
    "src",
    "utils",
    "text-format.js",
);
const rootOutputPath = path.join(rootDir, "bcamplifier.user.js");
const distOutputPath = path.join(distDir, "bcamplifier.user.js");

const meta = await readFile(metaPath, "utf8");
const core = await readFile(corePath, "utf8");
const playerStyles = await readFile(playerStylesPath, "utf8");
const enhancementStyles = await readFile(enhancementStylesPath, "utf8");
const playerIcons = await readFile(playerIconsPath, "utf8");
const textFormatUtils = await readFile(textFormatUtilsPath, "utf8");

validateUserscriptMeta(meta);
validateUserscriptCore(core);
validateStyles(playerStyles, playerStylesPath);
validateStyles(enhancementStyles, enhancementStylesPath);
validatePlayerIcons(playerIcons);
validateTextFormatUtils(textFormatUtils);

const scriptVersion = getUserscriptVersion(meta);
const bundle = `${meta.trimEnd()}\n\n${injectCoreConstants(
    injectStyles(
        injectSourceFragments(core.trimStart(), {
            playerIcons,
            textFormatUtils,
        }),
        playerStyles,
        enhancementStyles,
    ),
    scriptVersion,
)}`;

await mkdir(distDir, { recursive: true });
await writeFile(rootOutputPath, bundle, "utf8");
await writeFile(distOutputPath, bundle, "utf8");

console.log(`Built userscript: ${rootOutputPath}`);
console.log(`Built userscript: ${distOutputPath}`);

function validateUserscriptMeta(value) {
    const trimmed = value.trim();
    if (!trimmed.startsWith("// ==UserScript==")) {
        throw new Error("Userscript metadata must start with // ==UserScript==.");
    }

    if (!trimmed.endsWith("// ==/UserScript==")) {
        throw new Error("Userscript metadata must end with // ==/UserScript==.");
    }
}

function validateUserscriptCore(value) {
    if (!value.includes("(function () {")) {
        throw new Error("Userscript core must contain the main IIFE.");
    }

    if (!value.includes('const PLAYER_SHELL_CSS = "";')) {
        throw new Error("Userscript core must include PLAYER_SHELL_CSS placeholder.");
    }

    if (!value.includes('const ENHANCEMENT_CSS = "";')) {
        throw new Error("Userscript core must include ENHANCEMENT_CSS placeholder.");
    }

    if (!value.includes('const SCRIPT_VERSION = "";')) {
        throw new Error("Userscript core must include SCRIPT_VERSION placeholder.");
    }

    if (!value.includes("// __BCAMPX_PLAYER_ICONS__")) {
        throw new Error("Userscript core must include player icon placeholder.");
    }

    if (!value.includes("// __BCAMPX_TEXT_FORMAT_UTILS__")) {
        throw new Error("Userscript core must include text-format placeholder.");
    }

    if (!value.trimEnd().endsWith("})();")) {
        throw new Error("Userscript core must end with the main IIFE call.");
    }
}

function validateStyles(value, filePath) {
    if (!value.trim()) {
        throw new Error(`${filePath} must not be empty.`);
    }
}

function validatePlayerIcons(value) {
    if (!value.includes("PLAYER_ICON_DEFINITIONS")) {
        throw new Error("Player icon source must define PLAYER_ICON_DEFINITIONS.");
    }

    if (!value.includes("function createPlayerIcon")) {
        throw new Error("Player icon source must define createPlayerIcon.");
    }
}

function validateTextFormatUtils(value) {
    if (!value.includes("function cleanText")) {
        throw new Error("Text-format source must define cleanText.");
    }

    if (!value.includes("function sanitizeDescriptionHtml")) {
        throw new Error("Text-format source must define sanitizeDescriptionHtml.");
    }
}

function getUserscriptVersion(meta) {
    const match = meta.match(/^\/\/\s+@version\s+(.+)$/m);
    if (!match || !match[1].trim()) {
        throw new Error("Userscript metadata must include @version.");
    }

    return match[1].trim();
}

function injectSourceFragments(core, { playerIcons, textFormatUtils }) {
    return core
        .replace("// __BCAMPX_PLAYER_ICONS__", playerIcons.trimEnd())
        .replace("// __BCAMPX_TEXT_FORMAT_UTILS__", textFormatUtils.trimEnd());
}

function injectStyles(core, playerStyles, enhancementStyles) {
    return core
        .replace(
            'const PLAYER_SHELL_CSS = "";',
            `const PLAYER_SHELL_CSS = ${JSON.stringify(playerStyles)};`,
        )
        .replace(
            'const ENHANCEMENT_CSS = "";',
            `const ENHANCEMENT_CSS = ${JSON.stringify(enhancementStyles)};`,
        );
}

function injectCoreConstants(core, scriptVersion) {
    return core.replace(
        'const SCRIPT_VERSION = "";',
        `const SCRIPT_VERSION = ${JSON.stringify(scriptVersion)};`,
    );
}
