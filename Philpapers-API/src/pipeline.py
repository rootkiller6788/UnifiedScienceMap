"""Build the PhilPapers taxonomy tree, flat lookup, report and HTML map.

    python src/pipeline.py                          # from the local snapshot
    python src/pipeline.py --fetch                  # download first, then build
    python src/pipeline.py --raw path/to/other.json

All paths are resolved from this file's location, so the script can be run from
anywhere. Every file is read and written with an explicit UTF-8 encoding --
Windows consoles default to a legacy code page and would otherwise corrupt the
non-ASCII category names.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import build_tree as bt
import chord_layout
import fetch_categories
import render_map

ROOT = Path(__file__).resolve().parent.parent
DEFAULT_RAW = ROOT / "data" / "categories.raw.json"
DEFAULT_OUT = ROOT / "output"


def write_text(path: Path, text: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text, encoding="utf-8")


def write_json(path: Path, obj) -> None:
    write_text(path, json.dumps(obj, ensure_ascii=False, indent=2) + "\n")


def run(
    *,
    raw_path: Path,
    out_dir: Path,
    do_fetch: bool = False,
    url: str = fetch_categories.SNAPSHOT_URL,
    title: str = "PhilPapers Taxonomy",
    web_dir: Path | None = None,
) -> dict:
    """Fetch if asked, then build every output. Returns the report dict."""
    if do_fetch:
        size = fetch_categories.fetch_snapshot(url, dest=raw_path)
        print(f"fetched {size:,} bytes -> {raw_path}")

    if not raw_path.exists():
        raise FileNotFoundError(
            f"snapshot not found at {raw_path}\n"
            f"Run with --fetch to download it, or place the file there manually."
        )

    raw = json.loads(raw_path.read_text(encoding="utf-8"))

    records, parse_problems = bt.parse_records(raw)
    result = bt.build_forest(records, prior_problems=parse_problems)
    report = bt.build_report(result, source=str(raw_path), record_count=len(records))

    nested = bt.to_nested(result)
    flat = bt.to_flat(result)

    write_json(out_dir / "philpapers-taxonomy.json", nested)
    write_json(out_dir / "taxonomy-flat.json", flat)
    write_json(out_dir / "report.json", report)
    write_text(
        out_dir / "map.html",
        render_map.render_map(nested, stats=result.stats, source=str(raw_path), title=title),
    )

    # The chord dataset is small and standalone, so the "Unified Science Map"
    # app can load it as its own mode without touching map.html.
    chord = chord_layout.build_chord(nested)
    chord["meta"]["title"] = title
    chord["meta"]["source"] = Path(raw_path).name
    write_json(out_dir / "chord.json", chord)
    if web_dir is not None:
        write_json(web_dir / "philpapers-chord.json", chord)

    return report


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--raw", type=Path, default=DEFAULT_RAW,
                        help=f"snapshot to read (default: {DEFAULT_RAW})")
    parser.add_argument("--out", type=Path, default=DEFAULT_OUT,
                        help=f"output directory (default: {DEFAULT_OUT})")
    parser.add_argument("--fetch", action="store_true",
                        help="download the snapshot before building")
    parser.add_argument("--url", default=fetch_categories.SNAPSHOT_URL,
                        help="snapshot URL used by --fetch")
    parser.add_argument("--web-dir", type=Path, default=None,
                        help="also copy the chord dataset there as philpapers-chord.json, "
                             "for the local map app to serve")
    args = parser.parse_args(argv)

    try:
        report = run(raw_path=args.raw, out_dir=args.out, do_fetch=args.fetch,
                     url=args.url, web_dir=args.web_dir)
    except (FileNotFoundError, fetch_categories.FetchError) as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 1

    stats = report["stats"]
    counts = report["problemCounts"]
    print(f"records {report['recordCount']:,} | nodes {stats['nodes']:,} "
          f"| roots {stats['roots']} | max depth {stats['maxDepth']} "
          f"| cross-listed {stats['multiParent']:,}")
    if counts:
        summary = ", ".join(f"{kind}={n}" for kind, n in counts.items())
        print(f"diagnostics: {summary}")
    print(f"wrote {args.out}/philpapers-taxonomy.json, taxonomy-flat.json, report.json, "
          f"map.html, chord.json")
    if args.web_dir is not None:
        print(f"wrote {args.web_dir}/philpapers-chord.json")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
