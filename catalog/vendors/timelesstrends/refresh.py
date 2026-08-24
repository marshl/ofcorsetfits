"""End-to-end Timeless Trends catalog refresh.

Runs all five pipeline steps in-process:

  1. fetch_all_products    — /collections/all/products.json → products.json
  2. fetch_sizing_pages    — /pages/*-sizing-information    → sizing-tables.json
  3. review_positions      — interactive prompt            → positions.yaml
                             (prompts only for silhouettes not already reviewed)
  4. build                 — merge everything              → catalog/timeless-trends.json

There is no double-build here (unlike MCC): TT's sizes come from Shopify's
`/products.json` in step 1, not from a second per-variant fetch. The
build step already has everything it needs.

Flags:
  --skip-fetch          Skip HTTP steps (1, 2) AND the interactive review (3).
                        Only run the build against cached data.
  --skip-products       Reuse cached data/products.json.
  --skip-sizing         Reuse cached data/sizing-tables.json.
  --skip-review         Skip interactive prompt (new silhouettes stay missing).
  --assume-defaults     Passed through to review_positions.
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent))


def step_banner(n: int, total: int, title: str) -> None:
    label = f"Step {n}/{total}: {title}"
    bar = "=" * (len(label) + 8)
    print(f"\n{bar}\n=== {label} ===\n{bar}")


def _call_with_argv(fn, argv):
    saved = sys.argv[:]
    sys.argv = argv
    try:
        rc = fn()
        return rc if rc is not None else 0
    finally:
        sys.argv = saved


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--skip-fetch", action="store_true")
    parser.add_argument("--skip-products", action="store_true")
    parser.add_argument("--skip-sizing", action="store_true")
    parser.add_argument("--skip-review", action="store_true")
    parser.add_argument("--assume-defaults", action="store_true")
    args = parser.parse_args()

    if args.skip_fetch:
        args.skip_products = True
        args.skip_sizing = True
        args.skip_review = True

    import fetch_all_products
    import fetch_sizing_pages
    import review_positions
    import build

    N = 4

    if args.skip_products:
        print("Skipping products fetch (using cached products.json).")
    else:
        step_banner(1, N, "fetching product catalog")
        rc = fetch_all_products.main()
        if rc != 0:
            return rc

    if args.skip_sizing:
        print("\nSkipping sizing-pages fetch (using cached sizing-tables.json).")
    else:
        step_banner(2, N, "fetching per-silhouette sizing pages")
        rc = fetch_sizing_pages.main()
        if rc != 0:
            return rc

    if args.skip_review:
        print("\nSkipping landmark-position review (using cached positions.yaml).")
    else:
        step_banner(3, N, "reviewing landmark positions (interactive)")
        argv = ["review_positions"]
        if args.assume_defaults:
            argv.append("--assume-defaults")
        rc = _call_with_argv(review_positions.main, argv)
        if rc != 0:
            return rc

    step_banner(4, N, "building timeless-trends.json")
    build.main()
    print("\n✔ Timeless Trends catalog refresh complete.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
