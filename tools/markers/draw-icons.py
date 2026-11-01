"""Draw the picture markers from code: every icon here is original, made of the shapes below.

Each icon is drawn large on a 100-unit grid, fitted to 58 px and given a 3 px white halo, so it
reads on any terrain. Writes data/markers/<id>.png (64 px, transparent) for each id in
data/markers/catalog.json; worlds keep their chosen markers because the ids do not change.
Needs Pillow. Run: python tools/markers/draw-icons.py
"""
from pathlib import Path
import json, math
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "data/markers"
SS, SIZE, FIT, HALO = 10, 64, 58, 3
INK, PAPER, GREY, RED, GOLD, WOOD, DARKWOOD, STEEL, GREEN = "#17130f", "#ece0c8", "#a8a294", "#a8321f", "#c79c2e", "#8d5c30", "#5a3a1e", "#c9ccc8", "#6f8f4e"


class Pen:
    """A 100-unit canvas, drawn at SS times its size."""
    def __init__(self):
        self.im = Image.new("RGBA", (100 * SS, 100 * SS), (0, 0, 0, 0))
        self.d = ImageDraw.Draw(self.im)

    def poly(self, pts, fill=None, line=None, w=3):
        p = [(x * SS, y * SS) for x, y in pts]
        if fill: self.d.polygon(p, fill=fill)
        if line: self.stroke(list(pts) + [pts[0], pts[1]], w, line)

    def stroke(self, pts, w, col):
        p = [(x * SS, y * SS) for x, y in pts]
        self.d.line(p, fill=col, width=round(w * SS))
        r = w * SS / 2
        for x, y in p: self.d.ellipse((x - r, y - r, x + r, y + r), fill=col)

    def rect(self, x0, y0, x1, y1, fill=None, line=None, w=3):
        self.poly([(x0, y0), (x1, y0), (x1, y1), (x0, y1)], fill, line, w)

    def disc(self, x, y, r, fill=None, line=None, w=3, ry=None):
        ry = r if ry is None else ry
        if line: self.d.ellipse(((x - r - w / 2) * SS, (y - ry - w / 2) * SS, (x + r + w / 2) * SS, (y + ry + w / 2) * SS), fill=line)
        if fill: self.d.ellipse(((x - r + w / 2 * bool(line)) * SS, (y - ry + w / 2 * bool(line)) * SS, (x + r - w / 2 * bool(line)) * SS, (y + ry - w / 2 * bool(line)) * SS), fill=fill)


def arc(cx, cy, rx, ry, a0, a1, n=24):
    return [(cx + rx * math.cos(math.radians(a0 + (a1 - a0) * i / n)), cy + ry * math.sin(math.radians(a0 + (a1 - a0) * i / n))) for i in range(n + 1)]


def turn(pts, deg, cx=50, cy=50):
    c, s = math.cos(math.radians(deg)), math.sin(math.radians(deg))
    return [(cx + x * c - y * s, cy + x * s + y * c) for x, y in pts]


def regular(n, r, cx=50, cy=50, start=-90):
    return [(cx + r * math.cos(math.radians(start + 360 * i / n)), cy + r * math.sin(math.radians(start + 360 * i / n))) for i in range(n)]


def merlons(p, x0, x1, y, n, h=6, fill=PAPER, w=2.6):
    """A battlement: n raised teeth along a wall top."""
    step = (x1 - x0) / (2 * n - 1)
    for i in range(n):
        p.rect(x0 + 2 * i * step, y - h, x0 + (2 * i + 1) * step, y + 1, fill, INK, w)


def arch(p, cx, base, half, tall, fill=INK, line=None, w=2.4):
    p.poly([(cx - half, base), *arc(cx, base - tall + half, half, half, 180, 360, 12), (cx + half, base)], fill, line, w)


# Buildings
def keep(p, slight=False):
    p.rect(30, 26, 70, 92, PAPER, INK)
    merlons(p, 26, 74, 20, 4)
    p.rect(26, 20, 74, 28, PAPER, INK, 2.6)
    p.stroke([(50, 18), (50, 4)], 2.4, INK)
    p.poly([(51, 4), (64, 8), (51, 12)], INK)
    arch(p, 50, 92, 8, 20)
    if not slight:
        for x in (40, 60): p.rect(x - 2, 36, x + 2, 48, INK)
        p.stroke([(32, 60), (68, 60)], 1.8, INK)
    p.stroke([(18, 93), (82, 93)], 3.4, INK)

