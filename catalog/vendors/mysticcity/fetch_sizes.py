"""Fetch each variant's currently in-stock size list from MCC's product pages.

For every variant URL currently in `catalog/mystic-city.json`, GET its
product page and parse the WooCommerce `data-product_variations` JSON
to determine which waist sizes are actually in stock. Results write to
`data/per-variant-sizes.json` — a `{url: [int, ...]}` mapping, or a
`{url: {"error": "..."}` sentinel when the fetch failed or the page had no
usable stock data. The build step merges this into each variant's
`waist_sizes_in`.

The variations JSON is the source of truth — the pa_size dropdown lists
sizes regardless of stock, so parsing it produced false positives. Pages
with too many variations to inline (data-product_variations="false") fall
back to WooCommerce's Store API. See `shared/woocommerce.py` for both.

Rate-limited (see `shared.http.Fetcher` defaults). Writes incrementally
every 5 URLs so a Ctrl-C mid-run doesn't lose progress — re-running skips
already-successful URLs and retries error entries. To refetch everything,
move the cache aside first (refresh.py does this unless --resume-sizes).
"""

from __future__ import annotations

import json
import sys
import time
import urllib.error
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from shared.http import Fetcher  # noqa: E402
from shared.woocommerce import (  # noqa: E402
    ajax_variations_product_id,
    extract_in_stock_sizes,
    fetch_in_stock_sizes_from_store_api,
)

HERE = Path(__file__).resolve().parent
DATA_DIR = HERE / "data"
CATALOG_PATH = HERE.parent.parent / "mystic-city.json"
OUT_PATH = DATA_DIR / "per-variant-sizes.json"


def load_variant_urls() -> list[str]:
    catalog = json.loads(CATALOG_PATH.read_text())
    urls: list[str] = []
    for corset in catalog["corsets"]:
        for variant in corset["variants"]:
            urls.append(variant["url"])
    return sorted(set(urls))


def main() -> int:
    if not CATALOG_PATH.exists():
        print(
            f"Catalog file {CATALOG_PATH} does not exist. Run build.py first "
            "so we know which variant URLs to fetch.",
            file=sys.stderr,
        )
        return 1

    urls = load_variant_urls()
    print(f"Total variant URLs to fetch: {len(urls)}", flush=True)

    results: dict[str, list[int] | dict[str, str]] = {}
    if OUT_PATH.exists():
        try:
            results = json.loads(OUT_PATH.read_text())
            print(f"Resuming — {len(results)} already fetched", flush=True)
        except Exception:
            results = {}

    DATA_DIR.mkdir(parents=True, exist_ok=True)

    def flush() -> None:
        OUT_PATH.write_text(json.dumps(results, indent=2, sort_keys=True))

    fetcher = Fetcher()
    errors = 0
    started = time.monotonic()
    for i, url in enumerate(urls, 1):
        if url in results and isinstance(results[url], list):
            continue
        try:
            html = fetcher.get_text(url)
            sizes = extract_in_stock_sizes(html)
            if sizes is None and (product_id := ajax_variations_product_id(html)):
                # Too many variations to inline; ask the Store API instead.
                sizes = fetch_in_stock_sizes_from_store_api(fetcher, url, product_id)
            if sizes is None:
                results[url] = {"error": "no variations data on page"}
                errors += 1
                print(f"[{i}/{len(urls)}] {url} -> ERROR no variations data on page", flush=True)
            else:
                results[url] = sizes
                note = "" if sizes else " (WARN: no in-stock sizes)"
                print(f"[{i}/{len(urls)}] {url} -> {len(sizes)} in-stock sizes{note}", flush=True)
        except urllib.error.HTTPError as e:
            results[url] = {"error": f"HTTP {e.code}"}
            errors += 1
            print(f"[{i}/{len(urls)}] {url} -> ERROR HTTP {e.code}", flush=True)
        except Exception as e:
            results[url] = {"error": f"{type(e).__name__}: {e}"}
            errors += 1
            print(f"[{i}/{len(urls)}] {url} -> ERROR {type(e).__name__}", flush=True)

        if i % 5 == 0:
            flush()

    flush()
    dur = time.monotonic() - started
    print(f"\nDone in {dur:.1f}s. {len(results)} URLs, {errors} errors.", flush=True)
    return 0 if errors == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
