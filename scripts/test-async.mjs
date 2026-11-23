#!/usr/bin/env node

// Unit tests for shared async scheduling primitives in src/utils/async.js.

import assert from "node:assert/strict";
import test from "node:test";
import { createConcurrencyLimiter, createSerialQueue } from "../src/utils/async.js";

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

test("createConcurrencyLimiter enforces max concurrency and supports priority", async () => {
    let active = 0;
    let peak = 0;
    const order = [];
    const limit = createConcurrencyLimiter(2);

    const run = (label, ms, options) =>
        limit(async () => {
            active += 1;
            peak = Math.max(peak, active);
            order.push(label);
            await delay(ms);
            active -= 1;
            return label;
        }, options);

    const results = await Promise.all([
        run("a", 25),
        run("b", 25),
        run("c", 5),
        run("urgent", 5, { priority: true }),
    ]);

    assert.deepEqual(results, ["a", "b", "c", "urgent"]);
    assert.equal(peak, 2);
    assert.equal(order[2], "urgent");
    assert.equal(order[3], "c");
});

test("createSerialQueue serializes tasks and recovers after errors", async () => {
    const queue = createSerialQueue();
    const events = [];

    const first = queue(async () => {
        events.push("start:1");
        await delay(15);
        events.push("end:1");
        return 1;
    });
    const second = queue(async () => {
        events.push("start:2");
        throw new Error("boom");
    });
    const third = queue(async () => {
        events.push("start:3");
        return 3;
    });

    assert.equal(await first, 1);
    await assert.rejects(second, /boom/);
    assert.equal(await third, 3);
    assert.deepEqual(events, ["start:1", "end:1", "start:2", "start:3"]);
});
