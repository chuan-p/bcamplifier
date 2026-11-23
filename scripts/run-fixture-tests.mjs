#!/usr/bin/env node

// Unified headless-Chrome fixture test runner.
//
// Replaces the 11 separate sh + python + `sleep 1` scripts with one Node runner
// backed by ephemeral local HTTP servers (port 0, no sleep, no temp fixture
// copies) and `node:test`. Pass suite names on the CLI to filter, e.g.:
//   node scripts/run-fixture-tests.mjs feed playback

import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(scriptDir, "..");
const fixturesDir = path.join(rootDir, "fixtures");
const userscriptPath = path.join(rootDir, "bcamplifier.user.js");

const CHROME_BIN = execFileSync(path.join(scriptDir, "find-chrome.sh"), {
    encoding: "utf8",
}).trim();

const TINY_PNG = Buffer.from(
    "89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4" +
        "890000000a49444154789c6360000002000154a24f9d0000000049454e44ae426082",
    "hex",
);

const SILENCE_WAV = (() => {
    const rate = 8000;
    const frames = Math.floor(rate * 0.4);
    const dataLen = frames * 2;
    const buf = Buffer.alloc(44 + dataLen);
    buf.write("RIFF", 0);
    buf.writeUInt32LE(36 + dataLen, 4);
    buf.write("WAVEfmt ", 8);
    buf.writeUInt32LE(16, 16);
    buf.writeUInt16LE(1, 20);
    buf.writeUInt16LE(1, 22);
    buf.writeUInt32LE(rate, 24);
    buf.writeUInt32LE(rate * 2, 28);
    buf.writeUInt16LE(2, 32);
    buf.writeUInt16LE(16, 34);
    buf.write("data", 36);
    buf.writeUInt32LE(dataLen, 40);
    return buf;
})();

const MIME_TYPES = {
    ".html": "text/html; charset=utf-8",
    ".js": "application/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".png": "image/png",
    ".wav": "audio/wav",
    ".mp3": "audio/mpeg",
};

function startFixtureServer(routes = {}) {
    return new Promise((resolve, reject) => {
        const server = http.createServer((req, res) => {
            const pathname = (req.url || "/").split("?", 1)[0];

            const send = (body, contentType) => {
                res.writeHead(200, {
                    "Content-Type": contentType,
                    "Content-Length": body.length,
                });
                res.end(body);
            };

            if (pathname === "/bcamplifier.user.js") {
                send(
                    readFileSync(userscriptPath),
                    "application/javascript; charset=utf-8",
                );
                return;
            }
            if (pathname === "/silence.wav") {
                send(SILENCE_WAV, "audio/wav");
                return;
            }
            if (pathname.startsWith("/img/")) {
                send(TINY_PNG, "image/png");
                return;
            }
            if (Object.prototype.hasOwnProperty.call(routes, pathname)) {
                send(
                    readFileSync(path.join(fixturesDir, routes[pathname])),
                    "text/html; charset=utf-8",
                );
                return;
            }
            if (pathname.startsWith("/fixtures/")) {
                const rel = pathname.slice("/fixtures/".length);
                let target = path.resolve(fixturesDir, rel);
                if (
                    target === fixturesDir ||
                    target.startsWith(fixturesDir + path.sep)
                ) {
                    try {
                        if (statSync(target).isDirectory()) {
                            target = path.join(target, "index.html");
                        }
                        const ext = path.extname(target).toLowerCase();
                        send(
                            readFileSync(target),
                            MIME_TYPES[ext] || "application/octet-stream",
                        );
                        return;
                    } catch (_error) {}
                }
            }

            res.writeHead(404);
            res.end("Not found");
        });

        server.on("error", reject);
        server.listen(0, "127.0.0.1", () => {
            const addr = server.address();
            resolve({
                port: addr.port,
                close: () => new Promise((done) => server.close(done)),
            });
        });
    });
}

