"""Fetch every product in Timeless Trends' catalog via Shopify's documented
`/collections/all/products.json` endpoint.

Uses the paginated bulk endpoint (limit 250) rather than a per-product
fetch, per the store's own `agents.md`:

    "Browse all products: GET /collections/all
     Collection JSON: GET /collections/{handle}/products.json"

Two paginated requests suffice for TT's ~280 products. Total fetch time is
seconds, not minutes.

For products where `products.json` returns a truncated `body_html` /
missing tags, we chase the `<url>.js` endpoint for the richer per-product
JSON. That second fetch is rate-limited via the shared `Fetcher`, so a
worst-case run still stays well inside the site's per-IP limits.

Output: `data/products.json` — a `{handle: product_dict}` mapping. Each
product_dict is the raw Shopify product JSON (post-merge of the bulk +
individual views), verbatim, so downstream steps can key off whatever
Shopify fields they need without a schema change here every time.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

# Add catalog/vendors/ to sys.path so `shared.*` resolves regardless of
# how this file is invoked.
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from shared.http import Fetcher, write_json  # noqa: E402
from shared.shopify import fetch_product_full, iter_all_products  # noqa: E402

BASE_URL = "https://timeless-trends.com"

HERE = Path(__file__).resolve().parent
DATA_DIR = HERE / "data"
OUT_PATH = DATA_DIR / "products.json"


def main() -> int:
    fetcher = Fetcher()
    results: dict[str, dict] = {}

    print(f"Fetching product bulk pages from {BASE_URL}/collections/all/products.json ...", flush=True)
    n_bulk = 0
    for product in iter_all_products(fetcher, BASE_URL, collection="all", limit=250):
        handle = product.get("handle")
        if not handle:
            continue
        results[handle] = product
        n_bulk += 1
    print(f"  bulk: {n_bulk} products", flush=True)

    # The bulk endpoint sometimes returns a shorter body_html and omits
    # `type`/`tags` shape variance across Shopify versions. For catalog
    # building we need `type` (silhouette+length code) and `tags`
    # (materials). If any product is missing either, chase its .js endpoint.
    missing_meta = [
        h for h, p in results.items()
        if not p.get("product_type") and not p.get("type")
        or not (p.get("tags") or [])
    ]
    if missing_meta:
        print(f"  chasing .js for {len(missing_meta)} products with missing type/tags", flush=True)
        for i, handle in enumerate(missing_meta, 1):
            url = f"{BASE_URL}/products/{handle}"
            try:
                rich = fetch_product_full(fetcher, url)
                # Merge — keep bulk fields but overlay anything the .js has.
                results[handle] = {**results[handle], **rich}
                print(f"    [{i}/{len(missing_meta)}] {handle}", flush=True)
            except Exception as e:
                print(f"    [{i}/{len(missing_meta)}] {handle} -> ERROR {type(e).__name__}: {e}", flush=True)

    DATA_DIR.mkdir(parents=True, exist_ok=True)
    write_json(OUT_PATH, results, sort_keys=True)
    print(f"\nWrote {OUT_PATH.relative_to(HERE.parent.parent.parent)} ({len(results)} products)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
