---
name: youtube-research
description: Search YouTube for videos on a topic with date filtering, then extract full transcripts + metadata so the agent can synthesize answers across multiple videos (travel itineraries, market research, recipe roundups, comparison reports, "what are creators saying about X recently"). Use when the user asks to "research YouTube videos about X", "find videos about X and summarize", "build itinerary from YouTube", "watch videos about X for me", or otherwise wants information aggregated from several YouTube videos. No API key required — uses yt-dlp + youtube-transcript-api via uv.
---

# YouTube Research

Search → review → fetch transcripts → synthesize. Two composable scripts; the agent orchestrates.

## Quick start

Research recent Kuala Lumpur travel content:

```bash
# 1. Search (date-filtered, recent first, drop low-view and unwanted-perspective videos)
{baseDir}/scripts/search.py "Kuala Lumpur travel guide" \
    --since 6m --max 15 --min-views 5000 \
    --exclude-keyword india --exclude-keyword hindi > /tmp/kl.jsonl

# 2. Review /tmp/kl.jsonl, pick the most relevant videos by title/duration/views.

# 3. Fetch transcripts for the picks (cached under ~/.cache/youtube-research)
{baseDir}/scripts/fetch.py VIDEO_ID_1 VIDEO_ID_2 VIDEO_ID_3 > /tmp/kl-corpus.jsonl

# 4. Read /tmp/kl-corpus.jsonl and synthesize (itinerary, summary, comparison, etc.)
```

Replace `{baseDir}` with the directory containing this SKILL.md.

## Workflow

1. **Search broadly, but per facet.** If the topic has facets (food, transport, attractions, costs, neighborhoods), run a few focused searches rather than one diluted query. Better corpus that way.
2. **Review the metadata** before fetching transcripts — transcripts cost time. Drop clickbait, shorts under ~60s if you want substance, off-topic, or stale results.
3. **Fetch transcripts** for the kept videos with `fetch.py`. Each result is JSON with metadata + `transcript_segments: [{start, duration, text}]` + parsed chapters.
4. **Synthesize.** Quote with timestamps where useful (`[12:34]`). Note disagreements between creators. Flag claims that are clearly out of date (closed restaurant, changed prices, expired visa rule).

## Script Reference

### `scripts/search.py "<query>" [options]`

| Option | Default | Description |
|---|---|---|
| `--max N` | 15 | Max results to emit |
| `--since SPEC` | none | `6m`, `30d`, `1y`, `2w`, or `YYYYMMDD`. Videos with missing upload dates are dropped when set. |
| `--sort relevance\|date` | `date` | Client-side sort of the relevance-ranked pool |
| `--min-duration SEC` | none | Skip shorts/clips |
| `--max-duration SEC` | none | Skip multi-hour streams |
| `--min-views N` | none | Drop low-view results |
| `--exclude-keyword TEXT` | none | Drop results whose title/channel/description contain TEXT (case-insensitive). Repeatable: `--exclude-keyword india --exclude-keyword hindi`. |
| `--oversample N` | auto | Override candidate pool size (auto: 3× max with filters, 2× with `--sort date`, 1× otherwise) |

**Important caveat — `--sort date`:** YouTube's search returns results ranked by relevance. The script over-fetches that pool and sorts client-side, so `--sort date --since 6m` returns "the most recent within the relevance pool", NOT "the freshest videos on YouTube". Widen `--max` (or `--oversample`) if you need to dig deeper.

Output: JSON Lines on stdout (one video per line). Progress + per-filter skip counts on stderr.

### `scripts/fetch.py <video> [<video>...] [options]`

Each `<video>` is a YouTube URL (any common format) or an 11-char video ID.

| Option | Default | Description |
|---|---|---|
| `--output FILE` / `-o` | stdout | Write JSON Lines to a file |
| `--no-segments` | off | Metadata + chapters only, skip transcript fetch (also bypasses cache) |
| `--language LANG` | `en` | Preferred caption language code |
| `--sleep SEC` | 1.5 | Sleep between videos to avoid 429 (skipped on cache hits) |
| `--refresh` | off | Bypass transcript cache and re-fetch from YouTube |

Output: one JSON per video with `id, url, title, channel, upload_date, duration, view_count, description, chapters, transcript_source, transcript_language, transcript_segments` (plus `transcript_cache: {hit, fetched_at, path}` on cache hits).

`transcript_source` is one of:
- `manual` — human-made captions (highest quality)
- `auto` — YouTube ASR (expect typos on proper nouns)
- `yt-dlp` — fell back to yt-dlp subtitle download
- `none` — no captions available (segments empty)
- `skipped` — `--no-segments` was set

`transcript_language` is the BCP-47 code of the chosen transcript (e.g. `en`, `es`, `en-US`), or `"unknown"` when the source can't expose it.

#### Transcript cache

Transcripts are cached at `~/.cache/youtube-research/{video_id}/{language}.json` (override the root with `YOUTUBE_RESEARCH_CACHE=/path`). Cache hits skip both the network fetch and the inter-video sleep — re-runs of the same corpus are effectively free. Use `--refresh` to force a re-fetch (e.g. after a video was re-uploaded with corrected captions). Metadata is cached alongside the transcript and is also served from cache on a hit; if you need fresh view counts or descriptions, use `--refresh` or `--no-segments`.

#### YouTube anti-bot / cookies

If you hit "Sign in to confirm you're not a bot", set `YOUTUBE_COOKIES_FROM_BROWSER` to a browser name yt-dlp can read cookies from (`safari`, `chrome`, `firefox`, `edge`, etc.). The value is passed straight to yt-dlp's `cookiesfrombrowser` option for both `fetch.py` and `search.py` is unaffected (search uses no cookies).

```bash
YOUTUBE_COOKIES_FROM_BROWSER=safari ./fetch.py VIDEO_ID
```

## Tips

- **Single-quote queries containing `?`** in zsh: `'Best food KL?'` not `Best food KL?`.
- **Multiple narrow searches beat one broad search.** Run `--since 6m` for currency, then a separate `--since 2y` for evergreen "best of" videos if you need both.
- **Use `--no-segments` first** when you just want a "what's out there" sweep — much faster.
- **Auto-generated captions garble proper nouns** ("Koala Lumpur" for "Kuala Lumpur", "Lancavei" for "Langkawi"). Don't quote verbatim without sanity-checking.
- The transcript API may fail on region-locked or transcript-disabled videos. The script logs the error per video and continues — check `transcript_source: "none"` or an `error` field on the result.
- **First run downloads deps via uv** (~10-15s). Subsequent runs reuse the cached env and are fast.
- **Iterating on a corpus is cheap.** Once a video's transcript is in the cache, re-running `fetch.py` on the same list is near-instant (no network, no sleep). Use this to refine searches without paying the transcript cost twice.
