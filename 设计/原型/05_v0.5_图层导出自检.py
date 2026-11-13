#!/usr/bin/env python3
# coding: utf-8
"""Offline self-test for 05 SVG layer exporter. No actual world-data dependency.

Run: python 设计/原型/05_v0.5_图层导出自检.py
"""
from __future__ import annotations

import importlib.util
from pathlib import Path
import tempfile

from lxml import etree
from PIL import Image

ROOT = Path(__file__).resolve().parent
EXPORT = ROOT / "05_v0.5_透明图层导出.py"
NS = "http://www.w3.org/2000/svg"


def load_exporter():
    spec = importlib.util.spec_from_file_location("beyond_exporter_v05", EXPORT)
    if not spec or not spec.loader:
        raise RuntimeError("Unable to load exporter")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def fixture_svg():
    q = lambda name: "{" + NS + "}" + name
    root = etree.Element(q("svg"), nsmap={None: NS}, viewBox="0 0 480 270")
    def group(name, parent=root):
        return etree.SubElement(parent, q("g"), id=name)
    def r(parent, x, y, w, h, color):
        etree.SubElement(parent, q("rect"), x=str(x), y=str(y), width=str(w),
                         height=str(h), fill=color)
    g = group("interior_base")
    r(g, 0, 0, 480, 270, "#35434b")
    g = group("static_furniture")
    r(g, 20, 20, 100, 90, "#876448")
    nested = group("woodpile", g)
    r(nested, 35, 60, 14, 15, "#c9ad81")
    g = group("jar_state")
    r(g, 120, 80, 20, 25, "#90b4c0")
    nested = group("jar_fill_example", g)
    r(nested, 125, 95, 10, 6, "#ad7749")
    g = group("actor_indoor")
    r(g, 205, 90, 48, 110, "#819085")
    nested = group("hi_fi_knit_detail", g)
    r(nested, 211, 110, 28, 2, "#decca5")
    g = group("far_worker_optional")
    g.set("display", "none")
    r(g, 340, 90, 8, 20, "#ac564b")
    return etree.tostring(root, encoding="utf-8", xml_declaration=True)


def main():
    exporter = load_exporter()
    with tempfile.TemporaryDirectory(prefix="beyond-v05-art-test-") as tmp:
        directory = Path(tmp)
        source = directory / "scene.svg"
        source.write_bytes(fixture_svg())
        result = exporter.run(source, directory / "out", scale=2, trim=True, add_crops=True)
        expected = [
            "interior_base", "static_furniture", "woodpile",
            "jar_state", "jar_fill_example", "actor_indoor", "hi_fi_knit_detail",
            "far_worker_optional"
        ]
        actual = [row["id"] for row in result["layers"]]
        assert actual == expected, (actual, expected)
        assert result["verification"]["exact_rgba_match"], result["verification"]
        assert len(result["camera_crops"]) == 6
        assert all((directory / "out" / row["file"]).exists() for row in result["layers"])
        assert all(row["unscaled_alpha_bbox"] is not None for row in result["layers"])
        optional = next(row for row in result["layers"] if row["id"] == "far_worker_optional")
        assert optional["default_visible"] is False
        assert (directory / "out" / optional["file"]).exists()
        assert Image.open(directory / "out" / optional["file"]).getchannel("A").getbbox()
        merged = Image.open(directory / "out" / "recomposed_preview.png")
        source_img = Image.open(directory / "out" / "source_preview.png")
        assert merged.size == (960, 540) == source_img.size
        assert merged.tobytes() == source_img.tobytes(), "Exported layers must reconstruct the source"
        for row in result["layers"]:
            if row.get("trim_file"):
                cropped = Image.open(directory / "out" / row["trim_file"])
                assert cropped.width > 0 and cropped.height > 0
                assert row["trim_anchor_scaled"][0] >= 0
    print("PASS: 8 independent transparent layers, including invisible-but-exportable optional art")
    print("PASS: 2x RGBA pixel recomposition, anchors and 6 camera test crops")


if __name__ == "__main__":
    main()
