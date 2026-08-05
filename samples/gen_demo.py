#!/usr/bin/env python3
"""Generate a handful of colourful demo embroidery files for screenshots."""
import sys, os, math
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'scripts', 'vendor'))
import pyembroidery as pe

OUT = os.path.dirname(__file__)


def satin_block(p, cx, cy, r0, r1, turns, step_deg, density=0.6):
    """Spiral-ish filled ring of running stitches."""
    a = 0.0
    while a < turns * 360:
        rad = math.radians(a)
        rr = r0 + (r1 - r0) * (a / (turns * 360))
        p.stitch_abs(cx + rr * math.cos(rad), cy + rr * math.sin(rad))
        a += step_deg


def flower(path):
    p = pe.EmbPattern()
    colors = [0x2E7D32, 0xC62828, 0xF9A825, 0x1565C0, 0x6A1B9A]
    # stem (green)
    p.add_thread({"color": colors[0]})
    for y in range(0, 380, 6):
        p.stitch_abs(0, y)
        p.stitch_abs(6 if (y // 6) % 2 else -6, y)
    p.color_change()
    # petals (red)
    p.add_thread({"color": colors[1]})
    for k in range(6):
        ang = math.radians(k * 60)
        cx, cy = 55 * math.cos(ang), 55 * math.sin(ang)
        satin_block(p, cx, cy, 4, 34, 2.2, 22)
    p.color_change()
    # centre (yellow)
    p.add_thread({"color": colors[2]})
    satin_block(p, 0, 0, 2, 26, 3.5, 18)
    p.color_change()
    # accents (blue)
    p.add_thread({"color": colors[3]})
    for k in range(6):
        ang = math.radians(30 + k * 60)
        cx, cy = 90 * math.cos(ang), 90 * math.sin(ang)
        satin_block(p, cx, cy, 2, 12, 2, 24)
    p.end()
    pe.write(p, path)


def anchor(path):
    p = pe.EmbPattern()
    p.add_thread({"color": 0x1565C0})  # blue rope
    # ring
    satin_block(p, 0, -70, 2, 26, 3, 16)
    # shaft
    for y in range(-50, 80, 5):
        p.stitch_abs(-5, y); p.stitch_abs(5, y)
    p.color_change()
    p.add_thread({"color": 0xB71C1C})  # red flukes
    for t in [x / 20 for x in range(0, 21)]:
        ang = math.pi * (0.15 + 0.7 * t)
        r = 70
        p.stitch_abs(-r * math.cos(ang), 70 + 10 * math.sin(3 * ang))
    for t in [x / 20 for x in range(0, 21)]:
        ang = math.pi * (0.15 + 0.7 * t)
        r = 70
        p.stitch_abs(r * math.cos(ang), 70 + 10 * math.sin(3 * ang))
    p.color_change()
    p.add_thread({"color": 0xF9A825})  # gold crossbar
    for x in range(-40, 45, 5):
        p.stitch_abs(x, -35); p.stitch_abs(x, -25)
    p.end()
    pe.write(p, path)


def monogram(path):
    p = pe.EmbPattern()
    p.add_thread({"color": 0x6A1B9A})  # purple
    # letter "A" outline
    pts = [(-40, 60), (0, -60), (40, 60), (22, 60), (14, 30),
           (-14, 30), (-22, 60), (-40, 60)]
    for _ in range(3):
        for x, y in pts:
            p.stitch_abs(x, y)
    p.color_change()
    p.add_thread({"color": 0xF9A825})  # gold crossbar
    for x in range(-16, 17, 4):
        p.stitch_abs(x, 8); p.stitch_abs(x, 16)
    p.color_change()
    p.add_thread({"color": 0x00838F})  # teal underline flourish
    for x in range(-46, 47, 4):
        p.stitch_abs(x, 74 + 6 * math.sin(x / 12))
    p.end()
    pe.write(p, path)


def swirl(path):
    p = pe.EmbPattern()
    p.add_thread({"color": 0xAD1457})
    satin_block(p, 0, 0, 4, 80, 6, 12)
    p.color_change()
    p.add_thread({"color": 0x00897B})
    satin_block(p, 0, 0, 80, 4, 6, 12)
    p.end()
    pe.write(p, path)


designs = {
    "tulip_flower.dst": flower,
    "nautical_anchor.pes": anchor,
    "monogram_A.jef": monogram,
    "spiral_swirl.vp3": swirl,
    "tulip_flower.pes": flower,
    "nautical_anchor.dst": anchor,
}

for fname, fn in designs.items():
    fp = os.path.join(OUT, fname)
    fn(fp)
    print("wrote", fname, os.path.getsize(fp), "bytes")
print("done")
