#!/usr/bin/env node
// AST-based static check over src/:
// 1. Fails when a top-level function is neither called locally nor imported.
// 2. Fails when any module references an unbound identifier (missing import).

import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as acorn from "acorn";

const rootDir = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "..",
);
const srcDir = path.join(rootDir, "src");

const ALLOWED_GLOBALS = new Set([
    // Standard JS & browser globals
    "window", "document", "globalThis", "console", "location", "history",
    "navigator", "performance", "getComputedStyle", "CSS",
    "Math", "Number", "String", "Boolean", "Object", "Array", "Map", "Set",
    "WeakMap", "WeakSet", "Promise", "Date", "JSON", "RegExp", "URL",
    "URLSearchParams", "Error", "TypeError", "SyntaxError", "Symbol",
    "Reflect", "Proxy", "undefined", "NaN", "Infinity", "arguments",
    "setTimeout", "clearTimeout", "setInterval", "clearInterval",
    "requestAnimationFrame", "cancelAnimationFrame", "queueMicrotask",
    "encodeURIComponent", "decodeURIComponent", "parseInt", "parseFloat",
    "isNaN", "isFinite", "fetch", "AbortController", "Headers", "Response",
    "Request", "FormData", "Blob", "File", "Audio", "Image", "DOMParser",
    "Element", "HTMLElement", "HTMLInputElement", "HTMLButtonElement",
    "HTMLAnchorElement", "HTMLAudioElement", "HTMLImageElement",
    "HTMLIFrameElement", "Node", "Event", "CustomEvent", "KeyboardEvent",
    "MutationObserver", "IntersectionObserver", "MediaMetadata",
    // Userscript GM_* APIs
    "GM_getValue", "GM_setValue", "GM_deleteValue", "GM_listValues",
    "GM_xmlhttpRequest", "GM_addValueChangeListener",
    "GM_removeValueChangeListener", "GM_info",
    // esbuild build-time define macros
    "__BCAMPX_PLAYER_SHELL_CSS__", "__BCAMPX_ENHANCEMENT_CSS__",
    "__BCAMPX_SCRIPT_VERSION__", "__BCAMPX_BUILD_ID__",
]);

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

function addPatternNames(pattern, scope) {
    if (!pattern) return;
    if (pattern.type === "Identifier") {
        scope.add(pattern.name);
    } else if (pattern.type === "AssignmentPattern") {
        addPatternNames(pattern.left, scope);
    } else if (pattern.type === "RestElement") {
        addPatternNames(pattern.argument, scope);
    } else if (pattern.type === "ObjectPattern") {
        for (const prop of pattern.properties) {
            addPatternNames(prop.value || prop.argument, scope);
        }
    } else if (pattern.type === "ArrayPattern") {
        for (const el of pattern.elements) {
            addPatternNames(el, scope);
        }
    }
}

function collectBindings(stmt, scope) {
    if (!stmt || typeof stmt !== "object") return;
    if (stmt.type === "ImportDeclaration") {
        for (const spec of stmt.specifiers) {
            scope.add(spec.local.name);
        }
    } else if (stmt.type === "ExportNamedDeclaration" && stmt.declaration) {
        collectBindings(stmt.declaration, scope);
    } else if (stmt.type === "FunctionDeclaration" && stmt.id) {
        scope.add(stmt.id.name);
    } else if (stmt.type === "VariableDeclaration") {
        for (const decl of stmt.declarations) {
            addPatternNames(decl.id, scope);
        }
    }
}

