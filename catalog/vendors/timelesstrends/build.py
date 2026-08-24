"""Merge TT products + sizing tables + landmark positions into
`catalog/timeless-trends.json` — same schema as MCC so the scoring engine
consumes both catalogs identically.

Grouping model: one catalog "silhouette" entry per sizing page, plus a
per-code override for `silhouette_category` (GCX → cupped-rib, GSX →
conical, even though they share the gemini sizing chart). Every product
whose `product_type` code maps to a sizing page becomes a variant of
that silhouette; its Shopify variant sizes are intersected with the
sizing page's `sizes_offered` to get the buyable set.

Overbust products (OSR, OHR) are skipped — the current scoring engine
only handles underbust silhouettes, and overbust needs a bust
circumference the underbust body model doesn't have.

Products with `product_type` outside our known code map (Accessories,
Obsolete, Gift Card, empty, one-off `LBS`, etc.) are dropped with a
logged reason.
"""

from __future__ import annotations

import datetime as dt
import json
import re
import sys
from collections import Counter
from pathlib import Path

import yaml

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from shared.stretch_class import classify as classify_stretch  # noqa: E402

HERE = Path(__file__).resolve().parent
DATA_DIR = HERE / "data"
CATALOG_DIR = HERE.parent.parent
PRODUCTS_PATH = DATA_DIR / "products.json"
SIZING_PATH = DATA_DIR / "sizing-tables.json"
POSITIONS_PATH = DATA_DIR / "positions.yaml"
OUT_PATH = CATALOG_DIR / "timeless-trends.json"

# TT publishes all corsets under a small set of 3-letter product-type
# codes. Middle letter = silhouette family (H=Hourglass, S=Slim);
# last letter = length (S=Short, R=Regular, L=Long, X=one-length Gemini).
# GCX is the one code that overrides silhouette_category away from
# what its sizing page would default to (cupped-rib rather than conical),
# since Gemini Cupped is meant to cup the rib.
CODE_OVERRIDES: dict[str, dict] = {
    "GCX": {"silhouette_category": "cupped-rib"},
    "GSX": {"silhouette_category": "conical"},
    "LIB": {"silhouette_category": "hourglass"},
    "NHR": {"silhouette_category": "hourglass"},
    "LBS": {"silhouette_category": "hourglass"},
}

# Codes we intentionally do NOT surface in the catalog. Overbust is out
# of MVP scope for the current scoring engine (see the design doc's
# "Open Questions" — overbust needs bust_circumference which the
# underbust body model doesn't carry).
EXCLUDED_CODES = {"OSR", "OHR"}

# TT's brand-level slack table. Starter values borrowed from MCC — TT's
# actual materials are almost all structural (cotton coutil / satin / silk
# / mesh-in-some-products), so the numbers should be close. Calibrate
# later if the scoring feels off for TT specifically.
DEFAULT_SLACK = {"low": 0.5, "medium": 1.0, "high": 1.75}


def _code_from_product_type(product_type: str) -> str | None:
    m = re.search(r"\(([A-Z]{2,4})\)", product_type or "")
    return m.group(1) if m else None


def _code_to_slug(sizing: dict) -> dict[str, str]:
    """Build reverse lookup: product_type_code -> sizing_page_slug."""
    out: dict[str, str] = {}
    for slug, row in sizing.items():
        for code in row.get("product_type_codes") or []:
            out[code] = slug
    return out


def _stretch_class_for_product(product: dict) -> tuple[str, list[str]]:
    """Reuse the shared classifier — feed it the product title, and if
    the title's material words are thin, fall back to tags."""
    title = (product.get("title") or "").strip()
    stretch, materials = classify_stretch(title)
    if not materials:
        # Try tags too — some TT titles are just "Green Fairy Corset..."
        # with the material in tags.
        tag_str = " ".join(product.get("tags") or [])
        stretch2, materials2 = classify_stretch(tag_str)
        if materials2:
            return stretch2, materials2
    return stretch, materials


def _variant_sizes(product: dict) -> list[int]:
    """Return the list of currently-buyable waist sizes for this product.
    A variant is available when `available` is True; we drop out-of-stock
    variants to match the "waist_sizes_in" semantic on MCC's catalog
    (sizes currently listed in the dropdown)."""
    sizes: set[int] = set()
    for v in product.get("variants") or []:
        if not v.get("available"):
            continue
        # Size can live in title, option1, or the Size option value.
        for candidate in (v.get("option1"), v.get("title")):
            if not candidate:
                continue
            m = re.search(r"\b(\d+)\b", str(candidate))
            if m:
                sizes.add(int(m.group(1)))
                break
    return sorted(sizes)


