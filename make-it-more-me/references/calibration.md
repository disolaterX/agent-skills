# Calibration — build a personal voice profile

This is the SETUP phase. Goal: learn how *this specific user* writes, from their real output, and write a reusable profile to `~/.claude/voice/profiles/<name>.md`. Run it once per user (or per named voice). It mirrors the proven voice-extractor method but seeds it with deterministic measurement instead of guesswork.

Operate **locally only**. Read the user's own files and history; never upload samples anywhere. Tell the user what you are about to read before you read it.

## Phase 1 — name and locate the profile

- Default profile name is `default`. If the user is building a non-self voice (a brand, a client, a pen name), ask for a slug and use `~/.claude/voice/profiles/<slug>.md`.
- Confirm the store exists: `mkdir -p ~/.claude/voice/profiles ~/.claude/voice/extractions`.

## Phase 2 — discover sources (ask AND auto-detect)

You want samples for **both registers**. Ask the user which they have, and auto-detect what you can. Sample authenticity matters: raw/unedited (chat, email, Slack) reveals voice better than polished/published copy.

**A. Casual / chat voice — Claude Code transcripts (universal, do this for everyone):**
Every Claude Code user has a rich, unedited record of how they type. Run the bundled miner from **this skill's base directory** (the folder containing `SKILL.md`; the harness shows it as "Base directory for this skill". If unknown, it is typically `~/.claude/skills/make-it-more-me`):

```bash
mkdir -p ~/.claude/voice/profiles ~/.claude/voice/extractions
bash scripts/extract-cc-voice.sh | tee ~/.claude/voice/extractions/cc-$(date +%Y%m%d).txt
```

Pass a different transcripts dir or sample size as args if needed (e.g. `bash scripts/extract-cc-voice.sh "$HOME/.claude/projects" 80`). This prints length distribution, opening words/bigrams, capitalization and punctuation rates, casual/filler markers, apostrophe-dropping, rough emoji usage, and a random sample of real prompts to read.

**B. Published-prose voice — the user's writing:**
Ask for paths or globs: a blog/`content` dir, repo `README`s, docs, past essays, a bio. Or have them paste 3+ samples (≥500 words total). Then scan for texture:

```bash
# point at the user's prose dir (find recurses; works on macOS bash 3.2, no globstar needed)
DIR="path/to/content"
scan() { find "$DIR" -name '*.md' -exec cat {} + 2>/dev/null; }
echo "em-dashes:    $(scan | grep -o '—' | wc -l | tr -d ' ')"
# true italics only — lookarounds exclude **bold** and ***both***:
echo "italic spans: $(scan | perl -ne '$c+=()=/(?<!\*)\*(?!\*)[^*]+(?<!\*)\*(?!\*)/g; END{print 0+$c}')"
echo "semicolons:   $(scan | grep -o ';' | wc -l | tr -d ' ')"
# AI-tell vocabulary frequency
for w in delve tapestry testament realm navigate landscape underscore crucial pivotal robust seamless leverage multifaceted nuanced ultimately moreover ; do
  c=$(scan | grep -woiE "$w" | wc -l | tr -d ' '); [ "${c:-0}" -gt 0 ] && printf "  %-12s %s\n" "$w" "$c"
done
```

**C. Other sources:** offer to read pasted emails, transcripts, LinkedIn posts. Label each sample's context so you can attribute register.

**Minimum gate:** if total samples for a register are under ~500 words, say so and use quick mode for that register (fewer claims, flagged as low-confidence). Do not fabricate a profile from thin data.

## Phase 3 — quantitative fingerprint (deterministic, no hallucination)

From the script output and content scan, record hard numbers per register:
- Sentence/message length distribution and a typical length.
- Capitalization: % starting lowercase. Punctuation: % with no end mark, `?` rate.
- Contraction style: apostrophes kept vs dropped (`don't` vs `dont`).
- Em-dash, italic, semicolon density (published prose).
- Casual markers and their counts (bro, hey, lol, tbh…). Emoji usage.
- AI-tell vocabulary counts (published prose).

These numbers are the backbone — they are not opinions and they catch what the user can't self-report.

## Phase 4 — qualitative read (bounded)

Read the sampled prompts and a slice of their prose. Do **not** read everything; a few hundred lines is enough. Extract, quoting real examples:
- **Core energy / role**: teacher, challenger, straight-shooter, storyteller, hype, dry…
- **Signature phrases**: openers, transitions, closers — quote exact strings.
- **Recurring themes / domain vocabulary**: what they talk about unprompted; the jargon they actually use.
- **Recurring misspellings or idiosyncrasies** (eyeball the sample; e.g. consistent transpositions).
- **Anti-patterns**: words/constructions they would *never* use. Source from evidence ("0 instances of 'leverage' across all samples").

## Phase 5 — synthesize the profile

Fill `references/profile-template.md` into `~/.claude/voice/profiles/<name>.md`. One section per register found. Each register gets: when-to-use, core energy, sentence shape, capitalization/punctuation, signature phrases, vocabulary, DO, DON'T, and the measured fingerprint. Keep claims tied to evidence.

## Phase 6 — validation test (REQUIRED)

Generate two short passages on a topic the user cares about:
- **Version A** — in the extracted voice.
- **Version B** — same content, deliberately wrong voice (generic AI).

Ask: *"Does A sound like you when you're not overthinking it? What's off?"* Refine the profile from their answer. This catches extraction errors before the profile is trusted.

## Phase 7 — write and register

1. Write the profile to `~/.claude/voice/profiles/<name>.md`.
2. Save the raw extraction to `~/.claude/voice/extractions/` so it can be re-synthesized later.
3. If this agent has a persistent memory system, add a one-line pointer ("voice profile at ~/.claude/voice/profiles/<name>.md; use make-it-more-me to apply"). The profile file is the source of truth regardless.
4. Tell the user: how to apply it ("say 'make it more me' on any draft"), how to recalibrate ("learn my voice again" — reruns this), and that the profile is local and editable by hand.

## Quick mode

If the user wants editing *now* and has no profile: run only the CC miner (Phase 2A, which also creates the `~/.claude/voice/` store dirs), skim the sample, and write a minimal profile: top ~10 signature traits, capitalization/punctuation habits, 5 anti-patterns, one validated example. Mark it `status: quick`. Offer full calibration later. Even a quick profile must record the em-dash ban so the APPLY verify step has something to assert.
