"""Interactive hip-position review for the MCC catalog.

MCC's size-chart images encode two things that can't be scraped from HTML:
the vertical position of the upper hip (usually 3.5–4" below waist, sometimes
different on shorter models) and the low hip (usually 6–7"). This script
walks the developer through each unreviewed design, prints the product URL
plus every piece of context we have (title, springs, torso length, sizes,
detected silhouette words, materials), and prompts for values to enter.

Preserves values for any design already present in `data/hip-positions.yaml`
so re-running only asks about NEW designs. Saves incrementally after each
entered design so Ctrl-C mid-review keeps everything answered so far.

Flags:
  --assume-defaults      Non-interactive; fill new designs with defaults
                         (upper=4.0, low=6.0 or null, stretch=inferred). Use
                         from the orchestrator when a human review isn't
                         practical (e.g. CI-driven rebuild).
  --reset                Discard existing values and start over.
  --recheck DESIGN_ID    Prompt again for one specific design, overwriting
                         its current values. Repeatable.

Output is `data/hip-positions.yaml`, regenerated end-to-end each run so the
context comments stay in sync with the current chart data. User-editable
values live at the same indented positions build.py already expects.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import yaml

# Add catalog/vendors/ to sys.path so `shared.*` resolves.
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from shared.stretch_class import classify as classify_stretch  # noqa: E402

HERE = Path(__file__).resolve().parent
DATA_DIR = HERE / "data"
JSON_PATH = DATA_DIR / "comparison-chart.raw.json"
URL_MAP_PATH = DATA_DIR / "url-to-design.json"
SCRAPED_PATH = DATA_DIR / "scraped-per-design.json"
OUT_PATH = DATA_DIR / "hip-positions.yaml"

DEFAULT_UPPER_HIP = 4.0
DEFAULT_LOW_HIP = 6.0


def load_json_designs() -> dict[str, dict]:
    rows = json.loads(JSON_PATH.read_text())
    return {row["value"]["design"].upper(): row["value"] for row in rows}


def load_existing_values() -> dict[str, dict]:
    """Return `design_id -> {upper_hip_position_in, low_hip_position_in,
    stretch_class}` from the current hip-positions.yaml, or `{}` if the
    file doesn't exist. PyYAML strips comments; we regenerate them from
    fresh context when writing back."""
    if not OUT_PATH.exists():
        return {}
    doc = yaml.safe_load(OUT_PATH.read_text()) or {}
    out: dict[str, dict] = {}
    for entry in doc.get("designs") or []:
        did = entry.get("design_id")
        if not did:
            continue
        out[did] = {
            "upper_hip_position_in": entry.get("upper_hip_position_in", DEFAULT_UPPER_HIP),
            "low_hip_position_in": entry.get("low_hip_position_in", DEFAULT_LOW_HIP),
            "stretch_class": entry.get("stretch_class", "medium"),
        }
    return out


def _prompt_float(label: str, default: float) -> float:
    while True:
        raw = input(f"  {label} [{default}]: ").strip()
        if raw == "":
            return default
        try:
            return float(raw)
        except ValueError:
            print("  (please enter a number, or press enter for the default)")


def _prompt_optional_float(label: str, default: float) -> float | None:
    """Like `_prompt_float` but accepts 'none' / 'null' / '-' for null."""
    while True:
        raw = input(f"  {label} [{default}, or 'none']: ").strip().lower()
        if raw == "":
            return default
        if raw in ("none", "null", "-", "n"):
            return None
        try:
            return float(raw)
        except ValueError:
            print("  (please enter a number, 'none' for null, or press enter for the default)")


def _prompt_choice(label: str, choices: list[str], default: str) -> str:
    joined = "/".join(choices)
    while True:
        raw = input(f"  {label} ({joined}) [{default}]: ").strip().lower()
        if raw == "":
            return default
        if raw in choices:
            return raw
        print(f"  (must be one of: {joined})")


def _context_lines(design_id: str, url: str, json_row: dict, scrape_row: dict,
                   materials_str: str, low_hip_raw: str) -> list[str]:
    lines = [
        f"URL:                {url}",
        f"Title:              {(scrape_row.get('title') or '').strip()}",
        f"Torso length (in):  {json_row.get('torso_length')}",
        f"Rib spring (in):    {json_row.get('rib_spring')}",
        f"Upper hip spring:   {json_row.get('upper_hip_spring')}",
        f"Low hip spring:     {low_hip_raw}",
        f"Underbust at (in):  {json_row.get('underbust_length')}  (above waist)",
    ]
    sizes = scrape_row.get("sizes") or []
    if sizes:
        lines.append(f"Sizes:              {sizes}")
    silhouette_words = scrape_row.get("silhouette_words") or []
    if silhouette_words:
        lines.append(f"Silhouette words:   {', '.join(silhouette_words)}")
    lines.append(f"Materials in title: {materials_str}")
    return lines


def prompt_for_design(design_id: str, url: str, json_row: dict, scrape_row: dict,
                      inferred_stretch: str, materials: list[str],
                      has_low_hip: bool, low_hip_raw: str) -> dict:
    print()
    print(f"=========== {design_id} ===========")
    for line in _context_lines(design_id, url, json_row, scrape_row,
                                materials_str=", ".join(materials) if materials else "(none matched)",
                                low_hip_raw=low_hip_raw):
        print(line)
    print()
    print("Open the URL above, find the size-chart image, and read the green")
    print("annotation labels showing hip positions relative to natural waist.")
    print()

    upper = _prompt_float("Upper hip position (inches below waist)", DEFAULT_UPPER_HIP)
    if has_low_hip:
        low = _prompt_optional_float("Low hip position (inches below waist)", DEFAULT_LOW_HIP)
    else:
        low = None
        print("  (skipping low hip — MCC's low_hip_spring is '-' for this model)")
    stretch = _prompt_choice("Stretch class", ["low", "medium", "high"], inferred_stretch)

    return {
        "upper_hip_position_in": upper,
        "low_hip_position_in": low,
        "stretch_class": stretch,
    }


HEADER = [
    "# Mystic City underbust catalog — hip-position + stretch-class review",
    "#",
    "# One entry per design that has both a comparison-chart row AND a product",
    "# URL. For each, the user has verified:",
    "#",
    "# 1. HIP POSITIONS  — read from the green annotations on the size-chart",
    "#                     image on the product page. Inches below waist.",
    "#                     `null` when MCC's low_hip_spring is '-'.",
    "# 2. STRETCH CLASS  — verified against the actual product materials.",
    "#                     Inferred from title keywords as a starting default.",
    "#",
    "# The comments on each entry are regenerated from the current chart data",
    "# every time review_hip_positions.py runs — don't edit the comments, they",
    "# won't survive. Edit only the three data fields:",
    "#   upper_hip_position_in, low_hip_position_in, stretch_class.",
]


def _render_entry(
    design_id: str,
    url: str,
    json_row: dict,
    scrape_row: dict,
    materials: list[str],
    values: dict,
    low_hip_raw: str,
    has_low_hip: bool,
) -> list[str]:
    title = (scrape_row.get("title") or "").replace("\n", " ").strip()
    sizes = scrape_row.get("sizes") or []
    silhouette_words = scrape_row.get("silhouette_words") or []
    lines = [
        f"  - design_id: {design_id}",
        f"    url: {url}",
        f"    # title:              {title}",
        f"    # torso_length_in:   {json_row.get('torso_length')}",
        f"    # rib_spring_in:     {json_row.get('rib_spring')}",
        f"    # upper_hip_spring:  {json_row.get('upper_hip_spring')}",
        f"    # low_hip_spring:    {low_hip_raw}",
        f"    # underbust_at_in:    {json_row.get('underbust_length')}"
        "  (inches ABOVE waist — where MCC takes the underbust measurement)",
    ]
    if sizes:
        lines.append(f"    # sizes:              {sizes}")
    if silhouette_words:
        lines.append(f"    # silhouette:         {', '.join(silhouette_words)}")
    materials_display = ", ".join(materials) if materials else "(none matched)"
    lines.append(f"    # materials in title: {materials_display}")
    lines.append(
        f"    upper_hip_position_in: {values['upper_hip_position_in']}"
        "  # inches below waist"
    )
    if has_low_hip:
        low = values["low_hip_position_in"]
        if low is None:
            lines.append("    low_hip_position_in: null  # user cleared this value")
        else:
            lines.append(f"    low_hip_position_in: {low}  # inches below waist")
    else:
        lines.append(
            "    low_hip_position_in: null"
            "  # no low hip on this model — leave null"
        )
    lines.append(
        f"    stretch_class: {values['stretch_class']}"
        "  # low | medium | high"
    )
    lines.append("")
    return lines


def write_yaml(
    reviewed: dict[str, dict],
    reps: dict[str, str],
    json_designs: dict[str, dict],
    scraped: dict[str, dict],
) -> None:
    lines = list(HEADER)
    lines.append("")
    lines.append("designs:")
    for design_id in sorted(reviewed.keys()):
        if design_id not in reps:
            # Design present in YAML but no longer has a product URL — drop it
            # rather than emit a broken entry.
            continue
        url = reps[design_id]
        json_row = json_designs.get(design_id)
        if not json_row:
            for k, v in json_designs.items():
                if k.replace("-", "") == design_id.replace("-", ""):
                    json_row = v
                    break
        if not json_row:
            continue
        scrape_row = scraped.get(design_id, {})
        title = (scrape_row.get("title") or "").strip()
        _, materials = classify_stretch(title)
        low_hip_raw = str(json_row.get("low_hip_spring", "-")).strip()
        has_low_hip = low_hip_raw not in ("-", "", "–", None, "None")
        lines.extend(_render_entry(
            design_id, url, json_row, scrape_row, materials,
            reviewed[design_id], low_hip_raw, has_low_hip,
        ))
    OUT_PATH.write_text("\n".join(lines))


def default_values(json_row: dict, title: str) -> dict:
    low_hip_raw = str(json_row.get("low_hip_spring", "-")).strip()
    has_low_hip = low_hip_raw not in ("-", "", "–", None, "None")
    stretch, _ = classify_stretch(title)
    return {
        "upper_hip_position_in": DEFAULT_UPPER_HIP,
        "low_hip_position_in": DEFAULT_LOW_HIP if has_low_hip else None,
        "stretch_class": stretch,
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument(
        "--assume-defaults",
        action="store_true",
        help="Fill new designs with default values instead of prompting.",
    )
    parser.add_argument(
        "--reset",
        action="store_true",
        help="Discard existing values and re-review every design.",
    )
    parser.add_argument(
        "--recheck",
        action="append",
        default=[],
        metavar="DESIGN_ID",
        help="Prompt again for this design, overwriting its stored values. Repeatable.",
    )
    args = parser.parse_args()

    if not URL_MAP_PATH.exists():
        print(f"{URL_MAP_PATH} not found. Run match_urls.py first.", file=sys.stderr)
        return 1

    json_designs = load_json_designs()
    url_map = json.loads(URL_MAP_PATH.read_text())
    reps: dict[str, str] = url_map["representatives"]
    scraped = json.loads(SCRAPED_PATH.read_text()) if SCRAPED_PATH.exists() else {}

    existing = {} if args.reset else load_existing_values()
    to_recheck = set(args.recheck)

    # Compute the review queue: designs that either aren't in `existing` at
    # all, or are explicitly named in --recheck.
    queue: list[str] = []
    for design_id in sorted(reps.keys()):
        if design_id in to_recheck or design_id not in existing:
            queue.append(design_id)

    reviewed = dict(existing)
    # Purge --reset / --recheck values so we always prompt for them.
    if args.reset:
        reviewed = {}
    for did in to_recheck:
        reviewed.pop(did, None)

    print(
        f"Total designs with URLs: {len(reps)}. "
        f"Already reviewed: {sum(1 for d in reps if d in existing) - len(to_recheck & existing.keys())}. "
        f"To review: {len(queue)}."
    )
    if not queue:
        print("Nothing to review.")
    elif args.assume_defaults:
        print("--assume-defaults: filling with defaults (no prompts).")
        for did in queue:
            json_row = json_designs.get(did) or next(
                (v for k, v in json_designs.items()
                 if k.replace("-", "") == did.replace("-", "")),
                None,
            )
            if not json_row:
                print(f"  (skip {did} — no comparison-chart row)")
                continue
            scrape_row = scraped.get(did, {})
            title = (scrape_row.get("title") or "").strip()
            reviewed[did] = default_values(json_row, title)
    else:
        print(f"\nYou'll be asked about {len(queue)} design(s). Ctrl-C is safe — ")
        print("entries save incrementally.\n")
        for idx, did in enumerate(queue, 1):
            print(f"\n----- Review {idx} of {len(queue)} -----")
            json_row = json_designs.get(did) or next(
                (v for k, v in json_designs.items()
                 if k.replace("-", "") == did.replace("-", "")),
                None,
            )
            if not json_row:
                print(f"  (skip {did} — no comparison-chart row)")
                continue
            scrape_row = scraped.get(did, {})
            title = (scrape_row.get("title") or "").strip()
            inferred_stretch, materials = classify_stretch(title)
            low_hip_raw = str(json_row.get("low_hip_spring", "-")).strip()
            has_low_hip = low_hip_raw not in ("-", "", "–", None, "None")
            try:
                values = prompt_for_design(
                    did, reps[did], json_row, scrape_row,
                    inferred_stretch, materials, has_low_hip, low_hip_raw,
                )
            except (KeyboardInterrupt, EOFError):
                print("\n(interrupted — saving what you've entered so far)")
                write_yaml(reviewed, reps, json_designs, scraped)
                return 130
            reviewed[did] = values
            write_yaml(reviewed, reps, json_designs, scraped)

    write_yaml(reviewed, reps, json_designs, scraped)
    print(f"\nWrote {OUT_PATH} with {len(reviewed)} entries.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
