"""Fetch each TT product's rendered HTML and extract metafield blocks.

Timeless Trends' Shopify theme renders a small set of extra product data
into a `<div class="metafield-rich_text_field">` block. These blocks are
NOT in the JSON APIs (`/products.json`, `/products/{handle}.js`) — they
live only in the rendered storefront HTML at `/products/{handle}`.

What we can pull:

  * Lengths in inches — Center front, Side seam, Center back,
    Underbust-to-hip. Center back is the closest analog to MCC's torso
    length; body_length_in on the built catalog picks it up.
  * Per-product spring numbers (Rib spring, Hip spring) — potentially
    more precise than the silhouette-family averages we get from the
    sizing pages, because different products in the same family
    sometimes vary slightly.
  * Landmark positions (Underbust position above waist, High-hip
    position below waist), pulled from the parenthetical "about X inches
    above/below the waistline" annotations next to the spring numbers.
    This lets the build skip `review_positions.py` for any product with
    metafields populated.

Rate-limited at 2 s per request (same shared `Fetcher`). ~200 requests
→ ~7 min wall clock. Resumable on re-run.

Output: `data/product-metafields.json` keyed by product handle, each
value a dict of the extracted fields (any missing field simply absent).
"""

from __future__ import annotations

import html
import json
import re
import sys
import time
import urllib.error
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from shared.http import Fetcher  # noqa: E402

HERE = Path(__file__).resolve().parent
DATA_DIR = HERE / "data"
PRODUCTS_PATH = DATA_DIR / "products.json"
OUT_PATH = DATA_DIR / "product-metafields.json"

BASE_URL = "https://timeless-trends.com"

# Every metafield we care about lives inside a
# `<div class="metafield-rich_text_field">...</div>` block. There can be
# more than one (Lengths+Springs in one, Hardware+Textiles in another —
# we just concatenate the text from all matching blocks and regex over the
# combined string, which is simpler than trying to figure out which block
# is which).
_METAFIELD_BLOCK_RE = re.compile(
    r'<div class="metafield-rich_text_field">(.*?)</div>',
    re.DOTALL | re.IGNORECASE,
)

# Number literals we accept: whole `12`, decimal `11.5`, or mixed
# `12 1/4`. Optional inch marks (straight " or curly ” or "in") after.
_NUM_RE = r'(\d+(?:\s+\d+/\d+)?(?:\.\d+)?|\d+/\d+)'

# Each field we scrape maps to a (regex, parser) pair. The regex captures
# ONE number; the parser turns the captured string into a float. Some
# patterns include a parenthetical follow-up so we can pull the position
# annotation ("about 5 inches above the waistline") right where it lives,
# next to the corresponding spring.
FIELD_PATTERNS: list[tuple[str, re.Pattern[str]]] = [
    ("center_front_in", re.compile(rf'center\s*front\s*:?\s*{_NUM_RE}', re.IGNORECASE)),
    ("side_seam_in", re.compile(rf'side\s*(?:seam|length)\s*:?\s*{_NUM_RE}', re.IGNORECASE)),
    ("center_back_in", re.compile(rf'center\s*back\s*:?\s*{_NUM_RE}', re.IGNORECASE)),
    ("underbust_to_hip_in", re.compile(rf'underbust\s*to\s*hip\s*:?\s*{_NUM_RE}', re.IGNORECASE)),
    ("rib_spring_in", re.compile(rf'rib\s*spring\s*:?\s*{_NUM_RE}', re.IGNORECASE)),
    ("hip_spring_in", re.compile(rf'(?:high\s*)?hip\s*spring\s*:?\s*{_NUM_RE}', re.IGNORECASE)),
    # Positions live in parenthetical annotations. TT phrases both as
    # "(about X inches above the waistline)" or "(about X" above the
    # waistline)". Match either.
    ("underbust_position_in", re.compile(
        rf'rib\s*spring[^(]*\(\s*about\s+{_NUM_RE}\s*(?:in|inches|["”″′])?\s*above',
        re.IGNORECASE)),
    ("high_hip_position_in", re.compile(
        rf'(?:high\s*)?hip\s*spring[^(]*\(\s*about\s+{_NUM_RE}\s*(?:in|inches|["”″′])?\s*below',
        re.IGNORECASE)),
]


