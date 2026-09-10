#!/usr/bin/env python3
"""Generate the default symbol pack as hand-drawn-looking SVGs.

Every symbol is drawn in ink on transparent ground with a little wobble so
it reads as pen work rather than vector clip art. Re-run to regenerate:
    python3 tools/gen_default_pack.py
"""
import json, math, os, random

OUT = os.path.join(os.path.dirname(__file__), "..", "assets", "packs", "default")
INK = "#2a1f14"
PAPER = "#f3ead6"
GREEN = "#5a7a3a"
DGREEN = "#3c5a2c"
BLUE = "#4d6f8f"

rng = random.Random(7)

def wob(pts, amp=1.2):
    return [(x + rng.uniform(-amp, amp), y + rng.uniform(-amp, amp)) for x, y in pts]

def poly(pts, stroke=INK, fill="none", w=2.2, close=False, cap="round"):
    d = "M " + " L ".join(f"{x:.1f} {y:.1f}" for x, y in pts) + (" Z" if close else "")
    return f'<path d="{d}" fill="{fill}" stroke="{stroke}" stroke-width="{w}" stroke-linecap="{cap}" stroke-linejoin="round"/>'

def curve(pts, stroke=INK, fill="none", w=2.2, close=False):
    """Smooth-ish polyline via quadratic midpoints."""
    if len(pts) < 3:
        return poly(pts, stroke, fill, w, close)
    d = f"M {pts[0][0]:.1f} {pts[0][1]:.1f}"
    for i in range(1, len(pts) - 1):
        mx = (pts[i][0] + pts[i + 1][0]) / 2
        my = (pts[i][1] + pts[i + 1][1]) / 2
        d += f" Q {pts[i][0]:.1f} {pts[i][1]:.1f} {mx:.1f} {my:.1f}"
    d += f" L {pts[-1][0]:.1f} {pts[-1][1]:.1f}"
    if close:
        d += " Z"
    return f'<path d="{d}" fill="{fill}" stroke="{stroke}" stroke-width="{w}" stroke-linecap="round" stroke-linejoin="round"/>'

def hatch(a, b, n, w=1.3, shrink=0.15):
    """Short hatch strokes between two points along direction a->b, offset perpendicular."""
    out = []
    ax, ay = a; bx, by = b
    dx, dy = bx - ax, by - ay
    L = math.hypot(dx, dy) or 1
    px, py = -dy / L, dx / L
    for i in range(n):
        t = (i + 0.5) / n
        x, y = ax + dx * t, ay + dy * t
        l = L * 0.22 * (1 - shrink * i)
        out.append(poly(wob([(x, y), (x + px * l, y + py * l)], 0.8), w=w))
    return "".join(out)

def svg(w, h, body):
    return f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {w} {h}" width="{w}" height="{h}">{body}</svg>'

assets = []
def emit(name, category, tags, w, h, body, pivot=(0.5, 0.95), size=48.0, behavior=None):
    fn = f"{name}.svg"
    with open(os.path.join(OUT, fn), "w") as f:
        f.write(svg(w, h, body))
    a = {"id": name, "name": name.replace("_", " ").title(), "file": fn, "category": category, "tags": tags,
         "pivot": list(pivot), "world_size": size}
    if behavior:
        a["behavior"] = behavior
    assets.append(a)

# ---------------------------------------------------------------- mountains
def fade_fill(gid, y0, y1, colour=PAPER, top=0.92, knee=0.62):
    """Vertical gradient: paper-coloured near the summit, transparent at the
    base, so a row of peaks never forms a flat-bottomed band."""
    return (f'<linearGradient id="{gid}" gradientUnits="userSpaceOnUse" x1="0" y1="{y0:.1f}" x2="0" y2="{y1:.1f}">'
            f'<stop offset="0" stop-color="{colour}" stop-opacity="{top}"/>'
            f'<stop offset="{knee}" stop-color="{colour}" stop-opacity="{top * 0.8:.2f}"/>'
            f'<stop offset="1" stop-color="{colour}" stop-opacity="0"/></linearGradient>')

