#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.10"
# dependencies = ["yt-dlp"]
# ///
"""Search YouTube and emit per-video metadata as JSON Lines on stdout.

Important caveat — read before relying on `--sort date`:
  YouTube's search returns results ranked by relevance. We then over-fetch
  that relevance-ranked pool and sort/filter client-side. This means
  `--sort date --since 6m` returns "the most recent videos within the
  relevance-ranked pool that match your query", NOT "the freshest videos
  on YouTube about your query". Bump --max to widen the pool if needed.

Examples:
    search.py "Kuala Lumpur travel" --since 6m --max 10
    search.py "espresso machine review" --sort relevance --min-duration 300
    search.py "langkawi food" --since 6m --exclude-keyword india --min-views 5000
"""

import argparse
import json
import re
import sys
from datetime import datetime, timedelta

from yt_dlp import YoutubeDL


def parse_since(spec: str) -> str:
    s = spec.strip().lower()
    if re.fullmatch(r"\d{8}", s):
        return s
    m = re.fullmatch(r"(\d+)\s*([dwmy])", s)
    if not m:
        raise ValueError(f"Invalid --since {spec!r}; use 6m / 30d / 1y / 2w / YYYYMMDD")
    n, unit = int(m.group(1)), m.group(2)
    days = {"d": 1, "w": 7, "m": 30, "y": 365}[unit] * n
    return (datetime.now() - timedelta(days=days)).strftime("%Y%m%d")


def _matches_any_keyword(text: str, keywords: list[str]) -> bool:
    if not keywords:
        return False
    t = text.lower()
    return any(k.lower() in t for k in keywords)


def main() -> int:
    p = argparse.ArgumentParser(
        description="Search YouTube; emit one JSON per line.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    p.add_argument("query", help="Search query")
    p.add_argument("--max", type=int, default=15, help="Max results to emit (default 15)")
    p.add_argument("--since", default=None, help="Recency cutoff: 6m / 30d / 1y / 2w / YYYYMMDD. Videos with missing upload dates are dropped when set.")
    p.add_argument("--sort", choices=["relevance", "date"], default="date",
                   help="Client-side sort of the relevance-ranked pool (default: date)")
    p.add_argument("--min-duration", type=int, default=None, help="Minimum video seconds")
    p.add_argument("--max-duration", type=int, default=None, help="Maximum video seconds")
    p.add_argument("--min-views", type=int, default=None, help="Minimum view count")
    p.add_argument(
        "--exclude-keyword",
        action="append",
        default=[],
        metavar="TEXT",
        help="Drop results whose title/channel/description contain TEXT (case-insensitive). Repeatable.",
    )
    p.add_argument("--oversample", type=int, default=None,
                   help="Override candidate pool size (default: 3x max with filters, 2x with --sort date, 1x otherwise)")
    args = p.parse_args()

    try:
        since = parse_since(args.since) if args.since else None
    except ValueError as e:
        print(f"error: {e}", file=sys.stderr)
        return 2

    has_filters = bool(since or args.min_duration or args.max_duration or args.min_views or args.exclude_keyword)
    # Over-fetch so client-side filtering still produces enough results.
    if args.oversample is not None:
        fetch_n = max(args.max, args.oversample)
    elif has_filters:
        fetch_n = args.max * 3
    elif args.sort == "date":
        fetch_n = args.max * 2
    else:
        fetch_n = args.max
    target = f"ytsearch{fetch_n}:{args.query}"

    ydl_opts = {
        "quiet": True,
        "no_warnings": True,
        "skip_download": True,
        "noplaylist": True,
        "extract_flat": False,
        "ignoreerrors": True,  # skip unavailable videos instead of aborting the whole search
    }

    print(f"# searching: ytsearch{fetch_n}:{args.query!r}", file=sys.stderr)
    try:
        with YoutubeDL(ydl_opts) as ydl:
            info = ydl.extract_info(target, download=False)
    except Exception as e:
        print(f"error: search failed: {e}", file=sys.stderr)
        return 1

    entries = [e for e in ((info or {}).get("entries") or []) if e]
    skipped = {"date": 0, "no_date": 0, "min_dur": 0, "max_dur": 0, "min_views": 0, "keyword": 0}
    kept: list = []

    for v in entries:
        upload = v.get("upload_date") or ""
        duration = v.get("duration") or 0
        views = v.get("view_count") or 0

        # When --since is set, drop entries with missing upload_date too.
        if since:
            if not upload:
                skipped["no_date"] += 1
                continue
            if upload < since:
                skipped["date"] += 1
                continue

        if args.min_duration and duration < args.min_duration:
            skipped["min_dur"] += 1
            continue
        if args.max_duration and duration > args.max_duration:
            skipped["max_dur"] += 1
            continue
        if args.min_views and views < args.min_views:
            skipped["min_views"] += 1
            continue

        if args.exclude_keyword:
            blob = f"{v.get('title') or ''} {v.get('channel') or v.get('uploader') or ''} {v.get('description') or ''}"
            if _matches_any_keyword(blob, args.exclude_keyword):
                skipped["keyword"] += 1
                continue

        kept.append(v)

    if args.sort == "date":
        kept.sort(key=lambda v: v.get("upload_date") or "00000000", reverse=True)

    emitted = 0
    for v in kept[: args.max]:
        out = {
            "id": v.get("id"),
            "url": v.get("webpage_url") or f"https://www.youtube.com/watch?v={v.get('id')}",
            "title": v.get("title"),
            "channel": v.get("channel") or v.get("uploader"),
            "upload_date": v.get("upload_date") or None,
            "duration": v.get("duration") or None,
            "view_count": v.get("view_count"),
            "like_count": v.get("like_count"),
            "description": (v.get("description") or "")[:1000],
        }
        print(json.dumps(out, ensure_ascii=False))
        emitted += 1

    print(
        f"# emitted={emitted}/{args.max} fetched={len(entries)} kept={len(kept)} "
        f"skipped(date={skipped['date']}, no_date={skipped['no_date']}, "
        f"min_dur={skipped['min_dur']}, max_dur={skipped['max_dur']}, "
        f"min_views={skipped['min_views']}, keyword={skipped['keyword']})",
        file=sys.stderr,
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
