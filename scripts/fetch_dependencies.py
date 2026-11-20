"""Fetch the two pinned source archives, verifying their SHA-256 digests."""
from pathlib import Path, PurePosixPath
import hashlib
import io
import json
import urllib.request
import zipfile

ROOT = Path(__file__).resolve().parents[1]
for dependency in json.loads((ROOT / "third_party/dependencies.json").read_text()):
    destination = ROOT / "build/vendor" / dependency["name"]
    stamp = destination / ".archive-sha256"
    if stamp.exists() and stamp.read_text().strip() == dependency["sha256"]:
        print(f"Using cached {dependency['name']}")
        continue
    with urllib.request.urlopen(dependency["url"], timeout=60) as response:
        raw = response.read()
    if hashlib.sha256(raw).hexdigest() != dependency["sha256"]:
        raise RuntimeError(f"Archive hash mismatch: {dependency['name']}")
    with zipfile.ZipFile(io.BytesIO(raw)) as archive:
        for member in archive.infolist():
            parts = PurePosixPath(member.filename).parts
            if len(parts) < 2 or member.is_dir():
                continue
            relative = PurePosixPath(*parts[1:])
            if relative.is_absolute() or ".." in relative.parts:
                raise RuntimeError("Unsafe archive path")
            target = destination.joinpath(*relative.parts)
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(archive.read(member))
    stamp.write_text(dependency["sha256"] + "\n")
    print(f"Fetched and verified {dependency['name']}")