def path_d(pts, close=False):
    return "M " + " L ".join(f"{x:.1f} {y:.1f}" for x, y in pts) + (" Z" if close else "")

def mountain(seed, snow=False, steep=0.5, width=100, height=80, style="ink", twin=False):
    """One peak (or two summits joined by a saddle): a paper-filled silhouette
    that fades out toward the base, an ink outline, a shadow ridge from the
    summit and slope hatching on the shaded side, all clipped to the body."""
    rng.seed(seed)
    base_y = height - 3
    top_y = 5 + rng.uniform(0, 6)
    apexes = []
    if twin:
        ax = width * rng.uniform(0.30, 0.42)
        bx = ax + width * rng.uniform(0.22, 0.34)
        hi_left = rng.random() < 0.5
        apexes = [(ax, top_y if hi_left else top_y + rng.uniform(10, 20)), (bx, top_y + rng.uniform(10, 20) if hi_left else top_y)]
    else:
        apexes = [(width * rng.uniform(0.32, 0.68), top_y)]
    p = 1.0 / (1.0 + steep)  # <1: steep near the summit, easing out at the foot

    def flank(apex, foot_x, n):
        # Points from the summit down to the foot, concave, with small
        # shoulders so no two flanks match.
        pts = []
        for i in range(1, n):
            t = i / n
            x = apex[0] + (foot_x - apex[0]) * t
            y = apex[1] + (base_y - apex[1]) * (t ** p)
            pts.append((x + rng.uniform(-2.5, 2.5), min(base_y - 1, y + rng.uniform(-3, 3))))
        return pts

    left = flank(apexes[0], 2, rng.randint(3, 5))[::-1]
    right = flank(apexes[-1], width - 2, rng.randint(3, 5))
    outline = [(2, base_y)] + left + [apexes[0]]
    if twin:
        a, b = apexes
        saddle_y = max(a[1], b[1]) + rng.uniform(8, 16)
        outline += [((a[0] * 0.55 + b[0] * 0.45), saddle_y + rng.uniform(-2, 2)), b]
    outline += right + [(width - 2, base_y)]
    apex_idx = [len(left) + 1] + ([len(left) + 3] if twin else [])
    outline = wob(outline, 0.8)
    for k in apex_idx:
        outline[k] = apexes[0] if k == apex_idx[0] else apexes[-1]
    gid = f"g{seed}"
    cid = f"c{seed}"
    fill = PAPER if style == "ink" else "#e9dcc0"
    body = f'<defs>{fade_fill(gid, top_y, base_y, fill)}<clipPath id="{cid}"><path d="{path_d(outline, True)}"/></clipPath></defs>'
    body += f'<path d="{path_d(outline, True)}" fill="url(#{gid})" stroke="none"/>'
    inner = ""
    for apex in apexes:
        # Shadow ridge: summit down and to the right, ending short of the foot.
        foot = (apex[0] + width * rng.uniform(0.16, 0.26), base_y - rng.uniform(2, 8))
        ridge = [apex]
        for i in range(1, 5):
            t = i / 4
            ridge.append((apex[0] + (foot[0] - apex[0]) * t + rng.uniform(-2, 2), apex[1] + (foot[1] - apex[1]) * (t ** 0.9)))
        inner += curve(ridge, w=1.5)
        # Hatching: short strokes leaving the ridge toward the right foot,
        # parallel to the shaded slope, longer lower down.
        n = rng.randint(4, 6)
        for i in range(n):
            t = (i + 0.7) / (n + 0.6)
            sx = apex[0] + (foot[0] - apex[0]) * t
            sy = apex[1] + (foot[1] - apex[1]) * (t ** 0.9)
            L = 5 + 22 * t
            dirx, diry = (width - 2) - sx, base_y - sy
            m = math.hypot(dirx, diry) or 1
            ex, ey = sx + dirx / m * L, sy + diry / m * L * 0.9
            inner += poly(wob([(sx + 2, sy + 1), (ex, ey)], 0.6), w=1.1)
        # One or two light contour strokes on the lit side.
        for k in range(rng.randint(1, 2)):
            ox = apex[0] - 8 - k * 9
            oy = apex[1] + 14 + k * 8
            inner += curve(wob([(ox, oy), (ox - 7, oy + 11), (ox - 13, oy + 24)], 0.7), w=1.0)
        if snow:
            cap = [(apex[0] - 12, apex[1] + 15), (apex[0] - 6, apex[1] + 10), (apex[0] - 1, apex[1] + 15), (apex[0] + 5, apex[1] + 9), (apex[0] + 11, apex[1] + 16)]
            inner += curve(wob(cap, 0.7), w=1.3)
    body += f'<g clip-path="url(#{cid})">{inner}</g>'
    # Outline last so it sits over the hatching; drawn in pieces that meet
    # at each summit so the smoothing never rounds a peak into a loop.
    cuts = [0] + apex_idx + [len(outline) - 1]
    for a, b in zip(cuts, cuts[1:]):
        body += curve(outline[a:b + 1], w=2.3)
    return body

