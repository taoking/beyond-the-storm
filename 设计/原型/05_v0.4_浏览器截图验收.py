#!/usr/bin/env python3
# coding: utf-8
"""05 v0.4 浏览器截图验收脚本（独立美术检视，不验证正式游戏模拟）。
运行前：pip install playwright && python -m playwright install chromium
执行：python 设计/原型/05_v0.4_浏览器截图验收.py
可用：python .../05_v0.4_浏览器截图验收.py --browsers chromium webkit
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path
from playwright.sync_api import sync_playwright

HTML = Path(__file__).with_name("05_v0.4_雪夜木屋_镜头与分层检视.html")
SIZES = ((320, 180), (480, 270), (1280, 720))
CAMERAS = ("wide", "window", "hearth")


def run(path: Path, output: Path, browser_names: list[str]) -> dict:
    output.mkdir(parents=True, exist_ok=True)
    records = {"source": str(path.resolve()), "browsers": {}, "mode": "visual study, not real game"}
    with sync_playwright() as pw:
        for name in browser_names:
            browser = getattr(pw, name).launch(headless=True)
            page = browser.new_page(viewport={"width": 1720, "height": 1080}, device_scale_factor=1)
            errors: list[str] = []
            page.on("pageerror", lambda err: errors.append(str(err)))
            page.goto(path.resolve().as_uri(), wait_until="load")
            page.wait_for_timeout(250)
            rows = []
            for w, h in SIZES:
                page.evaluate("(w) => size(w)", w)
                for camera in CAMERAS:
                    page.evaluate("(v) => window.camera(v)", camera)
                    art = page.locator("#art")
                    outer = art.bounding_box()
                    scene = page.locator(".art-stage").bounding_box()
                    assert outer and scene, f"{name}/{w}/{camera}: missing scene"
                    actual = [round(outer["width"]), round(outer["height"])]
                    assert actual == [w, h], f"{name}/{camera}: frame actual={actual}, expect={[w,h]}"
                    assert abs(scene["width"] - outer["width"]) <= 2 and abs(scene["height"] - outer["height"]) <= 2, (
                        f"{name}/{w}/{camera}: scene not full bleed: {scene} vs {outer}"
                    )
                    out = output / f"{name}_{w}x{h}_{camera}.png"
                    art.screenshot(path=str(out))
                    rows.append({"window": actual, "camera": camera, "file": str(out)})
                page.evaluate("camera('window')")
                page.evaluate("layer('actor_indoor',false)")
                assert page.locator("#actor_indoor").evaluate("(e) => getComputedStyle(e).display") == "none"
                art.screenshot(path=str(output / f"{name}_{w}x{h}_empty_window.png"))
                page.evaluate("layer('actor_indoor',true)")
            assert not errors, f"{name} JS page errors: {errors}"
            records["browsers"][name] = {"screens": rows, "errors": errors}
            browser.close()
    (output / "report.json").write_text(json.dumps(records, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return records


if __name__ == "__main__":
    arg = argparse.ArgumentParser()
    arg.add_argument("--html", type=Path, default=HTML)
    arg.add_argument("--output", type=Path, default=Path(".art-v0.4-screenshots"))
    arg.add_argument("--browsers", nargs="+", choices=("chromium", "webkit", "firefox"), default=["chromium"])
    a = arg.parse_args()
    if not a.html.exists():
        raise SystemExit(f"missing file: {a.html}")
    result = run(a.html, a.output, a.browsers)
    print(f"OK: {sum(len(v['screens']) for v in result['browsers'].values())} camera screenshots")
    print("这些截图仍需人工检查可读性、裁切和像素质量；不能由脚本断言艺术质量。")