function runChrome(
    url,
    {
        budget = 6000,
        timeout = 24000,
        windowSize = "1400,1600",
        resolver = "",
        extraArgs = [],
    } = {},
) {
    const profileDir = mkdtempSync(
        path.join(os.tmpdir(), "bcampx-chrome-profile-"),
    );
    const args = [
        "--headless=new",
        "--no-sandbox",
        "--disable-gpu",
        "--no-first-run",
        "--no-default-browser-check",
        "--disable-background-networking",
        "--disable-component-update",
        `--user-data-dir=${profileDir}`,
    ];
    if (windowSize) args.push(`--window-size=${windowSize}`);
    if (resolver) args.push(`--host-resolver-rules=${resolver}`);
    args.push(...extraArgs, `--virtual-time-budget=${budget}`, "--dump-dom", url);

    return new Promise((resolve, reject) => {
        const child = spawn(CHROME_BIN, args, {
            stdio: ["ignore", "pipe", "pipe"],
        });
        let stdout = "";
        let stderr = "";
        let timedOut = false;

        child.stdout.on("data", (chunk) => {
            stdout += chunk.toString("utf8");
        });
        child.stderr.on("data", (chunk) => {
            stderr += chunk.toString("utf8");
        });

        const timer = setTimeout(() => {
            timedOut = true;
            child.kill("SIGKILL");
        }, timeout);

        child.on("error", (error) => {
            clearTimeout(timer);
            rmSync(profileDir, { recursive: true, force: true });
            reject(error);
        });

        child.on("close", (code) => {
            clearTimeout(timer);
            rmSync(profileDir, { recursive: true, force: true });
            // Some Chromium builds stay alive after --dump-dom has already
            // written the DOM; treat captured stdout on timeout as success.
            const effectiveCode = timedOut ? (stdout ? 0 : 1) : code ?? 1;
            if (effectiveCode !== 0) {
                reject(
                    new Error(
                        `Chrome exited with code ${effectiveCode} for ${url}\n${stderr}`,
                    ),
                );
                return;
            }
            resolve(stdout);
        });
    });
}

function assertTokens(dom, checks) {
    const missing = [];
    for (const [token, description] of Object.entries(checks)) {
        if (!dom.includes(token)) {
            missing.push(`${description} (expected ${token})`);
        }
    }
    assert.deepEqual(missing, [], `Missing tokens:\n  ${missing.join("\n  ")}`);
}

function readAttr(dom, attrName) {
    const escaped = attrName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const match = dom.match(new RegExp(`${escaped}="([^"]*)"`));
    return match ? match[1] : "";
}

const filters = process.argv.slice(2);
const shouldRun = (name) =>
    !filters.length || filters.some((f) => name.includes(f));

const sharedServer = await startFixtureServer();
test.after(() => sharedServer.close());

if (shouldRun("feed")) {
    test("feed fixture enhances main and delayed cards while filtering sidebar", async () => {
        const dom = await runChrome(
            `http://127.0.0.1:${sharedServer.port}/fixtures/feed/`,
            { budget: 6000, timeout: 15000 },
        );
        assertTokens(dom, {
            'data-bcampx-script-loaded="true"': "core script booted",
            'data-bcampx-page-kind="feed"': "page recognized as feed",
            'data-bcampx-init-state="ready"': "feed initializer finished",
            'data-bcampx-enhance-attempt-count="2"': "enhancement ran twice",
            'data-bcampx-enhanced-count="2"': "cards enhanced twice",
            'class="bcampx bcampx--expanded"': "enhancement UI rendered",
            "Jan 2, 2024 · Shanghai": "release facts rendered",
            "Track One": "first track rendered",
            "Track Two": "second track rendered",
            "Description · 2 tracks": "summary state updated",
            'data-bcampx-collection-playback="Fixture Artist - Collection Two Featured"':
                "collection grid continuous playback advanced",
            'data-bcampx-collection-shell-count="0"':
                "collection grid playback did not mount tracklist UI",
            'data-bcampx-collection-release-request-count="1"':
                "exactly one recovery fetch followed failed preview stream",
        });

        const main = dom.match(/<article id="fixture-main-card"[\s\S]*?<\/article>/);
        const delayed = dom.match(
            /<article id="fixture-delayed-card"[\s\S]*?<\/article>/,
        );
        const sidebar = dom.match(
            /<article id="fixture-sidebar-card"[\s\S]*?<\/article>/,
        );
        assert.ok(main && main[0].includes('class="bcampx'), "main card enhanced");
        assert.ok(
            delayed && delayed[0].includes('class="bcampx'),
            "delayed card enhanced",
        );
        assert.ok(sidebar, "sidebar card present");
        assert.ok(
            !sidebar[0].includes('class="bcampx'),
            "sidebar card remained filtered",
        );
    });
}