shapes = [(100, 80, 0.3), (90, 88, 0.55), (120, 70, 0.2), (96, 84, 0.45), (110, 76, 0.35), (84, 90, 0.7), (104, 72, 0.25), (92, 86, 0.6), (116, 80, 0.4), (88, 78, 0.5)]
for i, (w, h, st) in enumerate(shapes):
    emit(f"mountain_{i+1}", "mountains", ["mountain", "peak", "ink"], w, h, mountain(100 + i, snow=(i % 4 == 3), steep=st, width=w, height=h, twin=(i % 3 == 1)), size=54 * w / 100)
for i in range(4):
    emit(f"foothill_{i+1}", "mountains", ["mountain", "peak", "small", "ink"], 80, 46, mountain(160 + i, steep=0.25, width=80, height=46), size=34)
for i in range(3):
    emit(f"mountain_snow_{i+1}", "mountains", ["mountain", "peak", "snow", "ink"], 100, 80, mountain(200 + i, snow=True, steep=0.6), size=58)
for i in range(3):
    emit(f"mountain_range_{i+1}", "mountains", ["mountain", "range", "ink"], 180, 80,
         mountain(300 + i, steep=0.4, width=110) + f'<g transform="translate(70 4) scale(1.0)">{mountain(330 + i, steep=0.35, width=105, height=76)}</g>', size=100)

# ---------------------------------------------------------------- hills
def hill(seed, w=90, h=44):
    rng.seed(seed)
    base = h - 3
    pts = [(3, base)]
    peak_t = rng.uniform(0.4, 0.6)
    for i in range(1, 9):
        t = i / 9
        # Asymmetric dome: a skewed sine so no two hills share a profile.
        u = t / peak_t * 0.5 if t < peak_t else 0.5 + (t - peak_t) / (1 - peak_t) * 0.5
        pts.append((3 + (w - 6) * t, base - math.sin(u * math.pi) * (h - 12) + rng.uniform(-1.5, 1.5)))
    pts.append((w - 3, base))
    pts = wob(pts, 0.7)
    gid, cid = f"g{seed}", f"c{seed}"
    body = f'<defs>{fade_fill(gid, 6, base, PAPER, top=0.9, knee=0.55)}<clipPath id="{cid}"><path d="{path_d(pts, True)}"/></clipPath></defs>'
    body += f'<path d="{path_d(pts, True)}" fill="url(#{gid})" stroke="none"/>'
    inner = ""
    for i in range(rng.randint(3, 5)):
        t = 0.58 + i * 0.09
        x = 3 + (w - 6) * t
        u = 0.5 + (t - peak_t) / (1 - peak_t) * 0.5
        y = base - math.sin(u * math.pi) * (h - 12)
        inner += poly(wob([(x, y + 3), (x + 5 + i, min(base - 1, y + 12 + i * 2))], 0.5), w=1.0)
    body += f'<g clip-path="url(#{cid})">{inner}</g>'
    body += curve(pts, w=1.9)
    return body

for i in range(4):
    emit(f"hill_{i+1}", "hills", ["hill", "ink"], 90, 44, hill(400 + i), size=36)
