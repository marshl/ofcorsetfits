"""Sitemap URL extraction.

WordPress sitemap XML is a simple `<urlset><url><loc>URL</loc></url>…` shape;
we deliberately parse it with a regex rather than an XML parser to stay
resilient to namespaced variants and stray whitespace. Both MCC and Orchard
Corset publish their product URLs this way, so this module is vendor-agnostic.
"""

from __future__ import annotations

import re

_LOC_RE = re.compile(r"<loc>([^<]+)</loc>", re.IGNORECASE)


def extract_urls(sitemap_xml: str) -> list[str]:
    """Return all URLs listed in a sitemap XML document, in the order they
    appear. Whitespace around each URL is trimmed. Duplicates are preserved
    because sitemaps sometimes list the same URL under a canonical form — the
    caller can dedupe if that matters to them."""
    return [m.strip() for m in _LOC_RE.findall(sitemap_xml)]


__all__ = ["extract_urls"]