def _torso_length_from_description(product: dict) -> float | None:
    """Try to pull a torso-length number out of the product description
    body. TT prints "Center back: 12 1/4" - 13"" etc.; center-back is
    the closest analog to MCC's torso_length. If we can't find it,
    return None; the catalog entry just gets body_length_in=None."""
    body = product.get("body_html") or ""
    text = re.sub(r"<[^>]+>", " ", body)
    m = re.search(
        r"center\s*back\s*:?\s*(\d+(?:\s*\d+/\d+)?(?:\.\d+)?)",
        text, re.IGNORECASE,
    )
    if not m:
        return None
    return _parse_mixed_number(m.group(1))


def _parse_mixed_number(s: str) -> float | None:
    """Turn '12 1/4' -> 12.25, '13' -> 13.0, '9.5' -> 9.5."""
    s = s.strip()
    m = re.match(r"(\d+)\s+(\d+)/(\d+)$", s)
    if m:
        whole, num, den = map(int, m.groups())
        return whole + num / den
    m = re.match(r"(\d+)/(\d+)$", s)
    if m:
        num, den = map(int, m.groups())
        return num / den
    try:
        return float(s)
    except ValueError:
        return None


def _friendly_name(title: str, code: str | None) -> str:
    """Trim a title like 'Bed of Roses Straight Corset, Gemini Silhouette,
    Regular' down to the descriptive bit before the first comma. Keeps
    something recognizable per variant."""
    if not title:
        return code or ""
    first = title.split(",", 1)[0].strip()
    # Drop trailing "Corset" if present.
    first = re.sub(r"\s+Corset$", "", first, flags=re.IGNORECASE)
    return first or title


def build_variant(product: dict, code: str) -> dict:
    handle = product["handle"]
    url = f"https://timeless-trends.com/products/{handle}"
    stretch, materials = _stretch_class_for_product(product)
    sizes = _variant_sizes(product)
    return {
        "name": _friendly_name(product.get("title") or "", code),
        "url": url,
        "materials": materials,
        "stretch_class": stretch,
        "waist_sizes_in": sizes,
    }


def build_silhouette(
    slug: str,
    sizing_row: dict,
    positions_row: dict,
    variants_per_code: dict[str, list[dict]],
) -> dict | None:
    """One silhouette entry can bundle multiple product_type codes (e.g.
    GSX + GCX share gemini). But GCX has an override to `cupped-rib`,
    so when a slug has codes with different silhouette_categories we
    emit ONE silhouette per (slug, category) combination — same fit
    numbers, different category label."""
    codes = sizing_row.get("product_type_codes") or []
    if not codes:
        return None
    return None  # unused — main() emits per-code entries directly


def _measurements(sizing_row: dict, positions_row: dict) -> list[dict]:
    rib = sizing_row.get("rib_spring_in")
    hip = sizing_row.get("hip_spring_in")
    ub_pos = positions_row.get("underbust_position_in")
    hh_pos = positions_row.get("high_hip_position_in")
    measurements: list[dict] = []
    if rib is not None and ub_pos is not None:
        measurements.append({
            "position_from_waist_in": -ub_pos,
            "spring_in": rib,
            "label": "under-bust",
        })
    if hip is not None and hh_pos is not None:
        measurements.append({
            "position_from_waist_in": hh_pos,
            "spring_in": hip,
            "label": f"upper-hip ({hh_pos:g}in below waist)",
        })
    # TT has no low_hip — nothing to emit.
    return measurements


