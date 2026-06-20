#!/usr/bin/env python3

from __future__ import annotations

from io import BytesIO
from pathlib import Path

from PIL import Image, ImageDraw


ROOT = Path(__file__).resolve().parents[1]
ICON_DIR = ROOT / "assets" / "icons"
SOURCE = ROOT / "assets" / "icon-source" / "master-source.png"
FALLBACK_SOURCE = ICON_DIR / "icon-1024.png"
EXPORT_SIZES = [16, 32, 48, 128]
CORNER_RADIUS = 170


def build_master() -> Image.Image:
    source = resolve_source()
    with Image.open(source) as opened:
        image = opened.convert("RGBA")
    if source == FALLBACK_SOURCE:
        return image

    width, height = image.size

    mask = Image.new("L", (width, height), 0)
    draw = ImageDraw.Draw(mask)
    draw.rounded_rectangle((0, 0, width, height), radius=CORNER_RADIUS, fill=255)

    rounded = Image.new("RGBA", (width, height), (0, 0, 0, 0))
    rounded.paste(image, (0, 0), mask)
    return rounded


def export_icons(master: Image.Image) -> None:
    ICON_DIR.mkdir(parents=True, exist_ok=True)
    save_png_if_changed(master, ICON_DIR / "icon-1024.png")
    for size in EXPORT_SIZES:
        resized = master.resize((size, size), Image.Resampling.LANCZOS)
        save_png_if_changed(resized, ICON_DIR / f"icon-{size}.png")


def resolve_source() -> Path:
    if SOURCE.exists():
        return SOURCE
    if FALLBACK_SOURCE.exists():
        return FALLBACK_SOURCE
    raise FileNotFoundError(
        f"Missing icon source: expected {SOURCE} or fallback {FALLBACK_SOURCE}"
    )


def save_png_if_changed(image: Image.Image, output_path: Path) -> None:
    buffer = BytesIO()
    image.save(buffer, format="PNG")
    next_bytes = buffer.getvalue()
    if output_path.exists() and output_path.read_bytes() == next_bytes:
        return
    output_path.write_bytes(next_bytes)


def main() -> None:
    export_icons(build_master())


if __name__ == "__main__":
    main()
