#!/usr/bin/env node

import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { minify } from "terser";

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
const artistMusicFeedPath = path.join(
    rootDir,
    "src",
    "features",
    "artist-music-feed.js",
);
const playerPath = path.join(rootDir, "src", "features", "player.js");
const trackActionsPath = path.join(
    rootDir,
    "src",
    "features",
    "track-actions.js",
);
const releaseDataPath = path.join(rootDir, "src", "data", "release-data.js");
const tagIndexPath = path.join(rootDir, "src", "data", "tag-index.js");
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
const artistMusicFeed = await readFile(artistMusicFeedPath, "utf8");
const player = await readFile(playerPath, "utf8");
const trackActions = await readFile(trackActionsPath, "utf8");
const releaseData = await readFile(releaseDataPath, "utf8");
const tagIndex = await readFile(tagIndexPath, "utf8");
const textFormatUtils = await readFile(textFormatUtilsPath, "utf8");

validateUserscriptMeta(meta);
validateUserscriptCore(core);
validateStyles(playerStyles, playerStylesPath);
validateStyles(enhancementStyles, enhancementStylesPath);
validatePlayerIcons(playerIcons);
validateArtistMusicFeed(artistMusicFeed);
validatePlayer(player);
validateTrackActions(trackActions);
validateReleaseData(releaseData);
validateTagIndex(tagIndex);
validateTextFormatUtils(textFormatUtils);

const scriptVersion = getUserscriptVersion(meta);
const bundle = `${meta.trimEnd()}\n\n${injectCoreConstants(
    injectStyles(
        injectSourceFragments(core.trimStart(), {
            playerIcons,
            artistMusicFeed,
            player,
            trackActions,
            releaseData,
            tagIndex,
            textFormatUtils,
        }),
        playerStyles,
        enhancementStyles,
    ),
    scriptVersion,
)}`;

validateBuiltBundle(bundle);

const minified = await minify(bundle, {
    // The bundle targets current Chrome/Firefox and Tampermonkey, so Terser may
    // use modern syntax and a second pass; this trims ~1.5 KB from the release.
    ecma: 2020,
    compress: { passes: 2 },
    mangle: true,
    format: {
        comments: (node, comment) => {
            const value = comment.value.trim();
            return value.startsWith("@") || value.startsWith("==");
        },
        max_line_len: false,
    },
});
const output = minified && minified.code ? minified.code : bundle;

await mkdir(distDir, { recursive: true });
await writeFile(rootOutputPath, output, "utf8");
await writeFile(distOutputPath, output, "utf8");

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

    if (!value.includes("// __BCAMPX_ARTIST_MUSIC_FEED__")) {
        throw new Error(
            "Userscript core must include artist music feed placeholder.",
        );
    }

    if (!value.includes("// __BCAMPX_PLAYER__")) {
        throw new Error("Userscript core must include player placeholder.");
    }

    if (!value.includes("// __BCAMPX_TRACK_ACTIONS__")) {
        throw new Error(
            "Userscript core must include track action placeholder.",
        );
    }

    if (!value.includes("// __BCAMPX_RELEASE_DATA__")) {
        throw new Error("Userscript core must include release data placeholder.");
    }

    if (!value.includes("// __BCAMPX_TAG_INDEX__")) {
        throw new Error("Userscript core must include tag index placeholder.");
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

function validateArtistMusicFeed(value) {
    if (!value.includes("async function buildArtistMusicFeed")) {
        throw new Error(
            "Artist music feed source must define buildArtistMusicFeed.",
        );
    }

    if (!value.includes("function createArtistMusicFeedCard")) {
        throw new Error(
            "Artist music feed source must define createArtistMusicFeedCard.",
        );
    }
}

function validatePlayer(value) {
    if (!value.includes("function ensurePlayerShell")) {
        throw new Error("Player source must define ensurePlayerShell.");
    }

    if (!value.includes("function playSharedTrack")) {
        throw new Error("Player source must define playSharedTrack.");
    }
}

function validateTrackActions(value) {
    if (!value.includes("function runTrackActionHelper")) {
        throw new Error(
            "Track action source must define runTrackActionHelper.",
        );
    }

    if (!value.includes("function executeTrackAction")) {
        throw new Error(
            "Track action source must define executeTrackAction.",
        );
    }
}

function validateReleaseData(value) {
    if (!value.includes("async function getReleaseData")) {
        throw new Error("Release data source must define getReleaseData.");
    }

    if (!value.includes("function parseReleasePage")) {
        throw new Error("Release data source must define parseReleasePage.");
    }
}

function validateTagIndex(value) {
    if (!value.includes("function runFanTagIndexBuild")) {
        throw new Error("Tag index source must define runFanTagIndexBuild.");
    }

    if (!value.includes("function findFanTagSearchMatches")) {
        throw new Error(
            "Tag index source must define findFanTagSearchMatches.",
        );
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

function validateBuiltBundle(value) {
    const placeholders = [
        "__BCAMPX_PLAYER_ICONS__",
        "__BCAMPX_ARTIST_MUSIC_FEED__",
        "__BCAMPX_PLAYER__",
        "__BCAMPX_TRACK_ACTIONS__",
        "__BCAMPX_RELEASE_DATA__",
        "__BCAMPX_TAG_INDEX__",
        "__BCAMPX_TEXT_FORMAT_UTILS__",
    ];
    const remainingPlaceholder = placeholders.find((placeholder) =>
        value.includes(placeholder),
    );
    if (remainingPlaceholder) {
        throw new Error(`Built userscript still contains ${remainingPlaceholder}.`);
    }
}

function getUserscriptVersion(meta) {
    const match = meta.match(/^\/\/\s+@version\s+(.+)$/m);
    if (!match || !match[1].trim()) {
        throw new Error("Userscript metadata must include @version.");
    }

    return match[1].trim();
}

function injectSourceFragments(
    core,
    {
        playerIcons,
        artistMusicFeed,
        player,
        trackActions,
        releaseData,
        tagIndex,
        textFormatUtils,
    },
) {
    return core
        .replace("// __BCAMPX_PLAYER_ICONS__", playerIcons.trimEnd())
        .replace(
            "// __BCAMPX_ARTIST_MUSIC_FEED__",
            artistMusicFeed.trimEnd(),
        )
        .replace("// __BCAMPX_PLAYER__", player.trimEnd())
        .replace("// __BCAMPX_TRACK_ACTIONS__", trackActions.trimEnd())
        .replace("// __BCAMPX_RELEASE_DATA__", releaseData.trimEnd())
        .replace("// __BCAMPX_TAG_INDEX__", tagIndex.trimEnd())
        .replace("// __BCAMPX_TEXT_FORMAT_UTILS__", textFormatUtils.trimEnd());
}

function injectStyles(core, playerStyles, enhancementStyles) {
    return core
        .replace(
            'const PLAYER_SHELL_CSS = "";',
            `const PLAYER_SHELL_CSS = ${JSON.stringify(
                minifyCss(playerStyles),
            )};`,
        )
        .replace(
            'const ENHANCEMENT_CSS = "";',
            `const ENHANCEMENT_CSS = ${JSON.stringify(
                minifyCss(enhancementStyles),
            )};`,
        );
}

function minifyCss(css) {
    return css
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean)
        .join(" ");
}

function injectCoreConstants(core, scriptVersion) {
    return core.replace(
        'const SCRIPT_VERSION = "";',
        `const SCRIPT_VERSION = ${JSON.stringify(scriptVersion)};`,
    );
}