if (shouldRun("label-music")) {
    test("label /music fixture builds enhanced feed, toggle, tags, and supporter counts", async () => {
        const dom = await runChrome(
            `http://127.0.0.1:${sharedServer.port}/fixtures/label-music/music/`,
            { budget: 6000, timeout: 24000 },
        );
        assertTokens(dom, {
            'data-bcampx-page-kind="artist-music"': "recognized as artist music",
            'data-bcampx-label-feed-state="ready"': "label music feed built",
            'data-bcampx-label-feed-count="6"': "all release links collected",
            'data-bcampx-label-feed-source-hidden="true"': "native grid hidden",
            "bcampx-label-feed-toggle": "view toggle rendered",
            'data-bcampx-toggle-in-navbar="true"': "toggle placed in navbar",
            'data-bcampx-toggle-inline="true"': "toggle used inline placement",
            'data-bcampx-toggle-navbar-class="true"': "toggle navbar class",
            'data-bcampx-navbar-host-class="true"': "navbar host class",
            'data-bcampx-toggle-icon-count="2"': "list and grid icons rendered",
            'data-bcampx-toggle-left-grid="true"': "grid icon on left",
            'data-bcampx-toggle-right-list="true"': "list icon on right",
            'data-bcampx-toggle-feed-state-initial="true"': "started in feed state",
            'data-bcampx-label-selector-display="none"': "label selector hidden",
            'data-bcampx-toggle-original-grid-hidden="false"': "toggle showed original grid",
            'data-bcampx-toggle-original-feed-hidden="true"': "toggle hid enhanced feed",
            'data-bcampx-toggle-original-featured-hidden="false"':
                "toggle restored native featured releases",
            'data-bcampx-label-selector-original-display="block"':
                "label selector visible in original grid view",
            'data-bcampx-toggle-grid-state="true"': "toggle switched to grid",
            'data-bcampx-toggle-feed-grid-hidden="true"': "toggle restored feed",
            'data-bcampx-toggle-feed-feed-hidden="false"': "toggle showed feed again",
            'data-bcampx-toggle-feed-featured-hidden="true"': "hid featured releases",
            'data-bcampx-toggle-feed-featured-display="none"': "featured out of layout",
            'data-bcampx-label-selector-feed-display="none"': "selector hidden again",
            'data-bcampx-toggle-feed-state-restored="true"': "feed state restored",
            'data-bcampx-label-feed-card-count="6"': "featured deduplicated",
            'data-bcampx-label-feed-list-tag="DIV"': "list used DIV tag",
            'data-bcampx-owned-buy-text="you own this"': "owned state rendered",
            'data-bcampx-owned-buy-disabled="false"': "owned button clickable",
            'data-bcampx-owned-buy-url="https://bandcamp.com/fixturefan"':
                "owned button carried collection URL",
            'data-bcampx-no-buy-text="hear more"': "fallback button kept",
            'data-bcampx-no-buy-has-price="false"': "no stale price rendered",
            'data-bcampx-label-release-tags="tags: synth-pop, fixture-waveJan 2, 2024 · Shanghai"':
                "release tags and date rendered",
            'data-bcampx-label-release-tags-in-col1="false"': "tags in full-width row",
            'data-bcampx-supporter-count-before-refresh="appears in 250+ collectionsrefresh"':
                "automatic supporter count capped",
            'data-bcampx-supporter-count-before-refresh-exact="false"': "capped inexact",
            'data-bcampx-supporter-refresh-visible="true"': "refresh button visible",
            'data-bcampx-supporter-count-text="appears in 330 collections"':
                "manual refresh resolved exact count",
            'data-bcampx-supporter-count-exact="true"': "supporter count exact",
            'data-bcampx-supporter-request-count="6"': "transient failure retried",
            'data-bcampx-label-player-favorite-hidden="false"': "wishlist button shown",
            'data-bcampx-label-player-favorite-active-after-click="false"':
                "wishlist waited for completion",
            'data-bcampx-label-player-favorite-pending-after-click="true"':
                "wishlist showed pending state",
            "bcampx-label-feed-card": "synthetic feed cards rendered",
            'class="bcampx__track-link"': "playable tracklist buttons",
            "bcampx--supported-slot": "used supported slot",
            'data-bcampx-enhanced-count="6"': "all 6 cards enhanced",
            "Track One": "album metadata rendered",
            "Synthetic Track": "track release rendered",
            "Description · 2 tracks": "album summary rendered",
            "buy now ($7)": "digital price rendered",
            "pre-order (name your price)": "pre-order rendered",
            "free download": "free download rendered",
            "Owned Release": "owned release rendered",
            "No Buy Release": "no-buy release rendered",
        });
    });

    test("label /music grid-to-list switch retains and renders all cards", async () => {
        const dom = await runChrome(
            `http://127.0.0.1:${sharedServer.port}/fixtures/label-music/music/?view=original`,
            { budget: 6000, timeout: 24000, windowSize: "1400,480" },
        );
        assertTokens(dom, {
            'data-bcampx-grid-to-list-feed-hidden="false"': "list view shown",
            'data-bcampx-grid-to-list-card-count="6"': "all cards retained",
            'data-bcampx-grid-to-list-rendered-card-count="6"':
                "off-screen cards rendered without scrolling",
            'data-bcampx-grid-to-list-visible-placeholder-count="0"':
                "no supported-by placeholders remained visible",
        });
    });
}

if (shouldRun("buy-link")) {
    test("buy-link fixture preserves FREE DOWNLOAD release titles", async () => {
        const dom = await runChrome(
            `http://127.0.0.1:${sharedServer.port}/fixtures/feed/buy-link.html`,
            { budget: 6000, timeout: 15000 },
        );
        assertTokens(dom, {
            'data-bcampx-script-loaded="true"': "core script booted",
            'data-bcampx-enhanced-count="1"': "card enhanced",
            'data-bcampx-title-text="FREE DOWNLOAD The Riverbed EP"':
                "title link text preserved",
            'data-bcampx-buy-text="free download"': "collect-controls buy link updated",
        });
    });
}

