#!/usr/bin/env python3
# coding: utf-8
"""Export independent transparent PNGs from the editable 05 SVG mother scene.

Dependencies: pip install lxml cairosvg pillow
Run: python 设计/原型/05_v0.5_透明图层导出.py --svg 设计/原型/05_雪夜木屋_高保真分层母场景_v0.4.svg --out .art-v0.5-layers --scale 2 --trim

The SVG is the fact source for paint order. PNGs are artwork, NOT evidence of
world events. Canvas coordinate system is fixed at 480x270. No game saves.
"""
from __future__ import annotations

import argparse
from copy import deepcopy
from hashlib import sha256
from io import BytesIO
import json
from pathlib import Path

import cairosvg
from lxml import etree
from PIL import Image, ImageChops, ImageStat

NS_URI = "http://www.w3.org/2000/svg"
NS = "{" + NS_URI + "}"
CANVAS = (480, 270)
# Make genuinely independent mutable layers; preserve their original paint order.
NESTED = ("woodpile", "jar_fill_example", "hi_fi_knit_detail")
CROPS = {
    "window": (41, 98, 228, 128),
    "hearth": (309, 106, 165, 94),
}


def tag(name: str) -> str:
    return NS + name


def layer_doc(source, group):
    doc = etree.Element(tag("svg"), nsmap={None: NS_URI})
    for key, value in source.attrib.items():
        doc.set(key, value)
    for child in source:
        if child.tag == tag("defs"):
            doc.append(deepcopy(child))
    doc.append(deepcopy(group))
    return doc


def groups(source):
    items, seen = [], set()
    for orig in source:
        if orig.tag != tag("g"):
            continue
        group = deepcopy(orig)
        name = group.get("id")
        if not name or name in seen:
            raise ValueError(f"Duplicate/missing scene layer ID: {name}")
        seen.add(name)
        extracted = []
        for ident in NESTED:
            matches = group.xpath('.//svg:g[@id=$target]', namespaces={"svg": NS_URI}, target=ident)
            if not matches:
                continue
            if len(matches) != 1 or matches[0].getparent() is not group:
                raise ValueError(f"Layer {ident} has unsupported nesting")
            if any(x in group.attrib for x in ("transform", "clip-path", "opacity", "filter", "mask")):
                raise ValueError(f"Parent {name} has inherited transforms requiring explicit splitting")
            copy = deepcopy(matches[0])
            matches[0].getparent().remove(matches[0])
            extracted.append((ident, copy))
        items.append((name, group, None))
        for ident, nested in extracted:
            if ident in seen:
                raise ValueError(f"Duplicate layer ID: {ident}")
            seen.add(ident)
            items.append((ident, nested, name))
    if not items:
        raise ValueError("No SVG <g id> layers")
    return items


def raster(elem):
    data = etree.tostring(elem, encoding="utf-8", xml_declaration=True)
    png = cairosvg.svg2png(bytestring=data, output_width=480, output_height=270)
    return Image.open(BytesIO(png)).convert("RGBA")


def save(im, path, scale):
    if scale > 1:
        im = im.resize((im.width * scale, im.height * scale), Image.Resampling.NEAREST)
    im.save(path)


def crops(source, output):
    # Compare visually pleasing current crop vs a strict-integer-scale candidate.
    variants = [
        ("window_nearest_320", (41, 98, 228, 128), (320, 180), False),
        ("window_integer_320", (0, 52, 320, 180), (320, 180), True),
        ("window_nearest_480", (41, 98, 228, 128), (480, 270), False),
        ("window_integer_480", (35, 94, 240, 135), (480, 270), True),
        ("hearth_nearest_320", (309, 106, 165, 94), (320, 180), False),
        ("hearth_integer_320", (160, 52, 320, 180), (320, 180), True),
    ]
    result = []
    for name, (x, y, w, h), target, integer in variants:
        if x < 0 or y < 0 or x + w > 480 or y + h > 270:
            raise ValueError(f"Out of bounds crop: {name}")
        im = source.crop((x, y, x + w, y + h)).resize(target, Image.Resampling.NEAREST)
        im.save(output / (name + ".png"))
        result.append({"name": name, "source_rect": [x, y, w, h],
                       "output_size": list(target), "strict_integer_scale": integer})
    return result


