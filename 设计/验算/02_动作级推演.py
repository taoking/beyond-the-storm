#!/usr/bin/env python3
"""02 玩法草案的柴粮验算：动作级（半小时一步）。

不是游戏代码，只用来检查 02 第 5 节的规则在「先取得、后消耗」的顺序下是否闭合。
用法：python3 02_动作级推演.py [--runs N] [--years Y]
随机种子固定为 0..N-1，同样的参数重跑结果相同。
"""
import argparse
import random
from collections import Counter

SEASONS = [("冬", 24), ("春", 12), ("夏", 12), ("秋", 12)]
YEAR = sum(n for _, n in SEASONS)

# 天气档：A 好天  B 一般  C 出不了院子  D 暴风雪
WEATHER = {
    "冬": dict(A=.35, B=.35, C=.18, D=.12),
    "春": dict(A=.45, B=.35, C=.15, D=.05),
    "夏": dict(A=.60, B=.30, C=.10, D=.00),
    "秋": dict(A=.45, B=.35, C=.15, D=.05),
}
MAX_D_RUN, MAX_BAD_RUN, RECOVER = 3, 4, 2

YEARS = {
    "平年": dict(bad=1.0, late_spring=0, early_frost=0),
    "风雪年": dict(bad=1.35, late_spring=0, early_frost=0),
    "暖年": dict(bad=0.7, late_spring=0, early_frost=0),
    "春迟年": dict(bad=1.0, late_spring=3, early_frost=0),
    "霜早年": dict(bad=1.0, late_spring=0, early_frost=3),
}
YEAR_WEIGHTS = [("平年", .40), ("风雪年", .15), ("暖年", .15), ("春迟年", .15), ("霜早年", .15)]

WOOD_USE = {
    "冬": dict(俭=4, 正常=6, 丰足=8),
    "春": dict(俭=3, 正常=5, 丰足=6),
    "夏": dict(俭=2, 正常=4, 丰足=5),
    "秋": dict(俭=3, 正常=5, 丰足=6),
}
MEALS = dict(俭=[7.5, 18.5], 正常=[7.5, 12.5, 18.5], 丰足=[7.5, 12.5, 18.5])

P = dict(
    wood_cap=80, food_cap=60,
    thrift=2, thrift_exit=3, rich=10, rich_exit=8,      # 够用几天
    target_days=7, omen_days=10, tight_days=3,
    wood_yield=dict(A=20, B=14),
    food_yield={"冬": dict(A=6, B=4), "春": dict(A=6, B=5), "夏": dict(A=8, B=6), "秋": dict(A=8, B=6)},
    chore_hours=4.0,
    eave_wood=4, eave_wood_hours=1.0,      # 檐下取柴：每天至多一次
    eave_food=2, eave_food_hours=1.5,      # 檐下取粮：每天至多一次
    ember_hours=2.0, night_hours=8.0, meal_hours=1.0,
    plots=4, crop_days=5, crop_yield=5,
    window=0, bedding=0, greenhouse=0, fence=0,
    storm_extra=1,
    project_cap=3.0, project_cap_indoor=5.0,
)
BASE_REPAIRS = dict(wood_cap=120, food_cap=90, window=1, fence=1)
EXT_REPAIRS = dict(greenhouse=1, bedding=1)
STEP = 0.5
ORDER = ["俭", "正常", "丰足"]


def season_of(day):
    d = day % YEAR
    for name, n in SEASONS:
        if d < n:
            return name, d, n
        d -= n


def pick_year(rng):
    r = rng.random(); acc = 0
    for k, w in YEAR_WEIGHTS:
        acc += w
        if r < acc:
            return k
    return "平年"


class Sky:
    def __init__(self, rng):
        self.rng = rng; self.d_run = 0; self.bad_run = 0; self.recover = 0

    def draw(self, table, bad_mult):
        p = dict(table)
        p["C"] *= bad_mult; p["D"] *= bad_mult
        rest = 1 - p["C"] - p["D"]; s = table["A"] + table["B"]
        p["A"] = rest * table["A"] / s; p["B"] = rest * table["B"] / s
        if self.recover > 0 or self.bad_run >= MAX_BAD_RUN:
            p["C"] = p["D"] = 0
        if self.d_run >= MAX_D_RUN:
            p["D"] = 0
        tot = sum(p.values()); r = self.rng.random() * tot; acc = 0; w = "A"
        for k in "ABCD":
            acc += p[k]
            if r < acc:
                w = k; break
        if w in "CD":
            self.bad_run += 1
            self.d_run = self.d_run + 1 if w == "D" else 0
        else:
            if self.bad_run >= 2:
                self.recover = RECOVER
            self.bad_run = 0; self.d_run = 0
            if self.recover > 0:
                self.recover -= 1
        return w