if (shouldRun("description-url")) {
    test("description-url fixture wraps long URLs without overflowing card", async () => {
        const dom = await runChrome(
            `http://127.0.0.1:${sharedServer.port}/fixtures/feed/description-url.html`,
            { budget: 6000, timeout: 15000 },
        );
        assertTokens(dom, {
            'data-bcampx-script-loaded="true"': "core script booted",
            'data-bcampx-enhanced-count="1"': "card enhanced",
            'data-bcampx-description-count="1"': "description rendered",
            'data-bcampx-description-text="music video: www.youtube.com/watch?v=BwjMHwDNRjo&amp;list=RDBwjMHwDNRjo&amp;start_radio=1"':
                "description link text preserved",
            'data-bcampx-description-overflow="0"': "description did not overflow",
            'data-bcampx-layout-fits="true"': "long URL did not widen column",
        });
    });
}

if (shouldRun("helper-auth")) {
    test("helper-auth fixture rejects unverified wishlist helper hashes", async () => {
        const base = `http://127.0.0.1:${sharedServer.port}/fixtures/security/helper-auth.html`;
        const linkAttack = await runChrome(
            `${base}#bcampx-helper=wishlist&bcampx-request=fixture-1&bcampx-parent-origin=https://attacker.example`,
            { budget: 8000, timeout: 20000 },
        );
        assertTokens(linkAttack, { 'data-bcampx-script-loaded="true"': "booted" });
        assert.equal(readAttr(linkAttack, "data-bcampx-fixture-helper-auth"), "rejected");
        assert.equal(readAttr(linkAttack, "data-bcampx-fixture-post-count"), "0");

        const spoofed = await runChrome(
            `${base}#bcampx-helper=wishlist&bcampx-request=fixture-2&bcampx-parent-origin=https://bandcamp.com`,
            { budget: 8000, timeout: 20000 },
        );
        assertTokens(spoofed, { 'data-bcampx-script-loaded="true"': "booted" });
        assert.equal(readAttr(spoofed, "data-bcampx-fixture-helper-auth"), "rejected");
        assert.equal(readAttr(spoofed, "data-bcampx-fixture-post-count"), "0");

        const control = await runChrome(base, { budget: 8000, timeout: 20000 });
        assertTokens(control, { 'data-bcampx-script-loaded="true"': "booted" });
        assert.equal(readAttr(control, "data-bcampx-fixture-helper-auth"), "");
        assert.equal(readAttr(control, "data-bcampx-fixture-post-count"), "0");
    });
}

if (shouldRun("init-isolation")) {
    test("init-isolation fixture keeps player and ready state when feed build fails", async () => {
        const dom = await runChrome(
            `http://127.0.0.1:${sharedServer.port}/fixtures/init-isolation/music/`,
            { budget: 9000, timeout: 24000 },
        );
        assert.equal(readAttr(dom, "data-bcampx-fixture-build-failure"), "true");
        assert.equal(readAttr(dom, "data-bcampx-fixture-feed-state"), "error");
        assert.ok(
            readAttr(dom, "data-bcampx-fixture-init-error").includes(
                "synthetic feed mount failure",
            ),
        );
        assert.equal(readAttr(dom, "data-bcampx-fixture-init-state"), "ready");
        assert.equal(readAttr(dom, "data-bcampx-fixture-player-shell"), "true");
        assert.equal(readAttr(dom, "data-bcampx-fixture-feed-mounted"), "false");
        assert.equal(readAttr(dom, "data-bcampx-fixture-unhandled"), "0");
    });
}

if (shouldRun("playback")) {
    test("playback fixture honors latest playback intent and clicks during load", async () => {
        const base = `http://127.0.0.1:${sharedServer.port}/fixtures/feed`;

        const intentDom = await runChrome(`${base}/intent.html`, {
            budget: 12000,
            timeout: 40000,
        });
        assertTokens(intentDom, {
            'data-playback-intent-done="true"': "intent scenario finished",
            'data-playback-intent-requests="slow,fast"': "requests in click order",
            'data-playback-intent-result="latest"': "newer choice won",
            'data-playback-intent-track="Fixture Artist - Fast Track"':
                "player showed last chosen track",
        });

        const loadDom = await runChrome(`${base}/load-click.html`, {
            budget: 14000,
            timeout: 45000,
        });
        assertTokens(loadDom, {
            'data-click-during-load-done="true"': "click-during-load finished",
            'data-click-during-load-loading="true"': "click landed while loading",
            'data-click-during-load-result="applied"': "click applied after load",
            'data-click-during-load-track="Fixture Artist - Loaded Track"':
                "player started clicked track",
        });
    });
}

