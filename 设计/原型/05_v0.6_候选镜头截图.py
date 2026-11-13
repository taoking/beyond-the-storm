#!/usr/bin/env python3
# coding: utf-8
"""Render the 05 v0.6 actual-SVG camera candidates in Chromium.

Run: python 设计/原型/05_v0.6_候选镜头截图.py
Requires: pip install playwright && python -m playwright install chromium

Screenshots are the art preview, not gameplay or a proof of stylistic quality.
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path
from playwright.sync_api import sync_playwright

HERE = Path(__file__).resolve().parent
HTML = HERE / "05_v0.6_真实截图后的小窗镜头比较.html"
CASES = [
    (320, "window", "recommended", [18, 68, 288, 162]),
    (480, "window", "recommended", [35, 94, 240, 135]),
    (320, "hearth", "recommended", [247, 82, 230, 129]),
    (480, "hearth", "recommended", [240, 78, 240, 135]),
    (1280, "wide", "recommended", [0, 0, 480, 270]),
    (320, "window", "current", [41, 98, 228, 128]),
    (320, "window", "integer", [0, 52, 320, 180]),
    (480, "window", "integer", [35, 94, 240, 135]),
]


def run(html: Path, output: Path):
    output.mkdir(parents=True, exist_ok=True)
    report = {"source": str(html), "chromium": [], "visual_acceptance": "pending human review"}
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page(viewport={"width": 1740, "height": 1060}, device_scale_factor=1)
        errors = []
        page.on("pageerror", lambda e: errors.append(str(e)))
        page.goto(html.resolve().as_uri(), wait_until="load")
        for width, camera, mode, source_rect in CASES:
            page.evaluate("([w,m,c]) => { size(w); pixelMode(m); window.camera(c); }",
                          [width, mode, camera])
            frame = page.locator("#art")
            bbox = frame.bounding_box()
            assert bbox is not None
            expected_height = width * 9 // 16
            assert (round(bbox["width"]), round(bbox["height"])) == (width, expected_height)
            svg = page.locator("#motherScene")
            actual_crop = [int(x) for x in svg.get_attribute("viewBox").split()]
            assert actual_crop == source_rect, f"{width}/{camera}/{mode}: {actual_crop}"
            file = output / f"chromium_{width}x{expected_height}_{camera}_{mode}.png"
            frame.screenshot(path=str(file))
            report["chromium"].append(
                {"window": [width, expected_height], "camera": camera, "mode": mode,
                 "source_rect": source_rect, "file": file.name})
            if camera == "window" and mode == "recommended":
                page.evaluate("layer('actor_indoor',false)")
                hidden = page.locator("#actor_indoor").evaluate(
                    "(e) => getComputedStyle(e).display === 'none'")
                assert hidden
                file2 = output / f"chromium_{width}x{expected_height}_empty_window.png"
                frame.screenshot(path=str(file2))
                page.evaluate("layer('actor_indoor',true)")
        assert not errors, errors
        browser.close()
    (output / "report.json").write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n",
                                         encoding="utf-8")
    print(json.dumps({"screenshots": len(report["chromium"]) + 2,
                      "candidate_crops_tested": len(report["chromium"]),
                      "errors": 0}, ensure_ascii=False))


if __name__ == "__main__":
    p = argparse.ArgumentParser()
    p.add_argument("--html", type=Path, default=HTML)
    p.add_argument("--output", type=Path, default=Path(".art-v0.6-candidate-screens"))
    a = p.parse_args()
    run(a.html, a.output)
