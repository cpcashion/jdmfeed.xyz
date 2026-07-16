#!/usr/bin/env python3
"""
scripts/process-cutouts.py

Turns each listing's photo into a transparent cut-out of just the car, so the
card can float the car over its big chassis-code type. Runs in the refresh
job after fetch-listings; each new listing is processed once and cached by a
hash of its photo URL, so "real time as the feed grows" costs only the delta.

- Downloads listing.image_url
- Removes the background with rembg (U^2-Net salient-object model)
- Trims transparent margins so the car fills the frame
- Saves a compact WebP to app/public/cutouts/<hash>.webp
- Sets listing.cutout; prunes cut-outs no longer referenced by the feed

Pure-additive: on any failure for a listing, cutout is left empty and the
card falls back to the masked photo / paint gradient.
"""

import hashlib
import io
import json
import os
import sys
import urllib.request

import numpy as np
from PIL import Image
from scipy import ndimage

LISTINGS = os.path.join("app", "public", "listings.json")
CUT_DIR = os.path.join("app", "public", "cutouts")
UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36"
MAX_W = 900  # cap cut-out width; keeps WebP small

# Bump to invalidate every cached cut-out (feeds the filename hash).
CUT_VERSION = "v2"

os.makedirs(CUT_DIR, exist_ok=True)

with open(LISTINGS, encoding="utf-8") as f:
    data = json.load(f)
listings = data.get("listings", [])

# Lazy import so a rembg install problem is a clear, single failure.
from rembg import new_session, remove  # noqa: E402

# isnet-general-use segments object edges noticeably tighter than u2net —
# fewer background slivers around mirrors, spoilers, and wheel arches.
session = new_session("isnet-general-use")


def key_for(url: str) -> str:
    return hashlib.md5(f"{CUT_VERSION}|{url}".encode("utf-8")).hexdigest()[:16]


def clean_alpha(im: Image.Image) -> Image.Image:
    """Kill halos and detached background blobs so ONLY the car remains.

    - Faint alpha (<40) is halo noise, not car — zero it.
    - The segmenter often keeps disconnected fragments (poles, foliage,
      pavement corners). Keep the largest connected region plus anything at
      least 10% of its area (protects two-car photos and towed trailers that
      belong to the listing) and drop the rest.
    """
    a = np.asarray(im, dtype=np.uint8).copy()
    alpha = a[:, :, 3]
    alpha[alpha < 40] = 0
    mask = alpha > 0
    if mask.any():
        labels, n = ndimage.label(mask)
        if n > 1:
            sizes = ndimage.sum_labels(mask, labels, index=range(1, n + 1))
            keep = {i + 1 for i, s in enumerate(sizes) if s >= 0.10 * sizes.max()}
            drop = ~np.isin(labels, list(keep))
            alpha[drop] = 0
    a[:, :, 3] = alpha
    return Image.fromarray(a, "RGBA")


def fetch(url: str) -> bytes:
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=45) as r:
        return r.read()


referenced: set[str] = set()
made = 0
reused = 0
failed = 0

for l in listings:
    url = (l.get("image_url") or "").strip()
    l.setdefault("cutout", "")
    if not url.startswith("http"):
        continue
    name = key_for(url) + ".webp"
    out = os.path.join(CUT_DIR, name)
    rel = "cutouts/" + name
    referenced.add(name)

    if os.path.exists(out):
        l["cutout"] = rel
        reused += 1
        continue

    try:
        # post_process_mask smooths the mask morphologically (fast, no
        # pymatting); clean_alpha then removes halos + detached blobs.
        cut = remove(fetch(url), session=session, post_process_mask=True)
        im = clean_alpha(Image.open(io.BytesIO(cut)).convert("RGBA"))
        bbox = im.getbbox()  # trim transparent margins → car fills the frame
        if bbox:
            im = im.crop(bbox)
        if im.width > MAX_W:
            im = im.resize((MAX_W, round(im.height * MAX_W / im.width)))
        im.save(out, "WEBP", quality=82, method=6)
        l["cutout"] = rel
        made += 1
        print(f"cut  {l.get('title', '')[:48]}")
    except Exception as e:  # noqa: BLE001 — never fail the whole run for one car
        l["cutout"] = ""
        failed += 1
        print(f"FAIL {url} :: {e}", file=sys.stderr)

# Prune cut-outs the current feed no longer references (keeps repo bounded —
# the feed only ever shows currently-active listings).
for f in os.listdir(CUT_DIR):
    if f.endswith(".webp") and f not in referenced:
        os.remove(os.path.join(CUT_DIR, f))

with open(LISTINGS, "w", encoding="utf-8") as f:
    json.dump(data, f, indent=2)
    f.write("\n")

print(f"cutouts: {made} new, {reused} reused, {failed} failed, {len(referenced)} total")