function walkWithScope(node, scope, parent, prop, visit) {
    if (!node || typeof node !== "object") {
        return;
    }

    let nextScope = scope;
    if (
        node.type === "FunctionDeclaration" ||
        node.type === "FunctionExpression" ||
        node.type === "ArrowFunctionExpression"
    ) {
        nextScope = new Set(scope);
        if (node.id) nextScope.add(node.id.name);
        for (const param of node.params || []) {
            addPatternNames(param, nextScope);
        }
        if (node.body && node.body.type === "BlockStatement") {
            for (const st of node.body.body) collectBindings(st, nextScope);
        }
    } else if (node.type === "BlockStatement") {
        nextScope = new Set(scope);
        for (const st of node.body) collectBindings(st, nextScope);
    } else if (node.type === "CatchClause") {
        nextScope = new Set(scope);
        if (node.param) addPatternNames(node.param, nextScope);
    } else if (
        node.type === "ForStatement" ||
        node.type === "ForOfStatement" ||
        node.type === "ForInStatement"
    ) {
        nextScope = new Set(scope);
        if (node.init) collectBindings(node.init, nextScope);
        if (node.left && node.left.type === "VariableDeclaration") {
            collectBindings(node.left, nextScope);
        }
    }

    visit(node, nextScope, parent, prop);

    for (const childKey of Object.keys(node)) {
        if (childKey === "loc" || childKey === "start" || childKey === "end") {
            continue;
        }
        const value = node[childKey];
        if (Array.isArray(value)) {
            for (const item of value) {
                walkWithScope(item, nextScope, node, childKey, visit);
            }
        } else if (value && typeof value.type === "string") {
            walkWithScope(value, nextScope, node, childKey, visit);
        }
    }
}

const files = listJavaScriptFiles(srcDir);
const declarations = [];
const importedByOthers = new Set();
const localRefCounts = new Map();
const unboundRefs = [];

for (const file of files) {
    const rel = path.relative(rootDir, file);
    const code = readFileSync(file, "utf8");
    const ast = acorn.parse(code, { ecmaVersion: "latest", sourceType: "module" });

    const moduleFunctions = new Set();
    const topScope = new Set(ALLOWED_GLOBALS);
    for (const stmt of ast.body) {
        collectBindings(stmt, topScope);
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

    const fileUnbound = new Set();
    walkWithScope(ast, topScope, null, null, (node, scope, parent, key) => {
        if (node.type !== "Identifier") {
            return;
        }
        if (parent) {
            if (
                (parent.type === "FunctionDeclaration" ||
                    parent.type === "FunctionExpression" ||
                    parent.type === "VariableDeclarator") &&
                key === "id"
            ) {
                return;
            }
            if (parent.type === "MemberExpression" && key === "property" && !parent.computed) return;
            if (parent.type === "Property" && key === "key" && !parent.computed) return;
            if (
                parent.type === "ExportSpecifier" ||
                parent.type === "ImportSpecifier" ||
                parent.type === "ImportDefaultSpecifier" ||
                parent.type === "ImportNamespaceSpecifier"
            ) {
                return;
            }
            if (
                (parent.type === "LabeledStatement" ||
                    parent.type === "BreakStatement" ||
                    parent.type === "ContinueStatement") &&
                key === "label"
            ) {
                return;
            }
        }
        if (!scope.has(node.name)) {
            fileUnbound.add(node.name);
        }
        if (moduleFunctions.has(node.name)) {
            const declKey = `${rel}::${node.name}`;
            localRefCounts.set(declKey, (localRefCounts.get(declKey) || 0) + 1);
        }
    });

    for (const name of [...fileUnbound].sort()) {
        unboundRefs.push({ file: rel, name });
    }
}

const unused = declarations.filter(
    (decl) =>
        (localRefCounts.get(decl.key) || 0) === 0 &&
        !importedByOthers.has(decl.key),
);

if (unboundRefs.length) {
    console.error("Unbound identifiers referenced in src/:");
    unboundRefs.forEach((ref) => {
        console.error(`  ${ref.name} (${ref.file})`);
    });
    process.exit(1);
}

if (unused.length) {
    console.error("Unused functions declared in src/:");
    unused.forEach((decl) => {
        console.error(`  ${decl.name} (${decl.file})`);
    });
    process.exit(1);
}

console.log(`unused_symbols_ok: ${declarations.length} functions`);
