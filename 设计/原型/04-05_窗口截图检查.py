#!/usr/bin/env python3
# coding: utf-8
"""04 v1.4 / 05 v0.3 实尺寸 Chromium UI 检查。
Requires: pip install playwright && python -m playwright install chromium
Run: python 设计/原型/04-05_窗口截图检查.py
This does NOT validate 02 game rules or count real character activity.
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path
from playwright.sync_api import sync_playwright

HTML = Path(__file__).with_name("04-05_窗下书桌_窗口体验原型.html")


def geom_within(inner: dict, outer: dict, tolerance: float = 1.5) -> bool:
    return (
        inner["x"] >= outer["x"] - tolerance
        and inner["y"] >= outer["y"] - tolerance
        and inner["x"] + inner["width"] <= outer["x"] + outer["width"] + tolerance
        and inner["y"] + inner["height"] <= outer["y"] + outer["height"] + tolerance
    )


def run(html_path: Path, out_dir: Path, browsers: list[str]) -> dict:
    if not html_path.exists():
        raise FileNotFoundError(f"原型未找到: {html_path}")
    out_dir.mkdir(parents=True, exist_ok=True)
    report: dict = {"prototype": str(html_path.resolve()), "browsers": {}, "screenshots_are_game_frame_only": True}

    with sync_playwright() as p:
        for browser_name in browsers:
            browser_type = getattr(p, browser_name)
            browser = browser_type.launch(headless=True)
            context = browser.new_context(viewport={"width": 1760, "height": 1060}, device_scale_factor=1)
            page = context.new_page()
            errors: list[str] = []
            page.on("pageerror", lambda exc: errors.append(str(exc)))
            page.goto(html_path.resolve().as_uri(), wait_until="load")
            page.wait_for_timeout(220)
            results = []
            for size in (320, 480, 1280):
                page.locator(f"#size{size}").click()
                page.wait_for_timeout(200)
                frame = page.locator("#game")
                outer = frame.bounding_box()
                assert outer, f"{browser_name}/{size}：游戏窗口不可见"
                actual = [round(outer["width"]), round(outer["height"])]
                expected = [size, size * 9 // 16]
                assert all(abs(a - b) <= 1 for a, b in zip(actual, expected)), (
                    f"{browser_name}/{size}：实际窗口 {actual}，期望 {expected}"
                )
                controls = {}
                for control_id in ("clock", "focusButton", "todayButton", "mode"):
                    locator = page.locator("#" + control_id)
                    rect = locator.bounding_box()
                    assert rect and locator.is_visible(), f"{browser_name}/{size}：{control_id} 不可见"
                    controls[control_id] = geom_within(rect, outer)
                    assert controls[control_id], f"{browser_name}/{size}：{control_id} 被挤出窗口"

                prefix = out_dir / f"{browser_name}_{size}x{expected[1]}"
                frame.screenshot(path=str(prefix) + "_window.png")
                page.locator("#todayButton").click()
                assert page.locator("#todayCard").is_visible()
                frame.screenshot(path=str(prefix) + "_today.png")
                page.keyboard.press("Escape")
                assert not page.locator("#todayCard").is_visible()
                page.evaluate("window.simulateFinish(1,true)")
                assert page.locator("#roundSummary").is_visible()
                frame.screenshot(path=str(prefix) + "_round_end.png")
                page.evaluate("window.closeSummary()")

                page.evaluate("window.setActorOutside('empty')")
                frame.screenshot(path=str(prefix) + "_outdoor_empty.png")
                page.evaluate("window.setActorOutside('silhouette')")
                frame.screenshot(path=str(prefix) + "_outdoor_silhouette.png")
                page.evaluate("window.setActorOutside('home')")
                page.evaluate("window.setAction('tea')")
                frame.screenshot(path=str(prefix) + "_tea.png")
                page.evaluate("window.setAction('read')")

                results.append({"viewport": actual, "controls_within_frame": controls, "images": 6})

            if errors:
                raise AssertionError(f"{browser_name} 运行时错误: {errors}")
            report["browsers"][browser_name] = {"sizes": results, "javascript_errors": errors}
            context.close()
            browser.close()

    report_path = out_dir / "report.json"
    report_path.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return report


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--html", type=Path, default=HTML)
    parser.add_argument("--out-dir", type=Path, default=Path(".ui-review-screenshots"))
    parser.add_argument("--browsers", nargs="+", choices=["chromium", "webkit", "firefox"], default=["chromium"])
    args = parser.parse_args()
    summary = run(args.html, args.out_dir, args.browsers)
    print(json.dumps(summary, ensure_ascii=False, indent=2))
    print("注意：截图需人工检查人物是否被裁切、字号是否可读和背景层是否自然。")
