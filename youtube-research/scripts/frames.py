#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.10"
# dependencies = ["yt-dlp", "youtube-transcript-api>=1.0.0"]
# ///
"""Extract frames (screenshots) from a YouTube video for visual research.

Designed for capturing UI flows / walkthroughs: scene-change detection grabs the
distinct on-screen states (a page nav, a modal opening, a form filling in) and
skips the near-identical frames in between. Each frame is paired with the nearest
spoken transcript line in a manifest.json so you can read "what's happening" per
screen.

Downloads the video (or just a time range), runs ffmpeg to extract frames, then
DELETES the heavy video file by default and keeps only the PNGs + manifest under
~/.cache/youtube-research/{video_id}/frames/ (override root with
YOUTUBE_RESEARCH_CACHE).

Requires ffmpeg + ffprobe on PATH. yt-dlp is pulled in via uv.

Examples:
    frames.py https://www.youtube.com/watch?v=ID            # scene-detect, whole video
    frames.py ID --section 2:10-4:30                        # only that time range
    frames.py ID --mode interval --interval 5               # one frame / 5s
    frames.py ID --mode timestamp --at 0:30,1:15,4:02       # explicit times
    frames.py ID --mode timestamp --keyword checkout        # every time they say "checkout"
    frames.py ID --scene-threshold 0.2 --max-frames 80      # more sensitive, higher cap
    frames.py ID --keep-video                               # don't delete the source mp4
"""

import argparse
import glob
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
from datetime import datetime, timezone
from pathlib import Path

# Reuse the sibling fetch.py for ID extraction + transcript retrieval/caching.
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import fetch as _fetch  # noqa: E402

_CACHE_ROOT = _fetch._CACHE_ROOT


def _hms(seconds: float) -> str:
    s = int(round(seconds))
    h, rem = divmod(s, 3600)
    m, sec = divmod(rem, 60)
    return f"{h}:{m:02d}:{sec:02d}" if h else f"{m}:{sec:02d}"


def _parse_time(spec: str) -> float:
    """Parse 'SS', 'MM:SS', or 'HH:MM:SS' (also accepts decimals) into seconds."""
    spec = spec.strip()
    parts = spec.split(":")
    try:
        nums = [float(p) for p in parts]
    except ValueError:
        raise ValueError(f"bad time spec: {spec!r}")
    if len(nums) == 1:
        return nums[0]
    if len(nums) == 2:
        return nums[0] * 60 + nums[1]
    if len(nums) == 3:
        return nums[0] * 3600 + nums[1] * 60 + nums[2]
    raise ValueError(f"bad time spec: {spec!r}")


def _check_tools() -> None:
    missing = [t for t in ("ffmpeg", "ffprobe") if shutil.which(t) is None]
    if missing:
        sys.exit(f"error: required tool(s) not on PATH: {', '.join(missing)} (install ffmpeg)")


def _load_transcript(video_id: str, language: str) -> tuple[list, str]:
    """Return (segments, source). Uses the youtube-research transcript cache when
    present, else fetches via the same path fetch.py uses."""
    cached = _fetch._cache_load(video_id, language)
    if cached and cached.get("transcript_segments"):
        return cached["transcript_segments"], cached.get("transcript_source", "cache")
    api_result = _fetch.fetch_transcript_api(video_id, language)
    if api_result:
        segs, src, _lang = api_result
        return segs, src
    segs, _lang = _fetch.fetch_transcript_ytdlp(video_id, language)
    return segs, ("yt-dlp" if segs else "none")


def _nearest_line(segments: list, t: float) -> str:
    """Transcript text active at time t, else the closest segment by start time."""
    if not segments:
        return ""
    for seg in segments:
        start = seg.get("start", 0)
        if start <= t < start + seg.get("duration", 0):
            return seg.get("text", "")
    return min(segments, key=lambda s: abs(s.get("start", 0) - t)).get("text", "")


def _probe_height(path: str) -> int | None:
    """Return the pixel height of the first video stream, or None if unknown."""
    cmd = [
        "ffprobe", "-v", "error", "-select_streams", "v:0",
        "-show_entries", "stream=height", "-of", "csv=p=0", path,
    ]
    try:
        out = subprocess.run(cmd, capture_output=True, text=True, timeout=30)
    except subprocess.TimeoutExpired:
        return None
    lines = out.stdout.strip().splitlines()
    return int(lines[0]) if lines and lines[0].isdigit() else None


