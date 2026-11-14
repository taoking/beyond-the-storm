#!/usr/bin/env python3
"""Verify and (on --apply) import the G1 female source PNGs from ChatGPT ZIP.

This script does not push/commit and never copies preview/comparison images.
Run at the repository root:
  python3 "设计/原型/05_G1_女性角色素材导入.py" ~/Downloads/beyond_storm_G1_female_character_review_20261114.zip
  python3 "设计/原型/05_G1_女性角色素材导入.py" ~/Downloads/beyond_storm_G1_female_character_review_20261114.zip --apply
"""
from __future__ import annotations
import argparse
import hashlib
import struct
import zipfile
from pathlib import Path

BASE = Path(__file__).resolve().parents[2]
OUT = "assets/05/actor/indoor/female/"
SOURCES = {
  "sources/female_indoor_four_pose_source.png":
    ("identity_sheet.png", "5bbcf924dc2f3f0ba2c1cbd6912393c234275afe3a455d40b036325fbc0b7fcd", (1312, 1199)),
  OUT + "sleep.png":
    ("sleep.png", "6808edb1721b80863021e7706bc5cc020a42bf592a47b176fb1f2dc9498da918", (1672, 941)),
  OUT + "sitRead.png":
    ("sitRead.png", "8fec3cf04843438d0bcf924e3398221ca1bc1a826e6938375bc76148fd335f67", (1672, 941)),
  OUT + "sitWrite.png":
    ("sitWrite.png", "3776d5420588f448ee6c11d774cb716e6ae60639b7df7e6ed39578eb164f7b4b", (1672, 941)),
  OUT + "standWork.png":
    ("standWork.png", "45c10f1f4f9c14fad8038a3dc1c1a697b6e4d0cc34a2974e3226300a81578f79", (1672, 941)),
}

def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("zip_file", type=Path)
    ap.add_argument("--apply", action="store_true", help="Write verified PNG files to assets/05 (default: dry-run)")
    ap.add_argument("--force", action="store_true", help="Replace different existing PNGs (requires --apply)")
    args = ap.parse_args()
    verified: list[tuple[Path, bytes]] = []
    with zipfile.ZipFile(args.zip_file) as z:
        for archive_path, (name, expected_sha, dims) in SOURCES.items():
            data = z.read(archive_path)
            sha = hashlib.sha256(data).hexdigest()
            if sha != expected_sha:
                raise SystemExit(f"Checksum mismatch: {archive_path} expected {expected_sha}, got {sha}")
            if data[:8] != bytes.fromhex("89504e470d0a1a0a"):
                raise SystemExit(f"Not PNG: {archive_path}")
            w, h = struct.unpack(">II", data[16:24])
            if (w, h) != dims or data[25] != 6:  # PNG color type 6 = RGBA
                raise SystemExit(f"Wrong image size/color type for {archive_path}: {(w, h)}, {data[25]}")
            dest = BASE / OUT / name
            if dest.exists() and dest.read_bytes() != data and not args.force:
                raise SystemExit(f"Refusing to replace existing different art: {dest}; use --force deliberately")
            verified.append((dest, data))
            print(f"verified {archive_path} -> {dest.relative_to(BASE)} ({len(data)} bytes)")
    if args.apply:
        for path, data in verified:
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(data)
        print("Five source/alpha PNGs imported. Review then git add/commit/push them yourself.")
    else:
        print("Dry run passed. Add --apply to install only these five source PNGs.")

if __name__ == "__main__":
    main()