emit("hills_cluster", "hills", ["hill", "cluster", "ink"], 160, 60, hill(410) + f'<g transform="translate(60 8) scale(1.05)">{hill(411, w=90, h=44)}</g>' + f'<g transform="translate(30 18)">{hill(412, w=80, h=40)}</g>', size=110)

# ---------------------------------------------------------------- trees
def conifer(seed, w=40, h=64, fill=DGREEN):
    rng.seed(seed)
    body = poly([(w / 2, h - 4), (w / 2, h - 16)], w=2.4)
    tiers = 4
    for k in range(tiers):
        top = 6 + k * 12
        half = 6 + k * 4.2
        pts = [(w / 2, top), (w / 2 - half, top + 14), (w / 2 - half * 0.35, top + 12), (w / 2, top + 14.5), (w / 2 + half * 0.35, top + 12), (w / 2 + half, top + 14)]
        body += poly(wob(pts, 0.9), fill=fill, w=1.6, close=True)
    return body

def broadleaf(seed, w=52, h=60, fill=GREEN):
    rng.seed(seed)
    body = poly(wob([(w / 2 - 2, h - 4), (w / 2, h - 22)], 0.5), w=2.6)
    lobes = []
    n = 9
    for i in range(n):
        a = i / n * 2 * math.pi
        r = 17 + rng.uniform(-3, 3)
        lobes.append((w / 2 + math.cos(a) * r, 24 + math.sin(a) * r * 0.8))
    body += curve(wob(lobes, 1.0), fill=fill, w=1.8, close=True)
    # inner scribble
    for i in range(3):
        a = rng.uniform(0, 6.28)
        body += poly(wob([(w / 2 + math.cos(a) * 5, 24 + math.sin(a) * 5), (w / 2 + math.cos(a + 1.2) * 11, 24 + math.sin(a + 1.2) * 9)], 0.6), w=1.0)
    return body

for i in range(3):
    emit(f"conifer_{i+1}", "trees", ["tree", "conifer", "pine", "summer"], 40, 64, conifer(500 + i), size=22)
    emit(f"conifer_snow_{i+1}", "trees", ["tree", "conifer", "pine", "winter", "snow"], 40, 64, conifer(500 + i, fill="#e9eef0"), size=22)
for i in range(3):
    emit(f"conifer_ink_{i+1}", "trees", ["tree", "conifer", "ink"], 40, 64, conifer(500 + i, fill=PAPER), size=22)
rng.seed(700)
palm = poly([(26, 60), (24, 30)], w=2.6)
for k in range(6):
    a = -2.6 + k * 0.5
    palm += curve(wob([(24, 30), (24 + math.cos(a) * 14, 30 + math.sin(a) * 10), (24 + math.cos(a) * 24, 30 + math.sin(a) * 18 + 4)], 0.8), w=1.8)
emit("palm", "trees", ["tree", "palm", "tropical"], 52, 64, palm, size=24)
rng.seed(710)
dead = poly(wob([(24, 60), (24, 34), (14, 20)], 0.6), w=2.2) + poly(wob([(24, 40), (34, 26), (38, 14)], 0.6), w=1.8) + poly(wob([(30, 31), (36, 30)], 0.4), w=1.2) + poly(wob([(18, 26), (10, 28)], 0.4), w=1.2)
emit("dead_tree", "trees", ["tree", "dead", "swamp"], 48, 64, dead, size=22)
for i in range(2):
    rng.seed(720 + i)
    cluster = ""
    for (dx, dy, s) in [(0, 10, 0.9), (30, 4, 1.0), (58, 12, 0.85), (16, 26, 0.95), (44, 28, 0.9)]:
        cluster += f'<g transform="translate({dx} {dy}) scale({s})">{conifer(730 + i * 5 + dx, fill=PAPER)}</g>'
    emit(f"forest_cluster_{i+1}", "trees", ["forest", "cluster", "conifer", "ink"], 110, 90, cluster, size=48)

