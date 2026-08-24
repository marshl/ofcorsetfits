"""Fetch MCC's product sitemap and extract the product URL list.

MCC publishes every product URL at
`https://www.mysticcitycorsets.com/product-sitemap.xml` (verified against
robots.txt — product pages are not disallowed, and the sitemap is
explicitly a public entry point).

Outputs two files under `data/`:
  - `product-sitemap.xml` — the raw XML response (useful for later diffing
    if the URL set changes).
  - `product-urls.txt` — one URL per line, in sitemap order, used by the
    catalog build step to enumerate variant SKUs.
"""

from __future__ import annotations

import sys
from pathlib import Path

# Add catalog/vendors/ to sys.path so `shared.*` resolves whether this file
# is run as a script or imported by the orchestrator.
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from shared.http import Fetcher, write_text  # noqa: E402
from shared.sitemap import extract_urls  # noqa: E402

SITEMAP_URL = "https://www.mysticcitycorsets.com/product-sitemap.xml"

HERE = Path(__file__).resolve().parent
DATA_DIR = HERE / "data"
SITEMAP_PATH = DATA_DIR / "product-sitemap.xml"
URLS_PATH = DATA_DIR / "product-urls.txt"


def main() -> int:
    print(f"Fetching {SITEMAP_URL}")
    fetcher = Fetcher()
    xml = fetcher.get_text(SITEMAP_URL)
    write_text(SITEMAP_PATH, xml)
    urls = extract_urls(xml)
    write_text(URLS_PATH, "\n".join(urls) + "\n")
    print(f"Wrote {len(urls)} URLs -> {URLS_PATH.relative_to(HERE.parent.parent.parent)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
