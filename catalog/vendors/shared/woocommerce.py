"""WooCommerce product-page helpers.

WooCommerce is the ecommerce platform behind Mystic City, Orchard Corset,
Restyle, and most independent corsetiers. Its product-variant dropdown
follows a predictable pattern:

    <select … id="pa_size"…>
      <option value="">Choose an option</option>
      <option value="18">18</option>
      <option value="20">20</option>
      …
    </select>

Options with an empty `value` are the placeholder row — skip them. Numeric
values are the offered waist sizes in inches. This module extracts them
from raw HTML with regex; a full HTML parser would be overkill given
WooCommerce's template stability.
"""

from __future__ import annotations

import re

_SIZE_SELECT_RE = re.compile(
    r'<select[^>]*id="pa_size"[^>]*>(.+?)</select>',
    re.DOTALL | re.IGNORECASE,
)
_OPTION_VALUE_RE = re.compile(
    r'<option[^>]*value="(\d+)"',
    re.IGNORECASE,
)


def extract_size_options(html: str) -> list[int]:
    """Return the sorted, deduplicated list of numeric size options offered
    on a WooCommerce product page. An empty list means the size dropdown
    was absent or empty — treat as "currently unbuyable" at the caller."""
    m = _SIZE_SELECT_RE.search(html)
    if not m:
        return []
    return sorted({int(v) for v in _OPTION_VALUE_RE.findall(m.group(1))})


__all__ = ["extract_size_options"]
