"""End-to-end MCC catalog refresh — from scratch, no manual bookkeeping.

Runs all eight pipeline steps in-process:

  1. fetch_sitemap           — product-sitemap.xml -> data/product-urls.txt
  2. fetch_comparison_chart  — ninja_tables ajax   -> data/comparison-chart.raw.json
  3. match_urls              — sitemap × chart     -> data/url-to-design.json
  4. fetch_page_meta         — each rep URL       -> data/scraped-per-design.json
  5. review_hip_positions    — interactive prompt -> data/hip-positions.yaml
                                (prompts only for designs not already reviewed)
  6. build (pass 1)          — assemble catalog    -> catalog/mystic-city.json
                                (sizes still from the previous cache)
  7. fetch_sizes             — each variant URL   -> data/per-variant-sizes.json
                                (previous cache is backed up and every URL
                                 refetched, so stock is always current)
  8. build (pass 2)          — re-assemble        -> catalog/mystic-city.json
                                (now with fresh sizes)

The double-build (steps 6+8) is intentional: step 7 reads variant URLs from
the catalog written in step 6, and step 8 folds the freshly-fetched sizes
into that same structure. Step 6 is HTTP-free and cheap.

Step 5 blocks on stdin for any design that isn't already reviewed. Ctrl-C
mid-review is safe — entries save incrementally, and re-running resumes.
Pass --assume-defaults if you'd rather fill new designs with 4.0/6.0/inferred
without prompting.

Flags:
  --skip-fetch          Skip all HTTP steps (1, 2, 4, 7) AND the interactive
                        review (5). Only run match_urls + the two builds.
  --skip-sitemap        Reuse data/product-urls.txt.
  --skip-chart          Reuse data/comparison-chart.raw.json.
  --skip-match          Reuse data/url-to-design.json (only safe if the two
                        upstream files are unchanged).
  --skip-page-meta      Reuse data/scraped-per-design.json.
  --skip-review         Skip the interactive step entirely — new designs stay
                        out of the catalog until you run review_hip_positions.py.
  --skip-sizes          Reuse data/per-variant-sizes.json.
  --resume-sizes        Keep data/per-variant-sizes.json and fetch only the
                        URLs that are missing or errored. Use this to finish
                        an interrupted or partly failed run, not for a
                        normal refresh (it keeps the old stock for the rest).

Exits 1 if any size fetch failed. The catalog is still written, with those
variants listed as unbuyable, and build.py names each one; re-run with
--resume-sizes to retry just the failures.
  --assume-defaults     Passed through to review_hip_positions — fills new
                        entries with defaults instead of prompting.
  --nonce VALUE         Passed through to fetch_comparison_chart.
"""

from __future__ import annotations

import argparse
import shutil
import sys
from datetime import datetime, timezone
from pathlib import Path

HERE = Path(__file__).resolve().parent
DATA_DIR = HERE / "data"
CATALOG_PATH = HERE.parent.parent / "mystic-city.json"
SIZES_PATH = DATA_DIR / "per-variant-sizes.json"

# Add catalog/vendors/ to sys.path so both shared.* and sibling MCC modules
# import consistently regardless of how this script is invoked.
sys.path.insert(0, str(HERE.parent))


def backup_size_cache() -> Path:
    ts = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    dest = SIZES_PATH.with_name(f"per-variant-sizes.{ts}.bak.json")
    shutil.move(SIZES_PATH, dest)
    return dest


def step_banner(n: int, total: int, title: str) -> None:
    label = f"Step {n}/{total}: {title}"
    bar = "=" * (len(label) + 8)
    print(f"\n{bar}\n=== {label} ===\n{bar}")


