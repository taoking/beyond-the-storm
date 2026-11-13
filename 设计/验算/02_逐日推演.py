#!/usr/bin/env python3
"""02 玩法草案 v2.0 用的柴粮验算：逐日（按天结算）。不是游戏代码。

留着对照，数字不再作为依据。和 v2.2 规则的差别：
- 「俭」的时候允许一天做两次檐下活计（v2.2 改成每天各至多一次）；
- 没有炉膛、饭点和动作的先后，只有每天的进和出；
- 没有算「有暴风雪前兆时多备」。
当前的依据是同目录的 02_动作级推演.py。
用法：python3 02_逐日推演.py
"""
import random, sys
from collections import Counter

SEASONS = [("冬", 24), ("春", 12), ("夏", 12), ("秋", 12)]
YEAR = sum(n for _, n in SEASONS)

# 天气档：A 好天 B 一般 C 大雪/大雨（出不了院子） D 暴风雪
WEATHER = {
    "冬": dict(A=.35, B=.35, C=.18, D=.12),
    "春": dict(A=.45, B=.35, C=.15, D=.05),
    "夏": dict(A=.60, B=.30, C=.10, D=.00),
    "秋": dict(A=.45, B=.35, C=.15, D=.05),
}
MAX_D_RUN = 3      # 暴风雪最多连续天数
MAX_BAD_RUN = 4    # C/D 合计最多连续天数
RECOVER = 2        # 之后至少连续几天 A/B

# 年份性格：对 C、D 概率的倍率，以及春晚/秋早的天数
YEARS = {
    "平年": dict(bad=1.0, late_spring=0, early_frost=0),
    "风雪年": dict(bad=1.35, late_spring=0, early_frost=0),
    "暖年": dict(bad=0.7, late_spring=0, early_frost=0),
    "春迟年": dict(bad=1.0, late_spring=3, early_frost=0),
    "霜早年": dict(bad=1.0, late_spring=0, early_frost=3),
}
YEAR_WEIGHTS = [("平年", .40), ("风雪年", .15), ("暖年", .15), ("春迟年", .15), ("霜早年", .15)]

WOOD_USE = {  # 根/天
    "冬": dict(俭=4, 正常=6, 丰足=8),
    "春": dict(俭=3, 正常=5, 丰足=6),
    "夏": dict(俭=2, 正常=4, 丰足=5),
    "秋": dict(俭=3, 正常=5, 丰足=6),
}
FOOD_USE = dict(俭=2, 正常=3, 丰足=3)

P = dict(
    wood_cap=80, food_cap=60,
    thrift=2, thrift_exit=3, rich=10, rich_exit=8,   # 够用几天
    target_days=7, tight_days=3,
    wood_yield=dict(A=20, B=14),
    food_yield={"冬": dict(A=6, B=4), "春": dict(A=6, B=5), "夏": dict(A=8, B=6), "秋": dict(A=8, B=6)},
    min_wood=4, min_food=2,          # 全天候最低来源，每做一次
    plots=4, crop_days=5, crop_yield=5,
    window=0, bedding=0, greenhouse=0, fence=0,
    storm_extra=1,
)

BASE_REPAIRS = dict(wood_cap=120, food_cap=90, window=1, fence=1)   # 补窗缝、搭柴棚、整理地窖、修篱笆
EXT_REPAIRS = dict(greenhouse=1, bedding=1)                          # 暖棚、床褥窗帘（要探索材料）


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
        rest = 1 - p["C"] - p["D"]
        s = table["A"] + table["B"]
        p["A"] = rest * table["A"] / s; p["B"] = rest * table["B"] / s
        if self.recover > 0:
            p["C"] = p["D"] = 0
        if self.d_run >= MAX_D_RUN:
            p["D"] = 0
        if self.bad_run >= MAX_BAD_RUN:
            p["C"] = p["D"] = 0
        tot = sum(p.values()); r = self.rng.random() * tot; acc = 0
        w = "A"
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


