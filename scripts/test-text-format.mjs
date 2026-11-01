#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const scriptPath = fileURLToPath(import.meta.url);
const rootDir = path.resolve(path.dirname(scriptPath), "..");
const sourcePath = path.join(rootDir, "src", "utils", "text-format.js");

// Run the assertions west of UTC. Date-only values previously rendered as the
// previous day there, and a full timestamp must keep its own calendar day
// rather than being rewritten as local midnight.
if (process.env.BCAMPX_TEXT_FORMAT_CHILD !== "1") {
    try {
        execFileSync(process.execPath, [scriptPath], {
            stdio: "inherit",
            env: {
                ...process.env,
                TZ: "America/Los_Angeles",
                BCAMPX_TEXT_FORMAT_CHILD: "1",
            },
        });
    } catch (error) {
        process.exit(Number(error && error.status) || 1);
    }

    console.log("text_format_test=passed");
    process.exit(0);
}

const source = await readFile(sourcePath, "utf8");
const context = vm.createContext({
    Array,
    Date,
    Error,
    JSON,
    Map,
    Math,
    Number,
    Object,
    RegExp,
    Set,
    String,
    URL,
    console,
});
vm.runInContext(source, context, { filename: sourcePath });

const { formatReleaseDate } = context;
const options = { year: "numeric", month: "short", day: "numeric" };
const localDate = (year, month, day) =>
    new Date(year, month - 1, day).toLocaleDateString(undefined, options);
const genericDate = (value) =>
    new Date(value).toLocaleDateString(undefined, options);

const failures = [];

function expect(label, actual, expected) {
    if (actual !== expected) {
        failures.push(
            `${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`,
        );
    }
}

function expectNot(label, actual, unexpected) {
    if (actual === unexpected) {
        failures.push(`${label}: must not equal ${JSON.stringify(unexpected)}`);
    }
}

// The original regression: a bare date must stay on its announced calendar
// day, not the UTC-midnight day rendered in local time.
expect("date-only keeps its calendar day", formatReleaseDate("2024-01-02"), localDate(2024, 1, 2));
expectNot(
    "date-only is not parsed as UTC midnight",
    formatReleaseDate("2024-01-02"),
    genericDate("2024-01-02"),
);
expect("date-only with surrounding spaces", formatReleaseDate(" 2024-01-02 "), localDate(2024, 1, 2));
expect("leap day stays valid", formatReleaseDate("2024-02-29"), localDate(2024, 2, 29));

// A timestamp already carries a time and offset. It must keep the instant's
// local calendar day instead of being rewritten as local midnight.
const utcMidnight = "2024-01-02T00:00:00Z";
expect("utc timestamp keeps its instant", formatReleaseDate(utcMidnight), genericDate(utcMidnight));
expectNot("utc timestamp is not coerced to the date-only path", formatReleaseDate(utcMidnight), localDate(2024, 1, 2));
const offsetTimestamp = "2024-01-02T23:30:00-07:00";
expect("offset timestamp keeps its instant", formatReleaseDate(offsetTimestamp), genericDate(offsetTimestamp));

// Values the Date constructor would silently roll over must fall back to the
// raw text instead of rendering a different day.
expect("impossible month falls back", formatReleaseDate("2026-13-45"), "2026-13-45");
expect("impossible day falls back", formatReleaseDate("2026-02-30"), "2026-02-30");
expect("non-leap february 29 falls back", formatReleaseDate("2023-02-29"), "2023-02-29");

expect("unparseable text falls back", formatReleaseDate("not a date"), "not a date");
expect("empty value renders empty", formatReleaseDate(""), "");

if (failures.length) {
    console.log("text_format_test=failed");
    failures.forEach((failure) => console.log(`failed=${failure}`));
    process.exit(1);
}