def castle(p):
    p.rect(18, 52, 82, 90, PAPER, INK)
    merlons(p, 26, 74, 50, 4, 5)
    for x in (16, 84):
        p.rect(x - 9, 38, x + 9, 90, PAPER, INK)
        p.poly([(x - 12, 39), (x, 14), (x + 12, 39)], INK)
        p.rect(x - 2, 52, x + 2, 62, INK)
    p.rect(40, 26, 60, 52, PAPER, INK)
    p.poly([(37, 27), (50, 3), (63, 27)], INK)
    p.rect(48, 33, 52, 44, INK)
    arch(p, 50, 90, 9, 24)
    p.stroke([(2, 91), (98, 91)], 3.4, INK)

def fortress(p):
    p.poly([(4, 90), (14, 58), (86, 58), (96, 90)], PAPER, INK)
    merlons(p, 15, 85, 56, 6, 5)
    for x, top in ((22, 36), (78, 36), (50, 20)):
        p.rect(x - 9, top, x + 9, 62, PAPER, INK)
        merlons(p, x - 11, x + 11, top - 1, 3, 5)
        p.rect(x - 2, top + 8, x + 2, top + 18, INK)
    p.stroke([(50, 14), (50, 2)], 2.4, INK)
    p.poly([(51, 2), (65, 6), (51, 10)], RED, INK, 1.6)
    arch(p, 50, 90, 8, 20)
    for x in (24, 76): p.stroke([(x, 72), (x, 82)], 2.2, INK)

def gate(p, fill=GREY, w=3):
    for x in (24, 76):
        p.rect(x - 14, 24, x + 14, 92, fill, INK, w)
        merlons(p, x - 17, x + 17, 18, 3, 7, PAPER, 2.6)
        p.rect(x - 17, 18, x + 17, 26, PAPER, INK, 2.6)
        p.rect(x - 2, 36, x + 2, 48, INK)
    p.rect(38, 42, 62, 92, PAPER, INK, w)
    arch(p, 50, 92, 11, 40)
    for x in (45, 50, 55): p.stroke([(x, 62), (x, 90)], 1.3, PAPER)
    for y in (70, 79): p.stroke([(40, y), (60, y)], 1.3, PAPER)

def temple(p):
    # A great hall with a rose window, a spire and side chapels.
    for x in (16, 84):
        p.rect(x - 11, 56, x + 11, 92, PAPER, INK)
        p.poly([(x - 13, 57), (x, 42), (x + 13, 57)], INK)
        arch(p, x, 84, 3, 15)
    p.rect(30, 42, 70, 92, PAPER, INK)
    p.poly([(26, 44), (50, 20), (74, 44)], PAPER, INK)
    p.poly([(44, 26), (50, 2), (56, 26)], INK)
    p.disc(50, 44, 8, PAPER, INK, 2.6)
    for a in (0, 45, 90, 135):
        p.stroke(turn([(0, -6), (0, 6)], a, 50, 44), 1.4, INK)
    arch(p, 50, 92, 9, 24)
    p.stroke([(2, 93), (98, 93)], 3.4, INK)

def chapel(p):
    p.rect(22, 50, 78, 92, PAPER, INK)
    p.poly([(14, 52), (50, 24), (86, 52)], INK)
    p.rect(44, 12, 56, 36, PAPER, INK, 2.6)
    p.poly([(41, 13), (50, 0), (59, 13)], INK)
    arch(p, 50, 92, 9, 26)
    for x in (32, 68): arch(p, x, 72, 3.5, 13)
    p.stroke([(8, 93), (92, 93)], 3.4, INK)

