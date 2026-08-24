"""Match sitemap URLs to JSON design IDs and pick one representative per design."""

import json
import re
from collections import defaultdict
from pathlib import Path

HERE = Path(__file__).resolve().parent
DATA_DIR = HERE / "data"
JSON_PATH = DATA_DIR / "comparison-chart.raw.json"
URLS_PATH = DATA_DIR / "product-urls.txt"
OUT_PATH = DATA_DIR / "url-to-design.json"


def normalize(design_id):
    return design_id.upper().strip()


def strip_dashes(s):
    return s.replace("-", "")


def slug_from_url(url):
    m = re.match(r"^https://www\.mysticcitycorsets\.com/shop/([^/]+)/?$", url.strip())
    return m.group(1) if m else None


def match_design(slug, designs_sorted):
    """Pick the longest design ID that is a prefix of the slug (case-insensitive).

    designs_sorted is a list of normalized design IDs sorted LONGEST FIRST so
    longer matches like MCC109-C win over shorter matches like MCC109 or MCC10.
    """
    up = slug.upper()
    up_nd = strip_dashes(up)
    for did in designs_sorted:
        did_nd = strip_dashes(did)
        # Two-stage boundary check: allow either exact dash-preserved match OR
        # dash-stripped match (so JSON's "MCC109-C" matches slug "mcc109c-...").
        # The suffix must still be a word boundary (dash or end) after any
        # dash-normalized prefix consumption to avoid MCC109 grabbing mcc109c.
        for haystack, needle in ((up, did), (up_nd, did_nd)):
            if haystack.startswith(needle):
                rest_h = haystack[len(needle):]
                # Boundary check on the dash-normalized side is against the
                # NEXT ORIGINAL character in the slug; if there's a letter
                # right after where the design ID ends, we reject.
                # Compute the position in the original slug where the match
                # ends, accounting for stripped dashes.
                if haystack is up:
                    end_pos = len(needle)
                else:
                    # Count original slug chars consumed to match needle.
                    consumed = 0
                    matched = 0
                    while matched < len(needle) and consumed < len(up):
                        if up[consumed] != "-":
                            matched += 1
                        consumed += 1
                    end_pos = consumed
                rest_orig = up[end_pos:]
                if rest_orig == "" or rest_orig.startswith("-"):
                    return did
    return None


def main():
    data = json.loads(JSON_PATH.read_text())
    designs = sorted(
        {normalize(row["value"]["design"]) for row in data},
        key=lambda s: (-len(s), s),
    )
    print(f"Unique designs in JSON: {len(designs)}")

    urls = [
        u.strip() for u in URLS_PATH.read_text().splitlines()
        if u.strip() and "/shop/" in u and not u.rstrip("/").endswith("/shop")
    ]
    print(f"Product URLs from sitemap: {len(urls)}")

    by_design = defaultdict(list)
    unmatched = []
    for url in urls:
        slug = slug_from_url(url)
        if not slug:
            continue
        matched = match_design(slug, designs)
        if matched:
            by_design[matched].append(url)
        else:
            unmatched.append(url)

    print(f"Designs with at least one product URL: {len(by_design)}")
    print(f"Designs from JSON with NO product URL: "
          f"{len(designs) - len(by_design)}")
    missing = sorted(set(designs) - set(by_design.keys()))
    print("Missing designs:", missing)
    print(f"Product URLs NOT matched to any JSON design: {len(unmatched)}")
    if unmatched:
        print("First 20 unmatched URLs (may be silhouettes not in JSON, "
              "e.g. MCC-110A):")
        for u in unmatched[:20]:
            print(" ", u)

    # Pick representative per design: prefer the URL with fewest "sample" or
    # "sold-out" style qualifiers by length (shortest slug ≈ most canonical).
    representatives = {}
    for did, url_list in by_design.items():
        representatives[did] = min(url_list, key=lambda u: len(u))

    # Also propose URLs to fetch for silhouettes that appear only in the
    # sitemap (unmatched) — group by "MCC\d+[A-Z\-]*" prefix of slug.
    extras = defaultdict(list)
    extras_pattern = re.compile(r"^(MCC\d+[A-Z\-]*?)(?:[\-][A-Z]{2,})?(?:-|$)")
    for url in unmatched:
        slug = slug_from_url(url) or ""
        up = slug.upper()
        # Take everything up to the first dash after the leading MCC<num>
        m = re.match(r"^(MCC\d+[A-Z]*)", up)
        if m:
            extras[m.group(1)].append(url)
    extra_reps = {
        did: min(url_list, key=lambda u: len(u))
        for did, url_list in extras.items()
        if did not in representatives
    }
    print(f"Extra silhouettes (in sitemap, not in JSON): "
          f"{len(extra_reps)}")
    for did in sorted(extra_reps):
        print(f"  {did}: {extra_reps[did]}")

    out = {
        "unique_designs_in_json": len(designs),
        "unique_designs_with_url": len(representatives),
        "unique_extras_from_sitemap": len(extra_reps),
        "missing_from_sitemap": missing,
        "representatives": representatives,
        "extras": extra_reps,
    }
    OUT_PATH.write_text(json.dumps(out, indent=2))
    print(f"Wrote {OUT_PATH}")


if __name__ == "__main__":
    main()
