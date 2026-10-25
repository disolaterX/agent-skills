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

`look.mjs` resolves `patchright` from a sibling `node_modules` first, then from `~/.local/share/browser-lab/node_modules`. If neither loads it prints the `npm install` line to run instead of throwing `ERR_MODULE_NOT_FOUND`.

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
--fill <label=value>  fill an input by label, placeholder, role or name
                      both are repeatable and run in the order you type them
--scroll <n>          scroll the main scrollable area to the bottom n times, settling between
--scroll-to <text>    scroll until text (or css=/xpath= selector) is in view, up to 12 scrolls
--settle <ms>         pause after each scroll, default 700
--wait <ms>           sleep after the page loads
--wait-for <text>     wait until text appears (or css=/xpath= selector); absent = timeout = exit 1
--extract <regex>     print every match of a regex (repeatable)
--links               append the anchors
--screenshot <path>   save a full-page png
--max <chars>         cap the text dump (default 4000, 0 = all)
--json                structured output, good for piping into jq
--headless            force headless. Read the rules before using this.
--profile <dir>       override the persistent profile
--timeout <ms>        navigation timeout, default 45000
--viewport <wxh>      default 1440x900
```

`--click` and `--fill` accept `css=<selector>` and `xpath=<selector>` for an exact target, and execute in argument order, so "fill the box, then submit" is `--fill` before `--click`. A failed step stops the chain and exits 1.

### Exit codes

| code | meaning |
| --- | --- |
| 0 | content obtained (`ok: true`) |
| 1 | wall, HTTP >= 400, failed action, empty text, or page error |
| 2 | usage error (nothing launched) |
| 3 | no display, launch failure, or engine not loadable |
| 4 | another `look` already holds this profile |

Usage errors cover: no url, more than one url, unknown flag, empty `--click`/`--wait-for`/`--scroll-to`/`--extract`, malformed `--viewport`, and non-numeric `--max`/`--wait`/`--settle`/`--scroll`/`--timeout`.

### Reading the first line

- `BLOCKED [reason]` — the site refused or the page is empty. Exit 1. Stop, report it.
- `PARTIAL [reason]` — the page is real but degraded (`google-maps-limited-view`, `google-maps-signin-wall`, `google-consent`). Exit stays 0 because content is genuinely there; the line says what is missing. Never quote a PARTIAL page as complete.
- `HTTP 404` / `ERROR ...` / `FAILED <action>=...` — exit 1, text below still printed so you can read what the site served.
- `TRUST [webdriver=true]` — wrong engine; do not trust the run.

`--click` reports `ok` only when a real button, link, tab, role element or input was clicked — plain text nodes are not clickable and are reported as failures. Each click also reports `changed`: `false` means the click landed but the page did not change, so it did nothing useful.

`--scroll` reports `{requested, done, heightBefore, heightAfter, grew, atEnd, stalled, target}`. `stalled: true` means a scroll added nothing new; with `atEnd: true` the container was already at its end, so what you see is the ceiling. Do not keep retrying — if a list needs more than that, it is behind a sign-in or a wall.

`thin-content` only applies to HTML responses. A JSON or plain-text endpoint that answers `{"ok":true}` is content, not an empty shell, and passes.

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
8. **One run at a time on a profile.** A lockfile next to the profile (`<profile-dir>/.<name>.lock`, pid + timestamp) makes a second concurrent run exit 4 with "another look is running". Stale locks from a dead pid are cleared automatically. Fixing a real deadlock means fixing your material, not parallelising the browser.

## Reading results honestly

- Redirects are reported (`(redirected)`), because sites send you to a search page or a consent page. Check that the final address matches what you asked for before trusting the content.
- Directory sites hide direct numbers. Clicking "Show Number" usually yields a **call-tracking number** that routes to the business, not a direct line. Say which it is.
- A business's own website is often stale next to a live listing. When they disagree on hours, rating or phone, the live page wins — and say which one you used.
- Regex extraction over page text hoovers up ads and sidebars. Before quoting a number as the target business's, confirm it sits next to the business name.
- Session cookies do not survive a restart — only cookies with an expiry do. A login that hands out a session cookie will look logged out next run; that is Chromium, not this tool.
- Google Maps on a logged-out profile serves a **limited view**: the Reviews tab shows around five reviews, then `More reviews` / `See more reviews` opens a sign-in wall. `--scroll` reports `stalled: true` because there is nothing more to load. Say "five reviews available without sign-in" rather than implying the list is exhausted.
- Text inside iframes is not read and not clickable; `look` reports the miss instead of guessing.

## If it breaks

- `error: no DISPLAY ... refusing to fall back to headless` (exit 3) means the display variables are missing. Export the three lines above. This is a deliberate hard failure: a silent headless fallback gets fingerprinted and rate-limits the connection.
- `Executable doesn't exist` means the Chromium build is missing: `npx patchright install chromium`.
- `error: the patchright engine is not loadable` prints the `npm install` line to run; the skill's `node_modules` must symlink to `~/.local/share/browser-lab/node_modules`.
- `error: another look is running on this profile` (exit 4) means a concurrent run holds the lock. Wait, or delete `<profile-dir>/.<name>.lock` if that pid is gone.
