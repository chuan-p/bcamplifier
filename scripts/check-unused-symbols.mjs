#!/usr/bin/env node
// AST-based check that fails when a top-level function in src/ is neither
// called within its own module nor imported by any other module (or test).

import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as acorn from "acorn";

const rootDir = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "..",
);
const srcDir = path.join(rootDir, "src");

function listJavaScriptFiles(dir) {
    return readdirSync(dir)
        .sort()
        .flatMap((entry) => {
            const fullPath = path.join(dir, entry);
            if (statSync(fullPath).isDirectory()) {
                return listJavaScriptFiles(fullPath);
            }
            return entry.endsWith(".js") && entry !== "userscript.meta.js"
                ? [fullPath]
                : [];
        });
}

function walk(node, parent, key, visit) {
    if (!node || typeof node !== "object") {
        return;
    }
    visit(node, parent, key);
    for (const childKey of Object.keys(node)) {
        if (childKey === "loc" || childKey === "start" || childKey === "end") {
            continue;
        }
        const value = node[childKey];
        if (Array.isArray(value)) {
            for (const item of value) {
                walk(item, node, childKey, visit);
            }
        } else if (value && typeof value.type === "string") {
            walk(value, node, childKey, visit);
        }
    }
}

const files = listJavaScriptFiles(srcDir);
const declarations = [];
const importedByOthers = new Set();
const localRefCounts = new Map();

for (const file of files) {
    const rel = path.relative(rootDir, file);
    const code = readFileSync(file, "utf8");
    const ast = acorn.parse(code, { ecmaVersion: "latest", sourceType: "module" });

    const moduleFunctions = new Set();
    for (const stmt of ast.body) {
        if (stmt.type === "ImportDeclaration") {
            const resolved = path.relative(
                rootDir,
                path.resolve(path.dirname(file), stmt.source.value),
            );
            for (const spec of stmt.specifiers) {
                if (spec.type === "ImportSpecifier") {
                    importedByOthers.add(`${resolved}::${spec.imported.name}`);
                }
            }
            continue;
        }

        const inner =
            stmt.type === "ExportNamedDeclaration" && stmt.declaration
                ? stmt.declaration
                : stmt;
        if (inner.type === "FunctionDeclaration" && inner.id) {
            const key = `${rel}::${inner.id.name}`;
            moduleFunctions.add(inner.id.name);
            declarations.push({ file: rel, name: inner.id.name, key });
            localRefCounts.set(key, 0);
        }
    }

    walk(ast, null, null, (node, parent, key) => {
        if (node.type !== "Identifier" || !moduleFunctions.has(node.name)) {
            return;
        }
        if (parent) {
            if (parent.type === "FunctionDeclaration" && key === "id") return;
            if (parent.type === "MemberExpression" && key === "property" && !parent.computed) return;
            if (parent.type === "Property" && key === "key" && !parent.computed) return;
            if (parent.type === "ExportSpecifier") return;
            if (parent.type === "ImportSpecifier") return;
        }
        const declKey = `${rel}::${node.name}`;
        localRefCounts.set(declKey, (localRefCounts.get(declKey) || 0) + 1);
    });
}

const unused = declarations.filter(
    (decl) =>
        (localRefCounts.get(decl.key) || 0) === 0 &&
        !importedByOthers.has(decl.key),
);

if (unused.length) {
    console.error("Unused functions declared in src/:");
    unused.forEach((decl) => {
        console.error(`  ${decl.name} (${decl.file})`);
    });
    process.exit(1);
}

console.log(`unused_symbols_ok: ${declarations.length} functions`);
