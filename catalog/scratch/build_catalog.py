"""Merge raw MCC JSON + scrape output + manual-review YAML into the final catalog.

Produces `catalog/mystic-city.json` in the schema documented in the design doc.
Each corset entry captures:
  - identity (id, name, url)
  - classification (silhouette_category picked from scraped silhouette_words,
    plus stretch_class from the manual review)
  - geometry (body_length_in from torso_length; above/below waist lengths are
    null in MVP — see design doc "Open Questions")
  - measurements array with one entry per measurement point (under-bust,
    upper-hip, low-hip), each with position_from_waist_in (negative above
    waist, positive below) and spring_in
  - variants[i].waist_sizes_in (per-variant offered sizes; no silhouette-level rollup)
  - materials array (parsed from title, for provenance)
  - silhouette_words array (raw scraped keyword list, for provenance)
  - source metadata (which sources contributed which fields)
"""

from __future__ import annotations

import datetime as dt
import json
import re
import sys
from pathlib import Path

import yaml

HERE = Path(__file__).parent
CATALOG = HERE.parent
JSON_PATH = CATALOG / "mystic-city-comparison-chart.raw.json"
URL_MAP_PATH = HERE / "url-to-design.json"
SCRAPED_PATH = HERE / "scraped-per-design.json"
REVIEW_PATH = CATALOG / "hip-positions.yaml"
PRODUCT_URLS_PATH = HERE / "product-urls.txt"
PER_VARIANT_SIZES_PATH = HERE / "per-variant-sizes.json"
OUT_PATH = CATALOG / "mystic-city.json"

sys.path.insert(0, str(HERE))
from stretch_class import classify as classify_stretch  # noqa: E402

# Slug qualifier words we strip from the variant name derivation.
NAME_STRIP_WORDS = {
    "corset", "corsets", "underbust", "overbust", "under-bust", "over-bust",
    "sample", "size", "with", "and",
}
# Numeric qualifiers to also strip (e.g. "-2", "sample-size-24").
NAME_STRIP_NUM_RE = re.compile(r"\b\d+\b")


def slug_of(url: str) -> str | None:
    m = re.match(r"^https://www\.mysticcitycorsets\.com/shop/([^/]+)/?$", url.strip())
    return m.group(1) if m else None


def derive_variant_name(slug: str, design_id: str) -> str:
    """Turn a URL slug like `mcc69-black-brocade-mesh-underbust-corset` into a
    friendly display name like `Black Brocade Mesh` by stripping the design_id
    prefix and common corsetry filler words.
    """
    up = slug.upper()
    did_up = design_id.upper()
    # Strip design_id prefix (dash-normalized fallback).
    if up.startswith(did_up):
        remainder = slug[len(did_up):]
    else:
        did_nd = did_up.replace("-", "")
        # Find where the design_id ends in the slug when dashes are normalized.
        # This mirrors the matcher logic in match_urls.py.
        consumed = 0
        matched = 0
        while matched < len(did_nd) and consumed < len(slug):
            ch = slug[consumed].upper()
            if ch != "-":
                matched += 1
            consumed += 1
        remainder = slug[consumed:] if matched == len(did_nd) else slug
    # Strip leading dash and any leading empty-suffix qualifiers like "-2"/"-a".
    remainder = remainder.lstrip("-")
    # Split on dashes, drop filler words + bare numbers, title-case the rest.
    tokens = [
        t for t in remainder.split("-")
        if t and t.lower() not in NAME_STRIP_WORDS and not NAME_STRIP_NUM_RE.fullmatch(t)
    ]
    name = " ".join(t.capitalize() for t in tokens).strip()
    return name or slug  # fall back to raw slug if we stripped everything

# Priority order for picking a single silhouette_category from the scraped
# silhouette_words. Highest priority = most specific.
SILHOUETTE_PRIORITY = [
    "waspie",       # length-specific: short
    "longline",     # length-specific: long
    "long torso",   # length-specific: long (variant)
    "pipestem",     # rib-specific
    "cupped rib",   # rib-specific
    "cupped ribs",  # rib-specific (plural variant)
    "conical",      # rib-specific
    "conical rib",  # rib-specific (variant)
    "conical ribs", # rib-specific (plural variant)
    "hourglass",    # overall shape
]

