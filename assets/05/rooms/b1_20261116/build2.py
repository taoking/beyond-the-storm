#!/usr/bin/env python3
"""批次 2 白天的物件状态：每张跟批次 1 底图比，只取指定范围里变了的那块，存成整幅 2560×1440 的透明图层。

用法：python build2.py <出图 目录> [房间 ...]
读 <出图>/批次1/<间>.png 和 <出图>/批次2/*.png。要 Pillow、numpy、scipy、opencv-python。源图不入库。

Gemini 每次都把整张图重画一遍（纹理到处有细小差别），所以只在 LAYERS 给的范围里找「明显变了」的连通块，
补洞、外扩、羽化后取新图的像素；范围外顺手改了的一律不要。
"""
import json, sys
from pathlib import Path
import numpy as np, cv2
from PIL import Image, ImageDraw, ImageFilter
from scipy import ndimage as ndi

sys.path.insert(0, str(Path(__file__).resolve().parent))
import build as b1  # 批次 1 的玻璃规则：原玻璃每次现算，重跑不会叠上次并进去的那块

HERE = Path(__file__).resolve().parent
W, H = 2560, 1440
NAME = {'hearth_room': '炉间', 'observation_room': '观测间', 'kitchen_room': '灶间', 'bedroom': '卧室'}
K, A = 1.12, 10  # 跟 build.py 一样：r < b*K + A 算偏冷（窗外的雪景）

# 图层 → (来源文件名, 范围多边形或矩形 [x0, y0, x1, y1], 参数)
# 炉间柴堆、炉火的文件名跟画的内容对不上（柴堆 3、4 对调；炉火四张乱了），按画的内容对应
LAYERS = {
    'hearth_room': {
        'woodpile_1': ('炉间_柴堆1', [2000, 900, 2330, 1120], {}),
        'woodpile_2': ('炉间_柴堆2', [2030, 840, 2340, 1080], {}),
        'woodpile_3': ('炉间_柴堆4', [2030, 740, 2340, 1080], {}),
        'woodpile_4': ('炉间_柴堆3', [2030, 630, 2340, 1080], {}),
        'oil_lamp_body': ('炉间_柴堆1', [1570, 820, 1790, 1090], {}),
        'fire_flame_ember': ('炉间_炉火旺', [1720, 690, 2200, 1210], {'fire': True}),
        'fire_flame_low': ('炉间_炉火中', [1720, 690, 2200, 1210], {'fire': True}),
        'fire_flame_mid': ('炉间_炉火小', [1720, 690, 2200, 1210], {'fire': True}),
        'fire_flame_high': ('炉间_炉火余烬', [1720, 690, 2200, 1210], {'fire': True}),
        'kettle': ('炉间_物件', [1770, 500, 2010, 710], {}),
        'armchair_blanket': ('炉间_物件', [830, 740, 1505, 1300], {}),
        'snack_plate': ('炉间_物件', [1495, 920, 1790, 1100], {}),
        # 收音机和唱片机：旧的（坏收音机、罩着布的唱片机）也拆成图层，罩布让出来的那块并进玻璃
        'radio_fixed': ('炉间_物件', [130, 690, 418, 900], {'reveal': True}),
        'gramophone_open': ('炉间_物件', [418, 630, 770, 900], {'reveal': True}),
    },
    'kitchen_room': {
        'coat': ('灶间_物件1', [870, 480, 1180, 860], {}),
        'prep': ('灶间_物件1', [1510, 700, 2050, 890], {}),
        'oil_lamp_body': ('灶间_物件1', [2330, 560, 2545, 960], {}),
        # 储物架：料理台下面，左下那条斜线以下是地毯
        'stock_sparse': ('灶间_物件1', [(1160, 780), (2560, 780), (2560, 1440), (1760, 1440), (1700, 1395), (1160, 1170)], {}),
        'stock_half': ('灶间_物件2', [(1160, 780), (2560, 780), (2560, 1440), (1760, 1440), (1700, 1395), (1160, 1170)], {}),
        'stock_full': ('灶间_物件3', [(1160, 780), (2560, 780), (2560, 1440), (1760, 1440), (1700, 1395), (1160, 1170)], {}),
    },
    'bedroom': {
        'quilt_thick': ('卧室物件', [420, 730, 1400, 1300], {'keep_cool': True, 'close': 30}),  # 米色换米色，差得不明显，闭运算加大
        'oil_lamp_body': ('卧室物件', [170, 690, 445, 965], {}),
    },
}
# 不跟着变的那一半：修好以前画旧的
OLD_OF = {'radio_fixed': 'radio_broken', 'gramophone_open': 'gramophone_covered'}

