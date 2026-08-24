"""Fetch and parse Timeless Trends' per-silhouette sizing pages.

Unlike MCC (which publishes every design's rib/hip/torso in a single
`ninja_tables` blob), TT distributes fit data across a dozen "sizing
information" pages under `/pages/<silhouette>-sizing-information`. Each
page contains an HTML table with, per corset size:

  * Underbust circumference (inches)
  * Recommended natural waist range (inches)
  * High hip circumference (inches)

Subtracting the corset size from `underbust` and `high hip` gives the
per-silhouette rib spring and hip spring — the numbers our scoring engine
actually needs.

The mapping from a product's `product_type` code (e.g. `Corset-Underbust
(UHR)`) to a sizing-page slug is fixed and lives in the SILHOUETTES table
below. Overbust codes (OHR, OSR) are intentionally skipped — the current
scoring engine only handles underbust silhouettes.

Output: `data/sizing-tables.json` keyed by silhouette slug, each value:
  {
    "url": ...,
    "size_rows": [{"size": 18, "underbust_in": 25, "high_hip_in": 28,
                   "waist_min_in": 23, "waist_max_in": 24}, ...],
    "rib_spring_in": 7,
    "hip_spring_in": 10,
    "sizes_offered": [18, 20, ..., 42],
  }
"""

from __future__ import annotations

import html
import json
import re
import sys
from pathlib import Path
from statistics import median

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from shared.http import Fetcher, write_json  # noqa: E402

BASE_URL = "https://timeless-trends.com"

# The eleven sizing pages we care about. Each entry declares the URL slug
# and how a product's 3-letter type code maps onto this silhouette.
# `silhouette_category` is our schema's canonical category — cupped-rib
# vs conical vs hourglass vs longline vs waspie. Overbust intentionally
# excluded from the current MVP scope.
# Middle letter of a code is the silhouette family:
#   H = Hourglass line (deeper spring)
#   S = Slim line (gentler spring)
# Third letter is length: S=Short, R=Regular, L=Long, X=one-length (Gemini).
# GCX vs GSX share the gemini sizing chart but differ in shape — GCX cups
# the rib, GSX is straight. That split is handled per-code in build.py.
SILHOUETTES = [
    # slug, silhouette_category, length_hint, code_matches
    ("hourglass-short-sizing-information",   "waspie",     "short",   ["UHS"]),
    ("hourglass-regular-sizing-information", "hourglass",  "regular", ["UHR", "NHR"]),
    ("hourglass-long-sizing-information",    "longline",   "long",    ["UHL"]),
    ("slim-short-sizing-information",        "waspie",     "short",   ["USS"]),
    ("slim-regular-sizing-information",      "hourglass",  "regular", ["USR"]),
    ("slim-long-sizing-information",         "longline",   "long",    ["USL"]),
    ("gemini-sizing-information",            "conical",    "regular", ["GSX", "GCX"]),
    ("libra-sizing-information",             "hourglass",  "regular", ["LIB"]),
    ("libby-libra-gentle-sizing-information","hourglass",  "regular", ["LBS"]),
]

HERE = Path(__file__).resolve().parent
DATA_DIR = HERE / "data"
OUT_PATH = DATA_DIR / "sizing-tables.json"

# One HTML <table> block. `re.DOTALL` lets `.` match newlines inside cells.
_TABLE_RE = re.compile(r"<table[^>]*>(.*?)</table>", re.DOTALL | re.IGNORECASE)
_ROW_RE = re.compile(r"<tr[^>]*>(.*?)</tr>", re.DOTALL | re.IGNORECASE)
_CELL_RE = re.compile(r"<t[dh][^>]*>(.*?)</t[dh]>", re.DOTALL | re.IGNORECASE)


def _cell_text(fragment: str) -> str:
    text = re.sub(r"<[^>]+>", " ", fragment)
    text = html.unescape(text)
    return re.sub(r"\s+", " ", text).strip()


