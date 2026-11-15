#!/usr/bin/env python3
"""批次 1 四间正式底图（Gemini 原生 2560×1440）拆成室内层、窗外层和玻璃掩码，并把 g5_20261115 的坐标换到新图上。

用法：python build.py <出图/批次1 目录> [房间 ...]
FIT 里没有的房间，拿同级的 批次1_参考/ 里的参考图做模板匹配，现算拟合。
要 Pillow、numpy、scipy、opencv-python。源图不入库（在本机 出图/批次1/）。
"""
import copy, json, sys
from pathlib import Path
import numpy as np, cv2
from PIL import Image, ImageDraw, ImageFilter
from scipy import ndimage as ndi

HERE = Path(__file__).resolve().parent
OLD = HERE.parent / 'g5_20261115' / 'room_locations.json'
W, H = 2560, 1440
NAME = {'hearth_room': '炉间', 'observation_room': '观测间', 'kitchen_room': '灶间', 'bedroom': '卧室'}

# 玻璃：偏冷的像素（r < b*K + A）里、跟旧玻璃多边形（外扩 40 像素）重合过半的连通块；只填小于 HOLE 的洞
K, A, HOLE = 1.12, 10, 1500
# 挡在玻璃前、颜色又跟窗外分不开的东西，强制留在室内层
EXCLUDE = {
    'observation_room': [  # 窗台上的空玻璃罐
        [(1958, 714), (2031, 714), (2033, 742), (2043, 760), (2043, 858), (2035, 868),
         (1953, 868), (1945, 858), (1945, 760), (1955, 742)],
    ],
}
# 玻璃前没有家具的房间：每块玻璃取凸包，补上窗框边上偏暖的雪光（炉间前面有收音机和椅背，不取）
HULL = {'observation_room', 'kitchen_room', 'bedroom'}
# 旧坐标 → 新图：按每间几十个特征点做局部模板匹配后拟合的仿射（x' = a·x + b·y + c）
FIT = {
    'hearth_room': {'x': [1, 0, 0], 'y': [0, 1.0082, -6.45]},
    'observation_room': {'x': [1, 0, 0], 'y': [0, 1.0093, -5.68]},
    'kitchen_room': {'x': [1, 0, 0], 'y': [0, 1.0097, -5.48]},
}


def polys_mask(polys):
    im = Image.new('L', (W, H), 0)
    d = ImageDraw.Draw(im)
    for p in polys:
        d.polygon([tuple(map(float, q)) for q in p], fill=255)
    return np.asarray(im) > 0


def glass(room, rgb, old_room):
    r, b = rgb[..., 0].astype(int), rgb[..., 2].astype(int)
    cool = r < b * K + A
    near = ndi.binary_dilation(polys_mask([p for w in old_room['windows'] for p in w['panesCanvasPolygons']]), iterations=40)
    lab, n = ndi.label(cool)
    idx = range(n + 1)
    size = ndi.sum(np.ones_like(lab), lab, idx)
    keep = (ndi.sum(near, lab, idx) > 0.5 * size) & (size > 5000)
    keep[0] = False
    m = keep[lab]
    hl, hn = ndi.label(~m)
    small = ndi.sum(np.ones_like(hl), hl, range(hn + 1)) < HOLE
    small[0] = False
    m |= small[hl]
    if room in HULL:
        cs, _ = cv2.findContours(m.astype('uint8'), cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_NONE)
        hull = np.zeros(m.shape, 'uint8')
        for c in cs:
            cv2.fillPoly(hull, [cv2.convexHull(c)], 1)
        m = hull > 0
    if room in EXCLUDE:
        m &= ~polys_mask(EXCLUDE[room])
    return m