def main() -> None:
    if not PRODUCTS_PATH.exists() or not SIZING_PATH.exists():
        print("Missing inputs — run fetch_all_products.py + fetch_sizing_pages.py first.", file=sys.stderr)
        sys.exit(1)

    products = json.loads(PRODUCTS_PATH.read_text())
    sizing = json.loads(SIZING_PATH.read_text())
    positions_doc = yaml.safe_load(POSITIONS_PATH.read_text()) if POSITIONS_PATH.exists() else {}
    positions = positions_doc.get("silhouettes", {}) if positions_doc else {}
    code_to_slug = _code_to_slug(sizing)

    # Bucket products by product_type code.
    per_code: dict[str, list[dict]] = {}
    skipped_reasons: Counter = Counter()
    for handle, p in products.items():
        pt = p.get("product_type") or ""
        if not pt or not pt.startswith("Corset-"):
            skipped_reasons[f"not a Corset-* type ({pt or '(empty)'})"] += 1
            continue
        code = _code_from_product_type(pt)
        if not code:
            skipped_reasons[f"no 3-letter code in type ({pt})"] += 1
            continue
        if code in EXCLUDED_CODES:
            skipped_reasons[f"excluded code {code}"] += 1
            continue
        if code not in code_to_slug:
            skipped_reasons[f"unknown code {code}"] += 1
            continue
        per_code.setdefault(code, []).append(p)

    # Emit one silhouette per code. Slugs shared across codes (like
    # gemini for GSX+GCX) get separate silhouette entries with different
    # `silhouette_category` — same fit math, different scoring semantics
    # (cupped-rib vs conical treat the underbust penalty differently).
    corsets: list[dict] = []
    for code, prods in sorted(per_code.items()):
        slug = code_to_slug[code]
        sizing_row = sizing[slug]
        pos_row = positions.get(slug, {})
        overrides = CODE_OVERRIDES.get(code, {})
        silhouette_category = (
            overrides.get("silhouette_category")
            or sizing_row.get("silhouette_category")
            or "hourglass"
        )
        variants = [build_variant(p, code) for p in prods]
        # Sort variants by stretch order then name for stable output.
        order = {"low": 0, "medium": 1, "high": 2}
        variants.sort(key=lambda v: (order.get(v["stretch_class"], 99), v["name"]))
        # Materials + stretch classes aggregated across variants.
        all_materials: set[str] = set()
        all_stretch: set[str] = set()
        for v in variants:
            all_materials.update(v["materials"])
            all_stretch.add(v["stretch_class"])
        stretch_class_options = sorted(
            all_stretch, key=lambda s: order.get(s, 99),
        )
        materials_summary = sorted(all_materials)
        # Torso length — median across variants' descriptions (some products
        # have it, some don't; median smooths out any bad reads).
        lengths = [
            _torso_length_from_description(p) for p in prods
        ]
        lengths = [x for x in lengths if x is not None]
        body_length_in = (sum(lengths) / len(lengths)) if lengths else None

        entry = {
            "id": f"TT-{code}",
            "name": f"Timeless Trends {silhouette_category.title()} {sizing_row.get('length_hint', '').title()}".strip(),
            "url": f"https://timeless-trends.com/collections/all",  # placeholder — variants each carry their own URL
            "silhouette_category": silhouette_category,
            "silhouette_words": [silhouette_category, sizing_row.get("length_hint") or ""],
            "body_length_in": body_length_in,
            "above_waist_length_in": None,
            "below_waist_length_in": None,
            "measurements": _measurements(sizing_row, pos_row),
            "materials_summary": materials_summary,
            "stretch_class_options": stretch_class_options,
            "variants": variants,
            "notes": None,
            "provenance": {
                "sizing_page_slug": slug,
                "sizing_page_url": sizing_row.get("url"),
                "product_type_code": code,
                "rib_spring_in": sizing_row.get("rib_spring_in"),
                "hip_spring_in": sizing_row.get("hip_spring_in"),
                "sizing_sizes_offered": sizing_row.get("sizes_offered"),
                "underbust_position_in": pos_row.get("underbust_position_in"),
                "high_hip_position_in": pos_row.get("high_hip_position_in"),
            },
        }
        corsets.append(entry)

    corsets.sort(key=lambda c: c["id"])

    catalog = {
        "brand": "Timeless Trends",
        "brand_url": "https://timeless-trends.com/",
        "brand_waist_slack_by_stretch_class_in": DEFAULT_SLACK,
        "generated_at_iso": dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds"),
        "sources": {
            "collections_json": "https://timeless-trends.com/collections/all/products.json",
            "sizing_pages": "https://timeless-trends.com/pages/*-sizing-information",
            "landmark_positions": "manually reviewed against size-chart images",
        },
        "corsets": corsets,
    }

    OUT_PATH.write_text(json.dumps(catalog, indent=2))
    print(f"Wrote {OUT_PATH}")
    print(f"Silhouettes in catalog: {len(corsets)}")
    total_variants = sum(len(c["variants"]) for c in corsets)
    print(f"Total variants across silhouettes: {total_variants}")
    if skipped_reasons:
        print("\nSkipped products by reason:")
        for reason, n in skipped_reasons.most_common():
            print(f"  {n:3}  {reason}")


if __name__ == "__main__":
    main()