SILHOUETTE_ENUM_MAP = {
    "waspie": "waspie",
    "longline": "longline",
    "long torso": "longline",
    "pipestem": "pipestem",
    "cupped rib": "cupped-rib",
    "cupped ribs": "cupped-rib",
    "conical": "conical",
    "conical rib": "conical",
    "conical ribs": "conical",
    "hourglass": "hourglass",
}


def pick_silhouette_category(words: list[str]) -> str:
    """Return one canonical silhouette_category from the scraped word list."""
    normalized = {w.lower().strip() for w in words}
    for candidate in SILHOUETTE_PRIORITY:
        if candidate in normalized:
            return SILHOUETTE_ENUM_MAP[candidate]
    return "hourglass"  # safe default


def load_json_designs() -> dict[str, dict]:
    rows = json.loads(JSON_PATH.read_text())
    out: dict[str, dict] = {}
    for row in rows:
        key = row["value"]["design"].upper()
        # If dupes exist (raw JSON had MCC254 twice), later entries win —
        # they're identical rows so it doesn't matter.
        out[key] = row["value"]
    return out


def load_per_variant_sizes() -> dict[str, list[int]]:
    """Load per-variant scraped size lists. Returns {url: sizes}. URLs that
    errored (dict with 'error' key in the JSON) are treated as missing and
    excluded, since they have no reliable size data.
    """
    if not PER_VARIANT_SIZES_PATH.exists():
        return {}
    raw = json.loads(PER_VARIANT_SIZES_PATH.read_text())
    out: dict[str, list[int]] = {}
    for url, value in raw.items():
        if isinstance(value, list):
            out[url] = sorted(value)
    return out


def collect_variants_per_design(design_ids: list[str]) -> dict[str, list[dict]]:
    """Scan all sitemap product URLs, group SKUs under their design_id, and
    derive material+stretch_class per variant from the slug alone (no HTTP
    fetches needed — the material keywords live in the slug itself).
    Attaches per-variant waist_sizes_in from the per-variant size scrape.

    Returns { design_id: [ {name, url, materials, stretch_class,
                            waist_sizes_in}, ... ], ... }.
    """
    per_variant_sizes = load_per_variant_sizes()
    urls = [
        u.strip() for u in PRODUCT_URLS_PATH.read_text().splitlines()
        if u.strip() and "/shop/" in u and not u.rstrip("/").endswith("/shop")
    ]
    # Sort design IDs longest-first so MCC109-C wins over MCC109 for
    # slug `mcc109c-...` even after dash normalization.
    designs_sorted = sorted(design_ids, key=lambda s: (-len(s), s))

    def match_slug(slug: str) -> str | None:
        up = slug.upper()
        up_nd = up.replace("-", "")
        for did in designs_sorted:
            did_nd = did.replace("-", "")
            for haystack, needle in ((up, did), (up_nd, did_nd)):
                if haystack.startswith(needle):
                    # Boundary check on the original slug — the next char
                    # after the design ID (accounting for stripped dashes)
                    # must be '-' or end of string.
                    if haystack is up:
                        end_pos = len(needle)
                    else:
                        consumed = 0
                        matched = 0
                        while matched < len(needle) and consumed < len(up):
                            if up[consumed] != "-":
                                matched += 1
                            consumed += 1
                        end_pos = consumed
                    rest = up[end_pos:]
                    if rest == "" or rest.startswith("-"):
                        return did
        return None

    variants: dict[str, list[dict]] = {}
    for url in urls:
        slug = slug_of(url)
        if not slug:
            continue
        design_id = match_slug(slug)
        if not design_id:
            continue
        # Materials + stretch_class from the slug (treat dashes as spaces).
        slug_as_text = slug.replace("-", " ")
        stretch_cls, materials = classify_stretch(slug_as_text)
        name = derive_variant_name(slug, design_id)
        variants.setdefault(design_id, []).append({
            "name": name,
            "url": url,
            "materials": materials,
            "stretch_class": stretch_cls,
            "waist_sizes_in": per_variant_sizes.get(url, []),
        })

    # Sort variants within each design by (stretch_class order, name) for
    # stable output. low → medium → high.
    order = {"low": 0, "medium": 1, "high": 2}
    for did, vlist in variants.items():
        vlist.sort(key=lambda v: (order.get(v["stretch_class"], 99), v["name"]))
    return variants


def to_float(x, default=None):
    try:
        return float(x)
    except (TypeError, ValueError):
        return default


