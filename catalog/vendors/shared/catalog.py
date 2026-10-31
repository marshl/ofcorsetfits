"""Writing a vendor catalog file (catalog/<vendor>.json)."""

from __future__ import annotations

import json
from pathlib import Path


def write_catalog(path: Path, catalog: dict) -> bool:
    """
    Write the catalog, keeping the existing file's generated_at_iso when
    nothing else in it has changed, so a refresh that finds no changes
    leaves the file untouched. generated_at_iso therefore means "data last
    changed", which is what the app shows. Returns True if the content
    changed.
    """
    try:
        previous = json.loads(path.read_text())
    except (OSError, json.JSONDecodeError):
        previous = None

    def without_timestamp(c: dict) -> dict:
        return {k: v for k, v in c.items() if k != "generated_at_iso"}

    changed = previous is None or without_timestamp(previous) != without_timestamp(catalog)
    if not changed:
        catalog = {**catalog, "generated_at_iso": previous["generated_at_iso"]}
    path.write_text(json.dumps(catalog, indent=2))
    return changed


__all__ = ["write_catalog"]