def _download_video(video_id: str, dest_dir: str, resolution: int, section: str | None) -> str | None:
    """Download (a slice of) the video, capped at `resolution` height. Returns path or None."""
    height = resolution
    fmt = (
        f"bestvideo[height<={height}][ext=mp4]/bestvideo[height<={height}]/"
        f"best[height<={height}][ext=mp4]/best[height<={height}]/best"
    )
    opts = {
        "quiet": True,
        "no_warnings": True,
        "format": fmt,
        "outtmpl": os.path.join(dest_dir, "source.%(ext)s"),
        # audio is irrelevant for frames; keep the download lean
        "postprocessors": [],
        **_fetch._browser_opt(),
    }
    if section:
        try:
            start_s, end_s = section.split("-", 1)
            start, end = _parse_time(start_s), _parse_time(end_s)
        except Exception:
            raise ValueError(f"--section must look like MM:SS-MM:SS (got {section!r})")
        from yt_dlp.utils import download_range_func
        opts["download_ranges"] = download_range_func(None, [(start, end)])
        opts["force_keyframes_at_cuts"] = True

    from yt_dlp import YoutubeDL
    try:
        with YoutubeDL(opts) as ydl:
            ydl.extract_info(f"https://www.youtube.com/watch?v={video_id}", download=True)
    except Exception as e:
        print(f"#   download failed: {e}", file=sys.stderr)
        return None
    files = sorted(glob.glob(os.path.join(dest_dir, "source.*")))
    if not files:
        return None
    path = files[0]
    actual = _probe_height(path)
    if actual and actual > resolution:
        print(f"#   note: no stream <= {resolution}p available; downloaded {actual}p (cap exceeded)", file=sys.stderr)
    return path


_PTS_RE = re.compile(r"pts_time:([0-9.]+)")


def _extract_with_showinfo(video_path: str, vf: str, out_dir: str, offset: float = 0.0) -> list[tuple[str, float]]:
    """Run ffmpeg with a `showinfo` filter, returning [(frame_path, timestamp)] in order.

    `vf` must already include the selection filter; showinfo is appended here so we
    can recover the exact source pts_time of every emitted frame from stderr.
    `offset` (the section start) is added to every pts so timestamps are in
    original-video time, not clip-relative time — a section-cut clip restarts at ~0.
    """
    pattern = os.path.join(out_dir, "f_%05d.png")
    cmd = [
        "ffmpeg", "-hide_banner", "-nostdin", "-y", "-loglevel", "info",
        "-i", video_path,
        "-vf", f"{vf},showinfo",
        "-fps_mode", "vfr",
        pattern,
    ]
    try:
        proc = subprocess.run(cmd, capture_output=True, text=True, timeout=600)
    except subprocess.TimeoutExpired:
        raise RuntimeError("ffmpeg frame extraction timed out (>600s)")
    if proc.returncode != 0:
        print(proc.stderr[-1500:], file=sys.stderr)
        raise RuntimeError("ffmpeg frame extraction failed")
    times = _PTS_RE.findall(proc.stderr)
    frames = sorted(glob.glob(os.path.join(out_dir, "f_*.png")))
    pairs: list[tuple[str, float]] = []
    for i, fp in enumerate(frames):
        ts = float(times[i]) if i < len(times) else 0.0
        pairs.append((fp, ts + offset))
    return pairs


def _extract_at_times(video_path: str, times: list[float], out_dir: str, prefix: str = "t_", offset: float = 0.0) -> list[tuple[str, float]]:
    """Extract one frame at each timestamp (accurate seek). `times` are in
    original-video time; the actual seek into a section-cut clip is `t - offset`.
    The recorded timestamp stays the absolute `t`.

    `prefix` keeps these files from colliding with the scene extractor's `f_` files.
    """
    pairs: list[tuple[str, float]] = []
    for i, t in enumerate(sorted(set(times)), 1):
        seek = t - offset
        if seek < 0:
            print(f"#   skip frame at {_hms(t)} (before section start)", file=sys.stderr)
            continue
        out = os.path.join(out_dir, f"{prefix}{i:05d}.png")
        cmd = [
            "ffmpeg", "-hide_banner", "-nostdin", "-y", "-loglevel", "error",
            "-ss", f"{seek}", "-i", video_path,
            "-frames:v", "1", out,
        ]
        try:
            proc = subprocess.run(cmd, capture_output=True, text=True, timeout=120)
        except subprocess.TimeoutExpired:
            print(f"#   timeout extracting frame at {_hms(t)}", file=sys.stderr)
            continue
        if proc.returncode == 0 and os.path.isfile(out):
            pairs.append((out, t))
        else:
            print(f"#   could not extract frame at {_hms(t)}", file=sys.stderr)
    return pairs


