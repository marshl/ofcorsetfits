"""Shopify storefront helpers — mirror of `woocommerce.py` for the other big
ecommerce platform.

Every Shopify storefront exposes a documented set of unauthenticated
read-only JSON endpoints (see any store's `/agents.md` and their robots.txt).
The two we care about for catalog building:

  * `/collections/{handle}/products.json?limit=250&page=N` — paginated bulk
    fetch of every product in a collection, structured JSON, no HTML parsing.
    Common handle is `all` which lists every published product.
  * `/products/{handle}.js` — single-product JSON with the full storefront
    view (options, variants, tags, description HTML, images).

Both endpoints follow a stable schema across every Shopify store, so this
module is vendor-agnostic — a future vendor built on Shopify only needs to
supply their base URL.
"""

from __future__ import annotations

import json
from typing import Iterator

# Callers put `catalog/vendors/` on sys.path (see the sys.path.insert lines
# in each vendor's scripts), which makes `shared` a namespace package and
# `shared.http` importable from anywhere.
from shared.http import Fetcher


def iter_all_products(
    fetcher: Fetcher,
    base_url: str,
    collection: str = "all",
    limit: int = 250,
) -> Iterator[dict]:
    """Yield every product in a Shopify collection by paginating
    `/collections/{collection}/products.json`.

    Shopify caps `limit` at 250 per page. Iteration stops when a page returns
    an empty `products` array. `page` is 1-indexed (Shopify convention).
    """
    if base_url.endswith("/"):
        base_url = base_url[:-1]
    page = 1
    while True:
        url = f"{base_url}/collections/{collection}/products.json?limit={limit}&page={page}"
        body = fetcher.get_text(url)
        payload = json.loads(body)
        products = payload.get("products") or []
        if not products:
            return
        for product in products:
            yield product
        if len(products) < limit:
            return
        page += 1


def fetch_product_full(fetcher: Fetcher, product_url: str) -> dict:
    """Fetch the richer single-product JSON at `<url>.js`. This gives the
    description body, tags, and options that `products.json` sometimes
    truncates or omits."""
    if product_url.endswith("/"):
        product_url = product_url[:-1]
    return json.loads(fetcher.get_text(product_url + ".js"))


__all__ = ["iter_all_products", "fetch_product_full"]