def _parse_size_table(html_body: str) -> list[dict]:
    """Find the first HTML table on a sizing page whose header row contains
    'Corset Size' and 'Underbust'. Extract each data row as a dict of
    numeric values. Silently skips any table that doesn't look right so
    the caller can log which slug failed."""
    for table_html in _TABLE_RE.findall(html_body):
        rows_html = _ROW_RE.findall(table_html)
        if len(rows_html) < 3:
            continue
        header_cells = [_cell_text(c).lower() for c in _CELL_RE.findall(rows_html[0])]
        header_str = " | ".join(header_cells)
        if "corset size" not in header_str or "underbust" not in header_str:
            continue
        # Only care about the inches table, not the cm one.
        if "(cm)" in header_str:
            continue
        # Figure out column indices we need.
        idx_size = _find_col(header_cells, "corset size")
        idx_ub = _find_col(header_cells, "underbust")
        idx_hip = _find_col(header_cells, "high hip", "hip")
        idx_waist = _find_col(header_cells, "recommended natural waist", "natural waist")
        if idx_size is None or idx_ub is None or idx_hip is None:
            continue
        rows: list[dict] = []
        for r in rows_html[1:]:
            cells = [_cell_text(c) for c in _CELL_RE.findall(r)]
            if len(cells) <= max(idx_size, idx_ub, idx_hip):
                continue
            size = _first_int(cells[idx_size])
            ub = _first_float(cells[idx_ub])
            hip = _first_float(cells[idx_hip])
            waist_min = waist_max = None
            if idx_waist is not None and idx_waist < len(cells):
                waist_min, waist_max = _parse_range(cells[idx_waist])
            if size is None or ub is None or hip is None:
                continue
            rows.append({
                "size": size,
                "underbust_in": ub,
                "high_hip_in": hip,
                "waist_min_in": waist_min,
                "waist_max_in": waist_max,
            })
        if rows:
            return rows
    return []


def _find_col(headers: list[str], *needles: str) -> int | None:
    for needle in needles:
        for i, h in enumerate(headers):
            if needle in h:
                return i
    return None


def _first_int(s: str) -> int | None:
    m = re.search(r"-?\d+", s)
    return int(m.group()) if m else None


def _first_float(s: str) -> float | None:
    m = re.search(r"-?\d+(?:\.\d+)?", s)
    return float(m.group()) if m else None


def _parse_range(s: str) -> tuple[float | None, float | None]:
    """"23 - 24" or "23-24" -> (23.0, 24.0). Single number -> (n, n)."""
    nums = re.findall(r"-?\d+(?:\.\d+)?", s)
    if not nums:
        return (None, None)
    if len(nums) == 1:
        v = float(nums[0])
        return (v, v)
    return (float(nums[0]), float(nums[1]))


def _spring_from_rows(rows: list[dict], key: str) -> float | None:
    """Median of (col_value - corset_size) across all rows. Median because
    the smallest and largest sizes sometimes deviate from the constant
    grading a hair — the median hits the model's intended spring."""
    diffs = [r[key] - r["size"] for r in rows]
    return float(median(diffs)) if diffs else None


def main() -> int:
    fetcher = Fetcher()
    results: dict[str, dict] = {}
    empty_slugs: list[str] = []

    for slug, silhouette_category, length_hint, codes in SILHOUETTES:
        url = f"{BASE_URL}/pages/{slug}"
        print(f"Fetching {slug} ...", flush=True)
        try:
            body = fetcher.get_text(url)
        except Exception as e:
            print(f"  ERROR fetching: {type(e).__name__}: {e}", flush=True)
            continue
        rows = _parse_size_table(body)
        if not rows:
            print("  no size table parsed — leaving empty", flush=True)
            empty_slugs.append(slug)
            continue
        rib_spring = _spring_from_rows(rows, "underbust_in")
        hip_spring = _spring_from_rows(rows, "high_hip_in")
        sizes_offered = sorted({r["size"] for r in rows})
        results[slug] = {
            "url": url,
            "silhouette_category": silhouette_category,
            "length_hint": length_hint,
            "product_type_codes": codes,
            "rib_spring_in": rib_spring,
            "hip_spring_in": hip_spring,
            "sizes_offered": sizes_offered,
            "size_rows": rows,
        }
        print(
            f"  {len(rows)} rows | rib={rib_spring}\" hip={hip_spring}\" | "
            f"sizes {sizes_offered[0]}-{sizes_offered[-1]}",
            flush=True,
        )

    DATA_DIR.mkdir(parents=True, exist_ok=True)
    write_json(OUT_PATH, results, sort_keys=True)
    print(
        f"\nWrote {OUT_PATH.relative_to(HERE.parent.parent.parent)} — "
        f"{len(results)} silhouettes"
        + (f", {len(empty_slugs)} pages with no parseable table" if empty_slugs else "")
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
