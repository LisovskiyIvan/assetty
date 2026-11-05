#!/usr/bin/env python3
"""Write manifest.json for a release dir: version + sha256 of every archive.

Usage: python3 tools/manifest.py <version> <dir>
The manifest lands next to the archives, so `gh release create tag dir/*`
publishes it with them. Shape (must match app/src/update.zig):
{"version":"X.Y.Z","files":{"<archive>":{"sha256":"..."}}}
"""
import hashlib
import json
import os
import sys

version, d = sys.argv[1], sys.argv[2]
files = {}
for name in sorted(os.listdir(d)):
    p = os.path.join(d, name)
    if not os.path.isfile(p) or name == "manifest.json":
        continue
    h = hashlib.sha256()
    with open(p, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    files[name] = {"sha256": h.hexdigest()}

with open(os.path.join(d, "manifest.json"), "w") as f:
    json.dump({"version": version, "files": files}, f, indent=2)
    f.write("\n")
print("manifest.json:", " ".join(sorted(files)))
