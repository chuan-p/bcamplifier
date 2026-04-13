#!/usr/bin/env python3

from __future__ import annotations

from pathlib import Path

from PIL import Image, ImageDraw


ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "assets" / "icon-source" / "master-source.png"
ICON_DIR = ROOT / "assets" / "icons"
EXPORT_SIZES = [16, 32, 48, 128]
CORNER_RADIUS = 170


def build_master() -> Image.Image:
    image = Image.open(SOURCE).convert("RGBA")
    width, height = image.size

    mask = Image.new("L", (width, height), 0)
    draw = ImageDraw.Draw(mask)
    draw.rounded_rectangle((0, 0, width, height), radius=CORNER_RADIUS, fill=255)

    rounded = Image.new("RGBA", (width, height), (0, 0, 0, 0))
    rounded.paste(image, (0, 0), mask)
    return rounded


def export_icons(master: Image.Image) -> None:
    ICON_DIR.mkdir(parents=True, exist_ok=True)
    master.save(ICON_DIR / "icon-1024.png")
    for size in EXPORT_SIZES:
        resized = master.resize((size, size), Image.Resampling.LANCZOS)
        resized.save(ICON_DIR / f"icon-{size}.png")


def main() -> None:
    export_icons(build_master())


if __name__ == "__main__":
    main()