def ruined_tower(p, slight=False):
    p.poly([(30, 90), (34, 30), (42, 16), (47, 28), (55, 8), (60, 26), (66, 20), (70, 90)], PAPER, INK)
    if not slight:
        p.stroke([(52, 34), (47, 46), (54, 56), (49, 68)], 1.8, INK)
        p.rect(39, 42, 43, 54, INK)
    arch(p, 58, 90, 6, 16)
    # Fallen stones.
    p.poly([(10, 92), (16, 82), (26, 84), (30, 92)], INK)
    p.poly([(74, 92), (80, 86), (92, 92)], INK)
    if not slight: p.poly([(80, 80), (88, 76), (90, 82), (84, 85)], INK)
    p.stroke([(4, 93), (96, 93)], 3.4, INK)


# Round markers
def rings(p, *layers):
    """Concentric discs from the outside in: (radius, colour)."""
    for r, c in layers: p.disc(50, 50, r, c)

def star(p, r=44, inner=0.42, fill=INK, cx=50, cy=50, points=5):
    pts = []
    for i in range(points * 2):
        pts += regular(1, r if i % 2 == 0 else r * inner, cx, cy, -90 + 180 * i / points)
    p.poly(pts, fill)


# Anchors
def anchor(p, w=5, fill=None, outline=2.2, ornate=False):
    parts = [
        arc(50, 11, 7, 7, 0, 360),
        [(50, 18), (50, 88)],
        [(30, 30), (70, 30)],
        arc(50, 52, 37, 37, 18, 162),
    ]
    if fill:
        for s in parts: p.stroke(s, w + outline * 2, INK)
    for s in parts: p.stroke(s, w, fill or INK)
    for sx in (-1, 1):
        tip = [(50 + sx * 45, 40), (50 + sx * 26, 58), (50 + sx * 46, 66)]
        p.poly(tip, fill or INK, INK, 2)
        if ornate:
            p.poly([(50 + sx * 20, 30), (50 + sx * 27, 24), (50 + sx * 34, 30), (50 + sx * 27, 36)], fill or INK, INK, 2)
    if ornate: p.poly([(50, 42), (56, 50), (50, 58), (44, 50)], PAPER if not fill else INK, INK, 2)


# Danger
def skull(p, bone=PAPER):
    p.disc(50, 40, 38, INK, ry=36)
    p.rect(29, 62, 71, 96, INK)
    p.disc(50, 40, 34, bone, ry=32)
    p.rect(33, 62, 67, 92, bone)
    p.disc(35, 46, 10, INK, ry=11); p.disc(65, 46, 10, INK, ry=11)
    p.poly([(50, 56), (56, 68), (44, 68)], INK)
    for x in (41, 50, 59): p.stroke([(x, 76), (x, 92)], 2.2, INK)
    p.stroke([(58, 9), (53, 18), (60, 24), (56, 30)], 1.8, INK)

def sword(p, deg, blade=STEEL, hilt=INK, grip=INK, curve=0, length=56, wide=5):
    """A sword turned about the middle: the tip up at deg 0, hilt below; curve bends the blade."""
    n = 14
    side = lambda s: [(s * wide * (1 - (i / n) ** 4) + curve * (i / n) ** 2, 30 - length * i / n - 8) for i in range(n + 1)]
    b = side(-1) + side(1)[::-1]
    p.poly(turn(b, deg), blade, INK, 2.2)
    p.stroke(turn([(curve * 0.04, 20), (curve * 0.36, -6)], deg), 1.3, INK)
    guard = [(-15, 22), (15, 22), (15, 27), (-15, 27)]
    p.poly(turn(guard, deg), hilt, INK, 1.8)
    p.poly(turn([(-3.4, 27), (3.4, 27), (3.4, 41), (-3.4, 41)], deg), grip, INK, 1.8)
    x, y = turn([(0, 45)], deg)[0]
    p.disc(x, y, 4.6, hilt, INK, 2)

def crossed(p, deg=40, **k):
    sword(p, -deg, **k)
    k2 = dict(k)
    if "curve" in k2: k2["curve"] = -k2["curve"]
    sword(p, deg, **k2)


# Treasure
def chest(p, wood=PAPER, band=INK, gold=INK, x0=12, x1=88, top=50, base=90, dome=26):
    mid = (x0 + x1) / 2
    p.rect(x0, top, x1, base, wood, INK)
    p.poly(arc(mid, top, (x1 - x0) / 2, dome, 180, 360), wood, INK)
    for f in (0.2, 0.8):
        x = x0 + (x1 - x0) * f
        h = dome * math.sqrt(max(0, 1 - ((x - mid) / ((x1 - x0) / 2)) ** 2))
        p.stroke([(x, top - h), (x, base)], 4.6, band)
    p.stroke([(x0, top), (x1, top)], 3.4, INK)
    p.rect(mid - 7, top - 5, mid + 7, top + 12, gold, INK, 2)
    p.disc(mid, top + 4, 2.2, wood if gold == INK else INK)

