#!/usr/bin/env python3
"""Draws the Grove app icon set into assets/. Run: python3 scripts/make-icons.py"""
import math
import os

from PIL import Image, ImageDraw

OUT = os.path.join(os.path.dirname(__file__), "..", "assets")
S = 1024
SS = 3  # supersampling


def leaf(cx, cy, angle, length, width, n=40):
    """Points of a leaf starting at (cx, cy) pointing toward `angle` (radians)."""
    dx, dy = math.cos(angle), math.sin(angle)
    px, py = -dy, dx
    mx, my = cx + dx * length * 0.5, cy + dy * length * 0.5
    tx, ty = cx + dx * length, cy + dy * length

    def quad(p0, p1, p2):
        return [((1 - t) ** 2 * p0[0] + 2 * (1 - t) * t * p1[0] + t * t * p2[0],
                 (1 - t) ** 2 * p0[1] + 2 * (1 - t) * t * p1[1] + t * t * p2[1])
                for t in [i / n for i in range(n + 1)]]

    return quad((cx, cy), (mx + px * width, my + py * width), (tx, ty)) + \
        quad((tx, ty), (mx - px * width, my - py * width), (cx, cy))


def sprout(draw, scale, color, leaf_colors=None):
    """A two-leaf sprout centred in the canvas. `scale` 1 fills ~60% of it."""
    c = S * SS / 2
    u = S * SS * 0.3 * scale
    base = (c, c + u * 0.95)
    top = (c, c - u * 0.1)
    w = int(u * 0.13)
    draw.line([base, top], fill=color, width=w)
    draw.ellipse([base[0] - w / 2, base[1] - w / 2, base[0] + w / 2, base[1] + w / 2], fill=color)
    lc = leaf_colors or (color, color)
    draw.polygon(leaf(top[0], top[1] + u * 0.08, math.radians(-38), u * 1.05, u * 0.5), fill=lc[0])
    draw.polygon(leaf(top[0], top[1] + u * 0.08, math.radians(-142), u * 0.9, u * 0.44), fill=lc[1])


def gradient():
    img = Image.new("RGB", (S, S))
    px = img.load()
    top, bottom = (126, 214, 138), (47, 143, 91)
    for y in range(S):
        t = y / (S - 1)
        row = tuple(round(top[i] + (bottom[i] - top[i]) * t) for i in range(3))
        for x in range(S):
            px[x, y] = row
    return img


def layer(scale, color, leaf_colors=None):
    big = Image.new("RGBA", (S * SS, S * SS), (0, 0, 0, 0))
    sprout(ImageDraw.Draw(big), scale, color, leaf_colors)
    return big.resize((S, S), Image.LANCZOS)


def main():
    cream = (255, 250, 236, 255)
    leaves = ((255, 255, 255, 255), (236, 248, 226, 255))
    bg = gradient()
    bg.save(os.path.join(OUT, "android-icon-background.png"))

    icon = bg.convert("RGBA")
    icon.alpha_composite(layer(1.0, cream, leaves))
    icon.convert("RGB").save(os.path.join(OUT, "icon.png"))

    # Adaptive icons are cropped to the centre ~66%, so the sprout is drawn smaller.
    layer(0.66, cream, leaves).save(os.path.join(OUT, "android-icon-foreground.png"))
    layer(0.66, (255, 255, 255, 255)).save(os.path.join(OUT, "android-icon-monochrome.png"))
    layer(0.9, cream, leaves).save(os.path.join(OUT, "splash-icon.png"))
    layer(1.25, (255, 255, 255, 255)).resize((96, 96), Image.LANCZOS).save(os.path.join(OUT, "notification-icon.png"))
    icon.resize((48, 48), Image.LANCZOS).save(os.path.join(OUT, "favicon.png"))
    print("icons written")


if __name__ == "__main__":
    main()
