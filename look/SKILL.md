---
name: look
description: Last-resort headed browser for a URL, invoked as `look <url>`. Use only after the session's own search, URL-fetch and browser automation have failed or are absent, and specifically when a fetch returned a bot wall, a captcha, an empty shell or truncated client-rendered content, when the data only appears after a click ("Show Number", "More reviews", "View all"), a form fill, or scroll-driven lazy loading, or when you need a screenshot or a regex extract of rendered text. Drives real Chromium through a persistent profile with the automation flags patched out, prints the webdriver state with every run, and refuses to silently fall back to headless.
---

# look

`look` drives a **headed** Chromium through a persistent profile, so logins survive between runs. It prints a header (url, title, status, mode, webdriver, actions), then the page text.

The distinction that matters: headless Chromium advertises itself (UA `HeadlessChrome`) and gets rate-limited or blocked by search engines, maps and directory sites. `look` is headed on purpose, and never downgrades itself to headless when a display is missing — it fails loudly instead.

## Install

Needs Node 20+ and a desktop session.

```bash
# engine
mkdir -p ~/.local/share/browser-lab && cd ~/.local/share/browser-lab
npm init -y && npm install patchright && npx patchright install chromium

# this skill: put the skill directory wherever you keep skills, then
cd <skill-dir>
ln -sfn ~/.local/share/browser-lab/node_modules node_modules
mkdir -p ~/.local/bin && ln -sfn "$PWD/look.mjs" ~/.local/bin/look
```

`look.mjs` resolves `patchright` from a sibling `node_modules` first, then from `~/.local/share/browser-lab`. If neither loads it prints both failures and the install command, instead of throwing `ERR_MODULE_NOT_FOUND`.

## Display variables

Headed launch needs all three. On a Wayland desktop `:0` is Xwayland:

```bash
export XDG_RUNTIME_DIR=/run/user/$(id -u)
export DISPLAY=:0
export XAUTHORITY=$(ls -1 "$XDG_RUNTIME_DIR"/.mutter-Xwaylandauth.* 2>/dev/null | head -1)
```

Agent shells usually start with none of these set. Without `DISPLAY`, `look` exits 3 and prints the exact exports, naming the auth file it found. It does not retry headless.

## Order of operations — exhaust the session first

Climb this ladder and stop at the first rung that works. This skill is rung 4, not rung 1.

1. **Whatever search the session already has** — cheapest discovery. If it comes back unauthenticated or errors, fall through; do not retry it.
2. **Whatever URL-fetch the session already has** — any address you already know: docs, articles, APIs, plain HTML. A fraction of the cost of a browser.
3. **Any browser automation already available in the session** — if the session ships one, whether built in, configured, or attached by an extension, **it outranks this skill**. Use it, and only come here if it is absent or fails.
4. **`look`** — this skill. Only after 1–3 produced a wall, an empty shell, or no usable content.

Do not jump to rung 4 because it "feels more reliable". Every run launches a real browser (1–3 s) and flashes a window on the operator's screen. Say in your reply which rung you used and why the ones above it failed — that is the evidence that escalation was justified.

Static docs and blogs: rung 2, always.

## When to escalate here

- The fetch came back as `Just a moment`, `Attention Required`, `unusual traffic`, a captcha, or `enable JavaScript`.
- The page yielded almost no text because it renders client-side — maps, directories, dashboards, single-page apps.
- The content sits behind a click: "Show Number", "Read more", "View all", a cookie banner, an age gate.
- The list is lazy-loaded and needs scrolling.
- You need rendered results from a search engine rather than someone's summary of them.

## Options

```
--click <text>        click the first *actionable* element matching text
--fill <label=value>  fill an input by visible label, aria-label, aria-labelledby,
                      placeholder, name or id
                      click and fill are repeatable and run in the order you type them
--scroll <n>          scroll the page's main scrollable area to the bottom n times
--scroll-to <text>    scroll until text (or css=/xpath= selector) is in view, up to 12 scrolls
--settle <ms>         pause after each scroll, default 700
--wait <ms>           sleep after the steps
--wait-for <text>     wait until text appears (or css=/xpath= selector); absent = timeout = exit 1
--extract <regex>     print up to 40 matches of a regex (repeatable)
--links               append the anchors
--screenshot <path>   save a full-page png
--max <chars>         cap the text dump (default 4000, 0 = all)
--timeout <ms>        per-navigation and per-wait timeout, default 45000
--deadline <ms>       hard cap on the whole run; 0 means auto (a few minutes)
--viewport <wxh>      default 1440x900
--allow-local         permit file:// urls, which are refused by default
--headless            force headless. Read the rules before using this.
--profile <dir>       override the persistent profile
--json                structured output, good for piping into jq
```

`<text>` arguments are **literal text, not regexes**, matched case-insensitively. To target an element exactly, pass `css=<selector>` or `xpath=<selector>` to `--click`, `--wait-for` or `--scroll-to`. There is no implicit "looks like a selector" guessing, so `--click '#1 Rated'` searches for that text.

