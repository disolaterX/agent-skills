# Universal AI tells + the published-prose baseline

These are the texture habits that make prose read as machine-generated. They are the **default ruleset for the published-prose register**, used as a starting point during APPLY and overridden by anything the user's profile explicitly keeps. If a profile says "she genuinely writes with em-dashes", honor the profile.

The principle: strip texture, keep substance. Never change facts, numbers, names, or claims while de-tell-ing.

## Strip these by default

**Punctuation / typography**
- **Em-dashes (`—`).** The single strongest tell. Restructure into a colon, comma, period, or two sentences. Don't swap for a spaced hyphen unless it's a real list dash.
- **Italic `*emphasis*`** for drama — set plain. (Keep italics only for genuine titles of works. Never touch `**bold**` bullet lead-ins.)
- **Semicolon overuse** — usually splits into two sentences more naturally.

**Rhythm / structure**
- **The rule of three / tricolons** everywhere ("fast, clean, and reliable"). Vary it; cut to two or expand to a real list.
- **Antithesis templates**: "It's not just X, it's Y." / "not only… but also" / "This isn't about A. It's about B." Flatten to a direct statement.
- **Aphoristic mic-drop closers** — the punchy one-line fragment ending. End on a plain factual sentence instead.
- **Section-summary scaffolding**: "In conclusion", "Ultimately", "At its core", "When it comes to". Cut.
- **Perfectly balanced sentence rhythm** — real people are lumpier. Let lengths vary.

**Vocabulary (the LLM lexicon)**
- delve, tapestry, testament, realm, navigate (figurative), landscape (figurative), underscore, crucial, pivotal, robust, seamless(ly), leverage (verb), multifaceted, nuanced, intricate, myriad, foster, embark, elevate, unlock, harness, vibrant.
- Hedging boilerplate: "It's worth noting", "It's important to note", "That said", "Needless to say".
- "In today's fast-paced world", "Whether you're a … or a …".
Replace each with the plain word a normal person would say out loud.

**Tone**
- No unearned hype or self-congratulation ("a game-changer", "truly remarkable"). Let facts stand.
- No "trust-me" selling lines or persuasion closers ("trust me, you'll want this", "this is the cleanest way"). State the fact and let the reader judge. This is a default for everyone, not a per-profile option.
- No emoji bullets in professional prose unless the profile says the user does that.
- Cute, clever section headings become plain descriptive ones.

## Verify (REQUIRED before declaring done)

Never trust a self-report that says "all clean". Measure.

1. **Banned-token grep = 0**: for every edited file, `grep -c '—'` must be 0 *unless the profile explicitly whitelists em-dashes* (rare); a profile silent on em-dashes bans them by default. Also grep any other token the profile bans.
2. **Build if it's a site/app**: run `npm run build` / `astro build` / the project's build. Prose edits inside templates or front-matter can break parsing without touching visible code.
3. **YAML front-matter gotcha**: converting `—` to `:` inside an *unquoted* front-matter value makes the parser read the tail as a nested key (`summary: built in Go: fast` → `fast:` becomes a key). First preference: avoid introducing a colon in front-matter (use a comma or period). To make existing at-risk values safe, run the bundled tested fixer (do not hand-roll a one-liner, it has many corruption edge cases):

   ```bash
   # from this skill's base directory, or use the absolute path
   perl scripts/quote-yaml-frontmatter.pl path/to/content/*.md
   ```

   It only touches the first front-matter block, handles hyphen/digit keys, escapes backslashes and quotes, preserves CRLF, is idempotent, and skips and reports anything it cannot safely quote. URLs (`https://…`) are safe anyway because there is no space after the colon.