# ---------------------------------------------------------------- buildings
def house(x, y, w=18, h=14, tower=False):
    body = poly(wob([(x, y), (x, y - h), (x + w / 2, y - h - 8), (x + w, y - h), (x + w, y)], 0.7), fill=PAPER, w=1.6, close=True)
    body += poly(wob([(x + w * 0.4, y), (x + w * 0.4, y - h * 0.55), (x + w * 0.6, y - h * 0.55), (x + w * 0.6, y)], 0.4), w=1.0)
    if tower:
        body += poly(wob([(x + w - 4, y - h), (x + w - 4, y - h - 18), (x + w + 4, y - h - 18), (x + w + 4, y - h)], 0.6), fill=PAPER, w=1.4, close=True)
        body += poly([(x + w - 5, y - h - 18), (x + w, y - h - 26), (x + w + 5, y - h - 18)], fill=INK, w=1.2, close=True)
    return body

rng.seed(800)
emit("village", "settlements", ["village", "settlement", "houses"], 64, 48, house(6, 42, 16, 12) + house(30, 44, 18, 13) + house(46, 40, 14, 11), size=40)
rng.seed(801)
emit("town", "settlements", ["town", "settlement"], 90, 64, house(4, 58, 18, 14) + house(26, 60, 20, 16, tower=True) + house(54, 58, 18, 14) + house(70, 60, 16, 12), size=56)
rng.seed(802)
city = poly(wob([(4, 60), (4, 42), (12, 42), (12, 36), (20, 36), (20, 42), (100, 42), (100, 36), (108, 36), (108, 42), (116, 42), (116, 60)], 0.6), fill=PAPER, w=1.8, close=True)
for x in range(8, 112, 10):
    city += poly([(x, 42), (x, 46)], w=1.0)
city += house(24, 42, 18, 16, tower=True) + house(48, 42, 22, 18, tower=True) + house(78, 42, 18, 14)
emit("city", "settlements", ["city", "settlement", "walls"], 120, 64, city, size=72)
rng.seed(803)
castle = poly(wob([(8, 60), (8, 30), (16, 30), (16, 24), (24, 24), (24, 30), (40, 30), (40, 18), (48, 18), (48, 12), (56, 12), (56, 18), (64, 18), (64, 30), (80, 30), (80, 24), (88, 24), (88, 30), (96, 30), (96, 60)], 0.6), fill=PAPER, w=1.8, close=True)
castle += poly(wob([(44, 60), (44, 44), (60, 44), (60, 60)], 0.4), fill=INK, w=1.0, close=True)
castle += poly([(52, 12), (52, 2), (62, 6), (52, 9)], fill=INK, w=1.0, close=True)
emit("castle", "settlements", ["castle", "fortress", "keep"], 104, 64, castle, size=60)
rng.seed(804)
tower = poly(wob([(18, 60), (18, 16), (14, 16), (14, 10), (20, 10), (20, 14), (28, 14), (28, 10), (34, 10), (34, 16), (30, 16), (30, 60)], 0.6), fill=PAPER, w=1.8, close=True) + poly([(22, 60), (22, 48), (26, 48), (26, 60)], fill=INK, w=1.0, close=True)
emit("tower", "settlements", ["tower", "watchtower"], 48, 64, tower, size=32)
rng.seed(805)
ruins = poly(wob([(6, 56), (6, 34), (14, 34), (14, 44), (24, 44), (24, 30), (32, 30), (32, 56)], 0.8), fill=PAPER, w=1.6, close=True) + poly(wob([(40, 56), (40, 40), (46, 40), (46, 28), (54, 28), (54, 56)], 0.8), fill=PAPER, w=1.6, close=True) + poly(wob([(0, 58), (60, 57)], 0.8), w=1.4)
for i in range(5):
    x = 10 + i * 10
    ruins += poly(wob([(x, 60), (x + 3, 62)], 0.3), w=1.0)
emit("ruins", "settlements", ["ruins", "ancient"], 64, 64, ruins, size=40)
rng.seed(806)
temple = poly(wob([(6, 58), (58, 58), (58, 52), (6, 52)], 0.5), fill=PAPER, w=1.6, close=True) + poly([(4, 22), (32, 8), (60, 22)], fill=PAPER, w=1.8, close=True)
for x in range(12, 56, 10):
    temple += poly(wob([(x, 52), (x, 24)], 0.4), w=1.6)
