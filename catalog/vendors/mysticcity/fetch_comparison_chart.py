"""Fetch MCC's public "Corset Comparison Chart" data (spring/geometry table).

The chart is a WordPress `ninja_tables` table (table id 18400) served
through an ajax endpoint that requires a public nonce. Two moving parts
we accommodate:

  * The DISPLAY PAGE URL — the human-visible page that embeds the chart's
    JS. Grep the current nonce off it. MCC has renamed this page at least
    once (`/corset-comparison-chart/` → `/corset-comparison/`), so it's
    overridable via `--chart-url`.
  * The NONCE — rotates on each WP cache-purge. Auto-detected from the
    display page HTML via NONCE_PATTERNS; override via `--nonce` if the
    patterns fall out of date.

The ajax URL itself and the numeric table id (18400) are hard-coded here.
If MCC ever rebuilds the table in Ninja Tables, the id would change —
recovery is: view-source the display page, grep for `table_id`, update the
constant. So far this has stayed stable.

Flow:
  1. GET the display page. Regex-scan for the nonce.
  2. GET the ajax endpoint with the nonce and table id. Response is a
     JSON list, one entry per design (rib_spring, upper_hip_spring,
     low_hip_spring, underbust_length, princess_seam, torso_length, …).

Writes `data/comparison-chart.raw.json`.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from shared.http import Fetcher, write_json  # noqa: E402

TABLE_ID = 18400
AJAX_URL_TEMPLATE = (
    "https://www.mysticcitycorsets.com/wp-admin/admin-ajax.php"
    "?action=wp_ajax_ninja_tables_public_action"
    "&table_id={table_id}"
    "&target_action=get-all-data"
    "&default_sorting=new_first"
    "&skip_rows=0"
    "&limit_rows=0"
    "&ninja_table_public_nonce={nonce}"
)

# The page most likely to embed the chart. If MCC renames or moves it,
# override with --chart-url.
DEFAULT_CHART_URL = "https://www.mysticcitycorsets.com/corset-comparison/"

# Nonce patterns to try, in order. Ninja Tables has varied over versions —
# the value is typically a lowercase-hex string, 10 chars.
NONCE_PATTERNS = [
    r'ninja_table_public_nonce["\']?\s*[:=]\s*["\']([a-f0-9]+)["\']',
    r'"public_nonce"\s*:\s*"([a-f0-9]+)"',
    r'nonce\s*=\s*["\']([a-f0-9]+)["\']',
]

HERE = Path(__file__).resolve().parent
DATA_DIR = HERE / "data"
OUT_PATH = DATA_DIR / "comparison-chart.raw.json"


def detect_nonce(html: str) -> str | None:
    for pat in NONCE_PATTERNS:
        m = re.search(pat, html, re.IGNORECASE)
        if m:
            return m.group(1)
    return None


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument(
        "--chart-url",
        default=DEFAULT_CHART_URL,
        help=(
            "MCC page that embeds the comparison chart (used to auto-detect "
            f"the public nonce). Default: {DEFAULT_CHART_URL}"
        ),
    )
    parser.add_argument(
        "--nonce",
        default=None,
        help=(
            "Override the auto-detected nonce. Use this only if the regex "
            "patterns fall out of date — file an update afterward."
        ),
    )
    args = parser.parse_args()

    fetcher = Fetcher()

    if args.nonce:
        nonce = args.nonce
        print(f"Using nonce from --nonce override: {nonce}")
    else:
        print(f"Fetching chart page to detect nonce: {args.chart_url}")
        page_html = fetcher.get_text(args.chart_url)
        nonce = detect_nonce(page_html)
        if nonce is None:
            print(
                "\nFAILED to detect ninja_tables public nonce on the chart page.",
                file=sys.stderr,
            )
            print(
                "The page HTML did not match any of the known nonce patterns:",
                file=sys.stderr,
            )
            for pat in NONCE_PATTERNS:
                print(f"  - {pat}", file=sys.stderr)
            print(
                "\nGrep the page source for a value that looks like the current nonce "
                "(usually a short lowercase-hex string), then re-run with:\n"
                "  python3 fetch_comparison_chart.py --nonce <value>\n"
                "and add the working regex to NONCE_PATTERNS.",
                file=sys.stderr,
            )
            return 1
        print(f"Detected nonce: {nonce}")

    ajax_url = AJAX_URL_TEMPLATE.format(table_id=TABLE_ID, nonce=nonce)
    print(f"Fetching ajax endpoint")
    body = fetcher.get_text(ajax_url)
    try:
        parsed = json.loads(body)
    except json.JSONDecodeError as e:
        print(
            f"\nAjax response wasn't valid JSON ({e}). First 200 chars of body:\n"
            f"{body[:200]}",
            file=sys.stderr,
        )
        return 1
    write_json(OUT_PATH, parsed, sort_keys=False)
    n = len(parsed) if isinstance(parsed, list) else "n/a"
    print(f"Wrote {n} rows -> {OUT_PATH.relative_to(HERE.parent.parent.parent)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
