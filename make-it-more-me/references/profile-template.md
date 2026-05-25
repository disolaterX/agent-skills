# Profile template

Calibration fills this and writes it to `~/.claude/voice/profiles/<name>.md`. Keep every claim tied to evidence from the user's samples. One `## Register` block per voice found (most people have at least casual + published-prose).

```markdown
---
name: <slug>            # e.g. default
display: <Name>         # e.g. Sam
generated: <YYYY-MM-DD>
sources: [claude-code-transcripts, blog, readmes, pasted-samples]
status: validated       # or: quick | draft
---

# Voice Profile — <Name>

One or two plain sentences on who this is and what they write.

## Register: published prose
**When to use:** articles, READMEs, bios, landing copy, anything public-facing.
**Core energy / role:** <straight-shooter / teacher / storyteller / dry / …>
**Sentence shape:** <typical length, rhythm, paragraph habits>
**Capitalization & punctuation:** <sentence case; em-dashes? semicolons? oxford comma?>
**Signature phrases:** openers / transitions / closers — quote real examples.
**Vocabulary:** words and domain terms they actually use.
**DO:**
- <concrete rules derived from their writing>
**DON'T (anti-patterns — would never write):**
- <evidence-backed: "0 instances of 'leverage' across N samples">
**Measured fingerprint:** <em-dash density, italic density, AI-tell word counts, etc.>

## Register: casual / chat
**When to use:** DMs, comments, prompts, informal notes.
**Core energy:** <…>
**Capitalization & punctuation:** <% lowercase, % no end-mark, ? rate>
**Contractions:** <apostrophes kept or dropped — dont/cant/im>
**Signature markers:** <bro, hey, btw, lol, emoji — with frequencies>
**Recurring misspellings / quirks:** <e.g. consistent transpositions>
**DO / DON'T:** <…>
**Measured fingerprint:** <length distribution, top openers, marker counts>

## Validation
**Sounds like them:** "<Version A, in voice>"
**Does NOT (generic AI):** "<Version B, contrast>"

## Notes / confidence
<gaps, low-data registers, things to re-check>
```

Rules for a good profile:
- Quote real strings from samples; don't paraphrase the user's voice into your own.
- Prefer measured numbers over adjectives ("61% of messages have no end punctuation" beats "fairly casual").
- Anti-patterns are as important as patterns — they prevent drift back to generic.
- Keep registers clearly separated and labeled with when-to-use, so APPLY picks correctly.
