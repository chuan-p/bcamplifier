import { STATE } from "../state.js";
import { cleanText, normalizedText, sanitizeDescriptionHtml } from "./text-format.js";

export function isPlainPrimaryClick(event) {
    return Boolean(
        event &&
            event.button === 0 &&
            !event.metaKey &&
            !event.ctrlKey &&
            !event.shiftKey &&
            !event.altKey,
    );
}

export function setTextInputValue(input, value) {
    const proto = Object.getPrototypeOf(input);
    const descriptor =
        proto && Object.getOwnPropertyDescriptor(proto, "value");
    if (descriptor && typeof descriptor.set === "function") {
        descriptor.set.call(input, value);
    } else {
        input.value = value;
    }
}

function clearNodeMemo(node) {
    if (node && node.__bcampxMemo) {
        delete node.__bcampxMemo;
    }
}

export function clearNodeMemoDeep(root) {
    if (!(root instanceof Element)) {
        return;
    }

    clearNodeMemo(root);
    if (typeof root.querySelectorAll !== "function") {
        return;
    }

    root.querySelectorAll("*").forEach((node) => {
        clearNodeMemo(node);
    });
}

export function invalidateNodeMemoCache() {
    STATE.memoVersion += 1;
}

function findElementByText(root, selector, pattern) {
    return Array.from(root.querySelectorAll(selector)).find((node) =>
        pattern.test(normalizedText(node)),
    );
}

export function getMatchingRootOrDescendants(root, selector) {
    if (!root || typeof selector !== "string") {
        return [];
    }

    const matches = [];
    if (root instanceof Element && root.matches(selector)) {
        matches.push(root);
    }

    if (root.querySelectorAll) {
        matches.push(...Array.from(root.querySelectorAll(selector)));
    }

    return matches;
}

export function getNodeMemo(node) {
    if (!(node instanceof Element)) {
        return null;
    }

    if (
        !node.__bcampxMemo ||
        node.__bcampxMemo.__version !== STATE.memoVersion
    ) {
        node.__bcampxMemo = Object.create(null);
        node.__bcampxMemo.__version = STATE.memoVersion;
    }

    return node.__bcampxMemo;
}

export function findCachedElementByText(root, key, selector, pattern) {
    if (!(root instanceof Element) || !key) {
        return null;
    }

    const memo = getNodeMemo(root);
    if (memo && Object.prototype.hasOwnProperty.call(memo, key)) {
        return memo[key];
    }

    const result = findElementByText(root, selector, pattern) || null;
    if (memo) {
        memo[key] = result;
    }
    return result;
}

export function findCachedSelector(root, key, selector) {
    if (!(root instanceof Element) || !key || !selector) {
        return null;
    }

    const memo = getNodeMemo(root);
    if (memo && Object.prototype.hasOwnProperty.call(memo, key)) {
        return memo[key];
    }

    const result = root.querySelector(selector) || null;
    if (memo) {
        memo[key] = result;
    }
    return result;
}

export function createClassedElement(tagName, className) {
    const element = document.createElement(tagName);
    if (className) {
        element.className = className;
    }
    return element;
}

export function createDescriptionElement(data, className, tagName = "div") {
    if (!(data && (data.descriptionHtml || data.description))) {
        return null;
    }

    const description = createClassedElement(tagName, className);
    renderDescriptionContent(description, data);
    return description;
}

export function createTrackListElement(tracks, className, renderItem) {
    const list = createClassedElement("ol", className);
    (tracks || []).forEach((track, index) => {
        const item =
            typeof renderItem === "function"
                ? renderItem(track, index)
                : null;
        if (item instanceof Node) {
            list.append(item);
        }
    });
    return list;
}

function renderDescriptionContent(container, data) {
    const html = sanitizeDescriptionHtml(
        data && data.descriptionHtml ? data.descriptionHtml : "",
    );
    if (html) {
        replaceElementChildrenFromHtml(container, html);
        return;
    }

    container.textContent =
        data && data.description ? data.description : "";
}

export function normalizeDescriptionContent(container) {
    if (!container) {
        return;
    }

    Array.from(container.querySelectorAll("p")).forEach((paragraph) => {
        if (!cleanText(paragraph.textContent || "")) {
            paragraph.remove();
        }
    });

    Array.from(container.childNodes).forEach((node) => {
        if (
            node.nodeType === Node.TEXT_NODE &&
            !cleanText(node.textContent || "")
        ) {
            node.remove();
        }
    });
}

function replaceElementChildrenFromHtml(container, html) {
    if (!container) {
        return;
    }

    const parsed = new DOMParser().parseFromString(
        `<div>${html}</div>`,
        "text/html",
    );
    const root = parsed.body.firstElementChild;
    if (!root) {
        replaceElementChildren(container);
        return;
    }

    const nodes = Array.from(root.childNodes).map((node) =>
        document.importNode(node, true),
    );
    replaceElementChildren(container, nodes);
}

function replaceElementChildren(container, nodes = []) {
    if (!container) {
        return;
    }

    if (typeof container.replaceChildren === "function") {
        container.replaceChildren(...nodes);
        return;
    }

    while (container.firstChild) {
        container.removeChild(container.firstChild);
    }

    nodes.forEach((node) => {
        if (node) {
            container.appendChild(node);
        }
    });
}

export function markDebugState(name, value) {
    if (!document.documentElement || !name) {
        return;
    }

    document.documentElement.setAttribute(name, cleanText(value));
}

export function incrementDebugCounter(name) {
    if (!document.documentElement || !name) {
        return;
    }

    const current = Number(
        document.documentElement.getAttribute(name) || "0",
    );
    document.documentElement.setAttribute(
        name,
        String(Number.isFinite(current) ? current + 1 : 1),
    );
}
