    const PLAYER_ICON_DEFINITIONS = {
        favorite: {
            viewBox: "0 0 20 20",
            children: [
                {
                    tagName: "path",
                    attributes: {
                        class: "bcampx-player-favorite-outline",
                        d: "M10 16.4 3.7 10.5A3.9 3.9 0 0 1 9.2 4.9L10 5.7l.8-.8a3.9 3.9 0 0 1 5.5 5.6L10 16.4Z",
                        fill: "none",
                        stroke: "currentColor",
                        "stroke-width": "1.7",
                        "stroke-linecap": "round",
                        "stroke-linejoin": "round",
                    },
                },
                {
                    tagName: "path",
                    attributes: {
                        class: "bcampx-player-favorite-fill",
                        d: "M10 16.4 3.7 10.5A3.9 3.9 0 0 1 9.2 4.9L10 5.7l.8-.8a3.9 3.9 0 0 1 5.5 5.6L10 16.4Z",
                        fill: "currentColor",
                    },
                },
            ],
        },
        open: {
            viewBox: "0 0 20 20",
            children: [
                {
                    tagName: "path",
                    attributes: {
                        d: "M7 13 13 7",
                        fill: "none",
                        stroke: "currentColor",
                        "stroke-width": "1.8",
                        "stroke-linecap": "round",
                    },
                },
                {
                    tagName: "path",
                    attributes: {
                        d: "M8.2 6.8H14v5.8",
                        fill: "none",
                        stroke: "currentColor",
                        "stroke-width": "1.8",
                        "stroke-linecap": "round",
                        "stroke-linejoin": "round",
                    },
                },
            ],
        },
        settings: {
            viewBox: "0 0 20 20",
            children: [
                {
                    tagName: "circle",
                    attributes: {
                        cx: "10",
                        cy: "4.75",
                        r: "1.55",
                        fill: "currentColor",
                    },
                },
                {
                    tagName: "circle",
                    attributes: {
                        cx: "10",
                        cy: "10",
                        r: "1.55",
                        fill: "currentColor",
                    },
                },
                {
                    tagName: "circle",
                    attributes: {
                        cx: "10",
                        cy: "15.25",
                        r: "1.55",
                        fill: "currentColor",
                    },
                },
            ],
        },
    };

    function createSvgNode(tagName, attributes) {
        const node = document.createElementNS(SVG_NS, tagName);
        Object.entries(attributes || {}).forEach(([name, value]) => {
            node.setAttribute(name, value);
        });
        return node;
    }

    function createPlayerIcon(iconName) {
        const definition = PLAYER_ICON_DEFINITIONS[iconName];
        if (!definition) {
            return document.createTextNode("");
        }

        const svg = createSvgNode("svg", {
            viewBox: definition.viewBox,
            "aria-hidden": "true",
            focusable: "false",
        });

        definition.children.forEach((child) => {
            svg.appendChild(createSvgNode(child.tagName, child.attributes));
        });

        return svg;
    }
