"""Rate-limited HTTP GET plus a couple of small filesystem helpers used by
every vendor's fetch step.

Kept deliberately dependency-free — Python stdlib only — so the catalog
pipeline runs in any Python 3.10+ environment without a venv setup.
"""

from __future__ import annotations

import json
import sys
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

# Statuses worth retrying: rate limiting and transient server errors.
RETRYABLE_STATUSES = {429, 500, 502, 503, 504}


class Fetcher:
    """Rate-limited HTTP GET client. Reuses one client-side sleep-guard so
    consecutive calls from the same script don't accidentally burst — set
    the rate once in the constructor and forget.

    Rate limiting (429), transient server errors and network errors are
    retried up to max_retries times, waiting for Retry-After when the server
    sends one and backing off exponentially otherwise. Anything still
    failing after that is raised to the caller."""

    def __init__(
        self,
        rate_limit_seconds: float = 2.0,
        user_agent: str = DEFAULT_USER_AGENT,
        timeout_seconds: float = 30.0,
        max_retries: int = 3,
        backoff_seconds: float = 5.0,
        max_wait_seconds: float = 120.0,
    ) -> None:
        self.rate_limit_seconds = rate_limit_seconds
        self.user_agent = user_agent
        self.timeout_seconds = timeout_seconds
        self.max_retries = max_retries
        self.backoff_seconds = backoff_seconds
        self.max_wait_seconds = max_wait_seconds
        self._last_request_at: float | None = None

    def get_text(self, url: str) -> str:
        attempt = 0
        while True:
            try:
                return self._get_once(url)
            except urllib.error.HTTPError as e:
                if e.code not in RETRYABLE_STATUSES or attempt >= self.max_retries:
                    raise
                wait = self._retry_after(e) or self._backoff(attempt)
                reason = f"HTTP {e.code}"
            except (urllib.error.URLError, TimeoutError) as e:
                if attempt >= self.max_retries:
                    raise
                wait = self._backoff(attempt)
                reason = type(e).__name__
            attempt += 1
            print(
                f"  retry {attempt}/{self.max_retries} for {url} after {reason} "
                f"(waiting {wait:.0f}s)",
                file=sys.stderr,
                flush=True,
            )
            time.sleep(wait)

    def _get_once(self, url: str) -> str:
        self._sleep_if_needed()
        req = urllib.request.Request(url, headers={"User-Agent": self.user_agent})
        try:
            with urllib.request.urlopen(req, timeout=self.timeout_seconds) as resp:
                data = resp.read()
        finally:
            self._last_request_at = time.monotonic()
        return data.decode("utf-8", errors="replace")

    def _backoff(self, attempt: int) -> float:
        return min(self.backoff_seconds * 2 ** attempt, self.max_wait_seconds)

    def _retry_after(self, e: urllib.error.HTTPError) -> float | None:
        """Seconds from a numeric Retry-After header, capped. HTTP-date values
        are rare enough that falling back to the normal backoff is fine."""
        raw = e.headers.get("Retry-After") if e.headers else None
        try:
            return min(max(float(raw), 0.0), self.max_wait_seconds)
        except (TypeError, ValueError):
            return None

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


__all__ = ["DEFAULT_USER_AGENT", "RETRYABLE_STATUSES", "Fetcher", "write_json", "write_text"]