emit("temple", "settlements", ["temple", "shrine"], 64, 64, temple, size=40)
rng.seed(807)
mill = poly(wob([(24, 60), (26, 30), (38, 30), (40, 60)], 0.5), fill=PAPER, w=1.6, close=True)
for k in range(4):
    a = k * math.pi / 2 + 0.6
    mill += poly(wob([(32, 30), (32 + math.cos(a) * 22, 30 + math.sin(a) * 22)], 0.5), w=1.6)
    mill += poly(wob([(32 + math.cos(a) * 6, 30 + math.sin(a) * 6), (32 + math.cos(a) * 20 + math.cos(a + 1.57) * 4, 30 + math.sin(a) * 20 + math.sin(a + 1.57) * 4)], 0.5), w=1.0)
emit("windmill", "settlements", ["windmill", "mill"], 64, 64, mill, size=36)
rng.seed(808)
light = poly(wob([(26, 60), (28, 20), (36, 20), (38, 60)], 0.4), fill=PAPER, w=1.6, close=True) + poly([(24, 20), (40, 20), (32, 10)], fill=INK, w=1.0, close=True)
for y in range(28, 58, 8):
    light += poly([(27, y), (37, y)], w=0.8)
emit("lighthouse", "settlements", ["lighthouse", "harbour", "coast"], 64, 64, light, size=32)
rng.seed(809)
bridge = curve(wob([(4, 40), (16, 30), (32, 26), (48, 30), (60, 40)], 0.6), w=2.2) + curve(wob([(4, 48), (16, 38), (32, 34), (48, 38), (60, 48)], 0.6), w=2.2)
for x in range(10, 56, 8):
    bridge += poly([(x, 48 - (1 - abs(x - 32) / 32) * 12), (x, 40 - (1 - abs(x - 32) / 32) * 12)], w=1.0)
emit("bridge", "features", ["bridge", "river", "road"], 64, 56, bridge, pivot=(0.5, 0.75), size=36)
rng.seed(810)
cave = poly(wob([(6, 58), (10, 34), (22, 20), (42, 20), (54, 34), (58, 58)], 0.8), fill=PAPER, w=2.0, close=True) + poly(wob([(20, 58), (22, 42), (32, 34), (42, 42), (44, 58)], 0.6), fill=INK, w=1.2, close=True)
emit("cave", "features", ["cave", "dungeon", "entrance"], 64, 64, cave, size=32)
rng.seed(811)
mine = poly(wob([(8, 58), (14, 30), (32, 18), (50, 30), (56, 58)], 0.8), fill=PAPER, w=1.8, close=True) + poly([(22, 58), (22, 40), (42, 40), (42, 58)], fill=INK, w=1.0, close=True) + poly(wob([(4, 48), (18, 44)], 0.5), w=1.6) + poly(wob([(10, 52), (14, 40)], 0.5), w=1.6)
emit("mine", "features", ["mine", "dwarf", "mountain"], 64, 64, mine, size=32)

# ---------------------------------------------------------------- ships & monsters
rng.seed(900)
hull = curve(wob([(6, 40), (14, 52), (54, 52), (62, 38)], 0.7), fill=PAPER, w=2.0, close=True)
ship = hull + poly([(30, 52), (30, 8)], w=2.2) + curve(wob([(30, 10), (52, 22), (30, 36)], 1.0), fill=PAPER, w=1.6, close=True) + curve(wob([(28, 14), (12, 24), (28, 34)], 1.0), fill=PAPER, w=1.4, close=True) + poly([(28, 6), (38, 9), (28, 12)], fill=INK, w=1.0, close=True)
emit("ship", "sea", ["ship", "sail", "sea"], 68, 56, ship, pivot=(0.5, 0.85), size=40)
rng.seed(901)
galley = curve(wob([(4, 36), (12, 50), (60, 50), (66, 34)], 0.7), fill=PAPER, w=2.0, close=True) + poly([(34, 50), (34, 12)], w=2.0) + curve(wob([(16, 14), (52, 14), (34, 34)], 1.0), fill=PAPER, w=1.6, close=True)
for x in range(12, 60, 8):
    galley += poly(wob([(x, 50), (x - 3, 58)], 0.4), w=1.0)
