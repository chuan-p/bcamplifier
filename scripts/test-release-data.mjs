#!/usr/bin/env node

// Unit tests for the release page parser and the cache helpers built on it.

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { Window } from "happy-dom";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(scriptDir, "..");

const domWindow = new Window({
    url: "https://fixture.bandcamp.com/album/synthetic-release",
});
globalThis.window = domWindow;
globalThis.document = domWindow.document;
globalThis.DOMParser = domWindow.DOMParser;
globalThis.Node = domWindow.Node;
globalThis.Element = domWindow.Element;
test.after(() => domWindow.happyDOM.close());

const {
    parseReleasePage,
    normalizeReleaseData,
    valueClaimsOwnership,
    hasAccountScopedReleaseFields,
    stripAccountScopedReleaseFields,
    isCacheableReleaseValue,
    hasPlayableTracks,
} = await import("../src/data/release-data.js");
const { sanitizeDescriptionHtml } = await import("../src/utils/text-format.js");

test("parses Bandcamp release fixture tralbum blob, tracks, and metadata", async () => {
    const releaseFixture = await readFile(
        path.join(rootDir, "fixtures", "extension", "release.html"),
        "utf8",
    );
    const parsed = parseReleasePage(
        releaseFixture,
        "https://fixture.bandcamp.com/album/synthetic-release",
    );

    assert.equal(parsed.title, "Synthetic Release");
    assert.equal(parsed.artist, "Fixture Artist");
    assert.equal(parsed.releaseDate, "2024-01-02");
    assert.equal(parsed.location, "Shanghai");
    assert.deepEqual(
        parsed.tracks.map((track) => track.title),
        ["Track One", "Track Two"],
    );
    assert.deepEqual(
        parsed.tracks.map((track) => track.trackId),
        ["1", "2"],
    );
    assert.deepEqual(
        parsed.tracks.map((track) => track.duration),
        ["2:03", "2:36"],
    );
    assert.match(
        parsed.tracks[0].streamUrl,
        /^https:\/\/fixture\.bandcamp\.com:[^/]+\/audio\/track-one\.mp3$/,
    );
    assert.equal(
        parsed.description,
        "A synthetic release used to validate extension injection against a local HTTPS fixture.",
    );
    assert.equal(parsed.supporterItemId, 321);
    assert.equal(parsed.supporterItemType, "a");
    assert.equal(parsed.viewerKey, "");
    assert.equal(hasAccountScopedReleaseFields(parsed), false);
    assert.equal(isCacheableReleaseValue(parsed), true);
    assert.equal(hasPlayableTracks(parsed), true);
});

test("falls back to JSON-LD when tralbum blob is absent", () => {
    const jsonLdPage = `<!DOCTYPE html>
<html><head>
  <title>Ignored | Bandcamp</title>
  <script type="application/ld+json">
    {"@type":"MusicAlbum","name":"LD Album","byArtist":{"name":"LD Artist"},
     "datePublished":"2020-05-06","image":"https://example.test/art.jpg"}
  </script>
</head><body></body></html>`;
    const parsedJsonLd = parseReleasePage(
        jsonLdPage,
        "https://example.bandcamp.com/album/ld",
    );
    assert.equal(parsedJsonLd.title, "LD Album");
    assert.equal(parsedJsonLd.artist, "LD Artist");
    assert.equal(parsedJsonLd.releaseDate, "2020-05-06");
});

test("sanitizes description HTML safely", () => {
    const sanitized = sanitizeDescriptionHtml(
        '<p onclick="steal()">Hi <script>bad()</script>' +
            '<a href="https://example.test/ok">ok</a>' +
            '<a href="/relative">rel</a>' +
            '<iframe src="https://evil.test"></iframe></p>',
    );
    assert.ok(!sanitized.includes("<script"));
    assert.ok(!sanitized.includes("<iframe"));
    assert.ok(!sanitized.includes("onclick"));
    assert.ok(sanitized.includes('href="https://example.test/ok"'));
    assert.ok(sanitized.includes('rel="noopener noreferrer"'));
    assert.ok(!sanitized.includes('href="/relative"'));
});

test("recognises and strips account-scoped ownership fields", () => {
    assert.equal(valueClaimsOwnership({ digitalPrice: "You own this" }), true);
    assert.equal(
        valueClaimsOwnership({
            digitalOwnershipUrl: "https://bandcamp.com/fixture-fan",
        }),
        true,
    );
    assert.equal(valueClaimsOwnership({ digitalPrice: "$7 USD" }), false);
    assert.equal(
        hasAccountScopedReleaseFields({
            digitalDownloadUrl: "https://example.test/a.zip",
        }),
        true,
    );
    assert.deepEqual(
        stripAccountScopedReleaseFields({
            title: "Kept",
            digitalPrice: "You own this",
            digitalOwnershipUrl: "https://bandcamp.com/fixture-fan",
            digitalDownloadUrl: "https://example.test/a.zip",
        }),
        {
            title: "Kept",
            digitalPrice: "",
            digitalOwnershipUrl: "",
            digitalDownloadUrl: "",
        },
    );
});

test("enforces cacheability and track/description caps", () => {
    assert.equal(isCacheableReleaseValue({}), false);
    assert.equal(isCacheableReleaseValue(null), false);
    assert.equal(isCacheableReleaseValue({ title: "Ok" }), true);

    const manyTracks = Array.from({ length: 55 }, (_value, index) => ({
        title: `Track ${index + 1}`,
        track_id: String(index + 1),
        duration: 120,
    }));
    const longReleasePage = `<!DOCTYPE html><html><body>
  <div data-tralbum='${JSON.stringify({
      current: { title: "Long", type: "album", id: 1, band_id: 2 },
      album_title: "Long",
      artist: "Long Artist",
      album_release_date: "2024-01-02",
      trackinfo: manyTracks,
  })}'></div>
  <div class="tralbum-about">${"x".repeat(2000)}</div>
</body></html>`;
    const parsedLong = parseReleasePage(
        longReleasePage,
        "https://example.bandcamp.com/album/long",
    );
    assert.equal(parsedLong.tracks.length, 40);

    const normalized = normalizeReleaseData({
        url: "https://example.test/album/long",
        title: "Long",
        tracks: manyTracks,
        description: "x".repeat(2000),
    });
    assert.ok(String(normalized.description).length <= 420);
    assert.ok(String(normalized.description).length > 0);
});
