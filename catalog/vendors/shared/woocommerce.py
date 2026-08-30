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

Empirically (MCC, October 2026): a product's dropdown can list 7 sizes
while the variations JSON shows only 1 in stock — the difference is a
correctness-critical UX distinction, not a rounding error.
"""

from __future__ import annotations

import html as _html
import json
import re

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


def extract_in_stock_sizes(html: str) -> list[int]:
    """Return the sorted, deduplicated list of currently-in-stock
    numeric waist sizes for a WooCommerce product page.

    Reads the `data-product_variations` JSON blob inlined on the
    `variations_form` div — one variation object per (size × other
    attributes) combo — and keeps only variations with `is_in_stock`
    true. Non-numeric size values (e.g. an unrelated custom attribute)
    are silently skipped.

    Returns an empty list if the variations blob is missing (simple
    product / older WC install / bot-blocked response) or every
    variation is out of stock. Callers treat that as "currently
    unbuyable" — the display marks it accordingly.
    """
    m = _VARIATIONS_JSON_RE.search(html)
    if not m:
        return []
    try:
        variations = json.loads(_html.unescape(m.group(1)))
    except json.JSONDecodeError:
        return []
    if not isinstance(variations, list):
        return []
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


__all__ = ["extract_size_options", "extract_in_stock_sizes"]