emit("galley", "sea", ["ship", "galley", "oars", "sea"], 70, 60, galley, pivot=(0.5, 0.85), size=40)
rng.seed(902)
serp = curve(wob([(4, 44), (16, 26), (28, 44), (40, 26), (52, 44), (64, 26), (74, 40)], 1.0), w=2.6)
serp += curve(wob([(74, 40), (84, 30), (94, 34), (92, 42), (80, 44)], 0.8), fill=PAPER, w=2.0, close=True)
serp += f'<circle cx="86" cy="35" r="1.8" fill="{INK}"/>'
for x in (16, 40, 64):
    serp += poly(wob([(x, 26), (x - 3, 16), (x + 4, 24)], 0.6), fill=INK, w=1.0, close=True)
emit("sea_serpent", "sea", ["monster", "serpent", "sea"], 100, 56, serp, pivot=(0.5, 0.8), size=56)
rng.seed(903)
kraken = curve(wob([(30, 40), (26, 18), (46, 10), (64, 20), (58, 42)], 1.2), fill=PAPER, w=2.0, close=True)
for k in range(6):
    x0 = 28 + k * 7
    kraken += curve(wob([(x0, 40), (x0 - 8 + k * 3, 52), (x0 - 2 + k * 2, 62)], 1.2), w=2.0)
kraken += f'<circle cx="40" cy="26" r="2.2" fill="{INK}"/><circle cx="52" cy="26" r="2.2" fill="{INK}"/>'
emit("kraken", "sea", ["monster", "kraken", "sea"], 92, 68, kraken, pivot=(0.5, 0.7), size=56)
rng.seed(904)
anchor = poly([(32, 8), (32, 52)], w=2.4) + f'<circle cx="32" cy="8" r="5" fill="none" stroke="{INK}" stroke-width="2"/>' + poly([(18, 22), (46, 22)], w=2.2) + curve(wob([(10, 38), (18, 54), (32, 58), (46, 54), (54, 38)], 0.6), w=2.4)
emit("anchor", "sea", ["anchor", "harbour", "port"], 64, 64, anchor, pivot=(0.5, 0.5), size=24)

# ---------------------------------------------------------------- ornaments
rng.seed(1000)
rose = f'<circle cx="80" cy="80" r="70" fill="{PAPER}" stroke="{INK}" stroke-width="2"/><circle cx="80" cy="80" r="60" fill="none" stroke="{INK}" stroke-width="1"/>'
for k in range(16):
    a = k / 16 * 2 * math.pi
    lo = 0.4 if k % 4 == 0 else (0.5 if k % 2 == 0 else 0.55)
    rose += poly([(80 + math.sin(a) * 60 * lo, 80 - math.cos(a) * 60 * lo), (80 + math.sin(a) * 60, 80 - math.cos(a) * 60)], w=1.4 if k % 4 == 0 else 0.7)
for k, ln in [(0, 0.95), (2, 0.55), (4, 0.95), (6, 0.55), (8, 0.95), (10, 0.55), (12, 0.95), (14, 0.55)]:
    a = k / 16 * 2 * math.pi
    tip = (80 + math.sin(a) * 70 * ln, 80 - math.cos(a) * 70 * ln)
    w = 8
    l = (80 + math.sin(a - 1.5708) * w, 80 - math.cos(a - 1.5708) * w)
    r = (80 + math.sin(a + 1.5708) * w, 80 - math.cos(a + 1.5708) * w)
    rose += poly([tip, l, (80, 80)], fill=INK, w=0.8, close=True) + poly([tip, (80, 80), r], fill=PAPER, w=0.8, close=True)