T_CORE, T_SOFT = 34, 14  # 模糊后的差：过 T_CORE 算物件，T_SOFT 以下算重画噪声


def region_mask(r):
    im = Image.new('L', (W, H), 0)
    d = ImageDraw.Draw(im)
    if isinstance(r[0], (int, float)):
        d.rectangle(r, fill=255)
    else:
        d.polygon([tuple(p) for p in r], fill=255)
    return np.asarray(im) > 0


def bbox(m, pad=0):
    ys, xs = np.nonzero(m)
    return max(0, ys.min() - pad), min(H, ys.max() + 1 + pad), max(0, xs.min() - pad), min(W, xs.max() + 1 + pad)


def align(base, new, reg):
    """范围外扩 80 像素做相位相关，求新图相对底图的亚像素平移，挪回去"""
    y0, y1, x0, x1 = bbox(reg, 80)
    g = lambda a: cv2.cvtColor(a[y0:y1, x0:x1].astype('uint8'), cv2.COLOR_RGB2GRAY).astype('float32')
    win = cv2.createHanningWindow((x1 - x0, y1 - y0), cv2.CV_32F)
    (dx, dy), resp = cv2.phaseCorrelate(g(base), g(new), win)
    if resp < 0.2 or abs(dx) > 4 or abs(dy) > 4:
        return new, (0.0, 0.0)
    M = np.float32([[1, 0, -dx], [0, 1, -dy]])
    return cv2.warpAffine(new.astype('uint8'), M, (W, H), flags=cv2.INTER_LINEAR, borderMode=cv2.BORDER_REPLICATE).astype(int), (dx, dy)


def cool(rgb):
    return rgb[..., 0] < rgb[..., 2] * K + A


def feather(m, r):
    return np.asarray(Image.fromarray((m * 255).astype('uint8')).filter(ImageFilter.GaussianBlur(r))).astype(float) / 255


def cut(base, new, glass, reg, opt):
    """返回 (alpha 0..1, 对齐后的新图, 平移)"""
    new, sh = align(base, new, reg)
    d = np.abs(cv2.GaussianBlur(new.astype('float32'), (0, 0), 2.5) - cv2.GaussianBlur(base.astype('float32'), (0, 0), 2.5)).max(2)
    core = (d > T_CORE) & reg
    if not opt.get('keep_cool'):
        # 玻璃里重画的窗外不要；玻璃前的物件（不偏冷）照收
        core &= ~(glass & cool(new))
    else:
        # 物件本身偏冷（米色被子）：只把玻璃里明显发蓝的窗外扣掉
        core &= ~(glass & (new[..., 2] - new[..., 0] > 18))
    core = ndi.binary_opening(core, iterations=2)
    core = ndi.binary_closing(core, iterations=opt.get('close', 8))
    lab, n = ndi.label(core)
    if n:
        size = ndi.sum(core, lab, range(1, n + 1))
        core = np.isin(lab, 1 + np.nonzero(size >= max(1500, 0.04 * size.max()))[0])
    core = ndi.binary_fill_holes(core) & reg
    hard = feather(ndi.binary_dilation(core, iterations=3), 1.5)
    if opt.get('fire'):
        # 炉火的暖光是渐变的：核心外 60 像素里按差的大小软过渡
        support = ndi.binary_dilation(core, iterations=60) & reg
        soft = np.clip((d - T_SOFT) / (T_CORE - T_SOFT), 0, 1) * support
        soft = cv2.GaussianBlur(soft.astype('float32'), (0, 0), 4)
        hard = np.maximum(hard, soft)
    # 范围边上收干净，免得硬切
    hard *= feather(ndi.binary_erosion(reg, iterations=4), 3)
    return hard, new, sh


def save_layer(path, rgb, alpha):
    a = (np.clip(alpha, 0, 1) * 255).round().astype('uint8')
    out = np.dstack([rgb.astype('uint8'), a])
    out[a == 0, :3] = 0
    Image.fromarray(out, 'RGBA').save(path, 'WEBP', lossless=True, method=6)


