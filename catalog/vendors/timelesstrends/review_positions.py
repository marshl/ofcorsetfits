"""Interactive review of TT silhouette landmark positions.

The sizing pages give us rib and hip *spring* (circumference difference vs.
waist) but not *positions* (how far above/below the waist each landmark
sits on the corset). Those are visible only in size-chart images on the
product page — the same manual read as with MCC's hip positions.

This script walks the developer through each silhouette that TT's sizing
pages document, prints one representative product URL per silhouette so
you can open its size chart, and prompts for two values:

  * underbust_position_in — inches above the natural waist that TT's
    "Underbust" measurement is taken at. Typical range 5–7".
  * high_hip_position_in  — inches below the waist that TT's "High Hip"
    measurement is taken at. Typical range 3–5".

TT publishes only ONE hip landmark (high hip), no low hip; `low_hip_*`
stays null throughout, mirroring how MCC handles `low_hip_spring: '-'`
models.

Values save incrementally after each entry, and re-running only prompts
for silhouettes not yet reviewed. `--assume-defaults` fills with 5.5" /
4.0" without prompting (usable for headless / CI runs; verify manually
before shipping the catalog).
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import yaml

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

HERE = Path(__file__).resolve().parent
DATA_DIR = HERE / "data"
SIZING_PATH = DATA_DIR / "sizing-tables.json"
PRODUCTS_PATH = DATA_DIR / "products.json"
OUT_PATH = DATA_DIR / "positions.yaml"

DEFAULT_UNDERBUST = 5.5
DEFAULT_HIGH_HIP = 4.0

HEADER = [
    "# Timeless Trends silhouette landmark positions — human review",
    "#",
    "# One entry per silhouette (identified by its sizing-page slug). Each",
    "# holds two developer-reviewed positions in inches:",
    "#",
    "#   underbust_position_in  — inches ABOVE natural waist (where TT's",
    "#                           'Underbust' size-chart measurement is taken)",
    "#   high_hip_position_in   — inches BELOW natural waist (where TT's",
    "#                           'High Hip' measurement is taken)",
    "#",
    "# Comments below each entry are context regenerated from the sizing",
    "# pages every run; edit only the two data fields.",
]


def load_existing() -> dict[str, dict]:
    if not OUT_PATH.exists():
        return {}
    doc = yaml.safe_load(OUT_PATH.read_text()) or {}
    out: dict[str, dict] = {}
    for slug, entry in (doc.get("silhouettes") or {}).items():
        out[slug] = {
            "underbust_position_in": entry.get("underbust_position_in", DEFAULT_UNDERBUST),
            "high_hip_position_in": entry.get("high_hip_position_in", DEFAULT_HIGH_HIP),
        }
    return out


def _representative_url_for_codes(codes: list[str], products: dict) -> str | None:
    """Pick one product URL matching any of these product_type codes, so
    the reviewer has a size chart they can actually look at. Prefer a
    published, non-clearance product; fall back to whatever's available."""
    for handle, p in sorted(products.items()):
        pt = p.get("product_type") or ""
        for c in codes:
            if f"({c})" in pt:
                return f"https://timeless-trends.com/products/{handle}"
    return None


def _prompt_float(label: str, default: float) -> float:
    while True:
        raw = input(f"  {label} [{default}]: ").strip()
        if raw == "":
            return default
        try:
            return float(raw)
        except ValueError:
            print("  (please enter a number, or press enter for the default)")


def write_yaml(reviewed: dict[str, dict], sizing: dict[str, dict], products: dict) -> None:
    lines = list(HEADER)
    lines.append("")
    lines.append("silhouettes:")
    for slug in sorted(reviewed.keys()):
        if slug not in sizing:
            continue
        s = sizing[slug]
        rep = _representative_url_for_codes(s.get("product_type_codes") or [], products)
        codes = ", ".join(s.get("product_type_codes") or [])
        lines.append(f"  {slug}:")
        lines.append(f"    # silhouette_category:  {s.get('silhouette_category')}")
        lines.append(f"    # length_hint:          {s.get('length_hint')}")
        lines.append(f"    # rib_spring_in:        {s.get('rib_spring_in')}")
        lines.append(f"    # hip_spring_in:        {s.get('hip_spring_in')}")
        lines.append(f"    # product_type_codes:   [{codes}]")
        if rep:
            lines.append(f"    # example_url:          {rep}")
        vals = reviewed[slug]
        lines.append(f"    underbust_position_in: {vals['underbust_position_in']}  # inches above waist")
        lines.append(f"    high_hip_position_in:  {vals['high_hip_position_in']}   # inches below waist")
        lines.append("")
    OUT_PATH.write_text("\n".join(lines))


