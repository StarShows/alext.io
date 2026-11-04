#!/usr/bin/env python3
"""Create branded icons and a 1200 x 630 JPEG link-preview card, offline."""
from pathlib import Path
import math

from PIL import Image, ImageDraw, ImageFilter, ImageFont

OUT = Path(__file__).resolve().parents[2] / "images"
OUT.mkdir(parents=True, exist_ok=True)

DARK = (5, 6, 17)
CYAN = (97, 243, 255)
PINK = (255, 139, 212)
VIOLET = (165, 140, 255)
WHITE = (251, 252, 255)

FONT_DIR = Path("/usr/share/fonts/truetype/dejavu")
BOLD = str(FONT_DIR / "DejaVuSans-Bold.ttf")
REGULAR = str(FONT_DIR / "DejaVuSans.ttf")


def monogram(size):
    """High-resolution raster matching images/favicon.svg."""
    scale = 4
    extent = size * scale
    icon = Image.new("RGBA", (extent, extent), DARK + (255,))
    d = ImageDraw.Draw(icon)
    d.rounded_rectangle(
        (scale, scale, extent - scale, extent - scale),
        radius=13 * extent / 64, fill=DARK + (255,),
        outline=CYAN + (255,), width=max(1, 2 * scale),
    )

    def polygon(vertices, color=WHITE):
        d.polygon([(round(x * extent / 64), round(y * extent / 64))
                   for x, y in vertices], fill=color)

    polygon([(8, 48), (20, 14), (27, 14), (40, 48),
             (32.2, 48), (23.5, 23.9), (15.7, 48)])
    polygon([(17, 35), (32, 35), (34.5, 41), (14.5, 41)])
    polygon([(35.8, 14), (58, 14), (58, 21.5), (50.6, 21.5),
             (50.6, 48), (43.2, 48), (43.2, 21.5), (35.8, 21.5)])
    d.ellipse((50 * extent / 64, 51 * extent / 64,
               57 * extent / 64, 58 * extent / 64), fill=PINK + (255,))
    return icon.resize((size, size), Image.Resampling.LANCZOS)


def build_icons():
    for size, name in [
        (16, "favicon-16.png"), (32, "favicon-32.png"),
        (180, "apple-touch-icon.png"), (192, "icon-192.png"),
        (512, "icon-512.png"),
    ]:
        monogram(size).save(OUT / name, optimize=True)
    monogram(256).save(
        OUT / "favicon.ico", format="ICO",
        sizes=[(16, 16), (32, 32), (48, 48), (64, 64)],
    )