def tier(stock, cur, lo, lo_exit, hi, hi_exit):
    if cur == "俭":
        return "俭" if stock < lo_exit else ("丰足" if stock >= hi else "正常")
    if cur == "丰足":
        return "丰足" if stock >= hi_exit else ("俭" if stock < lo else "正常")
    return "俭" if stock < lo else ("丰足" if stock >= hi else "正常")


def run(years, seed, params, wood0, food0, repairs_at=None, worst=False, log=None):
    """repairs_at: {day: dict} 在第几天完成哪些修缮。worst: 强制最坏天气。"""
    rng = random.Random(seed)
    p = dict(P); p.update(params)
    sky = Sky(rng)
    wood, food = wood0, food0
    wt = ft = "正常"
    plots = [None] * p["plots"]      # 每格：剩余生长天数
    gh = [None, None]
    stats = Counter(); per_season = Counter(); thrift_runs = []; cur_run = 0
    shortfall = 0; chores = Counter(); year_kind = None
    per_year = []
    for day in range(years * YEAR):
        if repairs_at and day in repairs_at:
            p.update(repairs_at[day])
        sname, sd, sn = season_of(day)
        if day % YEAR == 0:
            year_kind = pick_year(rng); yc = Counter(); per_year.append((year_kind, yc))
        yk = YEARS[year_kind]
        table = WEATHER[sname]
        if sname == "春" and sd < yk["late_spring"]:
            table = WEATHER["冬"]
        if sname == "秋" and sd >= sn - yk["early_frost"]:
            table = WEATHER["冬"]
        w = "D" if worst else sky.draw(table, yk["bad"])

        wn = max(1, WOOD_USE[sname]["正常"] - p["window"] - p["bedding"])
        wt = tier(wood / wn, wt, p["thrift"], p["thrift_exit"], p["rich"], p["rich_exit"])
        ft = tier(food / 3, ft, p["thrift"], p["thrift_exit"], p["rich"], p["rich_exit"])
        order = ["俭", "正常", "丰足"]
        mood = order[min(order.index(wt), order.index(ft))]

        # 菜地：春夏秋，暴风雪天不长；春迟年头几天种不了
        grow_ok = sname != "冬" and not (sname == "春" and sd < 1 + yk["late_spring"])
        frost = sname == "秋" and sd >= sn - yk["early_frost"]
        for i, left in enumerate(plots):
            if left is None:
                days_left = sum(n for nm, n in SEASONS[1:]) - (day % YEAR - 24)
                if grow_ok and w != "D" and days_left > p["crop_days"]:
                    plots[i] = p["crop_days"]
            else:
                if w != "D" and sname != "冬":
                    left -= 1
                if sname == "冬":
                    plots[i] = None      # 入冬没收的就没了
                elif left <= 0:
                    y = p["crop_yield"] + p["fence"] - (1 if frost else 0)
                    food = min(p["food_cap"], food + y); plots[i] = None
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

        # 活计：上午一件；有一样在俭，下午再加一件
        autumn = sname == "秋"
        wtarget = p["wood_cap"] if autumn else min(p["wood_cap"], p["target_days"] * wn)
        ftarget = p["food_cap"] if autumn else min(p["food_cap"], p["target_days"] * 3)
        slots = 1 + (1 if mood == "俭" else 0)
        did = False
        for _ in range(slots):
            wdays = wood / wn; fdays = food / 3
            if w in "AB":
                wneed = wood < wtarget; fneed = food < ftarget
                if not (wneed or fneed):
                    break
                pick = "wood" if (wneed and (not fneed or wdays <= fdays)) else "food"
                if pick == "wood":
                    wood = min(p["wood_cap"], wood + p["wood_yield"][w]); chores["柴"] += 1
                else:
                    food = min(p["food_cap"], food + p["food_yield"][sname][w]); chores["粮"] += 1
                did = True
            else:
                # 出不了院子：库存偏紧才做檐下活计（柴粮各一次算一件）
                if wdays < p["tight_days"] or fdays < p["tight_days"]:
                    if wdays < p["tight_days"]:
                        wood = min(p["wood_cap"], wood + p["min_wood"])
                    if fdays < p["tight_days"]:
                        food = min(p["food_cap"], food + p["min_food"])
                    chores["檐下"] += 1; did = True
        if did:
            chores["有活计的天"] += 1

        # 用度
        wuse = WOOD_USE[sname][wt] - p["window"] - p["bedding"]
        if w == "D" and wt != "俭":
            wuse += p["storm_extra"]
        wuse = max(1, wuse)
        fuse = FOOD_USE[ft]
        if wood < wuse:
            shortfall += wuse - wood; wood = 0
        else:
            wood -= wuse
        if food < fuse:
            shortfall += fuse - food; food = 0
        else:
            food -= fuse

        stats[mood] += 1; per_season[(sname, mood)] += 1; yc[mood] += 1
        if mood == "俭":
            cur_run += 1
        elif cur_run:
            thrift_runs.append(cur_run); cur_run = 0
        if log is not None:
            log.append((day, sname, w, wt, ft, round(wood), round(food)))
    if cur_run:
        thrift_runs.append(cur_run)
    return dict(stats=stats, per_season=per_season, runs=thrift_runs, shortfall=shortfall,
                chores=chores, days=years * YEAR, per_year=per_year)


