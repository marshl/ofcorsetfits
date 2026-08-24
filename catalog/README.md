# Catalog

This directory holds the vendor-agnostic catalog files consumed by the app, plus the per-vendor pipelines that build them.

## Layout

```
catalog/
├── mystic-city.json              # OUTPUT: catalog the app imports
├── vendors/
│   ├── shared/                   # vendor-agnostic helpers
│   │   ├── http.py               # rate-limited GET, safe writes, standard UA
│   │   ├── sitemap.py            # WordPress sitemap XML → URL list
│   │   ├── woocommerce.py        # WooCommerce pa_size dropdown parser
│   │   └── stretch_class.py      # title-keyword → stretch_class classifier
│   └── mysticcity/               # MCC-specific pipeline + data
│       ├── refresh.py            # end-to-end orchestrator (steps 1-8)
│       ├── fetch_sitemap.py            # 1: product-sitemap.xml → product-urls.txt
│       ├── fetch_comparison_chart.py   # 2: ninja_tables ajax → raw JSON
│       ├── match_urls.py               # 3: sitemap × chart → url-to-design.json
│       ├── fetch_page_meta.py          # 4: each rep URL → scraped-per-design.json
│       ├── review_hip_positions.py     # 5: interactive prompt → hip-positions.yaml
│       ├── build.py                    # 6+8: merge sources → catalog/mystic-city.json
│       ├── fetch_sizes.py              # 7: each variant URL → per-variant-sizes.json
│       ├── analyze_variant_sizes.py    # one-off diagnostic
│       └── data/                       # input + intermediate files
│           ├── product-sitemap.xml
│           ├── product-urls.txt
│           ├── comparison-chart.raw.json
│           ├── url-to-design.json
│           ├── scraped-per-design.json
│           ├── hip-positions.yaml           # human-edited via review_hip_positions.py
│           └── per-variant-sizes.json
```

The catalog schema (documented in the design doc + `src/scoring/types.ts`) is vendor-agnostic: `brand`, `brand_url`, `brand_waist_slack_by_stretch_class_in`, `sources`, `generated_at_iso`, `corsets: [...]`. To add a new vendor, create a sibling folder under `vendors/` (e.g. `vendors/orchardcorset/`) with its own `refresh.py` + `build.py`, reuse the shared helpers, and write to `catalog/<vendor-slug>.json`.

## Rebuilding from scratch

```bash
# Full end-to-end refresh (fetches sitemap + chart + sizes, builds catalog):
python3 catalog/vendors/mysticcity/refresh.py

# Only rebuild from cached data (no HTTP):
python3 catalog/vendors/mysticcity/refresh.py --skip-fetch

# Skip individual fetch steps if their cache is still current:
python3 catalog/vendors/mysticcity/refresh.py --skip-sitemap --skip-chart

# If the ninja_tables nonce auto-detect breaks, grep the current nonce
# out of any MCC page's HTML and pass it explicitly:
python3 catalog/vendors/mysticcity/refresh.py --nonce <public-nonce>
```

The pipeline runs 8 steps: fetch sitemap → fetch chart → match URLs → fetch page meta → **interactive** hip-position review (prompts only for new designs) → build v1 (structure only) → fetch sizes → build v2 (with sizes). The double-build is intentional and cheap; step 6 is HTTP-free.

Rate limits: `shared.http.Fetcher` waits 2 s between requests by default. A full end-to-end fetch is ~135 variant URLs + 57 rep URLs + 1 sitemap + 1 chart ≈ 6–7 minutes wall clock.

**Interactive hip-position step:** MCC's size-chart images encode the vertical hip positions in green annotations that can't be scraped from HTML. `review_hip_positions.py` walks you through each unreviewed design, prints the product URL + full context (title, springs, torso length, sizes, silhouette words, materials), and prompts for values. Entries save incrementally — Ctrl-C is safe, re-running resumes. Non-interactive mode via `--assume-defaults` fills new designs with 4.0 / 6.0 / inferred-stretch when a human review isn't practical.

## Source and use notes

Data is factual (measurements, sizes) — factual data is not copyrightable in most jurisdictions. MCC's `robots.txt` explicitly permits access to `/wp-admin/admin-ajax.php` and does not disallow product pages. Requests are rate-limited and the User-Agent identifies the project and contact.

The tool this data feeds is a fit-finder that directs users toward buying corsets, i.e. aligned with vendors' interests rather than competing.

If a vendor ever objects to their data being in this repo, the right response is to remove the raw JSON for that vendor and refactor to compute needed values on the fly from the public endpoints at page load. The static JSON is a convenience for offline dev.

## Related

- Design doc: `~/.gstack/projects/ofcorsetfits/liam-master-design-20260717-202237.md`
- Auto-memory: `~/.claude/projects/-home-liam-Documents-ofcorsetfits/memory/project_ofcorsetfits_catalog_state.md`