def prompt_for_silhouette(slug: str, sizing_row: dict, rep_url: str | None) -> dict:
    print()
    print(f"=========== {slug} ===========")
    print(f"Silhouette category : {sizing_row.get('silhouette_category')}")
    print(f"Length hint         : {sizing_row.get('length_hint')}")
    print(f"Rib spring          : {sizing_row.get('rib_spring_in')}\"")
    print(f"Hip spring          : {sizing_row.get('hip_spring_in')}\"")
    print(f"Sizes offered       : {sizing_row.get('sizes_offered')}")
    codes = ", ".join(sizing_row.get("product_type_codes") or [])
    print(f"Matching product codes: {codes}")
    if rep_url:
        print(f"Example product URL : {rep_url}")
    print()
    print("Open the example URL, find the size-chart image, and read where")
    print("the underbust and high-hip labels sit relative to the waist.")
    print()
    ub = _prompt_float("Underbust position (inches ABOVE waist)", DEFAULT_UNDERBUST)
    hh = _prompt_float("High-hip position (inches BELOW waist)", DEFAULT_HIGH_HIP)
    return {"underbust_position_in": ub, "high_hip_position_in": hh}


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--assume-defaults", action="store_true",
                        help="Fill new silhouettes with defaults without prompting.")
    parser.add_argument("--reset", action="store_true",
                        help="Discard existing values and re-review everything.")
    parser.add_argument("--recheck", action="append", default=[],
                        metavar="SLUG",
                        help="Prompt again for one silhouette. Repeatable.")
    args = parser.parse_args()

    if not SIZING_PATH.exists():
        print(f"{SIZING_PATH} not found. Run fetch_sizing_pages.py first.", file=sys.stderr)
        return 1
    if not PRODUCTS_PATH.exists():
        print(f"{PRODUCTS_PATH} not found. Run fetch_all_products.py first.", file=sys.stderr)
        return 1

    sizing = json.loads(SIZING_PATH.read_text())
    products = json.loads(PRODUCTS_PATH.read_text())

    existing = {} if args.reset else load_existing()
    to_recheck = set(args.recheck)
    for did in to_recheck:
        existing.pop(did, None)

    # Only prompt for silhouettes that actually have products (skip pages
    # like slim-short if no code maps there — but we did map codes to every
    # page here, so this is defensive).
    queue = [
        slug for slug in sorted(sizing.keys())
        if slug not in existing and (sizing[slug].get("product_type_codes") or [])
    ]

    reviewed = dict(existing)
    print(
        f"Total silhouettes with fit data: {len(sizing)}. "
        f"Already reviewed: {len(existing)}. To review: {len(queue)}."
    )
    if not queue:
        pass
    elif args.assume_defaults:
        print(f"--assume-defaults: filling {len(queue)} with defaults "
              f"({DEFAULT_UNDERBUST}\" / {DEFAULT_HIGH_HIP}\").")
        for slug in queue:
            reviewed[slug] = {
                "underbust_position_in": DEFAULT_UNDERBUST,
                "high_hip_position_in": DEFAULT_HIGH_HIP,
            }
    else:
        print(f"\nYou'll be asked about {len(queue)} silhouette(s). Ctrl-C is safe — ")
        print("entries save incrementally.\n")
        for idx, slug in enumerate(queue, 1):
            print(f"\n----- Review {idx} of {len(queue)} -----")
            rep = _representative_url_for_codes(
                sizing[slug].get("product_type_codes") or [], products,
            )
            try:
                vals = prompt_for_silhouette(slug, sizing[slug], rep)
            except (KeyboardInterrupt, EOFError):
                print("\n(interrupted — saving what you've entered so far)")
                write_yaml(reviewed, sizing, products)
                return 130
            reviewed[slug] = vals
            write_yaml(reviewed, sizing, products)

    write_yaml(reviewed, sizing, products)
    print(f"\nWrote {OUT_PATH} with {len(reviewed)} silhouettes.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
