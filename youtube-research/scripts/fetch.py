#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.10"
# dependencies = ["yt-dlp", "youtube-transcript-api>=1.0.0"]
# ///
"""Fetch YouTube metadata + transcript for one or more videos as JSON Lines.

Caches transcripts under ~/.cache/youtube-research/{video_id}/{language}.json so
re-fetches in later sessions are instant. Use --refresh to ignore the cache.
Override the cache root with YOUTUBE_RESEARCH_CACHE.

Examples:
    fetch.py dQw4w9WgXcQ
    fetch.py https://www.youtube.com/watch?v=ID1 ID2 ID3 -o corpus.jsonl
    fetch.py ID --no-segments --language es
    fetch.py ID --refresh        # bypass cache and re-fetch
"""

import argparse
import glob
import json
import os
import re
import sys
import tempfile
import time
from datetime import datetime, timezone
from pathlib import Path

from yt_dlp import YoutubeDL


_COOKIES_FROM_BROWSER = os.environ.get("YOUTUBE_COOKIES_FROM_BROWSER")  # e.g. "chrome", "safari", "firefox"
_CACHE_ROOT = Path(os.environ.get("YOUTUBE_RESEARCH_CACHE", str(Path.home() / ".cache" / "youtube-research")))
_CACHE_VERSION = 1


def _browser_opt() -> dict:
    if not _COOKIES_FROM_BROWSER:
        return {}
    parts = _COOKIES_FROM_BROWSER.split(":", 1)
    return {"cookiesfrombrowser": (parts[0],) + (tuple(parts[1:]) if len(parts) > 1 else ())}


def extract_video_id(url_or_id: str) -> str | None:
    s = url_or_id.strip()
    if re.fullmatch(r"[A-Za-z0-9_-]{11}", s):
        return s
    m = re.search(
        r"(?:youtube\.com/watch\?v=|youtu\.be/|youtube\.com/embed/|youtube\.com/shorts/|youtube\.com/v/)([A-Za-z0-9_-]{11})",
        s,
    )
    return m.group(1) if m else None


_TS_RE = re.compile(
    r"^\s*[\[\(]?\s*(?:(\d{1,2}):)?(\d{1,2}):(\d{2})\s*[\]\)]?\s*[-–—:|.)]?\s*(.+?)\s*$"
)


def parse_chapters_from_description(description: str | None) -> list:
    if not description:
        return []
    chapters: list = []
    for line in description.splitlines():
        m = _TS_RE.match(line)
        if not m:
            continue
        h, mn, s, title = m.groups()
        seconds = int(s) + int(mn) * 60 + (int(h) * 3600 if h else 0)
        if title and (not chapters or seconds > chapters[-1]["start"]):
            chapters.append({"start": seconds, "title": title.strip()})
    return chapters if len(chapters) >= 2 else []


def normalize_chapters(meta: dict) -> list:
    raw = meta.get("chapters") or []
    if raw and isinstance(raw[0], dict) and "start_time" in raw[0]:
        return [{"start": int(c.get("start_time") or 0), "title": (c.get("title") or "").strip()} for c in raw]
    return parse_chapters_from_description(meta.get("description"))


def fetch_metadata(video_id: str) -> dict:
    opts = {
        "quiet": True,
        "no_warnings": True,
        "skip_download": True,
        "ignore_no_formats_error": True,
        "youtube_include_dash_manifest": False,
        "youtube_include_hls_manifest": False,
        **_browser_opt(),
    }
    with YoutubeDL(opts) as ydl:
        info = ydl.extract_info(f"https://www.youtube.com/watch?v={video_id}", download=False)
    return {
        "id": info.get("id"),
        "url": info.get("webpage_url"),
        "title": info.get("title"),
        "channel": info.get("channel") or info.get("uploader"),
        "channel_url": info.get("channel_url") or info.get("uploader_url"),
        "upload_date": info.get("upload_date"),
        "duration": info.get("duration"),
        "view_count": info.get("view_count"),
        "like_count": info.get("like_count"),
        "language": info.get("language"),
        "tags": info.get("tags") or [],
        "categories": info.get("categories") or [],
        "description": info.get("description"),
        "chapters": normalize_chapters(info),
    }


def _to_segs(transcript) -> list:
    return [
        {"start": round(s.start, 2), "duration": round(s.duration, 2), "text": s.text}
        for s in transcript.snippets
    ]


