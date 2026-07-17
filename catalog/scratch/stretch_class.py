"""Classify a corset's stretch behavior from its product title's material words.

Rules of thumb (based on corsetry knowledge — see design doc):
- `high`   — mesh-dominant products (sport mesh, powernet, "mesh corset" with
             no other structural fabric mentioned). Waist can stretch 1.5-2".
- `medium` — hybrid materials: mesh combined with cotton/satin/brocade (a
             structural fabric alongside stretchy panels). Waist stretches
             ~1".  Most MCC corsets fall here.
- `low`    — no mesh keywords; structural-only fabrics (cotton, coutil,
             brocade, satin, PVC, vinyl, leather). Waist stretch ≤0.5".

Returned tuple: (stretch_class, materials_found).
`materials_found` is retained on the catalog record for provenance so a
future maintainer can see WHY a corset was classified as it was.
"""

from __future__ import annotations

import re
from typing import Iterable

# Structural (low-stretch) fabric keywords. Case-insensitive, whole word.
STRUCTURAL = {
    "coutil", "cotton", "brocade", "satin", "pvc", "vinyl",
    "leather", "denim", "silk", "linen", "twill", "velvet", "velveteen",
}
# Stretch-contributing keywords.
STRETCH = {
    "mesh", "powernet", "power net", "sport mesh", "sport-mesh",
    "elastane", "spandex", "lycra",
}
# Materials-adjacent keywords we want to record even if they don't determine
# the class (patterns / textures that hint at the base fabric).
PATTERN = {
    "floral", "peacock", "bird", "cherry", "printed", "metallic",
}


def _keywords_present(text: str, keywords: Iterable[str]) -> set[str]:
    lower = text.lower()
    found = set()
    for kw in keywords:
        # word-boundary match; kw may contain spaces / hyphens.
        pattern = r"(?<![a-z]){}(?![a-z])".format(re.escape(kw))
        if re.search(pattern, lower):
            found.add(kw)
    return found


def classify(title: str) -> tuple[str, list[str]]:
    """Return (stretch_class, materials_found) for a product title."""
    if not title:
        return ("medium", [])  # safe default when title is missing

    structural_hits = _keywords_present(title, STRUCTURAL)
    stretch_hits = _keywords_present(title, STRETCH)

    materials = sorted(structural_hits | stretch_hits)

    if stretch_hits and not structural_hits:
        return ("high", materials)
    if stretch_hits and structural_hits:
        return ("medium", materials)
    if structural_hits:
        return ("low", materials)
    # No recognized material words — safe default.
    return ("medium", materials)


if __name__ == "__main__":
    import sys
    for line in sys.stdin:
        title = line.strip()
        if not title:
            continue
        cls, mats = classify(title)
        print(f"{cls:6} | {','.join(mats) or '-':30} | {title}")
