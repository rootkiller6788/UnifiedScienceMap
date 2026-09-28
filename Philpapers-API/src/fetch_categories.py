"""Download the PhilPapers taxonomy snapshot and save it verbatim.

The official PhilPapers API endpoint is behind a Cloudflare JS challenge and
returns HTTP 403 regardless of credentials, so it is not usable. This module
instead fetches a publicly hosted copy of the payload that was captured while
the API was still reachable.

The bytes are written exactly as received -- no parsing, no re-encoding, no
re-serializing -- so that re-running the pipeline never depends on the network
and a failed download can never corrupt a good local copy.
"""

from __future__ import annotations

import argparse
import os
import urllib.error
import urllib.request
from pathlib import Path

SNAPSHOT_URL = (
    "https://raw.githubusercontent.com/rookslog/sophotron/main/data/categories.json"
)
DEFAULT_DEST = Path("data/categories.raw.json")
TIMEOUT_SECONDS = 60.0
USER_AGENT = "philpapers-taxonomy-map/1.0 (personal research use)"


class FetchError(RuntimeError):
    """Raised when the snapshot cannot be retrieved or looks wrong."""


def looks_like_json(payload: bytes) -> bool:
    """True when the payload starts with a JSON array or object.

    Guards against persisting an HTML error page over a good raw file.
    """
    stripped = payload.lstrip()
    return stripped.startswith(b"[") or stripped.startswith(b"{")


def save_raw(payload: bytes, dest: Path) -> None:
    """Atomically write bytes to ``dest``, creating parent directories."""
    dest.parent.mkdir(parents=True, exist_ok=True)
    tmp = dest.with_suffix(dest.suffix + ".tmp")
    tmp.write_bytes(payload)
    os.replace(tmp, dest)


def fetch_snapshot(
    url: str = SNAPSHOT_URL,
    *,
    dest: Path = DEFAULT_DEST,
    opener=urllib.request.urlopen,
    timeout: float = TIMEOUT_SECONDS,
) -> int:
    """Fetch ``url`` and save it to ``dest``. Returns the number of bytes saved."""
    request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    try:
        with opener(request, timeout=timeout) as response:
            payload = response.read()
    except urllib.error.HTTPError as exc:
        raise FetchError(f"HTTP {exc.code} fetching {url}: {exc.reason}") from exc
    except urllib.error.URLError as exc:
        raise FetchError(f"network error fetching {url}: {exc.reason}") from exc
    except TimeoutError as exc:
        raise FetchError(f"timed out after {timeout}s fetching {url}") from exc

    if not payload:
        raise FetchError(f"empty response from {url}")
    if not looks_like_json(payload):
        preview = payload[:120].decode("utf-8", "replace").replace("\n", " ")
        raise FetchError(
            f"response from {url} is not JSON (looks like an error page): {preview!r}. "
            f"Refusing to overwrite {dest}."
        )

    save_raw(payload, dest)
    return len(payload)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--url", default=SNAPSHOT_URL, help="snapshot URL")
    parser.add_argument("--dest", type=Path, default=DEFAULT_DEST, help="output path")
    args = parser.parse_args(argv)

    try:
        size = fetch_snapshot(args.url, dest=args.dest)
    except FetchError as exc:
        print(f"error: {exc}")
        return 1
    print(f"saved {size:,} bytes to {args.dest}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
