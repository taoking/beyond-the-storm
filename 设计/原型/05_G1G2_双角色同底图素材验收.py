#!/usr/bin/env python3
"""Verify G1/G2 male & female fixed-scene review ZIP. No Github write or game/ mutation.

python3 "设计/原型/05_G1G2_双角色同底图素材验收.py" ~/Downloads/beyond_storm_05_G1_G2_dual_actor_locked_scene_20261114.zip
python3 "设计/原型/05_G1G2_双角色同底图素材验收.py" ...zip --install
Requires Pillow (python3 -m pip install Pillow).
"""
from __future__ import annotations
import argparse
import hashlib
import io
import json
import zipfile
from pathlib import Path
from PIL import Image, ImageChops

KINDS = ("male", "female")
POSES = ("sleep", "sitRead", "sitWrite", "standWork")
BASE_SHA256 = "7f2d72e49c1a520358111845d71b026d041ede1da1d08febdec6d21ac70bbb66"
SIZE = (1672, 941)
REPO = Path(__file__).resolve().parents[2]

def main() -> None:
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("archive", type=Path)
    p.add_argument("--install", action="store_true", help="Copy only eight reviewed RGBA source layers to assets/05/review/ (not previews)")
    args = p.parse_args()
    ready = []
    with zipfile.ZipFile(args.archive, "r") as z:
        if z.testzip() is not None:
            raise RuntimeError("ZIP CRC check failed")
        scene = z.read("sources/scene_g2_mood_reference.png")
        sha = hashlib.sha256(scene).hexdigest()
        if sha != BASE_SHA256:
            raise RuntimeError("Not the locked G2 base: " + sha)
        base = Image.open(io.BytesIO(scene)).convert("RGB")
        if base.size != SIZE:
            raise RuntimeError("Wrong G2 base resolution")
        manifest = json.loads(z.read("manifest.json"))
        qa = json.loads(z.read("qa/qa.json"))
        if len(manifest["layers"]) != 8 or not manifest["sameBaseAcrossEight"]:
            raise RuntimeError("Eight image layers / stable base required")
        for sex in KINDS:
            for pose in POSES:
                name = f"assets/05/actor/indoor/{sex}/{pose}.png"
                preview = f"previews/{sex}_{pose}.png"
                data = z.read(name)
                layer = Image.open(io.BytesIO(data)).convert("RGBA")
                comp = Image.open(io.BytesIO(z.read(preview))).convert("RGB")
                if layer.size != SIZE or comp.size != SIZE or layer.getchannel("A").getbbox() is None:
                    raise RuntimeError("Missing alpha or wrong dimensions: " + name)
                expected = base.convert("RGBA")
                expected.alpha_composite(layer)
                if ImageChops.difference(expected.convert("RGB"), comp).getbbox():
                    raise RuntimeError("Composition differs from exactly one locked base: " + name)
                ready.append((name, data))
                print("PASS", sex, pose, len(data), "bytes", layer.getchannel("A").getbbox())
        if qa["outsideAlphaPixelsChanged"] != 0:
            raise RuntimeError("Unexpected changes outside actor masks")
    if args.install:
        destroot = REPO / "assets/05/review/g1_newlayout"
        for name, data in ready:
            pth = destroot / "/".join(name.split("/")[-2:])
            if pth.exists() and pth.read_bytes() != data:
                raise RuntimeError("Refusing to overwrite different art: " + str(pth))
            pth.parent.mkdir(parents=True, exist_ok=True)
            pth.write_bytes(data)
        print("Installed only the eight source RGBA layers to", destroot, "(manual review before git add)")
    print("VERIFIED: 8 scene-locked RGBA layers, 8 exact composites, G2 reference SHA, no invented production status")

if __name__ == "__main__":
    main()