def _call_with_argv(fn, argv: list[str]) -> int:
    """Invoke a script module's `main` after replacing sys.argv with the
    given list (whose first entry stands in for the program name). Restores
    sys.argv afterwards so subsequent step calls stay clean."""
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
    parser.add_argument("--skip-sitemap", action="store_true")
    parser.add_argument("--skip-chart", action="store_true")
    parser.add_argument("--skip-match", action="store_true")
    parser.add_argument("--skip-page-meta", action="store_true")
    parser.add_argument("--skip-review", action="store_true")
    parser.add_argument("--skip-sizes", action="store_true")
    parser.add_argument("--resume-sizes", action="store_true")
    parser.add_argument("--assume-defaults", action="store_true")
    parser.add_argument("--nonce", default=None)
    args = parser.parse_args()

    if args.skip_fetch:
        args.skip_sitemap = True
        args.skip_chart = True
        args.skip_page_meta = True
        args.skip_review = True
        args.skip_sizes = True

    import fetch_sitemap
    import fetch_comparison_chart
    import match_urls
    import fetch_page_meta
    import review_hip_positions
    import fetch_sizes
    import build

    N = 8

    # --- Step 1: sitemap ---
    if args.skip_sitemap:
        print("Skipping sitemap fetch (using cached product-urls.txt).")
    else:
        step_banner(1, N, "fetching product sitemap")
        rc = fetch_sitemap.main()
        if rc != 0:
            print(f"Sitemap fetch failed with code {rc}", file=sys.stderr)
            return rc

    # --- Step 2: comparison chart ---
    if args.skip_chart:
        print("\nSkipping comparison-chart fetch (using cached raw JSON).")
    else:
        step_banner(2, N, "fetching comparison chart")
        argv = ["fetch_comparison_chart"]
        if args.nonce:
            argv += ["--nonce", args.nonce]
        rc = _call_with_argv(fetch_comparison_chart.main, argv)
        if rc != 0:
            print(f"Chart fetch failed with code {rc}", file=sys.stderr)
            return rc

    # --- Step 3: match URLs -> url-to-design.json ---
    if args.skip_match:
        print("\nSkipping URL matching (using cached url-to-design.json).")
    else:
        step_banner(3, N, "matching sitemap URLs to design IDs")
        match_urls.main()

    # --- Step 4: page metadata (titles, silhouette words, ...) ---
    if args.skip_page_meta:
        print("\nSkipping per-design page metadata fetch (using cached scraped-per-design.json).")
    else:
        step_banner(4, N, "fetching per-design page metadata")
        rc = fetch_page_meta.main()
        if rc != 0:
            print(
                f"\nPage-meta fetch reported {rc} error(s). Continuing — "
                "designs with errors will be missing title/silhouette data in the catalog.",
                file=sys.stderr,
            )

    # --- Step 5: interactive hip-position review ---
    if args.skip_review:
        print("\nSkipping hip-position review (using cached hip-positions.yaml).")
    else:
        step_banner(5, N, "reviewing hip positions (interactive)")
        argv = ["review_hip_positions"]
        if args.assume_defaults:
            argv.append("--assume-defaults")
        rc = _call_with_argv(review_hip_positions.main, argv)
        if rc != 0:
            print(f"\nReview step exited with code {rc}", file=sys.stderr)
            return rc

    # --- Step 6: build v1 (structure, no sizes yet) ---
    step_banner(6, N, "assembling catalog structure (pass 1)")
    build.main()

    # --- Step 7: sizes ---
    size_fetch_failed = False
    if args.skip_sizes:
        print("\nSkipping size fetch (using cached per-variant-sizes.json).")
    else:
        step_banner(7, N, "fetching per-variant sizes")
        if args.resume_sizes:
            print("Resuming — only missing or errored URLs will be fetched.")
        elif SIZES_PATH.exists():
            backup = backup_size_cache()
            print(f"Backed up previous size cache -> {backup.name}; refetching all.")
        else:
            print("No previous size cache — starting fresh.")
        size_fetch_failed = fetch_sizes.main() != 0

    # --- Step 8: build v2 (with sizes) ---
    step_banner(8, N, "rebuilding catalog with fresh sizes")
    build.main()
    if size_fetch_failed:
        print(
            "\n✘ Catalog written, but some size fetches failed — those variants "
            "are listed as unbuyable (see the build warnings above). Re-run with "
            "--resume-sizes --skip-sitemap --skip-chart --skip-page-meta to "
            "retry just the failures.",
            file=sys.stderr,
        )
        return 1
    print("\n✔ Catalog refresh complete.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