def chest_open(p, wood=PAPER, band=INK, coin=PAPER, gem=None):
    # The lid thrown back, its dark inside showing; the hoard heaped above the rim.
    p.poly([(12, 40), *arc(50, 26, 40, 20, 180, 360), (88, 40)], wood, INK)
    p.rect(17, 28, 83, 44, INK)
    for x in (24, 76): p.stroke([(x, 10), (x, 26)], 4, band)
    p.poly([(16, 52), *arc(50, 52, 34, 16, 180, 360), (84, 52)], coin, INK, 2)
    for x, y in ((34, 46), (46, 41), (58, 44), (68, 48), (52, 49), (40, 50)): p.disc(x, y, 3.2, coin, INK, 1.4)
    if gem: p.poly([(50, 34), (56, 42), (50, 50), (44, 42)], gem, INK, 1.6)
    p.rect(10, 52, 90, 92, wood, INK)
    for x in (26, 74): p.stroke([(x, 52), (x, 92)], 4.6, band)
    p.rect(43, 50, 57, 66, band if band != INK else INK, INK, 2)
    p.disc(50, 58, 2.2, wood if band == INK else INK)


def gem(p, fill=PAPER, shade=INK):
    p.poly([(50, 4), (84, 44), (50, 96), (16, 44)], fill, INK, 3.4)
    for s in ([(16, 44), (84, 44)], [(50, 4), (36, 44), (50, 96)], [(50, 4), (64, 44), (50, 96)]): p.stroke(s, 1.8, shade)


# Heraldry
def shield_outline():
    # A heater shield: flat top, sides sweeping to the point.
    left = [(10, 8)] + [(10 + 40 * (t / 20) ** 2.2, 8 + 34 + 54 * t / 20) for t in range(21)]
    right = [(100 - x, y) for x, y in left][::-1]
    return left + right

def shield(p, left, right=INK, charge=PAPER):
    out = shield_outline()
    half = [pt for pt in out if pt[0] <= 50] + [(50, 8)]
    p.poly(out, right)
    p.poly(half, left)
    p.poly(out, None, INK, 4.4)
    p.stroke([(50, 8), (50, 96)], 3, INK)
    p.poly([(50, 30), (60, 44), (50, 58), (40, 44)], charge, INK, 2.4)


# Shapes and points
def diamond(p, fill, inner=None, wide=44, tall=46, w=5):
    p.poly([(50, 50 - tall), (50 + wide, 50), (50, 50 + tall), (50 - wide, 50)], fill, INK, w)
    if inner: p.poly([(50, 50 - tall * 0.45), (50 + wide * 0.45, 50), (50, 50 + tall * 0.45), (50 - wide * 0.45, 50)], inner, INK, 2.4)

def rhombus(p, wide=28):
    p.poly([(50, 4), (50 + wide, 50), (50, 96), (50 - wide, 50)], INK)
    p.poly([(50, 24), (50 + wide * 0.48, 44), (50 - wide * 0.48, 44)], PAPER)
    p.poly([(50, 76), (50 + wide * 0.48, 56), (50 - wide * 0.48, 56)], PAPER)

def spark(p, r=46, wide=18):
    star(p, r, wide / r, INK, points=4)
    p.poly([(50, 50 - r * 0.5), (50 + wide * 0.32, 50), (50, 50 + r * 0.5), (50 - wide * 0.32, 50)], PAPER)

def waypoint(p, disc):
    for a in (0, 90, 180, 270):
        p.poly(turn([(-7, -30), (-3, -46), (3, -46), (7, -30)], a), INK)
        p.stroke(turn([(0, -20), (0, -42)], a), 7, INK)
    p.disc(50, 50, 17, disc, INK, 5)

