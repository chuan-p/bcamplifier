#!/usr/bin/env node

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { formatReleaseDate } from "../src/utils/text-format.js";

const scriptPath = fileURLToPath(import.meta.url);

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
    process.exit(0);
}

const options = { year: "numeric", month: "short", day: "numeric" };
const localDate = (year, month, day) =>
    new Date(year, month - 1, day).toLocaleDateString(undefined, options);
const genericDate = (value) =>
    new Date(value).toLocaleDateString(undefined, options);

test("date-only values keep their announced calendar day west of UTC", () => {
    assert.equal(formatReleaseDate("2024-01-02"), localDate(2024, 1, 2));
    assert.notEqual(formatReleaseDate("2024-01-02"), genericDate("2024-01-02"));
    assert.equal(formatReleaseDate(" 2024-01-02 "), localDate(2024, 1, 2));
    assert.equal(formatReleaseDate("2024-02-29"), localDate(2024, 2, 29));
});

test("timestamps preserve their instant's local calendar day", () => {
    const utcMidnight = "2024-01-02T00:00:00Z";
    assert.equal(formatReleaseDate(utcMidnight), genericDate(utcMidnight));
    assert.notEqual(formatReleaseDate(utcMidnight), localDate(2024, 1, 2));

    const offsetTimestamp = "2024-01-02T23:30:00-07:00";
    assert.equal(
        formatReleaseDate(offsetTimestamp),
        genericDate(offsetTimestamp),
    );
});

test("impossible and unparseable dates fall back cleanly", () => {
    assert.equal(formatReleaseDate("2026-13-45"), "2026-13-45");
    assert.equal(formatReleaseDate("2026-02-30"), "2026-02-30");
    assert.equal(formatReleaseDate("2023-02-29"), "2023-02-29");
    assert.equal(formatReleaseDate("not a date"), "not a date");
    assert.equal(formatReleaseDate(""), "");
});
