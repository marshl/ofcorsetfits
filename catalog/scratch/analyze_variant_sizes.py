"""Read per-variant-sizes.json and check whether all variants of each
silhouette share the same size range.

Reports:
- Silhouettes where all variants share sizes (the current assumption holds)
- Silhouettes where sizes DIVERGE across variants (the current assumption is
  wrong for these — need per-variant size storage)
- Any URLs whose fetch errored
"""

from __future__ import annotations

import json
from collections import defaultdict
from pathlib import Path

HERE = Path(__file__).parent
CATALOG_PATH = HERE.parent / "mystic-city.json"
SIZES_PATH = HERE / "per-variant-sizes.json"


def main() -> None:
    catalog = json.loads(CATALOG_PATH.read_text())
    per_url = json.loads(SIZES_PATH.read_text())

    # Group URLs by silhouette (design_id) from the catalog.
    by_silhouette: dict[str, list[str]] = defaultdict(list)
    for corset in catalog["corsets"]:
        for variant in corset["variants"]:
            by_silhouette[corset["id"]].append(variant["url"])

    # Report structure
    same_sizes: list[str] = []
    diverging: list[tuple[str, dict[str, list[int]]]] = []
    errored: list[tuple[str, str, str]] = []

    for design_id, urls in sorted(by_silhouette.items()):
        # Gather each variant's sizes (excluding errored ones)
        variant_sizes: dict[str, list[int]] = {}
        for url in urls:
            entry = per_url.get(url)
            if entry is None:
                errored.append((design_id, url, "missing"))
                continue
            if isinstance(entry, dict) and "error" in entry:
                errored.append((design_id, url, entry["error"]))
                continue
            if isinstance(entry, list):
                variant_sizes[url] = sorted(entry)

        if not variant_sizes:
            continue

        # Compare — do all variants share exactly the same size list?
        first_key = next(iter(variant_sizes))
        first_sizes = variant_sizes[first_key]
        all_same = all(sizes == first_sizes for sizes in variant_sizes.values())

        if all_same:
            same_sizes.append(design_id)
        else:
            diverging.append((design_id, variant_sizes))

    print("=" * 70)
    print(f"Silhouettes analyzed: {len(same_sizes) + len(diverging)}")
    print(f"  All variants share sizes: {len(same_sizes)}")
    print(f"  Sizes diverge across variants: {len(diverging)}")
    print(f"Errors: {len(errored)}")
    print("=" * 70)

    if errored:
        print("\n--- Fetch errors ---")
        for design_id, url, err in errored[:20]:
            print(f"  {design_id}: {err} — {url}")
        if len(errored) > 20:
            print(f"  ... and {len(errored) - 20} more")

    if diverging:
        print("\n--- Silhouettes with DIVERGING sizes across variants ---")
        for design_id, variant_sizes in diverging:
            print(f"\n{design_id}:")
            # Group URLs by their size list to summarize the divergence
            by_size_list: dict[tuple[int, ...], list[str]] = defaultdict(list)
            for url, sizes in variant_sizes.items():
                by_size_list[tuple(sizes)].append(url)
            for size_tuple, url_list in by_size_list.items():
                print(
                    f"  {len(url_list)} variant(s) → sizes {list(size_tuple)}"
                )
                for url in url_list[:3]:
                    print(f"    - {url}")
                if len(url_list) > 3:
                    print(f"    - ... and {len(url_list) - 3} more")
    else:
        print("\nNo divergence detected — current per-silhouette schema holds.")

    # Also compare against what's currently in the catalog for each silhouette
    print("\n" + "=" * 70)
    print("Comparison with current catalog's per-silhouette waist_sizes_in:")
    print("=" * 70)
    catalog_by_id = {c["id"]: c for c in catalog["corsets"]}
    matches_catalog = 0
    catalog_mismatch: list[tuple[str, list[int], list[int]]] = []
    for design_id, variant_sizes in [
        *[(d, {u: per_url[u] for u in urls if isinstance(per_url.get(u), list)})
          for d, urls in by_silhouette.items()]
    ]:
        if not variant_sizes:
            continue
        catalog_sizes = sorted(catalog_by_id[design_id]["waist_sizes_in"])
        # Union of what we scraped now vs current catalog claim
        union = sorted({s for sizes in variant_sizes.values() for s in sizes})
        if union == catalog_sizes:
            matches_catalog += 1
        else:
            catalog_mismatch.append((design_id, catalog_sizes, union))

    print(f"Silhouettes matching current catalog: {matches_catalog}")
    print(f"Silhouettes where re-scrape differs: {len(catalog_mismatch)}")
    if catalog_mismatch:
        for design_id, cat, actual in catalog_mismatch[:15]:
            print(f"  {design_id}:")
            print(f"    catalog says: {cat}")
            print(f"    actual union: {actual}")


if __name__ == "__main__":
    main()
