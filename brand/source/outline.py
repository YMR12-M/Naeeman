# يحوّل نصًا عربيًا إلى مسار SVG واحد (مع التشكيل عبر harfbuzz) — usage: outline.py font.ttf "نص"
import sys, json, uharfbuzz as hb
from fontTools.ttLib import TTFont
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen
from fontTools.pens.boundsPen import BoundsPen
fp, text = sys.argv[1], sys.argv[2]
blob = hb.Blob.from_file_path(fp); face = hb.Face(blob); font = hb.Font(face)
buf = hb.Buffer(); buf.add_str(text); buf.guess_segment_properties()
hb.shape(font, buf, {})
tt = TTFont(fp); gs = tt.getGlyphSet(); order = tt.getGlyphOrder()
colr = tt['COLR'] if 'COLR' in tt else None
layers = getattr(colr, 'ColorLayers', None) if colr else None
def names(gname):
    if layers and gname in layers: return [l.name for l in layers[gname]]
    return [gname]
pen = SVGPathPen(gs); bp = BoundsPen(gs)
x = 0; used=set()
for info, pos in zip(buf.glyph_infos, buf.glyph_positions):
    g = order[info.codepoint]
    for n in names(g):
        used.add(n)
        t = (1,0,0,-1, x+pos.x_offset, -pos.y_offset)  # y لأسفل في SVG
        gs[n].draw(TransformPen(pen, t)); gs[n].draw(TransformPen(bp, t))
    x += pos.x_advance
print(json.dumps({"d": pen.getCommands(), "bounds": bp.bounds, "advance": x, "glyphs": len(buf.glyph_infos), "colr": bool(layers)}))
