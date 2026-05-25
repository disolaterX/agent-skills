---
name: make-it-more-me
description: Write or edit prose so it reads in the user's authentic voice instead of generic AI texture. Two phases. SETUP (first run / "calibrate my voice", "learn how I write", "set up my voice") mines the user's own writing and Claude Code chat history to build a personal voice profile. APPLY (default / "make it more me", "de-ai-ify this", "sound like me", "rewrite in my voice", or any time you draft prose for this user) loads that profile and writes in their voice. Works for anyone — ships with no personal data.
---

# Make It More Me

Make written prose sound like the person it belongs to, not like a language model. Most drafts are fine on substance; what leaks is *texture* — em-dashes, italic emphasis, cute headings, aphoristic mic-drop closers, the rule of three. This skill removes generic AI texture and replaces it with the user's measured signature.

It is **data-driven, not opinion-driven**: it learns each user's voice from their real writing rather than imposing one style. The skill itself contains no personal data, so it is safe to share.

## Two registers — the load-bearing idea

Everyone has at least two voices, and applying the wrong one ruins the output:

- **Casual / chat voice** — how they type to an AI or a colleague: often lowercase, terse, typo-tolerant, slangy.
- **Published-prose voice** — how they write articles, READMEs, bios, landing copy: composed and correct, but still *theirs*.

How someone types to an AI is **not** how they write an article. The profile records each register separately. When applying, pick the register that matches the task. Default to published-prose for any public-facing writing.

## Step 0 — find the profile (this decides the phase)

```bash
ls ~/.claude/voice/profiles/*.md 2>/dev/null
```

- **No profile, or the user asked to (re)calibrate / "learn my voice" / "set up"** → run **SETUP**: read `references/calibration.md` and follow it end to end. Do not skip it.
- **A profile exists and the task is to write/edit** → run **APPLY** (below). Use `default.md` unless the user named another profile (e.g. "write like the brand voice" → `brand.md`).

Never invent a voice from memory. If there is no profile and the user wants editing now, offer a 2-minute quick calibration first (see calibration.md "quick mode").

## APPLY — write/edit in the loaded voice

1. **Load** the profile file. Read its registers, signature phrases, DO/DON'T, and anti-patterns.
2. **Pick the register** that fits the task (published-prose for public writing; casual only if the user is clearly writing a chat/DM/comment).
3. **Rewrite/draft** following that register's rules. Baseline for the published-prose register is `references/universal-ai-tells.md` (the AI texture everyone should strip) *as overridden by the profile* — if the profile says the user genuinely loves em-dashes, keep them.
4. **Preserve substance exactly**: no changed facts, numbers, names, dates, links, or claims. No added hype.
5. **Verify** before declaring done — this is required, see below.

## Verify (REQUIRED, never ship on a self-report)

Measure, do not trust "looks clean".

1. **Em-dash check, by default.** `grep -c '—'` every edited file. It must be **0** unless the profile *explicitly* whitelists em-dashes (rare). A profile that says nothing about em-dashes bans them, including in quick mode. Then also grep for any extra tokens the profile bans.
2. **Build / parse, always when one exists.** Run the project's build (`npm run build`, `astro build`, a docs generator, whatever it uses). Prose edits inside front-matter or templates break parsing with no visible code change. Skip the build only if the target is truly loose files with no build step, and even then re-parse any changed YAML.
3. **YAML front-matter safety.** Replacing `—` with `:` inside an *unquoted* front-matter value breaks the parser (`summary: built in Go: fast` reads `fast` as a key). Best: do not introduce a colon in front-matter at all (use a comma or period). To make existing at-risk values safe, run the bundled, tested fixer. Do NOT hand-roll a one-liner for this; YAML quoting has many corruption edge cases (CRLF, backslashes, comments, hyphenated keys, body `---` rules) that the script already handles:

   ```bash
   # run from this skill's base directory, or use the script's absolute path
   perl scripts/quote-yaml-frontmatter.pl path/to/content/*.md
   ```

   It touches only the first front-matter block, handles hyphen/digit keys, escapes correctly, preserves CRLF, is idempotent, and skips (and reports) anything it cannot safely quote.

## Scale

For a whole content directory, fan out background agents split by disjoint file sets, hand each the chosen register's rules from the profile, then run verify + build yourself in the main thread.

## Files

- `references/calibration.md` — the SETUP procedure (discover sources, extract, synthesize, validate, write profile).
- `references/universal-ai-tells.md` — default published-prose ruleset + the AI tells everyone should strip + verification details.
- `references/profile-template.md` — the structure every generated profile follows.
- `references/example-profile.md` — a filled synthetic profile so you can see the target shape.
- `scripts/extract-cc-voice.sh` — portable miner for the user's Claude Code transcripts (stats + sampled prompts).
- `scripts/quote-yaml-frontmatter.pl` — tested, conservative fixer that quotes at-risk YAML front-matter values (the verify step uses it).
