# 使い方: python -I districts.py <ne_10m_admin_1.geojson> <bansho.html> <seeds.py> <出力.js>
# 都道府県（Natural Earth・PD）を、区画の中心点からのボロノイ分割で数区画に分け、SVG path と隣接表を作る。
import json, sys, math, re
import shapely
from shapely.geometry import shape, Point, MultiPoint, Polygon, MultiPolygon
from shapely.ops import voronoi_diagram, unary_union, polylabel
src, html, seedf, out = sys.argv[1:5]
ns = {}; exec(open(seedf, encoding='utf-8').read(), ns)
SEEDS, LINKS = ns['SEEDS'], ns['LINKS']
pref_ids = dict((full, pid) for pid, full in re.findall(r"\['([a-z]+)', '([^']+)', '[^']+', '(?:北海道|東北|関東|中部|近畿|中国|四国|九州)'", open(html, encoding='utf-8').read()))
assert len(pref_ids) == 47, len(pref_ids)
d = json.load(open(src))
feats = {f['properties']['name_ja']: f for f in d['features'] if f['properties'].get('adm0_a3') == 'JPN'}
K = math.cos(math.radians(36.0)); W = 1000.0
LON_MIN, LON_MAX, LAT_MIN, LAT_MAX = 128.5, 146.0, 30.8, 45.7
S = W / ((LON_MAX - LON_MIN) * K); H = (LAT_MAX - LAT_MIN) * S
OKI = dict(lon0=122.9, lat1=27.0, lon1=128.4, lat0=24.0); OSC = 1.5
def P(lon, lat, oki=False):
    if oki: return (8 + (lon - OKI['lon0']) * K * S * OSC, 8 + (OKI['lat1'] - lat) * S * OSC)
    return ((lon - LON_MIN) * K * S, (LAT_MAX - lat) * S)
def proj_poly(rings, oki):
    return Polygon([P(*p, oki) for p in rings[0]], [[P(*p, oki) for p in r] for r in rings[1:]])

districts = []  # dict(id, pref, name, w, geom)
for full, seeds in SEEDS.items():
    pid = pref_ids[full]; oki = full == '沖縄県'
    g = feats[full]['geometry']
    polys = g['coordinates'] if g['type'] == 'MultiPolygon' else [g['coordinates']]
    comps = []
    for rings in polys:
        lons = [p[0] for p in rings[0]]; lats = [p[1] for p in rings[0]]
        clon, clat = sum(lons) / len(lons), sum(lats) / len(lats)
        if oki:
            if clon > OKI['lon1'] or clat > OKI['lat1']: continue
        elif clat < LAT_MIN or clon > LON_MAX or clon < LON_MIN: continue
        pg = proj_poly(rings, oki).buffer(0)
        if pg.area < (1.5 if oki else 4): continue
        comps.append(pg)
    pts = [Point(P(lon, lat, oki)) for _, lon, lat, _ in seeds]
    parts = [[] for _ in seeds]
    # 区画の中心を含む（いちばん近い）島を決める
    home = []
    for i, p in enumerate(pts):
        j = min(range(len(comps)), key=lambda c: comps[c].distance(p))
        if comps[j].distance(p) > 6: print('WARN far seed', full, seeds[i][0], round(comps[j].distance(p), 1))
        home.append(j)
        big = max(c.area for c in comps)
        if comps[j].area < big * 0.2: print('ISLAND seed', full, seeds[i][0], round(comps[j].area))
    for c, comp in enumerate(comps):
        mine = [i for i in range(len(seeds)) if home[i] == c]
        if not mine:
            i = min(range(len(seeds)), key=lambda k: comp.distance(pts[k]))
            parts[i].append(comp)
        elif len(mine) == 1:
            parts[mine[0]].append(comp)
        else:
            vd = voronoi_diagram(MultiPoint([pts[i] for i in mine]), envelope=comp.envelope.buffer(50))
            for cell in vd.geoms:
                i = next(i for i in mine if cell.contains(pts[i]) or cell.distance(pts[i]) < 1e-6)
                piece = cell.intersection(comp)
                if not piece.is_empty: parts[i].append(piece)
    for i, (name, lon, lat, w) in enumerate(seeds):
        geom = unary_union(parts[i]) if parts[i] else None
        if geom is None or geom.is_empty: print('EMPTY', full, name); continue
        districts.append(dict(id=f'{pid}{i}', pref=pid, name=name, w=w, geom=geom, cap=i == 0))

# 隣接（境界を少し太らせて重なる長さで判定）
geoms = [x['geom'] for x in districts]
tree = shapely.STRtree(geoms)
adj = {x['id']: set() for x in districts}
for i, a in enumerate(geoms):
    ab = a.buffer(0.6)
    for j in tree.query(ab):
        if j <= i: continue
        inter = ab.intersection(geoms[j].buffer(0.6))
        if inter.area > 4:
            adj[districts[i]['id']].add(districts[j]['id']); adj[districts[j]['id']].add(districts[i]['id'])
links = []
def find(lonlat):
    p = Point(P(*lonlat))
    return min(districts, key=lambda x: x['geom'].distance(p))['id']
for name, a, b in LINKS:
    x, y = find(a), find(b)
    if x == y: print('LINK same', name, x); continue
    links.append([x, y, name]); adj[x].add(y); adj[y].add(x)
# 海に面するか（ほかの区画と接していない境界が十分ある）
allu = unary_union(geoms)
coast = allu.boundary
out_d = []
# 簡略化（区画の境目を共有したまま）
simp = shapely.coverage_simplify(geoms, 0.9) if hasattr(shapely, 'coverage_simplify') else [g.simplify(0.9) for g in geoms]
def path(g):
    polys = [g] if g.geom_type == 'Polygon' else [p for p in getattr(g, 'geoms', []) if p.geom_type == 'Polygon']
    s = ''
    for pg in polys:
        for ring in [pg.exterior] + list(pg.interiors):
            q = []
            for x, y in list(ring.coords)[:-1]:
                t = (round(x), round(y))
                if not q or q[-1] != t: q.append(t)
            if len(q) >= 3 and abs(Polygon(q).area) >= 1: s += 'M' + 'L'.join(f'{x},{y}' for x, y in q) + 'Z'
    return s
for k, x in enumerate(districts):
    g = x['geom']
    lp = polylabel(max(g.geoms, key=lambda p: p.area) if g.geom_type == 'MultiPolygon' else g, 0.5)
    sea = g.boundary.intersection(coast.buffer(0.3)).length > 6
    out_d.append([x['id'], x['pref'], x['name'], x['w'], path(simp[k]), round(lp.x), round(lp.y), 1 if sea else 0, sorted(adj[x['id']])])
js = '  // 区画（Natural Earth 1:10m admin-1（PD）の都道府県を、主な都市を中心にボロノイ分割。tools/geo-districts.py で生成）\n'
js += '  // [id, 県id, 名前, 人口の重み, 形(SVG path), 名前の位置x, y, 海に面するか, 隣接する区画]\n'
js += '  const DIST_RAW = ' + json.dumps(out_d, ensure_ascii=False, separators=(',', ':')) + ';\n'
js += '  const DIST_LINKS = ' + json.dumps(links, ensure_ascii=False, separators=(',', ':')) + ';\n'
open(out, 'w', encoding='utf-8').write(js)
print(len(out_d), 'districts', len(js), 'bytes', 'coastless', sum(1 for d in out_d if not d[7]), 'isolated', [d[0] for d in out_d if not d[8]])