def build_social_card():
    width, height = 1200, 630
    canvas = Image.new("RGB", (width, height), DARK)
    px = canvas.load()
    # Dark gradient with restrained blue, cyan and violet atmospheric light.
    for y in range(height):
        for x in range(width):
            x1, y1 = (x - 200) / 650, (y - 80) / 490
            x2, y2 = (x - 970) / 490, (y - 280) / 370
            x3, y3 = (x - 840) / 430, (y - 600) / 350
            a = max(0, 1 - (x1*x1 + y1*y1)**0.7) * 0.17
            b = max(0, 1 - (x2*x2 + y2*y2)**0.7) * 0.19
            c = max(0, 1 - (x3*x3 + y3*y3)**0.7) * 0.12
            px[x, y] = (
                min(255, int(5 + 15*a + 87*b + 104*c)),
                min(255, int(6 + 27*a + 43*b + 35*c)),
                min(255, int(17 + 100*a + 90*b + 100*c)),
            )
    d = ImageDraw.Draw(canvas)
    for x in range(0, width, 54):
        v = int(10 + 15*x/width)
        d.line((x, 0, x, height), fill=(v, v+3, v+15), width=1)
    for y in range(0, height, 54):
        d.line((0, y, width, y), fill=(13, 16, 29), width=1)

    # A deliberate systems-network motif reflects the site's skill map.
    fx = Image.new("RGBA", (width, height))
    f = ImageDraw.Draw(fx)
    cx, cy = 982, 329
    for r, color in [(230, VIOLET + (65,)),
                     (182, CYAN + (95,)), (125, PINK + (65,))]:
        f.ellipse((cx-r, cy-r, cx+r, cy+r), outline=color, width=3)
    angle = math.radians(-35)
    for degrees in range(0, 360, 6):
        t = math.radians(degrees)
        dx, dy = 225*math.cos(t), 92*math.sin(t)
        x = cx + dx*math.cos(angle) - dy*math.sin(angle)
        y = cy + dx*math.sin(angle) + dy*math.cos(angle)
        f.ellipse((x-2, y-2, x+2, y+2), fill=CYAN + (130,))
    nodes = [
        (790,193), (856,123), (982,99), (1094,164),
        (1163,305), (1098,443), (944,540), (808,468),
        (763,322), (880,247), (1020,206), (1104,317),
        (1005,410), (886,396),
    ]
    edges = [
        (0,1), (1,2), (2,3), (3,4), (4,5), (5,6), (6,7), (7,8),
        (8,0), (9,10), (10,11), (11,12), (12,13), (13,9),
        (1,9), (3,10), (5,12), (7,13),
    ]
    colors = (CYAN, PINK, VIOLET)
    for n, (a, b) in enumerate(edges):
        f.line((nodes[a], nodes[b]), fill=colors[n % 3] + (90,),
               width=3 if n % 4 == 0 else 2)
    for n, (x, y) in enumerate(nodes):
        color = colors[n % 3]
        f.ellipse((x-5, y-5, x+5, y+5), fill=color + (210,))
        f.ellipse((x-2, y-2, x+2, y+2), fill=WHITE + (255,))
    canvas = Image.alpha_composite(canvas.convert("RGBA"),
                                   fx.filter(ImageFilter.GaussianBlur(18)))
    canvas = Image.alpha_composite(canvas, fx)
    motif = Image.new("RGBA", (width, height))
    f = ImageDraw.Draw(motif)
    f.rounded_rectangle((873, 239, 1091, 441), radius=55,
                        fill=(6,8,26,234), outline=CYAN + (180,), width=3)
    motif.alpha_composite(monogram(162), (902, 260))
    canvas = Image.alpha_composite(canvas, motif)
    canvas.alpha_composite(monogram(64), (68, 60))
    d = ImageDraw.Draw(canvas)
    font = lambda path, size: ImageFont.truetype(path, size)

    d.text((151, 67), "ALEXT.IO", font=font(BOLD, 21), fill=WHITE)
    d.text((151, 99), "ENGINEERING  /  PRODUCT  /  AI",
           font=font(REGULAR, 17), fill=(174,185,211))
    d.line((70,178,128,178), fill=CYAN, width=5)
    d.text((65,205), "Alex", font=font(BOLD, 82), fill=WHITE)
    d.text((65,287), "Tannenbaum", font=font(BOLD, 82), fill=WHITE)
    d.text((70,400), "SENIOR FULL STACK ENGINEER",
           font=font(BOLD, 33), fill=CYAN)
    d.text((70,462), "Building the interfaces, APIs and systems",
           font=font(REGULAR, 22), fill=(212,219,235))
    d.text((70,493), "behind products that cannot afford to break.",
           font=font(REGULAR, 22), fill=(212,219,235))
    d.line((70,566,750,566), fill=(43,60,88), width=2)
    d.text((70,582), "REACT  ·  TYPESCRIPT  ·  PYTHON  ·  AI  ·  CLOUD",
           font=font(BOLD, 18), fill=(164,176,201))
    d.text((1035,582), "alext.io", font=font(BOLD, 18), fill=WHITE)
    canvas.convert("RGB").save(
        OUT / "social-preview.jpg", format="JPEG", quality=78,
        optimize=True, progressive=True, subsampling=0,
    )


if __name__ == "__main__":
    build_icons()
    build_social_card()
    print("Generated branded icons and a 1200x630 social sharing image")
