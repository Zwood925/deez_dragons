#!/usr/bin/env python3
"""
Generate the PWA icons (192x192 and 512x512 PNG) with zero dependencies.

Usage (from frontend/):  python3 scripts/generate_icons.py

Design: dark background, crimson radial glow, gold rune-diamond with a
dark inner diamond. Full-bleed artwork so the icon is safe for "maskable".
"""
import math
import os
import struct
import zlib

OUT_DIR = os.path.join(os.path.dirname(__file__), "..", "public", "icons")

BG = (10, 10, 10)
CRIMSON = (127, 29, 29)
GOLD = (245, 180, 60)


def lerp(a, b, t):
    return a + (b - a) * t


def mix(c1, c2, t):
    t = max(0.0, min(1.0, t))
    return tuple(lerp(c1[i], c2[i], t) for i in range(3))


def render(size):
    rows = []
    c = (size - 1) / 2.0
    for y in range(size):
        row = bytearray([0])  # PNG filter type 0
        for x in range(size):
            dx, dy = (x - c) / size, (y - c) / size
            dist = math.hypot(dx, dy)

            # Background: crimson glow fading to near-black
            glow = max(0.0, 1.0 - dist / 0.62)
            color = mix(BG, CRIMSON, glow ** 1.6)

            # Diamond (rotated square) using Manhattan distance
            manhattan = abs(dx) + abs(dy)
            outer, ring_in, inner = 0.34, 0.285, 0.20
            aa = 1.5 / size
            if manhattan <= outer:
                if manhattan >= ring_in:
                    color = mix(color, GOLD, (outer - manhattan) / aa)
                elif manhattan > inner:
                    color = mix(color, BG, 0.85)
                else:
                    # inner gold core with soft edge
                    color = mix(BG, GOLD, (inner - manhattan) / aa * 0.5 + 0.5)
            row.extend(int(round(v)) for v in color)
        rows.append(bytes(row))
    return b"".join(rows)


def chunk(tag, data):
    body = tag + data
    return struct.pack(">I", len(data)) + body + struct.pack(">I", zlib.crc32(body) & 0xFFFFFFFF)


def write_png(path, size):
    raw = render(size)
    png = b"\x89PNG\r\n\x1a\n"
    png += chunk(b"IHDR", struct.pack(">IIBBBBB", size, size, 8, 2, 0, 0, 0))
    png += chunk(b"IDAT", zlib.compress(raw, 9))
    png += chunk(b"IEND", b"")
    with open(path, "wb") as f:
        f.write(png)
    print(f"wrote {os.path.normpath(path)} ({size}x{size}, {len(png)} bytes)")


if __name__ == "__main__":
    os.makedirs(OUT_DIR, exist_ok=True)
    for s in (192, 512):
        write_png(os.path.join(OUT_DIR, f"icon-{s}.png"), s)