def _apply_min_gap(pairs: list, gap: float) -> list:
    """Drop frames whose timestamp is within `gap` seconds of the last kept one.

    Scene detection fires repeatedly during zoom/transition animations, producing
    near-identical frames; this collapses those bursts to one representative frame.
    """
    if gap <= 0 or not pairs:
        return pairs
    kept = [pairs[0]]
    for fp, ts in pairs[1:]:
        if ts - kept[-1][1] >= gap:
            kept.append((fp, ts))
    return kept


def _subsample(pairs: list, max_frames: int) -> list:
    """Evenly thin a list down to at most max_frames, always keeping first and last."""
    n = len(pairs)
    if max_frames <= 0 or n <= max_frames:
        return pairs
    if max_frames == 1:
        return [pairs[0]]
    # Spread indices across the full span [0, n-1] inclusive so both ends survive.
    idx = sorted({round(i * (n - 1) / (max_frames - 1)) for i in range(max_frames)})
    return [pairs[i] for i in idx]


def _clear_raw_frames(out_dir: Path) -> None:
    """Remove un-promoted raw frames (f_*.png / t_*.png). Run at start to purge
    leftovers from a crashed prior run, and at end to drop subsampled-out frames."""
    for pat in ("f_*.png", "t_*.png"):
        for leftover in glob.glob(str(out_dir / pat)):
            try:
                os.remove(leftover)
            except OSError:
                pass


