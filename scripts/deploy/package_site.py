#!/usr/bin/env python3
"""Build a deterministic, allowlisted static-site release without server-side code."""
import argparse
import hashlib
import io
import re
import subprocess
import tarfile
from pathlib import Path, PurePosixPath

ROOT = Path(__file__).resolve().parents[2]
ALLOWED = {
    "js": {".js"},
    "images": {".png", ".jpg", ".jpeg", ".svg", ".webp", ".gif", ".avif", ".ico"},
    "fonts": {".woff", ".woff2", ".ttf", ".otf", ".eot", ".svg", ".css", ".html"},
    "public/css": {".css", ".map", ".woff", ".woff2", ".ttf", ".eot", ".svg", ".html", ".docx"},
    "public/files": {".pdf", ".docx", ".html", ".css", ".woff", ".woff2", ".ttf", ".eot", ".svg", ".png", ".jpg", ".jpeg", ".webp", ".json", ".js"},
    "public/fonts": {".woff", ".woff2", ".ttf", ".otf", ".eot", ".svg", ".css", ".html"},
    "public/images": {".png", ".jpg", ".jpeg", ".svg", ".webp", ".gif", ".avif", ".ico"},
}
MAX_FILE_SIZE = 20 * 1024 * 1024
MAX_RELEASE_SIZE = 100 * 1024 * 1024


def is_deployable(path: str) -> bool:
    parts = PurePosixPath(path).parts
    if not parts or any(part in ("", ".", "..") or part.startswith(".") for part in parts):
        return False
    if not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9 /._-]*", path):
        return False
    if path == "index.html":
        return True
    return any(path.startswith(prefix + "/") and PurePosixPath(path).suffix.lower() in extensions
               for prefix, extensions in ALLOWED.items())


def build(out: Path, root: Path = ROOT) -> list[str]:
    paths = subprocess.check_output(["git", "ls-files", "-z"], cwd=root).decode().rstrip("\0").split("\0")
    candidates = sorted(path for path in paths if is_deployable(path))
    if "index.html" not in candidates:
        raise ValueError("index.html is missing from the tracked release")
    total = 0
    files = []
    for relative in candidates:
        source = root / relative
        if source.is_symlink() or any(parent.is_symlink() for parent in source.parents if parent != root):
            raise ValueError(f"Symlinks are prohibited: {relative}")
        if not source.is_file() or not source.resolve().is_relative_to(root.resolve()):
            raise ValueError(f"Invalid release file: {relative}")
        size = source.stat().st_size
        total += size
        if size > MAX_FILE_SIZE or total > MAX_RELEASE_SIZE:
            raise ValueError(f"Release size limit exceeded at {relative}")
        files.append((relative, source.read_bytes()))
    if b"</html>" not in dict(files)["index.html"].lower():
        raise ValueError("index.html does not have a closing HTML tag")

    manifest = ("\n".join(candidates) + "\n").encode()
    checksums = "".join(f"{hashlib.sha256(data).hexdigest()}  site/{name}\n" for name, data in files).encode()
    out.parent.mkdir(parents=True, exist_ok=True)
    with tarfile.open(out, mode="w:gz", format=tarfile.PAX_FORMAT) as archive:
        for name, data in [("manifest.txt", manifest), ("SHA256SUMS", checksums)] + [
            (f"site/{name}", data) for name, data in files
        ]:
            member = tarfile.TarInfo(name)
            member.size = len(data)
            member.mode = 0o644
            member.uid = member.gid = member.mtime = 0
            archive.addfile(member, io.BytesIO(data))
    return candidates


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--out", type=Path, required=True)
    args = parser.parse_args()
    selected = build(args.out)
    print(f"Created release with {len(selected)} allowed static files: {args.out}")
