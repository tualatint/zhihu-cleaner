#!/usr/bin/env python3
"""生成扩展图标（纯标准库，无需 Pillow）。

设计：知乎蓝的圆角方块 + 一条白色横杠（“移除”的意象）。
用法：python3 tools/make-icons.py
"""
import os
import struct
import zlib

HERE = os.path.dirname(os.path.abspath(__file__))
OUT_DIR = os.path.join(os.path.dirname(HERE), "icons")

BG = (0, 132, 255, 255)      # 知乎蓝
FG = (255, 255, 255, 255)


def make_pixel_fn(size):
    radius = size * 0.22
    bar_h = max(1.0, size * 0.13)
    bar_w = size * 0.52
    bar_x0 = (size - bar_w) / 2.0
    bar_y0 = (size - bar_h) / 2.0
    maxi = size - 1

    def in_round_rect(x, y):
        # 四角做圆角裁剪
        for cx, cy in (
            (radius, radius),
            (maxi - radius, radius),
            (radius, maxi - radius),
            (maxi - radius, maxi - radius),
        ):
            corner = (
                (x < radius and cx == radius) or (x > maxi - radius and cx == maxi - radius)
            )
            vertical = (
                (y < radius and cy == radius) or (y > maxi - radius and cy == maxi - radius)
            )
            if corner and vertical:
                return (x - cx) ** 2 + (y - cy) ** 2 <= radius * radius
        return True

    def pixel(x, y):
        if not in_round_rect(x, y):
            return (0, 0, 0, 0)
        if bar_x0 <= x < bar_x0 + bar_w and bar_y0 <= y < bar_y0 + bar_h:
            return FG
        return BG

    return pixel


def write_png(path, size):
    pixel = make_pixel_fn(size)
    raw = bytearray()
    for y in range(size):
        raw.append(0)  # filter type 0 (None)
        for x in range(size):
            raw.extend(pixel(x, y))

    def chunk(tag, data):
        body = tag + data
        return (
            struct.pack(">I", len(data))
            + body
            + struct.pack(">I", zlib.crc32(body) & 0xFFFFFFFF)
        )

    ihdr = struct.pack(">IIBBBBB", size, size, 8, 6, 0, 0, 0)  # 8-bit RGBA
    png = (
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", ihdr)
        + chunk(b"IDAT", zlib.compress(bytes(raw), 9))
        + chunk(b"IEND", b"")
    )
    with open(path, "wb") as fh:
        fh.write(png)
    print(f"wrote {path} ({len(png)} bytes)")


def main():
    os.makedirs(OUT_DIR, exist_ok=True)
    for size in (48, 96):
        write_png(os.path.join(OUT_DIR, f"icon-{size}.png"), size)


if __name__ == "__main__":
    main()