def _pick_transcript(tlist, preferred_lang: str):
    """Return (Transcript, source) where source is 'manual' or 'auto'.

    Selection order:
      1. manually-created in preferred_lang
      2. manually-created in en
      3. generated in preferred_lang
      4. generated in en
      5. any manually-created
      6. any generated
    Returns (None, None) if nothing usable.
    """
    pref = [preferred_lang] if preferred_lang else []
    en = ["en"] if "en" not in pref else []

    if pref:
        try:
            return tlist.find_manually_created_transcript(pref), "manual"
        except Exception:
            pass
    if en:
        try:
            return tlist.find_manually_created_transcript(en), "manual"
        except Exception:
            pass
    if pref:
        try:
            return tlist.find_generated_transcript(pref), "auto"
        except Exception:
            pass
    if en:
        try:
            return tlist.find_generated_transcript(en), "auto"
        except Exception:
            pass

    manual_t = None
    generated_t = None
    try:
        for t in tlist:
            is_gen = getattr(t, "is_generated", False)
            if is_gen and generated_t is None:
                generated_t = t
            elif not is_gen and manual_t is None:
                manual_t = t
            if manual_t and generated_t:
                break
    except Exception:
        pass

    if manual_t:
        return manual_t, "manual"
    if generated_t:
        return generated_t, "auto"
    return None, None


def fetch_transcript_api(video_id: str, language: str) -> tuple[list, str, str] | None:
    """Try youtube-transcript-api.

    Returns (segments, source, transcript_language) or None on failure.
    `source` is 'manual' or 'auto'. `transcript_language` is the BCP-47 code
    of the chosen transcript (e.g. 'en', 'es'), or 'unknown' if not exposed.
    """
    try:
        from youtube_transcript_api import YouTubeTranscriptApi
    except ImportError:
        return None
    api = YouTubeTranscriptApi()
    try:
        tlist = api.list(video_id)
    except Exception:
        return None
    transcript, source = _pick_transcript(tlist, language)
    if transcript is None:
        return None
    try:
        fetched = transcript.fetch()
    except Exception:
        return None
    lang_code = getattr(transcript, "language_code", None) or "unknown"
    return _to_segs(fetched), source, lang_code


def fetch_transcript_ytdlp(video_id: str, language: str) -> tuple[list, str]:
    """Fallback: download auto-generated subtitles via yt-dlp. Retries on 429.

    Returns (segments, language_code). language_code is parsed from the chosen
    subtitle filename (e.g. 'en', 'es', 'en-US') or 'unknown' if not parseable.
    Empty list means no captions found.
    """
    with tempfile.TemporaryDirectory() as tmp:
        opts = {
            "quiet": True,
            "no_warnings": True,
            "skip_download": True,
            "ignore_no_formats_error": True,
            "youtube_include_dash_manifest": False,
            "youtube_include_hls_manifest": False,
            "writesubtitles": True,
            "writeautomaticsub": True,
            "subtitleslangs": [language, "en", "en-US", "en-GB"],
            "subtitlesformat": "json3",
            "outtmpl": os.path.join(tmp, "%(id)s.%(ext)s"),
            **_browser_opt(),
        }
        for attempt, backoff in enumerate([0, 5, 15]):
            if backoff:
                print(f"#   retry after {backoff}s (429)", file=sys.stderr)
                time.sleep(backoff)
            try:
                with YoutubeDL(opts) as ydl:
                    ydl.extract_info(f"https://www.youtube.com/watch?v={video_id}", download=True)
                break
            except Exception as e:
                msg = str(e)
                if "429" in msg or "Too Many Requests" in msg:
                    if attempt < 2:
                        continue
                return [], "unknown"
        files = glob.glob(os.path.join(tmp, "*.json3"))
        if not files:
            return [], "unknown"

        def lang_of(path: str) -> str:
            # Filenames look like {video_id}.{lang}.json3
            base = os.path.basename(path)
            parts = base.split(".")
            return parts[-2] if len(parts) >= 3 else "unknown"

        ranked = sorted(files, key=lambda p: (
            0 if lang_of(p) == language else
            1 if lang_of(p).split("-")[0] == language else
            2 if lang_of(p).startswith("en") else
            3
        ))
        chosen = ranked[0]
        lang_code = lang_of(chosen)
        try:
            with open(chosen) as f:
                data = json.load(f)
        except Exception:
            return [], lang_code
        segs: list = []
        for ev in data.get("events") or []:
            if "segs" not in ev:
                continue
            text = "".join(s.get("utf8", "") for s in ev["segs"]).strip()
            if not text:
                continue
            segs.append(
                {
                    "start": round((ev.get("tStartMs") or 0) / 1000.0, 2),
                    "duration": round((ev.get("dDurationMs") or 0) / 1000.0, 2),
                    "text": text,
                }
            )
        return segs, lang_code


def _cache_path(video_id: str, language: str) -> Path:
    safe_lang = re.sub(r"[^A-Za-z0-9_-]", "_", language or "default")
    return _CACHE_ROOT / video_id / f"{safe_lang}.json"


