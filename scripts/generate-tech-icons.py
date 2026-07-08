#!/usr/bin/env python3
"""Generate simple branded tech-stack icon PNGs for the PFE report."""
from __future__ import annotations

from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

OUT = Path(__file__).resolve().parents[1] / "doc" / "pfe-report" / "assets" / "tech-icons"
SIZE = 128


def load_font(size: int) -> ImageFont.FreeTypeFont | ImageFont.ImageFont:
    for path in (
        "C:/Windows/Fonts/segoeuib.ttf",
        "C:/Windows/Fonts/arialbd.ttf",
        "C:/Windows/Fonts/consolab.ttf",
    ):
        if Path(path).exists():
            return ImageFont.truetype(path, size)
    return ImageFont.load_default()


def hex_to_rgb(value: str) -> tuple[int, int, int]:
    value = value.lstrip("#")
    return tuple(int(value[i : i + 2], 16) for i in (0, 2, 4))  # type: ignore[return-value]


def make_icon(
    name: str,
    bg: str,
    fg: str,
    label: str,
    *,
    sublabel: str | None = None,
) -> None:
    img = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)
    margin = 8
    draw.rounded_rectangle(
        (margin, margin, SIZE - margin, SIZE - margin),
        radius=22,
        fill=hex_to_rgb(bg),
    )
    font = load_font(34 if len(label) <= 3 else 24)
    bbox = draw.textbbox((0, 0), label, font=font)
    tw, th = bbox[2] - bbox[0], bbox[3] - bbox[1]
    y = (SIZE - th) / 2 - (10 if sublabel else 0)
    draw.text(((SIZE - tw) / 2, y), label, fill=hex_to_rgb(fg), font=font)
    if sublabel:
        sfont = load_font(16)
        sb = draw.textbbox((0, 0), sublabel, font=sfont)
        sw = sb[2] - sb[0]
        draw.text(((SIZE - sw) / 2, y + th + 4), sublabel, fill=hex_to_rgb(fg), font=sfont)
    OUT.mkdir(parents=True, exist_ok=True)
    img.save(OUT / f"{name}.png", "PNG", optimize=True)
    print(f"Wrote {OUT / f'{name}.png'}")


def main() -> None:
    icons = [
        ("typescript", "3178C6", "FFFFFF", "TS"),
        ("javascript", "F7DF1E", "111111", "JS"),
        ("nodejs", "339933", "FFFFFF", "Node"),
        ("react", "20232A", "61DAFB", "React"),
        ("nextjs", "111111", "FFFFFF", "Next"),
        ("express", "111111", "FFFFFF", "ex"),
        ("prisma", "2D3748", "FFFFFF", "Prisma"),
        ("postgresql", "336791", "FFFFFF", "SQL"),
        ("redis", "DC382D", "FFFFFF", "Redis"),
        ("docker", "2496ED", "FFFFFF", "Docker"),
        ("vitest", "6E9F18", "FFFFFF", "Vitest"),
        ("bullmq", "B45309", "FFFFFF", "Bull"),
        ("zod", "3068B7", "FFFFFF", "Zod"),
        ("gemini", "4285F4", "FFFFFF", "AI"),
        ("css", "1572B6", "FFFFFF", "CSS"),
    ]
    for name, bg, fg, label in icons:
        make_icon(name, bg, fg, label)


if __name__ == "__main__":
    main()
