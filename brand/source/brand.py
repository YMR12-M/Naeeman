# يولّد ملفات SVG للوجو «نعيمًا» وأيقوناته من مسارات خط Aref Ruqaa Ink
# usage: brand.py <word.json> <letter.json> <out-dir>
import json, sys, math, os
WJ, LJ, OUT = sys.argv[1:4]; os.makedirs(OUT, exist_ok=True)
W = json.load(open(WJ)); L = json.load(open(LJ))
C = dict(wall='#A9D6C4', ink='#143C38', cream='#F3EBDD', chrome='#B9BFC4', edge='#5E676E',
         tile='#F4F3EC', grout='#D5D9D2', signN='#E3D7BF')

def word(g, cx, cy, width, height, fill):
    x0, y0, x1, y1 = g['bounds']; s = min(width / (x1 - x0), height / (y1 - y0))
    tx = cx - (x0 + x1) / 2 * s; ty = cy - (y0 + y1) / 2 * s
    return f'<path d="{g["d"]}" fill="{fill}" transform="translate({tx:.2f} {ty:.2f}) scale({s:.5f})"/>'

def screw(cx, cy, r, ang=35):
    a = math.radians(ang); dx, dy = math.cos(a) * r * .62, math.sin(a) * r * .62
    return (f'<circle cx="{cx}" cy="{cy}" r="{r}" fill="{C["chrome"]}" stroke="{C["edge"]}" stroke-width="{r*.16:.2f}"/>'
            f'<line x1="{cx-dx:.2f}" y1="{cy-dy:.2f}" x2="{cx+dx:.2f}" y2="{cy+dy:.2f}" stroke="{C["edge"]}" stroke-width="{r*.22:.2f}" stroke-linecap="round"/>')

def sign(x, y, w, h, board, ink, rx, word_w=.66, word_h=.70):
    """لوح اليافطة: خط دهان داخلي + الكلمة + مسمارين على الجنبين."""
    m = h * .06; lw = h * .014; r = h * .05
    return (f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="{rx}" fill="{board}"/>'
            f'<rect x="{x+m:.1f}" y="{y+m:.1f}" width="{w-2*m:.1f}" height="{h-2*m:.1f}" rx="{rx*.6:.1f}" fill="none" stroke="{ink}" stroke-width="{lw:.1f}"/>'
            + word(W, x + w / 2, y + h / 2, w * word_w, h * word_h, ink)
            + screw(x + m + r * 2.1, y + h / 2, r) + screw(x + w - m - r * 2.1, y + h / 2, r, 145))

def svg(vw, vh, body, label=True):
    a = ' role="img" aria-label="نعيمًا"' if label else ''
    return f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {vw} {vh}" width="{vw}" height="{vh}"{a}>{body}</svg>'

def tiles(y, n, size=1024):
    t = size / n; b = f'<rect x="0" y="{y}" width="{size}" height="{size-y}" fill="{C["tile"]}"/>'
    for i in range(1, n): b += f'<line x1="{i*t:.1f}" y1="{y}" x2="{i*t:.1f}" y2="{size}" stroke="{C["grout"]}" stroke-width="8"/>'
    return b + f'<rect x="0" y="{y-14}" width="{size}" height="28" fill="{C["ink"]}"/>'

f = {}
f['logo-sign.svg'] = svg(960, 560, sign(0, 0, 960, 560, C['ink'], C['cream'], 12))
f['logo-sign-night.svg'] = svg(960, 560, sign(0, 0, 960, 560, C['signN'], C['ink'], 12))
x0, y0, x1, y1 = W['bounds']; p = 24
f['wordmark.svg'] = (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="{x0-p:.1f} {y0-p:.1f} {x1-x0+2*p:.1f} {y1-y0+2*p:.1f}" role="img" aria-label="نعيمًا">'
                     f'<path d="{W["d"]}" fill="currentColor"/></svg>')
# الأيقونة: اليافطة نفسها مالية المربع (iOS بيقص الحواف لوحده)
f['icon.svg'] = svg(1024, 1024, f'<rect width="1024" height="1024" fill="{C["ink"]}"/>'
                    f'<rect x="92" y="92" width="840" height="840" rx="140" fill="none" stroke="{C["cream"]}" stroke-width="16"/>'
                    + word(W, 512, 512, 600, 560, C['cream']) + screw(160, 512, 26) + screw(864, 512, 26, 145), label=False)
# أندرويد maskable: كل حاجة جوه دايرة الأمان (نص قطر 40%)
f['icon-maskable.svg'] = svg(1024, 1024, f'<rect width="1024" height="1024" fill="{C["ink"]}"/>'
                             + word(W, 512, 512, 560, 440, C['cream']) + screw(178, 512, 28) + screw(846, 512, 28, 145), label=False)
# المشهد الكامل (حيطة + يافطة + بلاط): لشاشة البداية وصور المتجر
f['icon-scene.svg'] = svg(1024, 1024, f'<rect width="1024" height="1024" fill="{C["wall"]}"/>' + tiles(812, 4)
                          + sign(112, 150, 800, 560, C['ink'], C['cream'], 16), label=False)
f['favicon.svg'] = svg(64, 64, f'<rect width="64" height="64" rx="10" fill="{C["ink"]}"/>' + word(L, 33, 31, 40, 40, C['cream']))
for k, v in f.items(): open(os.path.join(OUT, k), 'w').write(v)
print(' '.join(f))