def panes(m):
    cs, _ = cv2.findContours(m.astype('uint8'), cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    out = []
    for c in sorted(cs, key=lambda c: tuple(c.reshape(-1, 2).min(0))):
        if cv2.contourArea(c) < 2000:
            continue
        out.append(cv2.approxPolyDP(c, 1.5, True).reshape(-1, 2).tolist())
    return out


def build(room, src, locs):
    out = HERE / room
    base = np.asarray(Image.open(src / '批次1' / f'{NAME[room]}.png').convert('RGB')).astype(int)
    glass = b1.glass(room, base.astype('uint8'), json.loads(b1.OLD.read_text(encoding='utf-8'))['rooms'][room])
    cache = {}
    reveal = np.zeros((H, W), bool)
    reveal_src = None
    report = {}
    for name, (fname, r, opt) in LAYERS[room].items():
        if fname not in cache:
            cache[fname] = np.asarray(Image.open(src / '批次2' / f'{fname}.png').convert('RGB')).astype(int)
        reg = region_mask(r)
        alpha, new, sh = cut(base, cache[fname], glass, reg, opt)
        if opt.get('reveal'):
            # 新图里这块成了窗外、底图里是东西：并进玻璃，图层里这块留空
            rv = (alpha > 0.5) & cool(new) & ~glass & reg
            rv = ndi.binary_opening(rv, iterations=2)
            lab, n = ndi.label(rv)
            if n:
                size = ndi.sum(rv, lab, range(1, n + 1))
                rv = np.isin(lab, 1 + np.nonzero(size >= 400)[0])
            # 外扩 3 像素吃掉旧东西的描边（只扩到新图里也是窗外的地方）
            rv = (ndi.binary_dilation(rv, iterations=3) & cool(new) & reg) | rv
            reveal |= rv
            reveal_src = new
            alpha = alpha * (1 - feather(rv, 0.7))
            # 旧的那一半：底图在同一范围里的像素，连同让出来的那块
            old_a = np.maximum(alpha, feather(rv, 0.7))
            save_layer(out / f'{OLD_OF[name]}.webp', base, old_a)
        save_layer(out / f'{name}.webp', new, alpha)
        report[name] = {'from': f'出图/批次2/{fname}.png', 'shift': [round(sh[0], 2), round(sh[1], 2)],
                        'px': int((alpha > 0.5).sum())}
        print(room, name, report[name])
    if reveal.any():
        # 玻璃 = 原玻璃 ∪ 让出来的；室内层这块透明；窗外层这块用新图的窗外
        g2 = glass | reveal
        Image.fromarray((g2 * 255).astype('uint8')).save(out / 'glass_mask.png', optimize=True)
        soft = np.asarray(Image.fromarray((g2 * 255).astype('uint8')).filter(ImageFilter.GaussianBlur(0.7)))
        Image.fromarray(np.dstack([base, 255 - soft]).astype('uint8'), 'RGBA').save(out / 'interior_rgba.webp', 'WEBP', lossless=True, method=6)
        under = ndi.binary_dilation(g2, iterations=2)
        # 两张图的窗外几乎同色，直接取新图的窗外，往原窗外那边羽化过渡
        a = feather(ndi.binary_dilation(reveal, iterations=6), 3)[..., None]
        view = (base * (1 - a) + reveal_src * a).round().astype('uint8')
        outside = np.dstack([view, under * 255]).astype('uint8')
        outside[~under, :3] = 0
        Image.fromarray(outside, 'RGBA').save(out / 'outside_winter_day_clear_rgba.webp', 'WEBP', lossless=True, method=6)
        locs['rooms'][room]['windows'][0]['panesCanvasPolygons'] = panes(g2)
        print(room, 'reveal px', int(reveal.sum()))
    return report


def main():
    src = Path(sys.argv[1])
    rooms = sys.argv[2:] or list(LAYERS)
    target = HERE / 'room_locations.json'
    locs = json.loads(target.read_text(encoding='utf-8'))
    for room in rooms:
        rep = build(room, src, locs)
        R = locs['rooms'][room]
        R['stateLayers'] = {k: v['from'] for k, v in rep.items()}
        R['stateLayers'].update({OLD_OF[k]: '出图/批次1/' + NAME[room] + '.png' for k in rep if k in OLD_OF})
    target.write_text(json.dumps(locs, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')


if __name__ == '__main__':
    main()