`--click` and `--fill` run in argument order, so "fill the box, then submit" is `--fill` before `--click`. A failed step stops the chain and exits 1. `--wait`, `--wait-for`, `--scroll-to` and `--scroll` always run **after** the steps, in that order, wherever they appear on the command line.

### Exit codes

| code | meaning |
| --- | --- |
| 0 | content obtained (`ok: true`) |
| 1 | wall, HTTP >= 400, failed action, empty text, page error, or run deadline hit |
| 2 | usage error (nothing launched, nothing written to stdout) |
| 3 | no display, launch failure, engine not loadable, or profile in use by another Chromium |
| 4 | another `look` holds this profile's lock |
| 130 | interrupted (SIGINT/SIGTERM/SIGHUP); the lock is released first |

Usage errors cover: no url, more than one url, unknown flag, a flag given without a value, an empty `--click`/`--wait-for`/`--scroll-to`/`--extract`, a malformed `--viewport`, non-numeric `--max`/`--wait`/`--settle`/`--scroll`/`--timeout`/`--deadline`, a url whose scheme is not http/https/file, and `file://` without `--allow-local`. A url with no scheme at all is passed to the browser and fails there as `ERROR`.

`--json` prints no JSON for exit 2, 3 or 4 (stderr only), nor for a deadline kill (exit 1) or an interrupt (exit 130) — in those three cases the process is torn down before output is assembled.

### Reading the first line

- `BLOCKED [reason]` — the site refused or the page is empty. Exit 1. Stop, report it.
- `PARTIAL [reason]` — the page is real but degraded (`google-maps-limited-view`, `google-maps-signin-wall`, `google-consent`). Exit stays 0 because content is genuinely there; the line says what is missing. Never quote a PARTIAL page as complete.
- `HTTP 404` / `FAILED <action>=...` — exit 1, with the page text printed below so you can read what the site served.
- `ERROR ...` — exit 1, the run failed. If navigation itself failed (DNS, timeout, TLS) nothing below it loaded and there is no text; if the failure happened *after* the page loaded (a step or script call threw), the header and the page text it had are still printed. Check whether a `url:` line with a real address appears before treating it as "never loaded".
- `TRUST [webdriver=true]` — wrong engine; do not trust the run.

Distinctive challenge phrases (`Just a moment`, `Verifying you are human`, `unusual traffic`, `Attention Required`) wall regardless of page size, but only where the phrase dominates the text it sits in — at least 60% of the title, or of a line of 200 characters or less, anywhere in the page. A challenge overlay appended at the end of a content-rich page still walls; a headline like "Unusual traffic expected this Diwali weekend" does not. Generic phrases (`access denied`, `enable JavaScript`, `DDoS protection`) only wall a page under ~1500 characters and are never matched against the title, so a search for "access denied fix" on a results page is not walled. Soft Maps notices are checked after hard walls. The check reads `navigator.webdriver` and the UA from the page's own JavaScript context, so treat `webdriver: false` as strong evidence rather than proof: a hostile page can lie about its own navigator.

`--fill` tries fields whose label, aria-label, aria-labelledby, placeholder, name or id contains the given label text, exact matches first, and reports which field it filled. A field that will not accept the value is skipped in favour of the next candidate.

`--click` reports `ok` only when a real interactive element was clicked — a button, link, tab, menu item, label, input, `[onclick]`, or a container that is not `tabindex="-1"` and does not wrap several controls. Plain text and page wrappers are failures, not clicks. Each click also reports `changed`: `false` means it landed but the page did not change, so it did nothing useful; `null` means the page was mid-navigation and could not be compared, and a click that opens a new tab counts as `false`.

`--scroll` reports `{requested, done, strategy, target, heightBefore, heightAfter, scrollTop, grew, atEnd, contentChanged, wheelTicks, fallback, stalled}`. `--scroll-to` reports `{scrollTo, ok, scrolls, strategy}` and uses the same wheel-first logic on a nested panel, so it can find rows that only exist while the panel is mid-list. One target is chosen per run: the document is scrolled programmatically, a nested panel (maps review lists, virtualised feeds) with mouse-wheel events over its centre, because assigning `scrollTop` to a re-rendered container does nothing. `fallback` names the strategy tried when the first one moved nothing. On a virtualised list the height never grows because nodes are replaced, so `contentChanged` is the signal that matters. `stalled: true` means two consecutive scrolls changed neither position nor content — that is the ceiling; do not keep retrying.

`thin-content` only applies to HTML responses, and is skipped entirely when `--screenshot` is passed (a screenshot-only run of an empty shell is legitimate). Otherwise a JSON or plain-text endpoint that answers `{"ok":true}` is content, not an empty shell, and passes.

`iframes: N` in the header means the page contains frames whose text is not read and whose controls are not clickable.

Page text and titles are stripped of terminal control sequences before printing, so a hostile page cannot rewrite the operator's terminal.

## Examples

