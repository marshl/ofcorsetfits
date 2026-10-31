"""WooCommerce product-page helpers.

WooCommerce is the ecommerce platform behind Mystic City, Orchard Corset,
Restyle, and most independent corsetiers.

Two extraction paths live here:

- `extract_size_options`: parses the `pa_size` <select> dropdown. This
  is what the dropdown SHOWS the shopper — every size the vendor lists,
  including sizes currently out of stock. Historically what our fetcher
  used, now retained mostly for reference / diagnostics.

- `extract_in_stock_sizes`: parses the JSON payload WooCommerce inlines
  on the `variations_form` div as `data-product_variations` — one
  variation object per (size × other attributes) combo, carrying
  `is_in_stock` per variation. This is the source of truth for "can I
  buy this size right now." This is what the pipeline should use.

- `fetch_in_stock_sizes_from_store_api`: the same answer for products
  with too many variations to inline (size × colour over WooCommerce's
  threshold, 30 by default), whose pages carry
  `data-product_variations="false"`. Reads the public Store API instead:
  one request for the variation list, then batches of 100 for stock.

Empirically (MCC, October 2026): a product's dropdown can list 7 sizes
while the variations JSON shows only 1 in stock — the difference is a
correctness-critical UX distinction, not a rounding error.
"""

from __future__ import annotations

import html as _html
import json
import re
import urllib.parse

from shared.http import Fetcher

_SIZE_SELECT_RE = re.compile(
    r'<select[^>]*id="pa_size"[^>]*>(.+?)</select>',
    re.DOTALL | re.IGNORECASE,
)
_OPTION_VALUE_RE = re.compile(
    r'<option[^>]*value="(\d+)"',
    re.IGNORECASE,
)
_VARIATIONS_JSON_RE = re.compile(
    r'data-product_variations="([^"]+)"',
)
_AJAX_VARIATIONS_FORM_RE = re.compile(
    r'<form[^>]*class="[^"]*variations_form[^"]*"[^>]*'
    r'data-product_id="(\d+)"[^>]*data-product_variations="false"',
)
_LEADING_INT_RE = re.compile(r"\d+")

# Store API caps per_page at 100.
_STORE_API_PAGE_SIZE = 100

# WooCommerce keys the size attribute under `attribute_pa_size` when it's
# a "product attribute" (`pa_` prefix — the standard for MCC and most
# corsetiers) and under `attribute_size` for a plain custom attribute.
# Try both so we don't need per-site tuning if a vendor migrates.
_SIZE_ATTR_KEYS = ("attribute_pa_size", "attribute_size")


def extract_size_options(html: str) -> list[int]:
    """Return the sorted, deduplicated list of numeric size options in
    the pa_size dropdown. **Includes out-of-stock sizes.** Prefer
    `extract_in_stock_sizes` for anything that decides purchasability.
    """
    m = _SIZE_SELECT_RE.search(html)
    if not m:
        return []
    return sorted({int(v) for v in _OPTION_VALUE_RE.findall(m.group(1))})


def extract_in_stock_sizes(html: str) -> list[int] | None:
    """Return the sorted, deduplicated list of currently-in-stock
    numeric waist sizes for a WooCommerce product page.

    Reads the `data-product_variations` JSON blob inlined on the
    `variations_form` div — one variation object per (size × other
    attributes) combo — and keeps only variations with `is_in_stock`
    true. Non-numeric size values (e.g. an unrelated custom attribute)
    are silently skipped.

    Returns an empty list when every variation is out of stock — callers
    treat that as "currently unbuyable".

    Returns None when the page has no usable variations data: the blob is
    missing (simple product, bot-check page), unparseable, or "false"
    (WooCommerce loads variations over AJAX once a product has more than
    its threshold, 30 by default). Stock is unknown in those cases, so
    callers should treat it as a failed fetch rather than out of stock,
    or, for the "false" case, use fetch_in_stock_sizes_from_store_api.
    """
    m = _VARIATIONS_JSON_RE.search(html)
    if not m:
        return None
    try:
        variations = json.loads(_html.unescape(m.group(1)))
    except json.JSONDecodeError:
        return None
    if not isinstance(variations, list):
        return None
    sizes: set[int] = set()
    for v in variations:
        if not isinstance(v, dict):
            continue
        if not v.get("is_in_stock"):
            continue
        attrs = v.get("attributes") or {}
        if not isinstance(attrs, dict):
            continue
        for key in _SIZE_ATTR_KEYS:
            raw = attrs.get(key)
            if raw is None:
                continue
            try:
                sizes.add(int(raw))
            except (ValueError, TypeError):
                pass
            break
    return sorted(sizes)


def ajax_variations_product_id(html: str) -> int | None:
    """Product ID when the page defers its variations to AJAX
    (data-product_variations="false"), else None."""
    m = _AJAX_VARIATIONS_FORM_RE.search(html)
    return int(m.group(1)) if m else None


def fetch_in_stock_sizes_from_store_api(
    fetcher: Fetcher,
    product_url: str,
    product_id: int,
) -> list[int]:
    """In-stock sizes for a product whose variations aren't inlined, read
    from the WooCommerce Store API on the product's own site. A size is in
    stock if any variation with that size is (whatever its colour), which
    matches extract_in_stock_sizes. Raises ValueError if the response
    doesn't have the expected shape.
    """
    parts = urllib.parse.urlsplit(product_url)
    api = f"{parts.scheme}://{parts.netloc}/wp-json/wc/store/v1/products"

    product = json.loads(fetcher.get_text(f"{api}/{product_id}"))
    size_by_variation: dict[int, int] = {}
    for v in product.get("variations") or []:
        for attr in v.get("attributes") or []:
            name = str(attr.get("name", "")).lower().removeprefix("pa_")
            m = _LEADING_INT_RE.search(str(attr.get("value", "")))
            if name == "size" and m:
                size_by_variation[v["id"]] = int(m.group())
                break
    if not size_by_variation:
        raise ValueError(f"Store API product {product_id} has no sized variations")

    ids = sorted(size_by_variation)
    sizes: set[int] = set()
    seen = 0
    for start in range(0, len(ids), _STORE_API_PAGE_SIZE):
        chunk = ids[start:start + _STORE_API_PAGE_SIZE]
        query = urllib.parse.urlencode({
            "type": "variation",
            "include": ",".join(map(str, chunk)),
            "per_page": _STORE_API_PAGE_SIZE,
        })
        items = json.loads(fetcher.get_text(f"{api}?{query}"))
        if not isinstance(items, list):
            raise ValueError(f"Store API returned {type(items).__name__}, expected a list")
        for item in items:
            if item.get("id") in size_by_variation:
                seen += 1
                if item.get("is_in_stock"):
                    sizes.add(size_by_variation[item["id"]])
    if seen != len(ids):
        raise ValueError(f"Store API returned {seen} of {len(ids)} variations")
    return sorted(sizes)


__all__ = [
    "ajax_variations_product_id",
    "extract_in_stock_sizes",
    "extract_size_options",
    "fetch_in_stock_sizes_from_store_api",
]
