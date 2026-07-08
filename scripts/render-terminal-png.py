#!/usr/bin/env python3
"""Render monospace terminal text to a PNG for report screenshots."""
from __future__ import annotations

import argparse
import re
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont


def load_font(size: int) -> ImageFont.FreeTypeFont | ImageFont.ImageFont:
    candidates = [
        "C:/Windows/Fonts/consola.ttf",
        "C:/Windows/Fonts/CascadiaMono.ttf",
        "C:/Windows/Fonts/lucon.ttf",
    ]
    for path in candidates:
        if Path(path).exists():
            return ImageFont.truetype(path, size)
    return ImageFont.load_default()


def colorize_line(line: str) -> tuple[str, tuple[int, int, int]]:
    if re.search(r"\b74 passed\b|\b10 passed\b|PASS\b|✓", line):
        return line, (134, 239, 172)
    if re.search(r"FAIL|failed|Error|error", line, re.I):
        return line, (252, 165, 165)
    if re.search(r"RUN |Test Files|Tests |Duration|Start at|eval", line):
        return line, (147, 197, 253)
    if line.strip().startswith(">"):
        return line, (250, 204, 21)
    return line, (229, 231, 235)


def render_terminal(text: str, out_path: Path, title: str | None = None) -> None:
    lines = text.replace("\r\n", "\n").replace("\r", "\n").split("\n")
    # Trim trailing empty lines
    while lines and not lines[-1].strip():
        lines.pop()

    font_size = 18
    font = load_font(font_size)
    padding = 24
    line_height = 26
    char_w = 10
    max_cols = max((len(l) for l in lines), default=40)
    width = min(max_cols * char_w + padding * 2, 1400)
    height = padding * 2 + (len(lines) + (1 if title else 0)) * line_height + 8

    img = Image.new("RGB", (width, height), (24, 24, 27))
    draw = ImageDraw.Draw(img)

    # Title bar
    if title:
        draw.rectangle((0, 0, width, 36), fill=(39, 39, 42))
        draw.ellipse((12, 12, 20, 20), fill=(239, 68, 68))
        draw.ellipse((28, 12, 36, 20), fill=(234, 179, 8))
        draw.ellipse((44, 12, 52, 20), fill=(34, 197, 94))
        draw.text((64, 9), title, fill=(212, 212, 216), font=load_font(14))
        y = 48
    else:
        y = padding

    for line in lines:
        _, color = colorize_line(line)
        draw.text((padding, y), line[: (width - padding * 2) // char_w], fill=color, font=font)
        y += line_height

    out_path.parent.mkdir(parents=True, exist_ok=True)
    img.save(out_path, "PNG", optimize=True)
    print(f"Wrote {out_path}")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("input")
    parser.add_argument("output")
    parser.add_argument("--title", default=None)
    args = parser.parse_args()
    text = Path(args.input).read_text(encoding="utf-8", errors="replace")
    render_terminal(text, Path(args.output), title=args.title)


if __name__ == "__main__":
    main()
