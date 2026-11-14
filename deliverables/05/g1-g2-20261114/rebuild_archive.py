#!/usr/bin/env python3
"""Restore the exact G1/G2 art ZIP from verified GitHub archive parts.

Run after cloning taoking/beyond-the-storm:
  python3 deliverables/05/g1-g2-20261114/rebuild_archive.py
  python3 deliverables/05/g1-g2-20261114/rebuild_archive.py --extract

No third-party dependencies, network access or Git credentials required.
"""
from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
from zipfile import ZipFile


def git_blob_sha1(data: bytes) -> str:
    h = hashlib.sha1()
    h.update(f"blob {len(data)}\0".encode("ascii"))
    h.update(data)
    return h.hexdigest()


def rebuild(root: Path, output: Path, extract: bool, force: bool) -> None:
    manifest = json.loads((root / "archive-manifest.json").read_text(encoding="utf-8"))
    entries = sorted(manifest["parts"], key=lambda item: item["index"])
    assert [item["index"] for item in entries] == list(range(len(entries))), "Missing or duplicate archive part"
    if output.exists() and not force:
        actual = hashlib.sha256(output.read_bytes()).hexdigest()
        if actual == manifest["expected_sha256"]:
            print(f"ZIP already verified: {output}")
        else:
            raise SystemExit(f"Refusing to replace an existing different file: {output}; add --force")
    else:
        output.parent.mkdir(parents=True, exist_ok=True)
        tmp = output.with_suffix(output.suffix + ".partial")
        if tmp.exists() and not force:
            raise SystemExit(f"Refusing to replace existing partial file: {tmp}; add --force")
        total = 0
        digest = hashlib.sha256()
        try:
            with tmp.open("wb") as out:
                for entry in entries:
                    relative = Path(entry["file"])
                    if relative.is_absolute() or ".." in relative.parts:
                        raise ValueError(f"Unsafe part path: {relative}")
                    part = root / relative
                    data = part.read_bytes()
                    if len(data) != entry["size"]:
                        raise ValueError(f"Wrong byte count for {part}: {len(data)}")
                    sha = git_blob_sha1(data)
                    if sha != entry["gitBlobSha1"]:
                        raise ValueError(f"Git blob hash mismatch for {part}: {sha}")
                    out.write(data)
                    digest.update(data)
                    total += len(data)
            if total != manifest["expected_bytes"] or digest.hexdigest() != manifest["expected_sha256"]:
                raise ValueError(f"Final ZIP SHA256 mismatch: {digest.hexdigest()} ({total} bytes)")
            tmp.replace(output)
        except BaseException:
            tmp.unlink(missing_ok=True)
            raise
        print(f"ZIP verified: {output}, {total:,} bytes, SHA256 {digest.hexdigest()}")

    with ZipFile(output, "r") as z:
        names = z.namelist()
        bad = z.testzip()
        if bad:
            raise ValueError(f"ZIP failed CRC check on {bad}")
        print(f"Archive CRC passed, {len(names)} files")
        if extract:
            dest = root / "extracted"
            dest.mkdir(exist_ok=True)
            for info in z.infolist():
                p = Path(info.filename)
                if p.is_absolute() or ".." in p.parts:
                    raise ValueError(f"Unsafe ZIP entry: {info.filename}")
                target = dest / p
                if target.exists() and not force:
                    raise SystemExit(f"Extracted destination exists: {target}; add --force")
                target.parent.mkdir(parents=True, exist_ok=True)
                if info.is_dir():
                    target.mkdir(parents=True, exist_ok=True)
                else:
                    with z.open(info) as src, target.open("wb") as dst:
                        import shutil
                        shutil.copyfileobj(src, dst)
            print(f"Extracted original lossless PNGs and all deliverables to: {dest}")


def main() -> None:
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--output", type=Path, help="Location of the reconstructed ZIP (default: alongside this script)")
    p.add_argument("--extract", action="store_true", help="Also extract the archived files into extracted/")
    p.add_argument("--force", action="store_true", help="Replace different existing ZIP/partial/extracted files")
    args = p.parse_args()
    root = Path(__file__).resolve().parent
    manifest = json.loads((root / "archive-manifest.json").read_text(encoding="utf-8"))
    rebuild(root, args.output or root / manifest["archive"], args.extract, args.force)


if __name__ == "__main__":
    main()