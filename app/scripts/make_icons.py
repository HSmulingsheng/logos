#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
生成 PWA 图标（用 Gentium 字体的 Α 字 + 蓝绿渐变底）。
用法: python3 scripts/make_icons.py
"""
from __future__ import annotations

import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

HERE = Path(__file__).resolve().parent
PUB = HERE.parent / "public"
FONT = PUB / "fonts" / "GentiumPlus-Bold.ttf"

# 与 tailwind.config.js 中的 aegean-500 / laurel-500 对齐
C1 = (6, 163, 240)
C2 = (61, 167, 92)


def gradient(size: int) -> Image.Image:
    img = Image.new("RGB", (size, size))
    px = img.load()
    for y in range(size):
        for x in range(size):
            t = (x + y) / (2 * (size - 1))
            px[x, y] = tuple(round(C1[i] + (C2[i] - C1[i]) * t) for i in range(3))
    return img


def rounded_mask(size: int, radius_ratio: float) -> Image.Image:
    m = Image.new("L", (size, size), 0)
    d = ImageDraw.Draw(m)
    d.rounded_rectangle([0, 0, size - 1, size - 1], radius=int(size * radius_ratio), fill=255)
    return m


def make(size: int, out: Path, radius_ratio: float, glyph_ratio: float, full_bleed: bool = False) -> None:
    base = gradient(size).convert("RGBA")
    if full_bleed:
        canvas = base
    else:
        canvas = Image.new("RGBA", (size, size), (0, 0, 0, 0))
        canvas.paste(base, (0, 0), rounded_mask(size, radius_ratio))

    font = ImageFont.truetype(str(FONT), int(size * glyph_ratio))
    layer = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    box = d.textbbox((0, 0), "Α", font=font)
    w, h = box[2] - box[0], box[3] - box[1]
    # 视觉重心略上移，因为 Α 的下缘留白多
    d.text(((size - w) / 2 - box[0], (size - h) / 2 - box[1] - size * 0.015), "Α", font=font, fill=(255, 255, 255, 255))
    canvas = Image.alpha_composite(canvas, layer)
    canvas.save(out)
    print(f"  {out.name}  {size}x{size}  {out.stat().st_size} B")


def main() -> int:
    if not FONT.exists():
        print(f"缺少字体 {FONT}", file=sys.stderr)
        return 1
    print("生成图标：")
    make(192, PUB / "icons" / "icon-192.png", 0.22, 0.62)
    make(512, PUB / "icons" / "icon-512.png", 0.22, 0.62)
    # maskable：满幅渐变 + 安全区内缩的字形
    make(512, PUB / "icons" / "icon-maskable-512.png", 0.5, 0.44, full_bleed=True)
    make(180, PUB / "icons" / "apple-touch-icon.png", 0.0, 0.60, full_bleed=True)
    # 供桌面 App 生成 .icns 用
    make(1024, PUB / "icons" / "icon-1024.png", 0.22, 0.62, full_bleed=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