if (shouldRun("own-collection")) {
    test("own-collection fixture keeps individual purchases separate for owner", async () => {
        const server = await startFixtureServer({
            "/fixturefan": "own-collection/index.html",
        });
        try {
            const dump = (mode) =>
                runChrome(`http://bandcamp.com:${server.port}/fixturefan?mode=${mode}`, {
                    budget: 12000,
                    timeout: 24000,
                    resolver: "MAP bandcamp.com 127.0.0.1",
                });

            const ownAlbum = await dump("own-album");
            assert.equal(readAttr(ownAlbum, "data-bcampx-fixture-card-count"), "2");
            assert.equal(
                readAttr(ownAlbum, "data-bcampx-fixture-release-urls"),
                "https://fixture.bandcamp.com/album/shared|https://fixture.bandcamp.com/album/shared",
            );
            assert.equal(
                readAttr(ownAlbum, "data-bcampx-fixture-downloads"),
                "https://bandcamp.com/download/song-one|https://bandcamp.com/download/song-two",
            );

            const ownTrack = await dump("own-track");
            assert.equal(readAttr(ownTrack, "data-bcampx-fixture-card-count"), "2");
            assert.equal(
                readAttr(ownTrack, "data-bcampx-fixture-titles"),
                "Shared Song One|Shared Song Two",
            );
            assert.equal(
                readAttr(ownTrack, "data-bcampx-fixture-downloads"),
                "https://bandcamp.com/download/song-one|https://bandcamp.com/download/song-two",
            );

            const ownIdentities = await dump("own-identities");
            assert.equal(readAttr(ownIdentities, "data-bcampx-fixture-card-count"), "2");
            assert.equal(
                readAttr(ownIdentities, "data-bcampx-fixture-downloads"),
                "https://bandcamp.com/download/song-one|https://bandcamp.com/download/song-two",
            );

            const otherAlbum = await dump("other-album");
            assert.equal(readAttr(otherAlbum, "data-bcampx-fixture-card-count"), "1");
            assert.equal(
                readAttr(otherAlbum, "data-bcampx-fixture-release-urls"),
                "https://fixture.bandcamp.com/album/shared",
            );

            const ownAlbumSync = await dump("own-album-sync");
            assert.equal(readAttr(ownAlbumSync, "data-bcampx-fixture-card-count"), "2");
            assert.equal(
                readAttr(ownAlbumSync, "data-bcampx-fixture-downloads"),
                "https://bandcamp.com/download/song-one|https://bandcamp.com/download/song-two",
            );

            const ownTrackSync = await dump("own-track-sync");
            assert.equal(readAttr(ownTrackSync, "data-bcampx-fixture-card-count"), "2");
            assert.equal(
                readAttr(ownTrackSync, "data-bcampx-fixture-downloads"),
                "https://bandcamp.com/download/song-one|https://bandcamp.com/download/song-two",
            );

            const otherAlbumSync = await dump("other-album-sync");
            assert.equal(readAttr(otherAlbumSync, "data-bcampx-fixture-card-count"), "1");
        } finally {
            await server.close();
        }
    });
}

if (shouldRun("batchcamp")) {
    test("batchcamp fixture hides controls in list view and restores them in grid view", async () => {
        const server = await startFixtureServer({
            "/fixturefan": "batchcamp/index.html",
        });
        const resolver =
            "MAP bandcamp.com 127.0.0.1, MAP fixture.bandcamp.com 127.0.0.1, MAP f4.bcbits.com 127.0.0.1";
        try {
            const dump = (mode) =>
                runChrome(`http://bandcamp.com:${server.port}/fixturefan?mode=${mode}`, {
                    budget: 18000,
                    timeout: 40000,
                    resolver,
                });
            const assertListState = (dom, prefix) => {
                assert.equal(readAttr(dom, `data-batchcamp-fixture-${prefix}view`), "feed");
                assert.equal(
                    readAttr(dom, `data-batchcamp-fixture-${prefix}position`),
                    "absolute",
                );
                assert.equal(readAttr(dom, `data-batchcamp-fixture-${prefix}onscreen`), "0");
                assert.equal(
                    readAttr(dom, `data-batchcamp-fixture-${prefix}select-all`),
                    "false",
                );
            };
            const assertGridState = (dom, prefix) => {
                assert.equal(
                    readAttr(dom, `data-batchcamp-fixture-${prefix}view`),
                    "original",
                );
                assert.equal(
                    readAttr(dom, `data-batchcamp-fixture-${prefix}position`),
                    "static",
                );
                assert.equal(readAttr(dom, `data-batchcamp-fixture-${prefix}onscreen`), "4");
                assert.equal(
                    readAttr(dom, `data-batchcamp-fixture-${prefix}select-all`),
                    "true",
                );
            };

            const installed = await dump("install");
            assertListState(installed, "feed-");
            assertGridState(installed, "grid-");
            assert.equal(readAttr(installed, "data-batchcamp-fixture-back-view"), "feed");
            assert.equal(
                readAttr(installed, "data-batchcamp-fixture-back-select-all"),
                "false",
            );

            const late = await dump("late");
            assert.equal(readAttr(late, "data-batchcamp-fixture-view-before"), "feed");
            assert.equal(
                readAttr(late, "data-batchcamp-fixture-position-before"),
                "absolute",
            );
            assertListState(late, "feed-");
            assertGridState(late, "grid-");

            const churn = await dump("churn");
            assert.equal(readAttr(churn, "data-batchcamp-fixture-view-before"), "feed");
            assertListState(churn, "feed-");
            assert.equal(
                readAttr(churn, "data-batchcamp-fixture-sync-after"),
                readAttr(churn, "data-batchcamp-fixture-sync-before"),
            );
        } finally {
            await server.close();
        }
    });
}