def process(video_input: str, args) -> dict:
    vid = _fetch.extract_video_id(video_input)
    if not vid:
        return {"input": video_input, "error": "could not extract video ID"}

    out_dir = _CACHE_ROOT / vid / "frames"
    if args.refresh and out_dir.exists():
        shutil.rmtree(out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    # Purge raw frames a crashed prior run may have left, so they can't be globbed
    # into this run's frame<->timestamp pairing.
    _clear_raw_frames(out_dir)

    try:
        meta = _fetch.fetch_metadata(vid)
    except Exception as e:
        return {"input": video_input, "id": vid, "error": f"metadata failed: {e}"}

    segments, tsrc = _load_transcript(vid, args.language)

    with tempfile.TemporaryDirectory() as work:
        print(f"#   downloading (<= {args.resolution}p{', section ' + args.section if args.section else ''}) ...", file=sys.stderr)
        video_path = _download_video(vid, work, args.resolution, args.section)
        if not video_path:
            return {"input": video_input, "id": vid, "error": "video download failed"}

        # A section-cut clip restarts its timeline at ~0; add the section start so
        # every recorded timestamp (and thus transcript pairing) is in video time.
        offset = 0.0
        if args.section:
            try:
                offset = _parse_time(args.section.split("-", 1)[0])
            except Exception:
                offset = 0.0

        if args.mode == "scene":
            vf = f"select='gt(scene,{args.scene_threshold})'"
            pairs = _extract_with_showinfo(video_path, vf, str(out_dir), offset)
            pairs = _apply_min_gap(pairs, args.min_gap)
            # scene filter never emits frame 0; prepend the clip's opening frame for context
            if not pairs or pairs[0][1] - offset > 1.0:
                first = _extract_at_times(video_path, [offset], str(out_dir), offset=offset)
                pairs = first + pairs
        elif args.mode == "interval":
            vf = f"fps=1/{args.interval}"
            pairs = _extract_with_showinfo(video_path, vf, str(out_dir), offset)
        elif args.mode == "timestamp":
            times: list[float] = []
            if args.at:
                times += [_parse_time(x) for x in args.at.split(",") if x.strip()]
            if args.keyword:
                kw = args.keyword.lower()
                times += [s.get("start", 0) for s in segments if kw in s.get("text", "").lower()]
            if not times:
                return {"input": video_input, "id": vid,
                        "error": "timestamp mode needs --at and/or --keyword (no matches found)"}
            pairs = _extract_at_times(video_path, times, str(out_dir), offset=offset)
        else:
            return {"input": video_input, "id": vid, "error": f"unknown mode {args.mode}"}

        if args.keep_video:
            kept = out_dir / os.path.basename(video_path)
            shutil.move(video_path, kept)

    pairs = _subsample(pairs, args.max_frames)

    # Rename to embed timestamp, build manifest
    frames_meta = []
    for i, (fp, ts) in enumerate(pairs, 1):
        final_name = f"frame_{i:04d}_t{ts:08.2f}.png"
        final_path = out_dir / final_name
        try:
            os.replace(fp, final_path)
        except OSError:
            shutil.copy(fp, final_path)
        frames_meta.append({
            "index": i,
            "file": final_name,
            "path": str(final_path),
            "timestamp": round(ts, 2),
            "timestamp_hms": _hms(ts),
            "transcript": _nearest_line(segments, ts),
        })

    # Drop any raw frames that weren't promoted (subsampled out)
    _clear_raw_frames(out_dir)

    manifest = {
        "video_id": vid,
        "url": meta.get("url"),
        "title": meta.get("title"),
        "mode": args.mode,
        "scene_threshold": args.scene_threshold if args.mode == "scene" else None,
        "interval": args.interval if args.mode == "interval" else None,
        "section": args.section,
        "resolution_cap": args.resolution,
        "transcript_source": tsrc,
        "frame_count": len(frames_meta),
        "extracted_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "frames_dir": str(out_dir),
        "frames": frames_meta,
    }
    manifest_path = out_dir / "manifest.json"
    with manifest_path.open("w") as f:
        json.dump(manifest, f, ensure_ascii=False, indent=2)

    return {
        "id": vid,
        "title": meta.get("title"),
        "mode": args.mode,
        "frame_count": len(frames_meta),
        "frames_dir": str(out_dir),
        "manifest": str(manifest_path),
        "transcript_source": tsrc,
    }


def main() -> int:
    p = argparse.ArgumentParser(description="Extract frames/screenshots from YouTube videos.")
    p.add_argument("videos", nargs="+", help="Video URLs or 11-char IDs")
    p.add_argument("--mode", choices=["scene", "interval", "timestamp"], default="scene",
                   help="scene = distinct screens (default); interval = every N sec; timestamp = explicit/keyword")
    p.add_argument("--scene-threshold", type=float, default=0.3,
                   help="Scene-change sensitivity 0-1, lower = more frames (default 0.3)")
    p.add_argument("--interval", type=float, default=5.0, help="Seconds between frames in interval mode (default 5)")
    p.add_argument("--min-gap", type=float, default=1.0,
                   help="scene mode: merge frames closer than this many seconds (default 1.0, 0 = off)")
    p.add_argument("--at", default="", help="timestamp mode: comma list e.g. 0:30,1:15,4:02")
    p.add_argument("--keyword", default="", help="timestamp mode: extract whenever transcript contains this word")
    p.add_argument("--section", default=None, help="Only download/extract this range, e.g. 2:10-4:30")
    p.add_argument("--resolution", type=int, default=1080, help="Max video height to download (default 1080)")
    p.add_argument("--max-frames", type=int, default=60, help="Cap total frames, evenly thinned (default 60)")
    p.add_argument("--language", default="en", help="Preferred transcript language for pairing (default en)")
    p.add_argument("--keep-video", action="store_true", help="Keep the downloaded video alongside frames")
    p.add_argument("--refresh", action="store_true", help="Wipe and re-extract this video's frames dir")
    p.add_argument("-o", "--output", default="-", help="Write JSON Lines summary here (default stdout)")
    args = p.parse_args()

    _check_tools()

    out = sys.stdout if args.output == "-" else open(args.output, "w")
    try:
        for i, v in enumerate(args.videos, 1):
            print(f"# [{i}/{len(args.videos)}] {v}", file=sys.stderr)
            try:
                result = process(v, args)
            except Exception as e:
                result = {"input": v, "error": f"unexpected: {e}"}
            out.write(json.dumps(result, ensure_ascii=False) + "\n")
            out.flush()
            if result.get("error"):
                print(f"#   error: {result['error']}", file=sys.stderr)
            else:
                print(f"#   ok: {result['frame_count']} frames -> {result['frames_dir']}", file=sys.stderr)
    finally:
        if out is not sys.stdout:
            out.close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
