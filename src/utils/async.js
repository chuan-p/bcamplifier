// Shared async scheduling primitives: bounded concurrency and serial queues.

export function createConcurrencyLimiter(getMaxConcurrency) {
    let active = 0;
    const queue = [];

    const readLimit = () => {
        const raw =
            typeof getMaxConcurrency === "function"
                ? getMaxConcurrency()
                : getMaxConcurrency;
        return Math.max(1, Math.floor(Number(raw) || 1));
    };

    const drain = () => {
        const maxConcurrency = readLimit();
        while (active < maxConcurrency && queue.length) {
            const entry = queue.shift();
            if (!entry || typeof entry.task !== "function") {
                continue;
            }
            active += 1;
            Promise.resolve()
                .then(() => entry.task())
                .then(entry.resolve, entry.reject)
                .finally(() => {
                    active = Math.max(0, active - 1);
                    drain();
                });
        }
    };

    return (task, options = {}) =>
        new Promise((resolve, reject) => {
            const entry = { task, resolve, reject };
            if (options && options.priority === true) {
                queue.unshift(entry);
            } else {
                queue.push(entry);
            }
            drain();
        });
}

export function createSerialQueue() {
    let tail = Promise.resolve();

    return (task) => {
        const run = () => Promise.resolve().then(task);
        const result = tail.then(run, run);
        tail = result.then(
            () => {},
            () => {},
        );
        return result;
    };
}