def report(title, params, wood0, food0, years=8, n=300, repairs_at=None):
    tot = Counter(); ps = Counter(); runs = []; sf = 0; ch = Counter(); days = 0
    by_kind = {}
    worst_year = 0
    for s in range(n):
        r = run(years, s, params, wood0, food0, repairs_at)
        tot += r["stats"]; ps += r["per_season"]; runs += r["runs"]; sf += r["shortfall"]
        ch += r["chores"]; days += r["days"]
        for kind, yc in r["per_year"]:
            by_kind.setdefault(kind, Counter()).update(yc)
            worst_year = max(worst_year, yc["俭"])
    print(f"\n== {title} ==")
    print("  总占比: " + "  ".join(f"{k} {tot[k]/days*100:.1f}%" for k in ["丰足", "正常", "俭"]))
    for sname, sn in SEASONS:
        t = sum(ps[(sname, k)] for k in ["丰足", "正常", "俭"])
        print(f"  {sname}: " + "  ".join(f"{k} {ps[(sname,k)]/t*100:.1f}%" for k in ["丰足", "正常", "俭"]))
    for kind, c in by_kind.items():
        t = sum(c.values())
        print(f"  [{kind}] " + "  ".join(f"{k} {c[k]/t*100:.1f}%" for k in ["丰足", "正常", "俭"]))
    if runs:
        runs.sort()
        print(f"  俭的段数/世界年: {len(runs)/(n*years):.2f}  中位 {runs[len(runs)//2]} 天  95分位 {runs[int(len(runs)*.95)]} 天  最长 {runs[-1]} 天")
    else:
        print("  没有出现俭")
    print(f"  单个世界年里俭最多的天数: {worst_year}")
    print(f"  用度缺口合计: {sf}")
    print("  活计占天数: " + "  ".join(f"{k} {v/days*100:.0f}%" for k, v in ch.items()))


if __name__ == "__main__":
    report("开局，无修缮，无探索（柴 60 粮 45 起）", {}, 60, 45)
    report("基础修缮全修好（窗缝、柴棚、地窖、篱笆）", BASE_REPAIRS, 60, 45)
    full = dict(BASE_REPAIRS); full.update(EXT_REPAIRS)
    report("基础加拓展（再加暖棚、床褥窗帘）", full, 60, 45)
    report("渐进：第 20、45、70、100 天各修好一件基础修缮", {}, 60, 45,
           repairs_at={20: dict(window=1), 45: dict(food_cap=90), 70: dict(wood_cap=120), 100: dict(fence=1)})
    # 压力：库存清零、入冬第一天、连续风雪年
    report("压力：库存清零起步（柴 0 粮 0）", {}, 0, 0, years=2)
    # 结构约束：永远是暴风雪
    r = run(1, 0, {}, 0, 0, worst=True)
    print("\n== 结构约束：库存 0，一整年天天暴风雪 ==")
    print("  用度缺口:", r["shortfall"], " 状态:", dict(r["stats"]))
    log = []
    run(1, 7, {}, 60, 45, log=log)
    if "-v" in sys.argv:
        for row in log:
            print(row)
