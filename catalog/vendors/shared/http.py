"""Rate-limited HTTP GET plus a couple of small filesystem helpers used by
every vendor's fetch step.

Kept deliberately dependency-free — Python stdlib only — so the catalog
pipeline runs in any Python 3.10+ environment without a venv setup.
"""

from __future__ import annotations

import json
import time
import urllib.error
import urllib.request
from pathlib import Path

# One shared identifier — no incentive to lie to the sites we scrape, and
# it makes it trivial for a webmaster to identify (and reach out about) the
# traffic if it's ever a problem.
DEFAULT_USER_AGENT = (
    "ofcorsetfits-catalog-builder/0.1 "
    "(liam.marshall@repositpower.com; personal fit-calculator project)"
)


class Fetcher:
    """Rate-limited HTTP GET client. Reuses one client-side sleep-guard so
    consecutive calls from the same script don't accidentally burst — set
    the rate once in the constructor and forget."""

    def __init__(
        self,
        rate_limit_seconds: float = 2.0,
        user_agent: str = DEFAULT_USER_AGENT,
        timeout_seconds: float = 30.0,
    ) -> None:
        self.rate_limit_seconds = rate_limit_seconds
        self.user_agent = user_agent
        self.timeout_seconds = timeout_seconds
        self._last_request_at: float | None = None

    def get_text(self, url: str) -> str:
        self._sleep_if_needed()
        req = urllib.request.Request(url, headers={"User-Agent": self.user_agent})
        try:
            with urllib.request.urlopen(req, timeout=self.timeout_seconds) as resp:
                data = resp.read()
        finally:
            self._last_request_at = time.monotonic()
        return data.decode("utf-8", errors="replace")

    def _sleep_if_needed(self) -> None:
        if self._last_request_at is None:
            return
        elapsed = time.monotonic() - self._last_request_at
        remaining = self.rate_limit_seconds - elapsed
        if remaining > 0:
            time.sleep(remaining)


def write_json(path: Path, data: object, *, indent: int = 2, sort_keys: bool = True) -> None:
    """Atomic-ish JSON write: serialize to a sibling `.tmp` and rename over
    the destination. Prevents leaving a truncated file behind if the process
    is killed mid-write."""
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(json.dumps(data, indent=indent, sort_keys=sort_keys))
    tmp.replace(path)


def write_text(path: Path, text: str) -> None:
    """Atomic-ish text write. Same rationale as `write_json`."""
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(text)
    tmp.replace(path)


__all__ = ["DEFAULT_USER_AGENT", "Fetcher", "write_json", "write_text"]
