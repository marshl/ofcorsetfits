# Catalog data — Mystic City Corsets

This directory holds source data used to build `mystic-city.json`, the catalog file consumed by the app.

## Files

### Source data (from Mystic City Corsets)

- **`mystic-city-comparison-chart.raw.json`** — raw response from MCC's public "Corset Comparison Chart" ninja_tables ajax endpoint. 79 unique underbust silhouettes with per-model spring values, geometry, and torso length. Fetched 2026-07-17.
- **`scratch/product-sitemap.xml`** — raw copy of `https://www.mysticcitycorsets.com/product-sitemap.xml`. 220 product URLs.
- **`scratch/product-urls.txt`** — flat list of product URLs extracted from the sitemap.

### Derived / working files

- **`scratch/match_urls.py`** — matches sitemap product URLs to design_ids from the comparison-chart JSON by prefix (with dash normalization for cases like `MCC109-C` ↔ `mcc109c`). Picks one representative URL per silhouette.
- **`scratch/url-to-design.json`** — output of `match_urls.py`. Contains: representative URL per design, extras (silhouettes on the sitemap but not in the JSON), missing (JSON designs with no product URL, likely discontinued).
- **`scratch/scraped-per-design.json`** — per-page scrape of the ~57 representative product pages. Extracts waist sizes from the `<select>` variation dropdown, silhouette words from descriptions, and any calibration notes ("runs small", "5-6″" ranges, etc.) from HTML text.
- **`scratch/stretch_class.py`** — small classifier that maps a product title's material keywords to a `stretch_class` (`low` | `medium` | `high`). Mesh-dominant → high; hybrid → medium; structural fabrics only → low. Used to fold material-dependent stretch into the scoring model's waist slack calculation.
- **`hip-positions.yaml`** — the manual-review file. For each of 57 corsets: URL + context + editable `upper_hip_position_in`, `low_hip_position_in`, `stretch_class`. User opens each URL, verifies hip positions against the size-chart image, verifies stretch class against product materials, edits values as needed. Merged into the final catalog when done.

### Reproducibility

To refetch the comparison-chart JSON (its `ninja_table_public_nonce` may have expired):

```bash
# Load any product page in a browser, view source, and grep the current public nonce
# from a "ninja_table_public_nonce" line in the inline JS or Vue.js data. Then:

NONCE="<current-public-nonce>"
curl -sSL \
  -H "User-Agent: ofcorsetfits-catalog-builder/0.1 (personal fit-calculator project)" \
  "https://www.mysticcitycorsets.com/wp-admin/admin-ajax.php?action=wp_ajax_ninja_tables_public_action&table_id=18400&target_action=get-all-data&default_sorting=new_first&skip_rows=0&limit_rows=0&ninja_table_public_nonce=${NONCE}" \
  > mystic-city-comparison-chart.raw.json
```

To refetch the sitemap:

```bash
curl -sSL "https://www.mysticcitycorsets.com/product-sitemap.xml" > scratch/product-sitemap.xml
grep -oE '<loc>[^<]+</loc>' scratch/product-sitemap.xml | sed 's|</\?loc>||g' > scratch/product-urls.txt
```

To rerun the URL matcher:

```bash
python3 scratch/match_urls.py
```

## Source and use notes

Data is factual (measurements, sizes) — factual data is not copyrightable in most jurisdictions. Robots.txt (`https://www.mysticcitycorsets.com/robots.txt`) explicitly permits access to `/wp-admin/admin-ajax.php` and does not disallow product pages.

Requests are rate-limited to ≤1/sec during scrapes. The User-Agent string identifies the project and contact.

The tool this data feeds is a fit-finder that directs users toward buying Mystic City corsets, i.e. aligned with MCC's interests rather than competing. Product URLs should be visible in the SPA's ranked results so users can click through to buy.

If MCC ever objects to the data being in this repo, the right response is to remove the raw JSON and refactor the app to compute needed values on the fly from the (permitted) ajax endpoint at page load — the endpoint is public and browser-consumable by design. The static JSON is a convenience for offline dev.

## Related

- Design doc: `~/.gstack/projects/ofcorsetfits/liam-master-design-20260717-202237.md`
- Auto-memory: `~/.claude/projects/-home-liam-Documents-ofcorsetfits/memory/project_ofcorsetfits_catalog_state.md`