def compass(p, face=PAPER, heart=INK):
    p.disc(50, 50, 46, face, INK, 5)
    p.disc(50, 50, 37, None, INK, 1.2)
    p.disc(50, 50, 36, face)
    for a in (45, 135, 225, 315):
        p.poly(turn([(0, -28), (5, -6), (-5, -6)], a), GREY if face == PAPER else PAPER, INK, 1.4)
    for a in (0, 90, 180, 270):
        p.poly(turn([(0, -38), (7, -6), (0, -6)], a), INK)
        p.poly(turn([(0, -38), (-7, -6), (0, -6)], a), PAPER, INK, 1.4)
    p.disc(50, 50, 6, heart, INK, 2)

def sigil(p):
    p.poly(turn([(0, -46), (46, 0), (0, 46), (-46, 0)], 0), INK)
    p.poly(regular(8, 26), PAPER)
    star(p, 22, 0.25, INK, points=4)

def cave(p, slight=False):
    # A hillside with a dark mouth, rocks about its lip.
    p.poly([(4, 90), (22, 40), (42, 16), (62, 14), (80, 38), (96, 90)], PAPER, INK, 3.4)
    arch(p, 50, 90, 22, 50)
    if not slight:
        p.stroke([(30, 34), (38, 26)], 2, INK); p.stroke([(68, 36), (74, 44)], 2, INK); p.stroke([(14, 70), (20, 58)], 2, INK); p.stroke([(82, 60), (87, 72)], 2, INK)
    p.poly([(38, 90), (44, 82), (50, 90)], PAPER, INK, 1.6)
    p.stroke([(2, 91), (98, 91)], 3.4, INK)


ICONS = {
    # buildings
    "gate": lambda p: gate(p), "gate-light": lambda p: gate(p, PAPER, 2.4),
    "temple": temple, "temple-small": chapel,
    "tower-ruin": ruined_tower, "tower-ruin-small": lambda p: ruined_tower(p, True),
    "castle": castle, "fortress": fortress,
    "keep": keep, "keep-small": lambda p: keep(p, True),
    # settlements
    "dot-ringed": lambda p: rings(p, (46, INK), (40, PAPER), (28, INK)),
    "ring-double": lambda p: rings(p, (46, INK), (41, PAPER), (32, INK), (28, PAPER)),
    "dot-red": lambda p: rings(p, (46, INK), (41, GREY), (29, INK), (25, RED)),
    "dot-black-ringed": lambda p: rings(p, (46, INK), (41, GREY), (29, INK)),
    "ring-dot": lambda p: rings(p, (46, INK), (37, PAPER), (6, INK)),
    "ring-dot-small": lambda p: rings(p, (46, INK), (30, GREY), (7, INK)),
    "star-ringed": lambda p: (rings(p, (46, INK), (41, PAPER), (34, INK), (31, PAPER)), star(p, 25)),
    "star-red-ringed": lambda p: (rings(p, (46, INK), (41, GREY), (34, INK), (31, RED)), star(p, 25, fill=INK)),
    # ports
    "anchor": lambda p: anchor(p, 5.5), "anchor-plain": lambda p: anchor(p, 3.4),
    "anchor-bold": lambda p: anchor(p, 8.5), "anchor-light": lambda p: anchor(p, 5, PAPER),
    "anchor-grey": lambda p: anchor(p, 5, GREY),
    "anchor-ornate": lambda p: anchor(p, 4.5, ornate=True), "anchor-ornate-grey": lambda p: anchor(p, 4.5, GREY, ornate=True),
    # danger
    "skull": skull, "skull-grey": lambda p: skull(p, GREY),
    "swords": lambda p: crossed(p, 50, wide=3.4), "swords-small": lambda p: crossed(p, 38),
    "swords-long": lambda p: crossed(p, 58, wide=2.8, length=62),
    "swords-curved": lambda p: crossed(p, 38, curve=11),
    "swords-colour": lambda p: crossed(p, 40, hilt=GOLD, grip=WOOD),
    "swords-ornate": lambda p: crossed(p, 42, blade=PAPER, hilt=GOLD, grip=RED, curve=7),
    # treasure
    "chest": lambda p: chest(p),
    "chest-color": lambda p: chest(p, WOOD, DARKWOOD, GOLD),
    "chest-tall": lambda p: chest(p, x0=22, x1=78, top=46, base=94, dome=20),
    "chest-tall-color": lambda p: chest(p, WOOD, DARKWOOD, GOLD, x0=22, x1=78, top=46, base=94, dome=20),
    "chest-open": lambda p: chest_open(p),
    "chest-open-color": lambda p: chest_open(p, WOOD, DARKWOOD, GOLD, RED),
    "gem": lambda p: gem(p), "gem-gold": lambda p: gem(p, GOLD),
    # heraldry
    "shield-red": lambda p: shield(p, RED), "shield-green": lambda p: shield(p, GREEN),
    "shield-gold": lambda p: shield(p, GOLD), "shield-grey": lambda p: shield(p, GREY),
    "shield-split": lambda p: shield(p, PAPER, INK, GREY),
    # shapes
    "hexagon-grey": lambda p: p.poly(regular(6, 45), GREY, INK, 5),
    "hexagon-light": lambda p: p.poly(regular(6, 45), PAPER, INK, 5),
    "octagon": lambda p: p.poly(regular(8, 46, start=-67.5), PAPER, INK, 6),
    "octagon-grey": lambda p: p.poly(regular(8, 46, start=-67.5), GREY, INK, 6),
    "square-open": lambda p: p.rect(8, 8, 92, 92, PAPER, INK, 6),
    "square-grey": lambda p: p.rect(8, 8, 92, 92, GREY, INK, 6),
    "diamond-open": lambda p: diamond(p, PAPER, PAPER),
    "diamond-red": lambda p: diamond(p, RED, None, w=6),
    "diamond-bold": lambda p: diamond(p, INK, PAPER, w=4),
    "diamond-red-bold": lambda p: diamond(p, INK, RED, w=4),
    "diamond-small": lambda p: diamond(p, PAPER, None, w=7),
    "diamond-grey": lambda p: diamond(p, GREY, None, w=6),
    "rhombus-split": lambda p: rhombus(p), "rhombus-small": lambda p: rhombus(p, 22),
    # points
    "cross-ring": lambda p: waypoint(p, PAPER), "cross-ring-small": lambda p: waypoint(p, GREY),
    "compass": lambda p: compass(p), "compass-red": lambda p: compass(p, GREY, RED),
    "star": lambda p: star(p, 48, 0.42), "sigil": sigil,
    "spark": lambda p: spark(p), "spark-small": lambda p: spark(p, 44, 13),
    "cross": lambda p: (p.stroke([(14, 14), (86, 86)], 15, INK), p.stroke([(86, 14), (14, 86)], 15, INK)),
    "cave": cave, "cave-small": lambda p: cave(p, True),
}