def tier(days, cur, p):
    if cur == "俭":
        return "俭" if days < p["thrift_exit"] else ("丰足" if days >= p["rich"] else "正常")
    if cur == "丰足":
        return "丰足" if days >= p["rich_exit"] else ("俭" if days < p["thrift"] else "正常")
    return "俭" if days < p["thrift"] else ("丰足" if days >= p["rich"] else "正常")


def weather_table(day, kind):
    sname, sd, sn = season_of(day)
    yk = YEARS[kind]
    if sname == "春" and sd < yk["late_spring"]:
        return WEATHER["冬"]
    if sname == "秋" and sd >= sn - yk["early_frost"]:
        return WEATHER["冬"]
    return WEATHER[sname]


def run(years, seed, params=None, wood0=60, food0=45, worst=False, repairs_at=None, force_year=None):
    rng = random.Random(seed)
    p = dict(P); p.update(params or {})
    sky = Sky(rng)
    wood, food = wood0, food0
    burn = 0.0 if (wood0 == 0) else 4.0      # 炉膛里正在烧的柴还能烧几小时
    ember = 0.0
    wt = ft = "正常"
    plots = [None] * p["plots"]; gh = [None, None]
    st = Counter(); per_season = Counter(); runs = []; cur_run = 0
    kinds = {}
    kind = force_year or pick_year(rng)
    next_kind = kind
    today = "D" if worst else sky.draw(weather_table(0, kind), YEARS[kind]["bad"])
    for day in range(years * YEAR):
        if repairs_at and day in repairs_at:
            p.update(repairs_at[day])
        sname, sd, sn = season_of(day)
        kind = next_kind
        yk = YEARS[kind]
        w = today
        # 明天的天气今天就定。明天是新年第一天的话，先抽新年的性格，用新年的参数
        if (day + 1) % YEAR == 0:
            next_kind = force_year or pick_year(rng)
        tomorrow = "D" if worst else sky.draw(weather_table(day + 1, next_kind), YEARS[next_kind]["bad"])
        today = tomorrow

        wn = max(1, WOOD_USE[sname]["正常"] - p["window"] - p["bedding"])
        wt = tier(wood / wn, wt, p); ft = tier(food / 3, ft, p)
        mood = ORDER[min(ORDER.index(wt), ORDER.index(ft))]
        st[mood] += 1; per_season[(sname, mood)] += 1
        kinds.setdefault(kind, Counter())[mood] += 1
        if mood == "俭":
            cur_run += 1
        elif cur_run:
            runs.append(cur_run); cur_run = 0

        # 清晨：自然等待的进度（作物）
        grow_ok = sname != "冬" and not (sname == "春" and sd < 1 + yk["late_spring"])
        frost = sname == "秋" and sd >= sn - yk["early_frost"]
        for i, left in enumerate(plots):
            if sname == "冬":
                plots[i] = None; continue
            if left is None:
                days_left = (YEAR - 24) - (day % YEAR - 24)
                if grow_ok and w != "D" and days_left > p["crop_days"]:
                    plots[i] = p["crop_days"]
            else:
                if w != "D":
                    left -= 1
                if left <= 0:
                    food = min(p["food_cap"], food + p["crop_yield"] + p["fence"] - (1 if frost else 0)); plots[i] = None
                else:
                    plots[i] = left
        if p["greenhouse"]:
            for i, left in enumerate(gh):
                if left is None:
                    gh[i] = 6 if sname == "冬" else 5
                else:
                    left -= 1
                    if left <= 0:
                        food = min(p["food_cap"], food + 4); gh[i] = None
                    else:
                        gh[i] = left

        # 今天的柴用度预算 → 白天几根、夜里压火几根
        use = WOOD_USE[sname][wt] - p["window"] - p["bedding"]
        if w == "D" and wt != "俭":
            use += p["storm_extra"]
        use = max(2, use)
        night_n = max(1, use // 3); day_n = max(1, use - night_n)
        stick_hours = 16.0 / day_n
        meals = list(MEALS[ft]); eaten = [False] * len(meals)
        tdays = p["omen_days"] if tomorrow == "D" else p["target_days"]
        autumn = sname == "秋"
        wtarget = p["wood_cap"] if autumn else min(p["wood_cap"], tdays * wn)
        ftarget = p["food_cap"] if autumn else min(p["food_cap"], tdays * 3)

        busy_until = 6.0; pending = None
        eave_w = eave_f = False; morning = afternoon = False
        proj = 0.0; did_chore = False; work = 0.0
        pcap = p["project_cap_indoor"] if w in "CD" else p["project_cap"]
        t = 6.0
        while t < 22.0 - 1e-9 or t < busy_until - 1e-9:
            free = t >= busy_until - 1e-9
            late = t >= 22.0 - 1e-9      # 过了 10 点：只把手上的事做完，不开新的
            if free and pending:
                kind_, amt = pending; pending = None
                if kind_ == "wood":
                    wood = min(p["wood_cap"], wood + amt)
                else:
                    food = min(p["food_cap"], food + amt)
            if free and burn <= 0 and wood >= 1:
                wood -= 1; burn = stick_hours; ember = p["ember_hours"]; st["烧柴"] += 1
            if free and not late:
                act = None
                # 1 没柴可添：先去檐下取柴
                if burn <= 0 and wood == 0 and not eave_w:
                    act = ("eave_w",)
                # 2 饭点
                if act is None:
                    for i, mt in enumerate(meals):
                        if not eaten[i] and t >= mt:
                            if food >= 1:
                                act = ("eat", i)
                            elif not eave_f:
                                act = ("eave_f",)
                            break
                # 3 活计
                if act is None:
                    slot = None
                    if 8 <= t < 12 and not morning:
                        slot = "m"
                    elif 14 <= t < 18 and not afternoon and mood == "俭":
                        slot = "a"
                    if slot:
                        wd, fd = wood / wn, food / 3
                        if w in "AB":
                            wneed, fneed = wood < wtarget, food < ftarget
                            if wneed or fneed:
                                act = ("chore", "wood" if (wneed and (not fneed or wd <= fd)) else "food", slot)
                        else:
                            if wd < p["tight_days"] and not eave_w:
                                act = ("eave_w",)
                            elif fd < p["tight_days"] and not eave_f:
                                act = ("eave_f",)
                # 4 项目
                if act is None and mood != "俭" and proj < pcap and ((14 <= t < 18) or (w in "CD" and 9 <= t < 12)):
                    proj += STEP; st["项目小时"] += STEP
                # 执行。要离开炉边一阵子的事，走之前先把柴添够
                if act and act[0] != "eat":
                    dur = {"eave_w": p["eave_wood_hours"], "eave_f": p["eave_food_hours"], "chore": p["chore_hours"]}[act[0]]
                    if act[0] != "eave_w" and wood == 0 and burn + p["ember_hours"] < dur and not eave_w:
                        act = ("eave_w",); dur = p["eave_wood_hours"]     # 没柴可添，先去檐下取
                    extra = 0
                    while burn + p["ember_hours"] < dur and wood >= 1 and extra < 2:
                        wood -= 1; burn = max(burn, 0.0) + stick_hours; ember = p["ember_hours"]; st["烧柴"] += 1; extra += 1
                if act:
                    if act[0] == "eave_w":
                        eave_w = True; busy_until = t + p["eave_wood_hours"]; pending = ("wood", p["eave_wood"])
                        st["檐下取柴"] += 1; did_chore = True; work += p["eave_wood_hours"]
                    elif act[0] == "eave_f":
                        eave_f = True; busy_until = t + p["eave_food_hours"]; pending = ("food", p["eave_food"])
                        st["檐下取粮"] += 1; did_chore = True; work += p["eave_food_hours"]
                    elif act[0] == "eat":
                        food -= 1; eaten[act[1]] = True; busy_until = t + p["meal_hours"]; st["吃饭"] += 1
                    elif act[0] == "chore":
                        _, what, slot = act
                        if slot == "m":
                            morning = True
                        else:
                            afternoon = True
                        amt = p["wood_yield"][w] if what == "wood" else p["food_yield"][sname][w]
                        busy_until = t + p["chore_hours"]; pending = (what, amt)
                        st["备柴" if what == "wood" else "备粮"] += 1; did_chore = True; work += p["chore_hours"]
            # 这半小时里的炉火
            if burn > 0:
                burn -= STEP
            elif ember > 0:
                ember -= STEP
            else:
                st["无火小时"] += STEP
            t += STEP
        # 睡前：到这里手上的事都已经做完（上面的循环会等它做完），入库后压火
        overrun = max(0.0, t - 22.0)
        st["晚睡小时"] += overrun
        if pending:
            kind_, amt = pending
            if kind_ == "wood":
                wood = min(p["wood_cap"], wood + amt)
            else:
                food = min(p["food_cap"], food + amt)
        st["缺餐"] += eaten.count(False)
        n = min(night_n, wood)
        wood -= n; st["烧柴"] += n
        cover = p["night_hours"] * n / night_n + max(0.0, burn)
        left = max(0.0, p["night_hours"] - overrun)
        b = min(cover, left); left -= b
        e = min(p["ember_hours"] if (n or burn > 0) else ember, left); left -= e
        st["无火小时"] += left
        burn = max(0.0, cover - (p["night_hours"] - overrun)); ember = max(0.0, p["ember_hours"] - e)
        if did_chore:
            st["有活计的天"] += 1
        st["活计小时"] += work
    if cur_run:
        runs.append(cur_run)
    return dict(st=st, per_season=per_season, runs=runs, days=years * YEAR, kinds=kinds)


def report(title, runs_n, years, **kw):
    tot = Counter(); ps = Counter(); rr = []; days = 0; kinds = {}
    for s in range(runs_n):
        r = run(years, s, **kw)
        tot += r["st"]; ps += r["per_season"]; rr += r["runs"]; days += r["days"]
        for k, c in r["kinds"].items():
            kinds.setdefault(k, Counter()).update(c)
    rr.sort()
    print(f"\n== {title} ==（{runs_n} 次 × {years} 个世界年）")
    print("  丰足 {:.1f}%  正常 {:.1f}%  俭 {:.1f}%".format(*[tot[k] / days * 100 for k in ["丰足", "正常", "俭"]]))
    for sname, _ in SEASONS:
        tt = sum(ps[(sname, k)] for k in ORDER) or 1
        print(f"  {sname}: " + " / ".join(f"{ps[(sname, k)] / tt * 100:.1f}" for k in ["丰足", "正常", "俭"]))
    if len(kinds) > 1:
        print("  各年份俭的占比: " + "  ".join(f"{k} {c['俭'] / sum(c[x] for x in ORDER) * 100:.1f}%" for k, c in sorted(kinds.items())))
    if rr:
        print(f"  俭：每世界年 {len(rr) / (runs_n * years):.2f} 段，中位 {rr[len(rr) // 2]} 天，95% 不超过 {rr[int(len(rr) * .95)]} 天，最长 {rr[-1]} 天")
    else:
        print("  没有出现俭")
    print(f"  缺餐 {tot['缺餐']} 次；无火 {tot['无火小时']:.1f} 小时（合 {days * 24} 小时里的 {tot['无火小时'] / (days * 24) * 100:.3f}%）")
    print(f"  有活计的日子 {tot['有活计的天'] / days * 100:.0f}%；活计每天平均 {tot['活计小时'] / days:.1f} 小时；项目每天平均 {tot['项目小时'] / days:.1f} 小时")
    print(f"  为做完手上的事而晚睡：合计 {tot['晚睡小时']:.1f} 小时")
    print(f"  每天平均烧柴 {tot['烧柴'] / days:.1f} 根、吃 {tot['吃饭'] / days:.1f} 餐；檐下取柴 {tot['檐下取柴'] / days * 100:.1f}% 的日子，取粮 {tot['檐下取粮'] / days * 100:.1f}%")


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--runs", type=int, default=300)
    ap.add_argument("--years", type=int, default=8)
    a = ap.parse_args()
    full = dict(BASE_REPAIRS); full.update(EXT_REPAIRS)
    report("开局，没有修缮", a.runs, a.years)
    report("基础修缮全修好（补窗缝、柴棚、地窖、篱笆）", a.runs, a.years, params=BASE_REPAIRS)
    report("再加暖棚、床褥窗帘", a.runs, a.years, params=full)
    # 03 的顺序和工时：补窗缝 6、搭柴棚 18、整理地窖 15、修篱笆 8；按每天 2 工时
    report("基础修缮按 03 的顺序在第 3、12、20、24 天修好", a.runs, a.years,
           repairs_at={3: dict(window=1), 12: dict(wood_cap=120), 20: dict(food_cap=90), 24: dict(fence=1)})
    report("只看头一个世界年：同上", a.runs, 1,
           repairs_at={3: dict(window=1), 12: dict(wood_cap=120), 20: dict(food_cap=90), 24: dict(fence=1)})
    report("只看头一个世界年：一件修缮都不做", a.runs, 1)
    report("压力：连着 8 个风雪年，没有修缮", a.runs, a.years, force_year="风雪年")
    report("压力：入冬第一天柴粮都是零、炉膛是空的", a.runs, 2, wood0=0, food0=0)
    report("结构：柴粮是零、炉膛是空的，一整年天天暴风雪", 1, 1, wood0=0, food0=0, worst=True)
