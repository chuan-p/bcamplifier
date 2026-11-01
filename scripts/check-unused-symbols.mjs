#!/usr/bin/env node
// Fails when a function declared in src/ is never referenced anywhere.
//
// The bundle is one dependency-injected IIFE, so dead helpers survive unnoticed
// (and keep shipping in the minified userscript). Counting identifier
// occurrences in the raw sources is deliberately conservative: a name inside a
// comment or string also counts as a reference, so this only reports symbols
// that are truly unreferenced.

import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "..",
);
const srcDir = path.join(rootDir, "src");
const declarationPattern =
    /^ {4}(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(/gm;
const identifierPattern = /[A-Za-z_$][\w$]*/g;

function listJavaScriptFiles(dir) {
    return readdirSync(dir).flatMap((entry) => {
        const fullPath = path.join(dir, entry);
        if (statSync(fullPath).isDirectory()) {
            return listJavaScriptFiles(fullPath);
        }
        return entry.endsWith(".js") ? [fullPath] : [];
    });
}

const files = listJavaScriptFiles(srcDir);
const sources = files.map((file) => ({
    file,
    text: readFileSync(file, "utf8"),
}));

const declarations = [];
const referenceCounts = new Map();

for (const source of sources) {
    for (const match of source.text.matchAll(declarationPattern)) {
        declarations.push({
            file: path.relative(rootDir, source.file),
            name: match[1],
        });
        referenceCounts.set(match[1], (referenceCounts.get(match[1]) || 0) + 1);
    }
}

for (const source of sources) {
    for (const match of source.text.matchAll(identifierPattern)) {
        const name = match[0];
        if (!referenceCounts.has(name)) {
            continue;
        }
        referenceCounts.set(name, referenceCounts.get(name) + 1);
    }
}

const unused = declarations.filter(
    (declaration) => (referenceCounts.get(declaration.name) || 0) <= 1,
);

if (unused.length) {
    console.error("Unused functions declared in src/:");
    unused.forEach((declaration) => {
        console.error(`  ${declaration.name} (${declaration.file})`);
    });
    process.exit(1);
}

console.log(`unused_symbols_ok: ${declarations.length} functions`);