def finish(pen):
    """Fit the drawing to FIT px, centred, with a white halo round it."""
    im = pen.im.crop(pen.im.getbbox())
    k = FIT / max(im.size)
    im = im.resize((max(1, round(im.width * k)), max(1, round(im.height * k))), Image.LANCZOS)
    art = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
    art.paste(im, ((SIZE - im.width) // 2, (SIZE - im.height) // 2))
    white = Image.new("RGBA", (SIZE, SIZE), (255, 255, 255, 255))
    white.putalpha(art.getchannel("A").point(lambda a: 255 if a > 64 else a * 4))
    out = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
    for i in range(16):
        a = i * math.pi / 8
        out = Image.alpha_composite(out, shifted(white, round(math.cos(a) * HALO), round(math.sin(a) * HALO)))
    return Image.alpha_composite(out, art)


def shifted(im, dx, dy):
    moved = Image.new("RGBA", im.size, (0, 0, 0, 0))
    moved.paste(im, (dx, dy))
    return moved


def main():
    ids = [m["id"] for m in json.loads((OUT / "catalog.json").read_text(encoding="utf8"))]
    missing = [i for i in ids if i not in ICONS]
    extra = [i for i in ICONS if i not in ids]
    if missing or extra: raise SystemExit(f"catalog and drawings differ: missing {missing}, extra {extra}")
    for i in ids:
        pen = Pen()
        ICONS[i](pen)
        finish(pen).save(OUT / f"{i}.png", optimize=True)
    print(f"{len(ids)} markers drawn")


if __name__ == "__main__":
    main()