rose += f'<text x="80" y="10" font-family="serif" font-size="14" text-anchor="middle" fill="{INK}">N</text>'
emit("compass_rose", "ornaments", ["compass", "rose", "ornament"], 160, 160, rose, pivot=(0.5, 0.5), size=140)
rng.seed(1001)
cart = f'<rect x="6" y="6" width="188" height="68" rx="6" fill="{PAPER}" stroke="{INK}" stroke-width="2.2"/><rect x="12" y="12" width="176" height="56" rx="3" fill="none" stroke="{INK}" stroke-width="0.9"/>'
for (cx, cy) in [(6, 6), (194, 6), (6, 74), (194, 74)]:
    cart += f'<circle cx="{cx}" cy="{cy}" r="4" fill="{INK}"/><circle cx="{cx}" cy="{cy}" r="1.8" fill="{PAPER}"/>'
for x in (24, 176):
    cart += curve(wob([(x - 8, 40), (x, 30), (x + 8, 40), (x, 50), (x - 8, 40)], 0.5), w=1.0)
emit("cartouche", "ornaments", ["cartouche", "frame", "title", "ornament"], 200, 80, cart, pivot=(0.5, 0.5), size=220)
rng.seed(1002)
banner = curve(wob([(10, 20), (30, 14), (100, 14), (120, 20), (110, 34), (120, 48), (100, 44), (30, 44), (10, 48), (20, 34)], 0.8), fill=PAPER, w=2.0, close=True)
banner += poly(wob([(30, 14), (32, 44)], 0.4), w=1.0) + poly(wob([(100, 14), (98, 44)], 0.4), w=1.0)
emit("banner", "ornaments", ["banner", "ribbon", "label", "ornament"], 130, 60, banner, pivot=(0.5, 0.5), size=120)
rng.seed(1003)
scale = poly([(10, 20), (190, 20)], w=2.0) + poly([(10, 28), (190, 28)], w=2.0)
for i in range(6):
    x = 10 + i * 36
    scale += poly([(x, 16), (x, 32)], w=1.6)
    if i % 2 == 0 and i < 5:
        scale += f'<rect x="{x}" y="20" width="36" height="8" fill="{INK}"/>'
emit("scale_bar", "ornaments", ["scale", "bar", "ornament"], 200, 44, scale, pivot=(0.5, 0.5), size=200)
rng.seed(1004)
skull = f'<circle cx="32" cy="26" r="16" fill="{PAPER}" stroke="{INK}" stroke-width="2"/><circle cx="26" cy="24" r="3.5" fill="{INK}"/><circle cx="38" cy="24" r="3.5" fill="{INK}"/>' + poly([(30, 34), (32, 30), (34, 34)], w=1.4) + poly([(26, 40), (38, 40)], w=2.0) + poly(wob([(14, 52), (50, 32)], 0.5), w=2.4) + poly(wob([(14, 32), (50, 52)], 0.5), w=2.4)
emit("skull", "markers", ["danger", "skull", "marker"], 64, 64, skull, pivot=(0.5, 0.5), size=26)
rng.seed(1005)
camp = poly(wob([(6, 56), (32, 10), (58, 56)], 0.6), fill=PAPER, w=2.0, close=True) + poly([(32, 10), (32, 56)], w=1.2) + poly(wob([(24, 56), (32, 36), (40, 56)], 0.5), fill=INK, w=1.0, close=True)
emit("camp", "markers", ["camp", "tent", "marker"], 64, 64, camp, size=28)
rng.seed(1006)
x_mark = poly(wob([(12, 12), (52, 52)], 0.8), w=4.0) + poly(wob([(52, 12), (12, 52)], 0.8), w=4.0)
emit("x_marks_the_spot", "markers", ["x", "treasure", "marker"], 64, 64, x_mark, pivot=(0.5, 0.5), size=22)

manifest = {
    "name": "Isoline default symbols",
    "author": "Isoline",
    "license": "CC0-1.0",
    "description": "Hand-drawn style ink symbols generated by tools/gen_default_pack.py. Replace or extend freely.",
    "assets": assets,
}
with open(os.path.join(OUT, "pack.json"), "w") as f:
    json.dump(manifest, f, indent=2)
print(f"wrote {len(assets)} symbols to {OUT}")