def _cache_load(video_id: str, language: str) -> dict | None:
    path = _cache_path(video_id, language)
    if not path.is_file():
        return None
    try:
        with path.open() as f:
            payload = json.load(f)
    except Exception:
        return None
    if not isinstance(payload, dict) or payload.get("cache_version") != _CACHE_VERSION:
        return None
    return payload


def _cache_save(video_id: str, language: str, payload: dict) -> None:
    path = _cache_path(video_id, language)
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        tmp = path.with_suffix(path.suffix + ".tmp")
        with tmp.open("w") as f:
            json.dump(payload, f, ensure_ascii=False)
        tmp.replace(path)
    except Exception as e:
        print(f"#   cache write failed: {e}", file=sys.stderr)


def process(video_input: str, no_segments: bool, language: str, refresh: bool) -> dict:
    vid = extract_video_id(video_input)
    if not vid:
        return {"input": video_input, "error": "could not extract video ID"}

    cached = None if (refresh or no_segments) else _cache_load(vid, language)
    if cached:
        meta = dict(cached.get("meta") or {})
        meta["transcript_source"] = cached.get("transcript_source", "cache")
        meta["transcript_language"] = cached.get("transcript_language", "unknown")
        meta["transcript_segments"] = cached.get("transcript_segments") or []
        meta["transcript_cache"] = {
            "hit": True,
            "fetched_at": cached.get("fetched_at"),
            "path": str(_cache_path(vid, language)),
        }
        return meta

    try:
        meta = fetch_metadata(vid)
    except Exception as e:
        return {"input": video_input, "id": vid, "error": f"metadata failed: {e}"}

    if no_segments:
        meta["transcript_source"] = "skipped"
        meta["transcript_language"] = "unknown"
        meta["transcript_segments"] = []
        return meta

    api_result = fetch_transcript_api(vid, language)
    if api_result:
        segs, src, lang = api_result
    else:
        segs, lang = fetch_transcript_ytdlp(vid, language)
        src = "yt-dlp" if segs else "none"

    meta["transcript_source"] = src
    meta["transcript_language"] = lang
    meta["transcript_segments"] = segs

    if src != "none":
        _cache_save(vid, language, {
            "cache_version": _CACHE_VERSION,
            "video_id": vid,
            "requested_language": language,
            "transcript_source": src,
            "transcript_language": lang,
            "transcript_segments": segs,
            "fetched_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
            "meta": {k: v for k, v in meta.items() if k not in {"transcript_source", "transcript_language", "transcript_segments", "transcript_cache"}},
        })
    return meta


def main() -> int:
    p = argparse.ArgumentParser(description="Fetch YouTube metadata + transcript as JSON Lines.")
    p.add_argument("videos", nargs="+", help="Video URLs or 11-char IDs")
    p.add_argument("-o", "--output", default="-", help="Output file (default stdout)")
    p.add_argument("--no-segments", action="store_true", help="Metadata only, skip transcript")
    p.add_argument("--language", default="en", help="Preferred caption language code (default en)")
    p.add_argument("--sleep", type=float, default=1.5, help="Seconds to sleep between videos (default 1.5)")
    p.add_argument("--refresh", action="store_true", help="Bypass transcript cache and re-fetch")
    args = p.parse_args()

    out = sys.stdout if args.output == "-" else open(args.output, "w")
    try:
        for i, v in enumerate(args.videos, 1):
            vid_peek = extract_video_id(v)
            cache_hit = bool(
                vid_peek and not args.refresh and not args.no_segments
                and _cache_load(vid_peek, args.language)
            )
            if i > 1 and args.sleep > 0 and not cache_hit:
                time.sleep(args.sleep)
            print(f"# [{i}/{len(args.videos)}] {v}{' (cache)' if cache_hit else ''}", file=sys.stderr)
            try:
                result = process(v, args.no_segments, args.language, args.refresh)
            except Exception as e:
                result = {"input": v, "error": f"unexpected: {e}"}
            out.write(json.dumps(result, ensure_ascii=False) + "\n")
            out.flush()
            src = result.get("transcript_source", "—")
            lang = result.get("transcript_language", "—")
            segs = len(result.get("transcript_segments") or [])
            err = result.get("error")
            if err:
                print(f"#   error: {err}", file=sys.stderr)
            else:
                cache_tag = " [cached]" if (result.get("transcript_cache") or {}).get("hit") else ""
                print(f"#   ok: source={src} lang={lang} segments={segs}{cache_tag}", file=sys.stderr)
    finally:
        if out is not sys.stdout:
            out.close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
