#!/usr/bin/env node

// Bump the release version in every file that carries a copy of it.
//
// `src/userscript.meta.js` is the single source of truth. This script exists so
// a release is one command instead of five careful edits, and so the dev
// loader's cache-busting query string cannot be left behind (it used to say
// v=3.2 while the script was already 3.3.x).

import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(scriptDir, "..");

const metaPath = path.join(rootDir, "src", "userscript.meta.js");
const devLoaderPath = path.join(rootDir, "bcamplifier.dev.user.js");
const packagePath = path.join(rootDir, "package.json");
const manifestPaths = [
    path.join(rootDir, "manifest.chrome.json"),
    path.join(rootDir, "manifest.firefox.json"),
];

const requested = process.argv[2];
const meta = await readFile(metaPath, "utf8");
const current = readVersionFromMeta(meta);

if (!requested) {
    console.log(`Current version: ${current}`);
    console.log("Usage: node scripts/bump-version.mjs <version>");
    process.exit(0);
}

const next = String(requested).trim().replace(/^v/i, "");
if (!/^\d+\.\d+\.\d+$/.test(next)) {
    console.error(`Refusing to use "${requested}": expected MAJOR.MINOR.PATCH.`);
    process.exit(1);
}

if (next === current) {
    console.log(`Version is already ${current}.`);
    process.exit(0);
}

await writeFile(
    metaPath,
    meta.replace(/^(\/\/\s+@version\s+).+$/m, `$1${next}`),
    "utf8",
);

const devLoader = await readFile(devLoaderPath, "utf8");
const updatedDevLoader = devLoader
    .replace(/^(\/\/\s+@version\s+).+$/m, `$1${next}`)
    .replace(/(\/bcamplifier\.user\.js\?v=)[^&\s]+/, `$1${next}`);
if (updatedDevLoader === devLoader) {
    console.error("Dev loader did not contain a version or ?v= to update.");
    process.exit(1);
}
await writeFile(devLoaderPath, updatedDevLoader, "utf8");

for (const manifestPath of manifestPaths) {
    const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
    manifest.version = next;
    await writeFile(
        manifestPath,
        `${JSON.stringify(manifest, null, 2)}\n`,
        "utf8",
    );
}

const packageJson = JSON.parse(await readFile(packagePath, "utf8"));
packageJson.version = next;
await writeFile(
    packagePath,
    `${JSON.stringify(packageJson, null, 2)}\n`,
    "utf8",
);

// The lockfile repeats the root version. `npm ci` tolerates a version-only
// mismatch, but leaving it stale makes every release show an unexplained
// package-lock.json diff.
try {
    const lockPath = path.join(rootDir, "package-lock.json");
    const lock = JSON.parse(await readFile(lockPath, "utf8"));
    lock.version = next;
    if (lock.packages && lock.packages[""]) {
        lock.packages[""].version = next;
    }
    await writeFile(lockPath, `${JSON.stringify(lock, null, 2)}\n`, "utf8");
} catch (error) {
    if (error && error.code !== "ENOENT") {
        throw error;
    }
}

console.log(`Version bumped ${current} -> ${next}`);
console.log("Next: npm run build && ./scripts/build-extension.sh");

function readVersionFromMeta(value) {
    const match = value.match(/^\/\/\s+@version\s+(.+)$/m);
    if (!match || !match[1].trim()) {
        throw new Error("src/userscript.meta.js is missing @version.");
    }

    return match[1].trim();
}
