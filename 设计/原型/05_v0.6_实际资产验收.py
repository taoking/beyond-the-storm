#!/usr/bin/env python3
# coding: utf-8
"""Check real 05 v0.4 artwork export and actual Chromium frame screenshots.

This validates facts about generated files and pixel compositing, not subjective art
quality or the real gameplay/engine state.
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path
import sys
from PIL import Image, ImageChops, ImageStat


REQUIRED_LAYERS = {
    "interior_base", "window_weather", "window_frame",
    "static_furniture", "woodpile", "jar_state", "jar_fill_example",
    "actor_indoor", "hi_fi_knit_detail", "stove_fire",
    "hi_fi_light_pixels", "lighting_overlay",
}


def validate(manifest_path: Path, screenshot_report: Path):
    m = json.loads(manifest_path.read_text("utf-8"))
    s = json.loads(screenshot_report.read_text("utf-8"))
    export_dir = manifest_path.parent
    screenshot_dir = screenshot_report.parent

    layers = m["layers"]
    ids = [row["id"] for row in layers]
    if len(set(ids)) != len(ids):
        raise AssertionError("Duplicate art layer IDs")
    if not REQUIRED_LAYERS.issubset(ids):
        raise AssertionError(f"Missing layers: {sorted(REQUIRED_LAYERS - set(ids))}")

    for layer in layers:
        p = export_dir / layer["file"]
        if not p.is_file():
            raise AssertionError(f"Missing rendered PNG {p}")
        with Image.open(p) as im:
            if im.mode != "RGBA":
                raise AssertionError(f"Layer {p.name} is not RGBA")
            size = (480 * m["scale"], 270 * m["scale"])
            if im.size != size:
                raise AssertionError(f"Layer {p.name} dimensions {im.size} != {size}")
            if layer["unscaled_alpha_bbox"] is None:
                # Empty deliberately hidden candidate art is allowed.
                continue
            if layer.get("trim_file"):
                trim = export_dir / layer["trim_file"]
                if not trim.is_file():
                    raise AssertionError(f"Missing trimmed PNG {trim}")
                if layer.get("trim_anchor_scaled") is None:
                    raise AssertionError(f"Trimmed PNG {trim.name} has no anchor")

    src = Image.open(export_dir / "source_preview.png").convert("RGBA")
    recomposed = Image.open(export_dir / "recomposed_preview.png").convert("RGBA")
    if src.size != recomposed.size:
        raise AssertionError("Recomposed PNG differs in dimensions")
    diff = ImageChops.difference(src, recomposed)
    extrema = [max(ch.getextrema()) for ch in diff.split()]
    mean = list(ImageStat.Stat(diff).mean)
    # CairoSVG rasterizes individual translucent layers separately. Tiny alpha
    # rounding is permissible; large discrepancies are not.
    if max(mean) > 3.0 or max(extrema) > 64:
        raise AssertionError(f"Layer recomposition exceeded tolerance: mean={mean}, max={extrema}")
    if all(e == 0 for e in extrema):
        fidelity = "pixel-exact"
    else:
        fidelity = "minor alpha/compositing differences; inspect diff"

    views = s["browsers"].get("chromium", {}).get("screens", [])
    expected = {(w, h, camera) for w, h in ((320, 180), (480, 270), (1280, 720))
                for camera in ("wide", "window", "hearth")}
    actual = {(row["window"][0], row["window"][1], row["camera"]) for row in views}
    if not expected.issubset(actual):
        raise AssertionError(f"Missing screenshot matrix entries: {sorted(expected - actual)}")
    for row in views:
        shot = Path(row["file"])
        if not shot.is_file():
            shot = screenshot_dir / shot.name
        if not shot.is_file():
            raise AssertionError(f"Missing Chromium screenshot: {row['file']}")
        with Image.open(shot) as im:
            if im.size != tuple(row["window"]):
                raise AssertionError(f"Bad screenshot dimensions {shot}: {im.size}")

    return {
        "source_sha256": m["source_sha256"],
        "layers_exported": len(layers),
        "required_layers_found": len(REQUIRED_LAYERS),
        "recomposition": fidelity,
        "channel_abs_mean": [round(v, 4) for v in mean],
        "channel_abs_max": extrema,
        "chromium_matrix": len(expected),
        "screenshot_files": len(views),
        "gameplay_engine_verified": False,
        "real_safari_verified": False,
        "art_quality_acceptance": "manual review required",
    }


def main():
    arg = argparse.ArgumentParser()
    arg.add_argument("--manifest", type=Path, required=True)
    arg.add_argument("--screenshot-report", type=Path, required=True)
    arg.add_argument("--out", type=Path)
    args = arg.parse_args()
    result = validate(args.manifest, args.screenshot_report)
    result_str = json.dumps(result, indent=2, ensure_ascii=False)
    if args.out:
        args.out.parent.mkdir(parents=True, exist_ok=True)
        args.out.write_text(result_str + "\n", encoding="utf-8")
    print(result_str)
    return 0


if __name__ == "__main__":
    sys.exit(main())