def build_entry(design_id: str, review_row: dict, json_row: dict,
                scrape_row: dict, variants: list[dict]) -> dict | None:
    """Assemble one catalog entry. Returns None if data is insufficient."""
    warnings = []

    rib_spring = to_float(json_row.get("rib_spring"))
    upper_hip_spring = to_float(json_row.get("upper_hip_spring"))
    low_hip_spring_raw = str(json_row.get("low_hip_spring", "-")).strip()
    low_hip_spring = (to_float(low_hip_spring_raw)
                      if low_hip_spring_raw not in ("-", "", "–") else None)
    underbust_length = to_float(json_row.get("underbust_length"))
    torso_length = to_float(json_row.get("torso_length"))

    upper_hip_position = to_float(review_row.get("upper_hip_position_in"))
    low_hip_position = review_row.get("low_hip_position_in")
    if low_hip_position is not None:
        low_hip_position = to_float(low_hip_position)
    # Note: review_row.get("stretch_class") is no longer used at silhouette level;
    # variants each carry their own stretch_class derived from their URL slug.
    # We record it in provenance only, so the user's review isn't silently
    # discarded.
    review_stretch_class = review_row.get("stretch_class")

    # Build measurements list — each with position (negative above waist) and
    # the corresponding spring, plus a human-readable label.
    measurements = []
    if underbust_length is not None and rib_spring is not None:
        measurements.append({
            "position_from_waist_in": -underbust_length,
            "spring_in": rib_spring,
            "label": "under-bust",
        })
    elif underbust_length is None or rib_spring is None:
        warnings.append(
            f"missing underbust_length or rib_spring; under-bust measurement dropped"
        )

    if upper_hip_position is not None and upper_hip_spring is not None:
        measurements.append({
            "position_from_waist_in": upper_hip_position,
            "spring_in": upper_hip_spring,
            "label": f"upper-hip ({upper_hip_position:g}in below waist)",
        })
    else:
        warnings.append(
            "missing upper_hip_position or upper_hip_spring; measurement dropped"
        )

    if low_hip_position is not None and low_hip_spring is not None:
        measurements.append({
            "position_from_waist_in": low_hip_position,
            "spring_in": low_hip_spring,
            "label": f"low-hip ({low_hip_position:g}in below waist)",
        })
    elif low_hip_position is not None and low_hip_spring is None:
        warnings.append(
            f"user provided low_hip_position={low_hip_position} but MCC JSON "
            "has no low_hip_spring — cannot form measurement"
        )
    elif low_hip_position is None and low_hip_spring is not None:
        warnings.append(
            f"JSON has low_hip_spring={low_hip_spring} but review has "
            "low_hip_position=null — cannot form measurement"
        )

    # Scrape-derived metadata.
    silhouette_words = scrape_row.get("silhouette_words") or []
    title = (scrape_row.get("title") or "").replace("\n", " ").strip()
    scraped_calibration = scrape_row.get("calibration")
    scraped_hardcoded = scrape_row.get("hardcoded_measurements")

    silhouette_category = pick_silhouette_category(silhouette_words)

    # Aggregate materials + stretch classes across variants. Sizes are per-variant
    # (see CorsetVariant.waist_sizes_in) — no silhouette-level rollup, since it
    # would be misleading (unioning what "the silhouette offers" hides real
    # per-color availability differences the ranking already accounts for).
    all_materials: set[str] = set()
    all_stretch_classes: set[str] = set()
    for v in variants:
        all_materials.update(v["materials"])
        all_stretch_classes.add(v["stretch_class"])
    materials_summary = sorted(all_materials)
    stretch_class_options = sorted(all_stretch_classes,
                                   key=lambda s: {"low": 0, "medium": 1, "high": 2}.get(s, 99))

    if not variants:
        warnings.append(
            "no product-page variants found in the sitemap for this design_id — "
            "the silhouette has fit data but no purchase URLs"
        )

    entry = {
        "id": design_id,
        "name": title or design_id,
        "url": review_row.get("url"),
        "silhouette_category": silhouette_category,
        "silhouette_words": silhouette_words,
        "body_length_in": torso_length,
        "above_waist_length_in": None,
        "below_waist_length_in": None,
        "measurements": measurements,
        "materials_summary": materials_summary,
        "stretch_class_options": stretch_class_options,
        "variants": variants,
        "notes": None,
        "provenance": {
            "raw_json": {
                "rib_spring": json_row.get("rib_spring"),
                "upper_hip_spring": json_row.get("upper_hip_spring"),
                "low_hip_spring": json_row.get("low_hip_spring"),
                "underbust_length": json_row.get("underbust_length"),
                "princess_seam": json_row.get("princess_seam"),
                "torso_length": json_row.get("torso_length"),
            },
            "scrape": {
                "sku": scrape_row.get("sku"),
                "calibration_from_page": scraped_calibration,
                "hardcoded_measurements_from_page": scraped_hardcoded,
            },
            "review_stretch_class_at_representative_variant": review_stretch_class,
            "warnings": warnings,
        },
    }
    return entry


