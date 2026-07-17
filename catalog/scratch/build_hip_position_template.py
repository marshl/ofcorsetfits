"""Build the manual-review template from JSON + URL matches + scrape.

Produces one YAML document containing an entry per matched design (57).
Each entry has:
  - URL to the product page
  - Context comments (title, springs, torso, sizes, silhouette words)
  - Pre-filled default hip positions the user verifies against the size chart
    image
  - Pre-filled default stretch_class inferred from the title's material
    keywords the user verifies against the actual product materials
"""

import json
import sys
from pathlib import Path

HERE = Path(__file__).parent
CATALOG = HERE.parent
JSON_PATH = CATALOG / "mystic-city-comparison-chart.raw.json"
URL_MAP_PATH = HERE / "url-to-design.json"
SCRAPED_PATH = HERE / "scraped-per-design.json"
OUT_PATH = CATALOG / "hip-positions.yaml"

sys.path.insert(0, str(HERE))
from stretch_class import classify as classify_stretch  # noqa: E402

# Data-driven defaults observed from 4 verified size charts (MCC-110A, MCC-6,
# MCC-94, MCC-69C). Upper hip is consistently at 3.5–4" below waist across
# models with low_hip_spring; single-hip corsets vary 3.5–4" too.
# Low hip is 6–7" below waist when present.
DEFAULT_UPPER_HIP = 4.0
DEFAULT_LOW_HIP = 6.0


def load_json_designs():
    """Return { design_id_upper: value_dict } from the raw comparison chart."""
    rows = json.loads(JSON_PATH.read_text())
    return {row["value"]["design"].upper(): row["value"] for row in rows}


def main():
    json_designs = load_json_designs()
    url_map = json.loads(URL_MAP_PATH.read_text())
    scraped = json.loads(SCRAPED_PATH.read_text())
    reps = url_map["representatives"]

    lines = [
        "# Mystic City underbust catalog — manual review template",
        "#",
        "# 57 corsets. For each entry, verify TWO fields against the product page:",
        "#",
        "# 1. HIP POSITIONS (upper_hip_position_in, low_hip_position_in)",
        "#    - Open the `url`, find the size chart image, read the GREEN annotation",
        "#      labels. They show the vertical position of each hip measurement",
        "#      relative to the natural waist.",
        "#    - Values are inches below the natural waist. Defaults are 4 (upper)",
        "#      and 6 (low). Override where the image shows a different number.",
        "#    - Waspies and shorter corsets often use 3-3.5\" instead of 4\".",
        "#    - `low_hip_position_in: null` for models with `low_hip_spring: -` in",
        "#      MCC's JSON — those corsets have no low hip measurement. Leave null.",
        "#",
        "# 2. STRETCH CLASS (stretch_class)",
        "#    - Auto-classified from the product title's material words:",
        "#      * `low`    — no mesh (cotton/satin/brocade/PVC only). Waist ≈ nominal.",
        "#      * `medium` — hybrid (mesh + structural fabric). Waist runs ~1\" large.",
        "#      * `high`   — mesh-dominant. Waist runs 1.5-2\" large.",
        "#    - Titles can be misleading (e.g. \"cotton\" corset with mesh panels).",
        "#      If you've handled the product and know the material mix differs from",
        "#      the classification, override.",
        "#",
        "# Format is YAML. Preserve the exact indentation and quoting. When done,",
        "# save the file and tell Claude to merge into the final catalog.",
        "",
        "designs:",
    ]

    entries_written = 0
    for design_id in sorted(reps.keys()):
        url = reps[design_id]
        json_row = json_designs.get(design_id)
        if not json_row:
            # Fallback — dash-normalization edge cases in the JSON key.
            for k, v in json_designs.items():
                if k.replace("-", "") == design_id.replace("-", ""):
                    json_row = v
                    break
        if not json_row:
            continue

        low_hip_raw = str(json_row.get("low_hip_spring", "-")).strip()
        has_low_hip = low_hip_raw not in ("-", "", "–", None)

        scrape_row = scraped.get(design_id, {})
        sizes = scrape_row.get("sizes") or []
        silhouette_words = scrape_row.get("silhouette_words") or []
        title = (scrape_row.get("title") or "").replace("\n", " ").strip()
        stretch_cls, materials = classify_stretch(title)

        # Emit one YAML mapping entry with helpful context comments,
        # one field per comment line so it's easy to scan.
        lines.append(f"  - design_id: {design_id}")
        lines.append(f"    url: {url}")
        lines.append(f"    # title:              {title}")
        lines.append(f"    # torso_length_in:   {json_row.get('torso_length')}")
        lines.append(f"    # rib_spring_in:     {json_row.get('rib_spring')}")
        lines.append(f"    # upper_hip_spring:  {json_row.get('upper_hip_spring')}")
        lines.append(f"    # low_hip_spring:    {low_hip_raw}")
        lines.append(
            f"    # underbust_at_in:    {json_row.get('underbust_length')}"
            "  (inches ABOVE waist — where MCC takes the underbust measurement)"
        )
        if sizes:
            lines.append(f"    # sizes:              {sizes}")
        if silhouette_words:
            lines.append(f"    # silhouette:         {', '.join(silhouette_words)}")
        materials_display = ", ".join(materials) if materials else "(none matched)"
        lines.append(f"    # materials in title: {materials_display}")
        lines.append(
            f"    upper_hip_position_in: {DEFAULT_UPPER_HIP}"
            "  # inches below waist — verify from image"
        )
        if has_low_hip:
            lines.append(
                f"    low_hip_position_in: {DEFAULT_LOW_HIP}"
                "  # inches below waist — verify from image"
            )
        else:
            lines.append(
                "    low_hip_position_in: null"
                "  # no low hip on this model — leave null"
            )
        lines.append(
            f"    stretch_class: {stretch_cls}"
            "  # low | medium | high — override if title misleading"
        )
        lines.append("")
        entries_written += 1

    OUT_PATH.write_text("\n".join(lines))
    print(f"Wrote {OUT_PATH} with {entries_written} entries")


if __name__ == "__main__":
    main()
