# 使い方: python3 -I convert.py <ne_10m_admin_1.geojson> <出力.js>
# Natural Earth（パブリックドメイン）の都道府県の形を、SVG の path に変換する。
import json, sys, math
src, out = sys.argv[1], sys.argv[2]
d = json.load(open(src))
feats = [f for f in d['features'] if f['properties'].get('adm0_a3') == 'JPN']
LAT0 = 36.0
K = math.cos(math.radians(LAT0))
W = 1000.0
# 本土の範囲（沖縄・小笠原などの遠い島を除く）
LON_MIN, LON_MAX, LAT_MIN, LAT_MAX = 128.5, 146.0, 30.8, 45.7
S = W / ((LON_MAX - LON_MIN) * K)
H = (LAT_MAX - LAT_MIN) * S
def proj(lon, lat):
    return ((lon - LON_MIN) * K * S, (LAT_MAX - lat) * S)
# 沖縄は左上の枠に描く（縮尺そのまま、位置をずらす）
OKI = dict(lon0=122.9, lat1=27.0, lon1=128.4, lat0=24.0)
OKI_POS = (8.0, 8.0)
def proj_oki(lon, lat):
    x = (lon - OKI['lon0']) * K * S
    y = (OKI['lat1'] - lat) * S
    return (OKI_POS[0] + x * 1.5, OKI_POS[1] + y * 1.5)

def area(ring):
    a = 0
    for i in range(len(ring)):
        x1, y1 = ring[i]; x2, y2 = ring[(i + 1) % len(ring)]
        a += x1 * y2 - x2 * y1
    return a / 2
def dp(pts, tol):
    if len(pts) < 3: return pts
    def rec(a, b):
        (x1, y1), (x2, y2) = pts[a], pts[b]
        dx, dy = x2 - x1, y2 - y1
        L = math.hypot(dx, dy) or 1e-9
        best, idx = 0, -1
        for i in range(a + 1, b):
            x0, y0 = pts[i]
            dd = abs(dy * x0 - dx * y0 + x2 * y1 - y2 * x1) / L
            if dd > best: best, idx = dd, i
        if best > tol and idx > 0:
            return rec(a, idx)[:-1] + rec(idx, b)
        return [pts[a], pts[b]]
    return rec(0, len(pts) - 1)

shapes, labels = {}, {}
for f in feats:
    name = f['properties']['name_ja']
    g = f['geometry']
    polys = g['coordinates'] if g['type'] == 'MultiPolygon' else [g['coordinates']]
    okinawa = name == '沖縄県'
    parts = []
    best = None
    for poly in polys:
        ring = poly[0]
        lats = [p[1] for p in ring]; lons = [p[0] for p in ring]
        clat = sum(lats) / len(lats); clon = sum(lons) / len(lons)
        if okinawa:
            if clon > 128.4 or clat > 27.0: continue  # 大東諸島など遠い島は省く
            pts = [proj_oki(*p) for p in ring]
        else:
            if clat < LAT_MIN or clon > LON_MAX or clon < LON_MIN: continue  # 小笠原・奄美など
            pts = [proj(*p) for p in ring]
        a = abs(area(pts))
        if a < 6 and not okinawa: continue      # 小さな離島は省く
        if okinawa and a < 1.5: continue
        tol = 0.9 if not okinawa else 0.6
        h = len(pts) // 2
        simp = dp(pts[:h + 1], tol)[:-1] + dp(pts[h:] + [pts[0]], tol)[:-1]
        if len(simp) < 3: continue
        q = []
        for x, y in simp:
            t = (round(x), round(y))
            if not q or q[-1] != t: q.append(t)
        if len(q) < 3: continue
        parts.append('M' + 'L'.join(f'{x},{y}' for x, y in q) + 'Z')
        if best is None or a > best[0]:
            cx = sum(p[0] for p in pts) / len(pts); cy = sum(p[1] for p in pts) / len(pts)
            best = (a, cx, cy)
    shapes[name] = ''.join(parts)
    if best is None: print("NONE", name, len(polys)); continue
    labels[name] = (round(best[1]), round(best[2]))
js = '  // 都道府県の形（Natural Earth 1:10m admin-1、パブリックドメイン。tools/geo-convert.py で変換・簡略化）\n'
js += f'  const JMAP_W = {W:.0f};\n  const JMAP_H = {H:.0f};\n'
js += '  const JMAP_OKI_BOX = [%d, %d, %d, %d];\n' % (0, 0, int(OKI_POS[0] + (OKI['lon1'] - OKI['lon0']) * K * S * 1.5 + 14), int(OKI_POS[1] + (OKI["lat1"] - OKI["lat0"]) * S * 1.5 + 14))
js += '  const JMAP_SHAPES = ' + json.dumps(shapes, ensure_ascii=False, separators=(',', ':')) + ';\n'
js += '  const JMAP_LABELS = ' + json.dumps(labels, ensure_ascii=False, separators=(',', ':')) + ';\n'
open(out, 'w').write(js)
print(len(js), 'bytes', 'H=', round(H), 'missing', [n for n, s in shapes.items() if not s])
