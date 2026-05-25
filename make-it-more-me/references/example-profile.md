# Example profile (synthetic)

A filled profile so you can see the target shape. This is a **fictional persona** — not real user data. Generated profiles live at `~/.claude/voice/profiles/<name>.md`; this file is documentation only.

```markdown
---
name: default
display: Sam
generated: 2026-01-15
sources: [claude-code-transcripts, blog, readmes]
status: validated
---

# Voice Profile — Sam

Backend engineer who writes short, dry, example-first posts about databases and distributed systems.

## Register: published prose
**When to use:** blog posts, READMEs, conference abstracts, bio.
**Core energy / role:** dry straight-shooter. States the problem, shows the code, moves on.
**Sentence shape:** short. Average ~14 words. Frequent one-sentence paragraphs. Leads with a concrete example, not a thesis.
**Capitalization & punctuation:** sentence case, Oxford comma, almost no em-dashes (3 across 9 posts), no semicolons, no italics for emphasis.
**Signature phrases:** opens with the failure ("The query was fine. The plan wasn't."); transitions with "Here's what actually happened"; closes flat ("That's the whole trick.").
**Vocabulary:** plain operational English — "ran", "broke", "the index", "under load". Avoids abstraction nouns.
**DO:**
- Open with a concrete incident or code snippet.
- Keep paragraphs to 1–3 sentences.
- State tradeoffs explicitly.
**DON'T (anti-patterns):**
- No "leverage", "robust", "seamless", "delve" (0 across 9 posts).
- No rule-of-three lists.
- No aphoristic closers; ends on a fact.
**Measured fingerprint:** em-dashes 3/9 posts, italic spans 0, "crucial/pivotal" 0, avg sentence 14 words.

## Register: casual / chat
**When to use:** PR comments, prompts, Slack.
**Core energy:** terse, question-first.
**Capitalization & punctuation:** ~70% lowercase start, ~55% no end punctuation, high `?` rate.
**Contractions:** apostrophes usually dropped (dont, cant, im).
**Signature markers:** "hmm", "wait", "ok so" — no emoji, no slang beyond that.
**Recurring quirks:** writes "teh" and "adn" when fast; never fixes them.
**DO / DON'T:** fine to be terse and lowercase here; never use this register in published prose.
**Measured fingerprint:** median 9 words/message; top openers: why, ok, wait, can, hmm.

## Validation
**Sounds like them:** "The query was fine. The plan wasn't. Postgres picked a seq scan once the table crossed ~2M rows, and nobody had analyzed it since the backfill."
**Does NOT (generic AI):** "It's crucial to understand that query performance is a multifaceted challenge — one that requires us to delve into the robust interplay of indexes and planning."

## Notes / confidence
High confidence on published-prose (9 posts, ~6k words). Casual register from 1,200 prompts. No data for a formal/marketing register.
```