def _parse_number(s: str) -> float | None:
    s = s.strip()
    m = re.match(r"^(\d+)\s+(\d+)/(\d+)$", s)
    if m:
        whole, num, den = map(int, m.groups())
        return whole + num / den
    m = re.match(r"^(\d+)/(\d+)$", s)
    if m:
        num, den = map(int, m.groups())
        return num / den
    try:
        return float(s)
    except ValueError:
        return None


def _strip_html(fragment: str) -> str:
    text = re.sub(r"<[^>]+>", " ", fragment)
    text = html.unescape(text)
    return re.sub(r"\s+", " ", text).strip()


def extract_metafields(page_html: str) -> dict:
    """Return a `{field: float, ...}` dict for the fields we could find.
    Missing fields are simply absent from the returned dict."""
    blocks = _METAFIELD_BLOCK_RE.findall(page_html)
    if not blocks:
        return {}
    combined = " ".join(_strip_html(b) for b in blocks)
    result: dict[str, float] = {}
    for field, pat in FIELD_PATTERNS:
        m = pat.search(combined)
        if not m:
            continue
        val = _parse_number(m.group(1))
        if val is not None:
            result[field] = val
    return result


def load_handles() -> list[str]:
    products = json.loads(PRODUCTS_PATH.read_text())
    # Skip products that clearly aren't corsets — no need to hit their
    # pages just to log "no metafields".
    handles = []
    for handle, p in products.items():
        pt = p.get("product_type") or ""
        if pt.startswith("Corset-"):
            handles.append(handle)
    return sorted(handles)


def main() -> int:
    if not PRODUCTS_PATH.exists():
        print(f"{PRODUCTS_PATH} not found. Run fetch_all_products.py first.", file=sys.stderr)
        return 1

    handles = load_handles()
    print(f"Fetching per-product metafields for {len(handles)} corsets", flush=True)

    results: dict[str, dict] = {}
    if OUT_PATH.exists():
        try:
            results = json.loads(OUT_PATH.read_text())
            good = sum(1 for v in results.values() if isinstance(v, dict) and "error" not in v)
            print(f"Resuming — {good} successful entries already present", flush=True)
        except Exception:
            results = {}

    def flush() -> None:
        OUT_PATH.write_text(json.dumps(results, indent=2, sort_keys=True))

    fetcher = Fetcher()
    errors = 0
    empty = 0
    started = time.monotonic()
    for i, handle in enumerate(handles, 1):
        existing = results.get(handle)
        if isinstance(existing, dict) and "error" not in existing:
            continue
        url = f"{BASE_URL}/products/{handle}"
        try:
            page = fetcher.get_text(url)
            fields = extract_metafields(page)
            results[handle] = fields
            if not fields:
                empty += 1
                print(f"[{i}/{len(handles)}] {handle} -> no metafields found", flush=True)
            else:
                keys = sorted(fields.keys())
                print(f"[{i}/{len(handles)}] {handle} -> {len(fields)} fields ({', '.join(keys[:4])}...)", flush=True)
        except urllib.error.HTTPError as e:
            results[handle] = {"error": f"HTTP {e.code}"}
            errors += 1
            print(f"[{i}/{len(handles)}] {handle} -> ERROR HTTP {e.code}", flush=True)
        except Exception as e:
            results[handle] = {"error": f"{type(e).__name__}: {e}"}
            errors += 1
            print(f"[{i}/{len(handles)}] {handle} -> ERROR {type(e).__name__}: {e}", flush=True)

        if i % 5 == 0:
            flush()

    flush()
    dur = time.monotonic() - started
    print(
        f"\nDone in {dur:.1f}s. {len(results)} products, "
        f"{empty} with no metafields, {errors} errors.",
        flush=True,
    )
    return 0 if errors == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