def main():
    json_designs = load_json_designs()
    scraped = json.loads(SCRAPED_PATH.read_text())
    review = yaml.safe_load(REVIEW_PATH.read_text())

    # Collect all variant SKUs across the sitemap, grouped by design_id.
    design_ids_in_review = [r["design_id"] for r in review["designs"]]
    variants_by_design = collect_variants_per_design(design_ids_in_review)

    corsets = []
    per_entry_warnings = []
    for review_row in review["designs"]:
        design_id = review_row["design_id"]
        # Look up the JSON row, allowing dash-normalized fallback.
        json_row = json_designs.get(design_id)
        if not json_row:
            for k, v in json_designs.items():
                if k.replace("-", "") == design_id.replace("-", ""):
                    json_row = v
                    break
        if not json_row:
            per_entry_warnings.append(
                f"{design_id}: no matching row in raw JSON — skipping"
            )
            continue

        scrape_row = scraped.get(design_id, {})
        if not scrape_row:
            per_entry_warnings.append(
                f"{design_id}: no matching entry in scraped-per-design.json"
            )
            scrape_row = {}

        variants = variants_by_design.get(design_id, [])
        entry = build_entry(design_id, review_row, json_row, scrape_row, variants)
        if entry:
            corsets.append(entry)
            if entry["provenance"]["warnings"]:
                for w in entry["provenance"]["warnings"]:
                    per_entry_warnings.append(f"{design_id}: {w}")

    corsets.sort(key=lambda c: c["id"])

    catalog = {
        "brand": "Mystic City Corsets",
        "brand_url": "https://mysticcitycorsets.com/",
        "brand_waist_slack_by_stretch_class_in": {
            "low": 0.5,
            "medium": 1.0,
            "high": 1.75,
        },
        "generated_at_iso": dt.datetime.now(dt.timezone.utc).isoformat(
            timespec="seconds"
        ),
        "sources": {
            "comparison_chart_json":
                "https://www.mysticcitycorsets.com/wp-admin/admin-ajax.php"
                "?action=wp_ajax_ninja_tables_public_action&table_id=18400"
                "&target_action=get-all-data",
            "product_sitemap": "https://www.mysticcitycorsets.com/product-sitemap.xml",
            "hip_positions": "manually reviewed against size-chart images",
            "stretch_class": "auto-classified from title materials + manual review",
        },
        "corsets": corsets,
    }

    OUT_PATH.write_text(json.dumps(catalog, indent=2))
    print(f"Wrote {OUT_PATH}")
    print(f"Corsets in catalog: {len(corsets)}")
    print(f"Warnings collected: {len(per_entry_warnings)}")
    for w in per_entry_warnings:
        print(f"  ⚠ {w}")

    # Also print a compact distribution summary.
    from collections import Counter
    print()
    print("--- Distribution ---")
    print("Silhouette categories:",
          dict(Counter(c["silhouette_category"] for c in corsets)))
    print("Silhouettes with stretch_class_options:")
    for options in ("['low']", "['medium']", "['high']", "['low', 'medium']",
                    "['low', 'medium', 'high']", "['medium', 'high']",
                    "['low', 'high']"):
        pass
    opts_dist = Counter(tuple(c["stretch_class_options"]) for c in corsets)
    for opts, n in sorted(opts_dist.items(), key=lambda x: (-x[1], x[0])):
        print(f"  {list(opts)}: {n}")
    print(f"Total variants across all silhouettes: "
          f"{sum(len(c['variants']) for c in corsets)}")
    print(f"Silhouettes with 0 variants (no product URLs found): "
          f"{sum(1 for c in corsets if not c['variants'])}")
    print("Corsets with low hip measurement:",
          sum(1 for c in corsets if any(
              m["label"].startswith("low-hip") for m in c["measurements"])))


if __name__ == "__main__":
    main()
