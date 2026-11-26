#!/usr/bin/env python3
"""Zips the demo vault with UTF-8 file names (zipfile sets the UTF-8 flag), deterministic timestamps. Usage: zip-vault.py <vaultDir> <out.zip>"""
import os, sys, zipfile
src, out = sys.argv[1], sys.argv[2]
base = os.path.basename(src.rstrip('/'))
with zipfile.ZipFile(out, 'w', zipfile.ZIP_DEFLATED, compresslevel=9) as z:
    for root, dirs, files in os.walk(src):
        dirs.sort()
        for f in sorted(files):
            p = os.path.join(root, f)
            arc = os.path.join(base, os.path.relpath(p, src))
            zi = zipfile.ZipInfo(arc, date_time=(2026, 11, 26, 0, 0, 0))
            zi.compress_type = zipfile.ZIP_DEFLATED
            zi.external_attr = 0o644 << 16
            with open(p, 'rb') as fh:
                z.writestr(zi, fh.read())
print(out)