```bash
look 'https://www.google.com/search?q=Balaji+Computer+Service+JP+Nagar+Phase+6+phone' --max 800

look 'https://www.google.com/maps/search/<query>' --extract '[1-5]\.[0-9]\s*\([\d,]+\)' --json

look '<justdial listing>' --click 'Show Number' --extract '[6-9][0-9]{9}'

look 'https://site.example/search' --fill 'q=thermal paste' --wait-for 'Results' --links

look 'https://www.bing.com' --fill 'Search=thermal paste' --click 'Search' --wait 2500

look '<maps place url>' --click 'Reviews' --scroll 8 --max 0
```

## Rules, measured on a Linux laptop over a residential connection (Oct 2026)

These come from a four-way benchmark — a stock browser headless, the same stock browser headed, the bundled engine here, and a hardened alternative — run against a search engine, a maps listing and a directory site. Do not "improve" on them from theory.

1. **Never reach for headless mode on search engines, challenge pages or directory sites.** Measured: headless flags the session as automated, advertises itself in the user agent, and gets rate-limited by search and a protocol-level error from the directory.
2. **Do not swap the bundled engine for a stock automation library "because it's simpler".** The stock library, even headed, failed search twice on the same connection — including after a 75 second cooldown — while flagged as automated. Seconds later, the bundled engine returned content. The automation flag is the discriminator: not the user agent, not the IP.
3. **Do not add user-agent spoofing, stealth add-ons or proxies.** The wall tracked the driver, not the identity. Spoofing adds inconsistency without removing the tell.
4. **One query at a time.** Do not fan out several search requests in parallel from one connection; you will rate-limit yourself and poison the next run. Serial, with a few seconds between, is what worked.
5. **Check the reported automation flag on any run you intend to trust.** `webdriver: false` in the header, and no `ua: advertises HeadlessChrome` line. A `TRUST [webdriver=true]` line means the wrong engine and the run exits 1.
6. **On `BLOCKED`, stop.** Report the wall to the operator. Do not loop retries; retrying hardens the block.
7. **Never delete the persistent profile directory** (`~/.local/share/browser-lab/profile`). It holds cookies and logins. If a site is in a bad logged-out state, use `--profile` with a scratch dir instead.
8. **One run at a time on a profile.** The lock is `<parent-dir-of-profile>/.<profile-name>.lock`, holding a pid and timestamp; a second run exits 4 with "another look is running". A stale lock from a dead pid is claimed by atomic rename before it is discarded, so two runs cannot both recover the *same* stale lock; three overlapping runs that all race a third writer is theoretically possible, and Chromium's own profile lock is the backstop. A lock path that is not a regular file with an integer `pid` is refused, never deleted. Fixing a real deadlock means fixing your material, not parallelising the browser.

## Reading results honestly

- Redirects are reported (`(redirected)`), because sites send you to a search page or a consent page. Check that the final address matches what you asked for before trusting the content. Only the first navigation's status is reported; a click that lands on a 404 is not flagged.
- Directory sites hide direct numbers. Clicking "Show Number" usually yields a **call-tracking number** that routes to the business, not a direct line. Say which it is.
- A business's own website is often stale next to a live listing. When they disagree on hours, rating or phone, the live page wins — and say which one you used.
- Regex extraction over page text hoovers up ads and sidebars. Before quoting a number as the target business's, confirm it sits next to the business name. `--extract` returns whole matches, not capture groups, stops at 40, and runs over at most 200k characters; a catastrophically backtracking regex can still stall the run, so keep patterns simple.
- Session cookies do not survive a restart — only cookies with an expiry do. A login that hands out a session cookie will look logged out next run; that is Chromium, not this tool.
- Google Maps on a logged-out profile serves a **limited view**: the Reviews tab shows around five reviews, then `More reviews` / `See more reviews` opens a sign-in wall. Scrolling reports `stalled: true` because there is nothing more to load. Say "five reviews available without sign-in" rather than implying the list is exhausted.
- Text inside iframes is neither read nor clickable; the header reports how many frames were skipped.

## If it breaks

- `error: no DISPLAY ... refusing to fall back to headless` (exit 3) means the display variables are missing. Export the three lines above. This is a deliberate hard failure: a silent headless fallback gets fingerprinted and rate-limits the connection.
- `error: ... profile is already in use by another instance of Chromium` (exit 3) means some other Chromium — possibly not `look` — holds the profile. Wait, or use `--profile` with a scratch dir.
- `Executable doesn't exist` means the Chromium build is missing: `npx patchright install chromium`.
- `error: the patchright engine is not loadable` prints both resolution failures and the install command; the skill's `node_modules` must symlink to `~/.local/share/browser-lab/node_modules`.
- `error: another look is running on this profile` (exit 4) means a concurrent run holds the lock. Wait, or delete that lock file if the pid is gone. A lock path that is not a regular file this tool wrote is refused rather than deleted.
- `error: run exceeded its Ns deadline and was killed` (exit 1) means the page or a script call hung past `--deadline`; the lock was released. Raise `--deadline` for legitimately slow pages.
- `error: interrupted` (exit 130) means SIGINT/SIGTERM; the browser is closed and the lock released.
