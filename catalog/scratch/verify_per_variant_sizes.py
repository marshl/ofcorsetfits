"""Fetch every variant URL in the catalog and record its size dropdown.

Rate-limited to one request every 2 seconds. Uses a descriptive User-Agent
identifying the project. Writes results incrementally so a mid-run failure
still leaves partial data on disk.

Output: catalog/scratch/per-variant-sizes.json — a mapping from URL to a
list of integer waist sizes extracted from the WooCommerce <select> dropdown.
"""

from __future__ import annotations

import json
import re
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

HERE = Path(__file__).parent
CATALOG_PATH = HERE.parent / "mystic-city.json"
OUT_PATH = HERE / "per-variant-sizes.json"

RATE_LIMIT_SECONDS = 2.0
USER_AGENT = (
    "ofcorsetfits-catalog-builder/0.1 "
    "(liam.marshall@repositpower.com; personal fit-calculator project)"
)

# WooCommerce variation select regex — captures the numeric size value from
# each <option value="18"> line inside the size <select>. Strict enough to
# avoid catching unrelated numeric options elsewhere on the page.
SELECT_BLOCK_RE = re.compile(
    r'<select[^>]*id="pa_size"[^>]*>(.+?)</select>',
    re.DOTALL | re.IGNORECASE,
)
OPTION_VALUE_RE = re.compile(
    r'<option[^>]*value="(\d+)"',
    re.IGNORECASE,
)


def load_variant_urls() -> list[str]:
    catalog = json.loads(CATALOG_PATH.read_text())
    urls: list[str] = []
    for corset in catalog["corsets"]:
        for variant in corset["variants"]:
            urls.append(variant["url"])
    return sorted(set(urls))


def fetch(url: str) -> str:
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(req, timeout=30) as resp:
        return resp.read().decode("utf-8", errors="replace")


def extract_sizes(html: str) -> list[int]:
    m = SELECT_BLOCK_RE.search(html)
    if not m:
        return []
    return sorted({int(v) for v in OPTION_VALUE_RE.findall(m.group(1))})


def main() -> int:
    urls = load_variant_urls()
    print(f"Total variant URLs to fetch: {len(urls)}", flush=True)

    # Load existing partial results if any, so a re-run resumes.
    results: dict[str, list[int] | dict[str, str]] = {}
    if OUT_PATH.exists():
        try:
            results = json.loads(OUT_PATH.read_text())
            print(f"Resuming — {len(results)} already fetched", flush=True)
        except Exception:
            results = {}

    def flush() -> None:
        OUT_PATH.write_text(json.dumps(results, indent=2, sort_keys=True))

    errors = 0
    started = time.monotonic()
    for i, url in enumerate(urls, 1):
        if url in results and isinstance(results[url], list):
            continue
        try:
            html = fetch(url)
            sizes = extract_sizes(html)
            results[url] = sizes
            note = "" if sizes else " (WARN: empty sizes list)"
            print(f"[{i}/{len(urls)}] {url} -> {len(sizes)} sizes{note}", flush=True)
        except urllib.error.HTTPError as e:
            results[url] = {"error": f"HTTP {e.code}"}
            errors += 1
            print(f"[{i}/{len(urls)}] {url} -> ERROR HTTP {e.code}", flush=True)
        except Exception as e:
            results[url] = {"error": f"{type(e).__name__}: {e}"}
            errors += 1
            print(f"[{i}/{len(urls)}] {url} -> ERROR {type(e).__name__}", flush=True)

        # Save incrementally every 5 URLs.
        if i % 5 == 0:
            flush()
        time.sleep(RATE_LIMIT_SECONDS)

    flush()
    dur = time.monotonic() - started
    print(f"\nDone in {dur:.1f}s. {len(results)} URLs, {errors} errors.", flush=True)
    return 0 if errors == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