def panes(m):
    cs, _ = cv2.findContours(m.astype('uint8'), cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    out = []
    for c in sorted(cs, key=lambda c: tuple(c.reshape(-1, 2).min(0))):
        if cv2.contourArea(c) < 2000:
            continue
        out.append(cv2.approxPolyDP(c, 1.5, True).reshape(-1, 2).tolist())
    return out


def old_points(room, old):
    R = old['rooms'][room]
    P = [l['footAnchor'] for l in old['locations'].values() if l.get('room') == room and l.get('footAnchor')]
    P += [p for d in R['doorways'] for p in d.get('polygon', [])]
    for x, y, w, h in [s['rect'] for s in R['displaySlots']] + [R['actor']['rect']]:
        P += [[x, y], [x + w, y + h]]
    return P + [R['lampAnchor']]


def fit_room(room, ref, src, old):
    """参考图上每个旧坐标附近取一块，在新图 ±220 像素里找最像的位置，拿匹配度 ≥ 0.9 的点拟合仿射"""
    def load(p):
        im = cv2.imdecode(np.fromfile(str(p), np.uint8), cv2.IMREAD_GRAYSCALE)
        return cv2.GaussianBlur(cv2.resize(im, (W // 2, H // 2), interpolation=cv2.INTER_AREA), (3, 3), 0)
    a, b = load(ref), load(src)
    old_pts, new_pts = [], []
    for x, y in old_points(room, old):
        best = None
        for half in (60, 100):
            x0 = int(max(0, min(W // 2 - 2 * half, x / 2 - half)))
            y0 = int(max(0, min(H // 2 - 2 * half, y / 2 - half)))
            sx0, sy0 = max(0, x0 - 110), max(0, y0 - 110)
            res = cv2.matchTemplate(b[sy0:y0 + 2 * half + 110, sx0:x0 + 2 * half + 110],
                                    a[y0:y0 + 2 * half, x0:x0 + 2 * half], cv2.TM_CCOEFF_NORMED)
            _, score, _, loc = cv2.minMaxLoc(res)
            if best is None or score > best[0]:
                best = (score, (sx0 + loc[0] - x0) * 2, (sy0 + loc[1] - y0) * 2)
        if best[0] >= 0.9:
            old_pts.append([x, y]); new_pts.append([x + best[1], y + best[2]])
    X = np.c_[np.array(old_pts, float), np.ones(len(old_pts))]
    n = np.array(new_pts, float)
    fx = np.linalg.lstsq(X, n[:, 0], rcond=None)[0]
    fy = np.linalg.lstsq(X, n[:, 1], rcond=None)[0]
    FIT[room] = {'x': fx.round(5).tolist(), 'y': fy.round(5).tolist()}
    print(room, 'fit from', len(old_pts), 'points', FIT[room])


def tf(room, p):
    fx, fy = FIT[room]['x'], FIT[room]['y']
    x, y = p
    return [round(fx[0] * x + fx[1] * y + fx[2]), round(fy[0] * x + fy[1] * y + fy[2])]


def tf_rect(room, r):
    x0, y0 = tf(room, r[:2])
    x1, y1 = tf(room, [r[0] + r[2], r[1] + r[3]])
    return [x0, y0, x1 - x0, y1 - y0]


def strip(r):
    """状态图层、人物、暖炉火光都是旧套的文件，批次 2 在新底图上重做"""
    r['status'] = 'pending'
    r.pop('stateLayers', None)
    for k in ('image', 'contact', 'occlusion', 'frontOcclusion', 'quality'):
        r['actor'].pop(k, None)
    r.get('heater', {}).pop('litOverlay', None)
    for w in r['windows']:
        w['glassMask'] = 'glass_mask.png'


def build(room, src, old, new):
    if room not in FIT:
        fit_room(room, src.parent.parent / '批次1_参考' / src.name, src, old)
    rgb = np.asarray(Image.open(src).convert('RGB'))
    assert rgb.shape[:2] == (H, W), (src, rgb.shape)
    out = HERE / room
    out.mkdir(exist_ok=True)
    m = glass(room, rgb, old['rooms'][room])
    Image.fromarray((m * 255).astype('uint8')).save(out / 'glass_mask.png', optimize=True)
    # 室内层：玻璃处透明，边缘软化约 1 像素；窗外层比玻璃外扩 2 像素，垫在软边下面
    soft = np.asarray(Image.fromarray((m * 255).astype('uint8')).filter(ImageFilter.GaussianBlur(0.7)))
    interior = np.dstack([rgb, 255 - soft]).astype('uint8')
    Image.fromarray(interior, 'RGBA').save(out / 'interior_rgba.webp', 'WEBP', lossless=True, method=6)
    under = ndi.binary_dilation(m, iterations=2)
    outside = np.dstack([rgb, under * 255]).astype('uint8')
    outside[~under, :3] = 0
    Image.fromarray(outside, 'RGBA').save(out / 'outside_winter_day_clear_rgba.webp', 'WEBP', lossless=True, method=6)

    # 每次都从旧套的坐标换算，重跑不会叠加
    R = new['rooms'][room] = copy.deepcopy(old['rooms'][room])
    strip(R)
    R['windows'][0]['panesCanvasPolygons'] = panes(m)
    R['windows'][0]['frameLeakGuard'] = {
        'method': 'glass = cool pixels connected to the old pane areas, small holes filled, jar and similar see-through props excluded; interior alpha softened ~1 px; outside layer extends 2 px under the frame',
        'mask': 'glass_mask.png', 'approvedGeometry': False}
    for d in R['doorways']:
        if 'polygon' in d:
            d['polygon'] = [tf(room, p) for p in d['polygon']]
    for s in R['displaySlots']:
        s['rect'] = tf_rect(room, s['rect'])
    R['actor']['rect'] = tf_rect(room, R['actor']['rect'])
    for k in ('lampAnchor', 'coatAnchor', 'storageAnchor'):
        if k in R:
            R[k] = tf(room, R[k])
    sh = R['standingHeight']
    for k, loc in old['locations'].items():
        if loc.get('room') == room and loc.get('footAnchor'):
            foot = tf(room, loc['footAnchor'])
            new['locations'][k].update(footAnchor=foot, standingHeightPx=round(sh['a'] + foot[1] * sh['b']))
    R['source'] = f'出图/批次1/{NAME[room]}.png (Gemini, native 2560x1440, 2026-11-16)'
    R['status'] = 'base_ready'
    print(room, 'glass px', int(m.sum()), 'panes', len(R['windows'][0]['panesCanvasPolygons']))


def main():
    src = Path(sys.argv[1])
    rooms = sys.argv[2:] or list(FIT)  # 卧室重出以后：python build.py <目录> bedroom
    target = HERE / 'room_locations.json'
    new = json.loads((target if target.exists() else OLD).read_text(encoding='utf-8'))
    old = json.loads(OLD.read_text(encoding='utf-8'))
    if not target.exists():
        new.update(date='2026-11-16', status='BATCH1_NATIVE_BASES_IN_PROGRESS',
                   sourceScaleIsUpsampled=False,
                   coordinateSystem='all x/y in native 2560x1440 scene pixels (batch-1 Gemini bases)')
        for r in new['rooms'].values():
            strip(r)
    for room in rooms:
        build(room, src / f'{NAME[room]}.png', old, new)
    target.write_text(json.dumps(new, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')


if __name__ == '__main__':
    main()