def run(input_path, output, scale=2, trim=False, add_crops=True):
    output.mkdir(parents=True, exist_ok=True)
    source_bytes = input_path.read_bytes()
    parser = etree.XMLParser(resolve_entities=False, no_network=True)
    svg = etree.fromstring(source_bytes, parser)
    if svg.tag != tag("svg"):
        raise ValueError("Not a valid SVG")
    if [float(i) for i in svg.get("viewBox", "").split()] != [0, 0, 480, 270]:
        raise ValueError("The mother scene must use 480x270 logical coordinates")
    source_image = raster(svg)
    reconstructed = Image.new("RGBA", CANVAS)
    manifest = {
        "schema": "beyond-the-storm.art-layers.v0.5",
        "status": "prototype extraction; not final sprite animation",
        "source": input_path.name, "source_sha256": sha256(source_bytes).hexdigest(),
        "logical_size": list(CANVAS), "scale": scale, "layers": [], "camera_crops": [],
    }
    for order, (name, group, parent) in enumerate(groups(svg)):
        # Export deliberately hidden candidate art as visible standalone pixels;
        # do NOT show it in the reconstructed default scene.
        default_visible = group.get("display") != "none"
        export_group = deepcopy(group)
        if not default_visible:
            export_group.attrib.pop("display", None)
        picture = raster(layer_doc(svg, export_group))
        if default_visible:
            reconstructed = Image.alpha_composite(reconstructed, picture)
        filename = f"{order:02d}_{name}.png"
        save(picture, output / filename, scale)
        box = picture.getchannel("A").getbbox()
        layer = {"id": name, "order": order, "file": filename,
                 "canvas_size": [480 * scale, 270 * scale],
                 "unscaled_alpha_bbox": list(box) if box else None,
                 "parent_from_svg": parent,
                 "state_inputs": group.get("data-inputs"),
                 "candidate_status": group.get("data-status"),
                 "default_visible": default_visible}
        if trim and box:
            filename2 = f"{order:02d}_{name}.trim.png"
            save(picture.crop(box), output / filename2, scale)
            layer["trim_file"] = filename2
            layer["trim_anchor_scaled"] = [box[0] * scale, box[1] * scale]
        manifest["layers"].append(layer)
    save(source_image, output / "source_preview.png", scale)
    save(reconstructed, output / "recomposed_preview.png", scale)
    difference = ImageChops.difference(source_image, reconstructed)
    stats = ImageStat.Stat(difference)
    manifest["verification"] = {
        "exact_rgba_match": all(ch.getextrema() == (0, 0) for ch in difference.split()),
        "mean_channel_abs_diff": [round(v, 5) for v in stats.mean],
        "max_channel_abs_diff": [max(x.getextrema()) for x in difference.split()],
        "note": "Antialiasing and alpha can produce minor differences on separate-layer composite",
    }
    if add_crops:
        manifest["camera_crops"] = crops(source_image, output)
    (output / "manifest.json").write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return manifest


if __name__ == "__main__":
    p = argparse.ArgumentParser(description="Export the 05 v0.4 SVG into transparent PNG layers")
    p.add_argument("--svg", type=Path, required=True)
    p.add_argument("--out", type=Path, default=Path(".art-v0.5-layers"))
    p.add_argument("--scale", type=int, default=2, choices=range(1, 9))
    p.add_argument("--trim", action="store_true")
    p.add_argument("--no-crops", action="store_true")
    args = p.parse_args()
    if not args.svg.is_file():
        p.error(f"SVG not found: {args.svg}")
    result = run(args.svg, args.out, args.scale, args.trim, not args.no_crops)
    print(json.dumps({"layers": len(result["layers"]), "verification": result["verification"],
                      "output": str(args.out)}, ensure_ascii=False, indent=2))
