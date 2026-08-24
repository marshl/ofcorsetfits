"""Fetch per-design product page metadata and write scraped-per-design.json.

For every design in `data/url-to-design.json`'s `representatives` map, fetch
the representative product page and extract:

  - title              — from <h1 class="product_title">…</h1> (WooCommerce standard)
  - sku                — from <span class="sku">…</span>
  - silhouette_words   — keyword scan of the page for known corsetry silhouette
                         terms (hourglass, cupped rib, conical, waspie, …)
  - sizes              — from the WooCommerce pa_size dropdown

`calibration` and `hardcoded_measurements` are left null — they're free-form
description prose that varies too much for a reliable regex. If a maintainer
wants to fill them in for a specific design, edit the JSON by hand or extend
this script.

Rate-limited via `shared.http.Fetcher`. Resumable on re-run — successful
entries are kept; error entries and missing designs get retried.
"""

from __future__ import annotations

import json
import re
import sys
import time
import urllib.error
from pathlib import Path

# Add catalog/vendors/ to sys.path so `shared.*` resolves.
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from shared.http import Fetcher  # noqa: E402
from shared.woocommerce import extract_size_options  # noqa: E402

HERE = Path(__file__).resolve().parent
DATA_DIR = HERE / "data"
URL_MAP_PATH = DATA_DIR / "url-to-design.json"
OUT_PATH = DATA_DIR / "scraped-per-design.json"

# WooCommerce product-page landmarks. Two title patterns — the h1 is the
# canonical one; the <title> tag is a fallback if the theme has been customized.
_TITLE_H1_RE = re.compile(
    r'<h1[^>]*class="[^"]*\bproduct_title\b[^"]*"[^>]*>(.+?)</h1>',
    re.DOTALL | re.IGNORECASE,
)
_TITLE_TAG_RE = re.compile(r"<title[^>]*>(.+?)</title>", re.DOTALL | re.IGNORECASE)
_SKU_RE = re.compile(
    r'<span[^>]*class="[^"]*\bsku\b[^"]*"[^>]*>([^<]+)</span>',
    re.IGNORECASE,
)

# Silhouette keywords we search the page text for. Order doesn't matter —
# `build.py:pick_silhouette_category` has its own priority list. The bigrams
# ("cupped rib", "long torso") are checked before their trailing unigrams
# would catch, but since we return the full match string that's just noise
# to strip out downstream, not a correctness concern.
_SILHOUETTE_KEYWORDS = [
    "hourglass",
    "cupped ribs",
    "cupped rib",
    "conical rib",
    "conical",
    "waspie",
    "longline",
    "long torso",
    "pipestem",
    "underbust",
    "overbust",
    "hip ties",
]


def _strip_html(fragment: str) -> str:
    """Remove any inner tags and collapse whitespace to single spaces."""
    return re.sub(r"\s+", " ", re.sub(r"<[^>]+>", "", fragment)).strip()


def extract_title(html: str) -> str | None:
    m = _TITLE_H1_RE.search(html)
    if m:
        return _strip_html(m.group(1))
    m = _TITLE_TAG_RE.search(html)
    if not m:
        return None
    # Strip common site-suffix separators.
    text = _strip_html(m.group(1))
    for sep in (" | ", " - ", " – "):
        if sep in text:
            return text.split(sep, 1)[0].strip()
    return text


def extract_sku(html: str) -> str | None:
    m = _SKU_RE.search(html)
    return _strip_html(m.group(1)) if m else None


def extract_silhouette_words(html: str) -> list[str]:
    """Return every silhouette keyword found in the page text (deduped, in
    canonical order). Uses word-boundary matching so `cupped ribs` doesn't
    also fire `cupped rib`; we search bigrams first and dedupe by removing
    a matched shorter form when a longer one also matched."""
    text = _strip_html(html).lower()
    matched: set[str] = set()
    for kw in _SILHOUETTE_KEYWORDS:
        pattern = r"(?<![a-z])" + re.escape(kw) + r"(?![a-z])"
        if re.search(pattern, text):
            matched.add(kw)
    # If we matched both a bigram and its shorter form, drop the shorter one.
    if "cupped ribs" in matched:
        matched.discard("cupped rib")
    if "conical rib" in matched:
        matched.discard("conical")
    if "long torso" in matched:
        matched.discard("longline")  # rarely co-occurs; be safe
    return [kw for kw in _SILHOUETTE_KEYWORDS if kw in matched]


def load_representatives() -> dict[str, str]:
    if not URL_MAP_PATH.exists():
        raise FileNotFoundError(
            f"{URL_MAP_PATH} not found. Run match_urls.py (or the orchestrator "
            "which runs it) before fetching per-design metadata."
        )
    return json.loads(URL_MAP_PATH.read_text())["representatives"]


def main() -> int:
    reps = load_representatives()
    print(f"Fetching metadata for {len(reps)} designs", flush=True)

    results: dict[str, dict] = {}
    if OUT_PATH.exists():
        try:
            results = json.loads(OUT_PATH.read_text())
            good = sum(
                1 for v in results.values()
                if isinstance(v, dict) and "error" not in v
            )
            print(f"Resuming — {good} successful entries already present", flush=True)
        except Exception:
            results = {}

    def flush() -> None:
        OUT_PATH.write_text(json.dumps(results, indent=2, sort_keys=True))

    fetcher = Fetcher()
    errors = 0
    started = time.monotonic()
    ordered_ids = sorted(reps.keys())
    for i, design_id in enumerate(ordered_ids, 1):
        existing = results.get(design_id)
        if isinstance(existing, dict) and "error" not in existing:
            continue
        url = reps[design_id]
        try:
            html = fetcher.get_text(url)
            title = extract_title(html) or ""
            sku = extract_sku(html) or ""
            silhouette_words = extract_silhouette_words(html)
            sizes = extract_size_options(html)
            results[design_id] = {
                "url": url,
                "sizes": sizes,
                "silhouette_words": silhouette_words,
                "calibration": None,
                "title": title,
                "sku": sku,
                "hardcoded_measurements": None,
            }
            print(
                f"[{i}/{len(reps)}] {design_id} -> title={title!r}, "
                f"{len(sizes)} sizes, silhouette={silhouette_words}",
                flush=True,
            )
        except urllib.error.HTTPError as e:
            results[design_id] = {"error": f"HTTP {e.code}", "url": url}
            errors += 1
            print(f"[{i}/{len(reps)}] {design_id} -> ERROR HTTP {e.code}", flush=True)
        except Exception as e:
            results[design_id] = {"error": f"{type(e).__name__}: {e}", "url": url}
            errors += 1
            print(
                f"[{i}/{len(reps)}] {design_id} -> ERROR {type(e).__name__}: {e}",
                flush=True,
            )

        if i % 5 == 0:
            flush()

    flush()
    dur = time.monotonic() - started
    print(
        f"\nDone in {dur:.1f}s. {len(results)} designs, {errors} errors.",
        flush=True,
    )
    return 0 if errors == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