if (shouldRun("fan-profile")) {
    test("fan-profile fixture covers collection, wishlist, tag search, preview, hidden, and incremental sync", async () => {
        const server = await startFixtureServer({
            "/fixturefan": "fan-profile/index.html",
            "/fixturefan/following/extra": "fan-profile/index.html",
            "/fixturefan-uptodate": "fan-profile/up-to-date.html",
            "/fixturefan-disabled": "fan-profile/disabled.html",
            "/fixturefan-preview": "fan-profile/preview.html",
            "/fixturefan-hidden": "fan-profile/hidden.html",
            "/fixturefan-resume": "fan-profile/resume.html",
            "/fixturefan-incremental": "fan-profile/incremental.html",
            "/fixturefan-ratelimit": "fan-profile/rate-limit.html",
        });
        const baseUrl = `http://bandcamp.com:${server.port}`;
        const resolver =
            "MAP bandcamp.com 127.0.0.1, MAP f4.bcbits.com 127.0.0.1, MAP example.com 127.0.0.1";
        const dump = (route, budget, timeout, extraArgs = []) =>
            runChrome(baseUrl + route, { budget, timeout, resolver, extraArgs });

        try {
            const mainDom = await dump("/fixturefan", 28000, 45000);
            assertTokens(mainDom, {
                'data-bcampx-followers-toggle-absent="true"': "followers started without toggle",
                'data-bcampx-collection-card-count="2"': "collection built on tab switch",
                'data-bcampx-collection-toggle-visible="true"': "collection revealed toggle",
                'data-bcampx-search-first="https://fixture.bandcamp.com/album/release-1"':
                    "search mirrored source grid",
                'data-bcampx-search-reconciled="https://fixture.bandcamp.com/album/release-3"':
                    "search replacement removed stale cards",
                'data-bcampx-wishlist-count="appears in 1 234 collections"':
                    "wishlist reused native collection count",
                'data-bcampx-wishlist-count-exact="true"': "native count authoritative",
                'data-bcampx-localized-dot-count="1234"': "dot-separated count parsed",
                'data-bcampx-localized-space-count="1234"': "space-separated count parsed",
                'data-bcampx-supporter-request-count="0"': "no extra supporter requests",
                'data-bcampx-cached-tracklist-early-count="2"': "cached tracklist rendered early",
                'data-bcampx-cached-native-stream="https://example.com/4.mp3"':
                    "reused page-fresh native preview",
                'data-bcampx-cached-stale-stream-cleared="true"': "stale preview cleared",
                'data-bcampx-wishlist-loading-summary="Loading extra context..."':
                    "loading summary shown",
                'data-bcampx-wishlist-loading-state="true"': "loading state shown",
                'data-bcampx-wishlist-slot-loading="Loading extra context..."':
                    "slot loading message shown",
                'data-bcampx-wishlist-slot-loading-visible="true"': "slot loading visible",
                'data-bcampx-wishlist-refreshed-stream="https://example.com/4.mp3"':
                    "stale cache refreshed",
                'data-bcampx-wishlist-second-refreshed-stream="https://example.com/404.mp3"':
                    "background refresh restored streams",
                'data-bcampx-wishlist-player-enabled="true"': "player wishlist enabled",
                'data-bcampx-wishlist-player-active="true"': "player wishlist active",
                'data-bcampx-player-returned-grid="wishlist-grid"': "restored wishlist tab",
                'data-bcampx-player-scroll-release="https://fixture.bandcamp.com/album/release-4"':
                    "scrolled to active release",
                'data-bcampx-player-scroll-track="4"': "targeted exact track row",
                'data-bcampx-player-scroll-offset="-76"': "accounted for sticky fan tabs",
                'data-bcampx-wishlist-player-pending="true"': "used remote helper action",
                'data-bcampx-wishlist-last-card-preview="true"': "rendered native preview",
                'data-bcampx-wishlist-last-card-loaded="true"': "loaded below-viewport card",
                'data-bcampx-tab-card-reused="true"': "tab switch reused cards",
                'data-bcampx-tab-enhance-delta="0"': "tab switch did not rebuild cards",
                'data-bcampx-tab-sync-delta="0"': "clean fan grids skipped sync",
                'data-bcampx-tab-scan-delta="0"': "tab switch did not schedule full scans",
                'data-bcampx-auto-fetch-limit="4"': "autofetch limit 4",
                'data-bcampx-auto-fetch-peak-count="4"': "autofetch peaked at 4",
                'data-bcampx-auto-fetch-active-count="0"': "autofetch settled",
                'data-bcampx-auto-fetch-queue-count="0"': "autofetch queue drained",
                'data-bcampx-tag-search-matched-before-clear="1"': "tag search matched",
                'data-bcampx-tag-search-card-count="1"': "appended one tag card",
                'data-bcampx-tag-search-card-url="https://fixture.bandcamp.com/album/release-9"':
                    "rendered tagged release",
                'data-bcampx-tag-search-card-order="https://fixture.bandcamp.com/album/release-3,https://fixture.bandcamp.com/album/release-9"':
                    "tag match appended after native results",
                'data-bcampx-tag-cards-with-tracks="1"': "tag result kept tracklist",
                'data-bcampx-tag-cards-total="1"': "exactly one tag result",
                'data-bcampx-tag-search-setup="bound"': "tag search bridge bound",
                'data-bcampx-tag-index-pending="collection,wishlist"':
                    "fresh index scheduled both grids",
                'data-bcampx-tag-index-state="filled"': "tag index finished",
                'data-bcampx-tag-index-items="20"': "indexed both grids",
                'data-bcampx-tag-index-tagged="10"': "fetched all release tags",
                'data-bcampx-tag-card-survived="true"': "tag card survived native arrival",
                'data-bcampx-tag-card-copies="1"': "no duplicate tag card",
                'data-bcampx-tag-search-view="original"': "switched to native grid",
                'data-bcampx-tag-search-section-count="0"': "native grid has no tag block",
                'data-bcampx-tag-search-cleared-matches="0"': "clearing dropped matches",
                'data-bcampx-tag-search-cleared-feed-count="0"': "clearing removed tag cards",
                'data-bcampx-tag-search-cleared-section="false"': "clearing removed block",
                'data-bcampx-tag-search-no-match-card="https://fixture.bandcamp.com/album/release-10"':
                    "tag-only query rendered match",
                'data-bcampx-tag-search-no-match-hidden="false"':
                    "native view left no-match notice",
                'data-bcampx-feed-outside-grid="true"': "feed outside managed grid",
                'data-bcampx-feed-centered="true"': "feed centered",
                'data-bcampx-fixture-tag-setting-label="Tag search (experimental)"':
                    "tag setting marked experimental",
                'data-bcampx-fixture-tag-setting-progress="true"':
                    "tag setting showed progress",
                'data-bcampx-tag-search-no-match-leak="false"': "no-match notice did not leak",
                'data-bcampx-tag-native-origins="native,native"': "reused native cards",
                'data-bcampx-tag-native-art="true"': "kept native cover art",
                'data-bcampx-tag-native-playerdata="true"': "kept native preview data",
                'data-bcampx-tag-index-origin="index"': "rendered off-page tag match",
                'data-bcampx-tag-index-art="https://f4.bcbits.com/img/a0000054321_16.jpg"':
                    "derived cover art from art id",
                'data-bcampx-tag-index-action="you own this"': "owned tag card action",
                'data-bcampx-tag-index-owned="true"': "owned tag card link",
                'data-bcampx-tracklist-source="mobile-api"': "mobile API fallback tracklist",
                'data-bcampx-api-tracklist-label="API Track 30"': "API track rows rendered",
                'data-bcampx-api-tracklist-stream="https://example.com/api-30.mp3"':
                    "API tracklist playable streams",
                'data-bcampx-api-tracklist-after="present"':
                    "API tracklist survived later syncs",
            });

            const deepDom = await dump("/fixturefan/following/extra", 2500, 18000);
            assertTokens(deepDom, { 'data-bcampx-script-loaded="true"': "booted" });
            assert.ok(!deepDom.includes('<section class="bcampx-label-feed"'));

            const upToDateDom = await dump("/fixturefan-uptodate", 9000, 20000);
            assertTokens(upToDateDom, {
                'data-bcampx-tag-index-state="up-to-date"': "skipped background run",
                'data-bcampx-tag-index-pending=""': "no pending grid",
                'data-bcampx-tag-index-items="10"': "reported stored item count",
                'data-bcampx-fixture-tag-requests="0"': "no tag requests",
                'data-bcampx-fixture-hook-state="up-to-date"': "hook reported state",
                'data-bcampx-fixture-hook-items="10"': "hook reported items",
                'data-bcampx-fixture-hook-complete="true"': "hook reported complete",
                'data-bcampx-fixture-summary-state="up-to-date"': "summary state",
                'data-bcampx-fixture-summary-items="10"': "summary items",
            });

            const rateLimitDom = await dump("/fixturefan-ratelimit", 9000, 20000);
            assertTokens(rateLimitDom, {
                'data-bcampx-tag-index-state="cooldown"': "429 stopped index run",
                'data-bcampx-fixture-request-burst="true"': "stopped further requests",
                'data-bcampx-fixture-cooldown-active="true"': "cooldown persisted",
                'data-bcampx-fixture-cooldown-level="1"': "backoff level 1",
            });

            const disabledDom = await dump("/fixturefan-disabled", 12000, 25000);
            assertTokens(disabledDom, {
                'data-bcampx-fixture-index-state="disabled"': "disabled by default",
                'data-bcampx-fixture-setup="false"': "search bridge not bound",
                'data-bcampx-fixture-tag-requests="0"': "no tag requests",
                'data-bcampx-fixture-matches="none"': "no tag matches",
            });

            const resumeDom = await dump("/fixturefan-resume", 16000, 30000);
            assertTokens(resumeDom, {
                'data-bcampx-fixture-items="42"': "kept earlier items",
                'data-bcampx-fixture-has-old="true"': "old item survived",
                'data-bcampx-fixture-has-new="true"': "resumed page merged",
                'data-bcampx-fixture-has-seed="true"': "newest page items merged",
                'data-bcampx-fixture-resumed="true"': "resumed from stored token",
                'data-bcampx-fixture-complete="true"': "finished enumerating",
                'data-bcampx-tag-index-items="42"': "full item count",
                'data-bcampx-tag-index-items-complete="true"': "complete flag set",
            });

            const previewDom = await dump("/fixturefan-preview", 20000, 45000, [
                "--autoplay-policy=no-user-gesture-required",
            ]);
            assertTokens(previewDom, {
                'data-bcampx-preview-done="true"': "preview scenario finished",
                'data-bcampx-preview-row="Preview Song"': "featured track listed",
                'data-bcampx-preview-row-stream="true"': "preview stream attached",
                'data-bcampx-preview-action="download"': "download action offered",
                'data-bcampx-preview-download="https://bandcamp.com/download/preview-7002"':
                    "download link from redownload map",
                'data-bcampx-preview-unavailable="true"': "missing release marked unavailable",
                'data-bcampx-preview-player-track="Fixture Artist - Preview Song"':
                    "played in shared player",
                'data-bcampx-preview-player-store="Preview Release / Fixture Artist"':
                    "player showed release metadata",
                'data-bcampx-preview-player-active="true"': "shared player active",
                'data-bcampx-preview-link-prevented="true"': "unverified link held",
                'data-bcampx-preview-link-unavailable="true"': "dead page detected before nav",
                'data-bcampx-preview-search-player="Fixture Artist - Search Song"':
                    "search result played in shared player",
                'data-bcampx-preview-search-unavailable="true"':
                    "private search card marked unavailable",
            });

            const hiddenDom = await dump("/fixturefan-hidden", 18000, 35000);
            assertTokens(hiddenDom, {
                'data-bcampx-hidden-done="true"': "hidden scenario finished",
                'data-bcampx-hidden-unavailable="true"': "404 marked unavailable",
                'data-bcampx-hidden-html-requests="1"': "requested once",
                'data-bcampx-hidden-api-requests="1"': "mobile API requested",
                'data-bcampx-hidden-tracks="Hidden Track"': "API tracklist filled card",
                'data-bcampx-hidden-release-link-blocked="true"': "dead link blocked",
                'data-bcampx-hidden-download-outside="true"': "download link stayed outside",
                'data-bcampx-hidden-artist-link-ok="true"': "artist link stayed usable",
            });

            const hiddenCachedDom = await dump(
                "/fixturefan-hidden?cached=1",
                18000,
                35000,
            );
            assertTokens(hiddenCachedDom, {
                'data-bcampx-hidden-cached="true"': "seeded cache",
                'data-bcampx-hidden-done="true"': "cached hidden scenario finished",
                'data-bcampx-hidden-unavailable="true"': "cached 404 marked unavailable",
                'data-bcampx-hidden-html-requests="1"': "revalidated once",
                'data-bcampx-hidden-release-link-blocked="true"': "cached link blocked",
                'data-bcampx-hidden-artist-link-ok="true"': "artist link stayed usable",
            });

            const incrementalDom = await dump("/fixturefan-incremental", 12000, 30000);
            assertTokens(incrementalDom, {
                'data-debug-incremental-feed-count="3"': "appended item reached feed",
                'data-debug-incremental-used="true"': "incremental sync used",
                'data-debug-incremental-card="present"': "appended card present",
            });
        } finally {
            await server.close();
        }
    });
}
