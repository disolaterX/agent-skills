#!/usr/bin/env node
import { mkdirSync, writeFileSync, readFileSync, readdirSync, unlinkSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";

const EXIT_OK = 0;
const EXIT_BLOCKED = 1;
const EXIT_USAGE = 2;
const EXIT_LAUNCH = 3;
const EXIT_LOCKED = 4;

const labDir = join(homedir(), ".local/share/browser-lab");
const engineCandidates = ["patchright", join(labDir, "node_modules/patchright/index.mjs")];
let chromium;
let engineError;
for (const specifier of engineCandidates) {
  try {
    ({ chromium } = await import(specifier));
    break;
  } catch (error) {
    engineError ??= error;
  }
}
if (!chromium) {
  console.error("error: the patchright engine is not loadable, so no browser can start.");
  console.error(`  first failure: ${firstLineLoose(engineError?.message)}`);
  console.error(`  node_modules must be a symlink to ${join(labDir, "node_modules")}`);
  console.error(`run: cd ${labDir} && npm install`);
  process.exit(EXIT_LAUNCH);
}

const SOFT_WALLS = new Set(["google-maps-limited-view", "google-maps-signin-wall", "google-consent"]);

const WALLS = [
  [/sign-in to get the best of google maps/i, "google-maps-signin-wall"],
  [/you.re seeing a limited view/i, "google-maps-limited-view"],
  [/limited view of google maps/i, "google-maps-limited-view"],
  [/just a moment/i, "cloudflare-js-challenge"],
  [/attention required/i, "cloudflare-block"],
  [/verify you are human/i, "captcha-interstitial"],
  [/unusual traffic/i, "google-rate-limit"],
  [/our systems have detected/i, "google-automated-queries"],
  [/are you a robot/i, "robot-check"],
  [/access denied/i, "access-denied"],
  [/enable javascript/i, "js-required-wall"],
  [/challenge-platform/i, "challenge-platform"],
  [/sorry\/index/i, "google-sorry"],
  [/pardon our interruption/i, "akamai-block"],
  [/ddos protection/i, "ddos-wall"],
  [/before you continue to google/i, "google-consent"],
];

const THIN_TEXT_CHARS = 24;

const argv = process.argv.slice(2);
const positionals = [];
const opts = {
  url: null,
  links: false,
  json: false,
  headless: false,
  steps: [],
  wait: 0,
  waitFor: null,
  scroll: 0,
  scrollTo: null,
  settle: 700,
  extract: [],
  screenshot: null,
  max: 4000,
  timeout: 45000,
  profile: join(labDir, "profile"),
  viewport: "1440x900",
  verbose: false,
};

const HELP = `look <url> [options]

  --click <text>          click the first *actionable* element matching text
  --fill <label=value>    fill an input by label, placeholder, role or name
                          --click and --fill run in the order you give them
  --scroll <n>            scroll the page's main scrollable area to the bottom n times, settling between
  --scroll-to <text>      scroll until text (or css=/xpath= selector) is in view
  --settle <ms>           pause after each scroll, default 700
  --wait <ms>             sleep after load
  --wait-for <text>       wait until text (or css=/xpath= selector) appears; absent = timeout = exit 1
  --extract <regex>       print every match of a regex (repeatable)
  --links                 append anchor list
  --screenshot <path>     save a png
  --max <chars>           cap text output (default 4000, 0 = unlimited)
  --headless              force headless (detectable; avoid search/maps/directory sites)
  --profile <dir>         persistent profile (default ~/.local/share/browser-lab/profile)
  --json                  structured output
  --verbose               print diagnostics to stderr

Exit codes: 0 content, 1 wall/error/empty, 2 usage, 3 no display or engine failure, 4 another look holds the lock`;

for (let i = 0; i < argv.length; i += 1) {
  const a = argv[i];
  const next = () => {
    const v = argv[i + 1];
    if (v === undefined || v.startsWith("--")) throw new Error(`${a} needs a value`);
    i += 1;
    return v;
  };
  if (a === "--links") opts.links = true;
  else if (a === "--json") opts.json = true;
  else if (a === "--headless") opts.headless = true;
  else if (a === "--verbose") opts.verbose = true;
  else if (a === "--click") opts.steps.push({ kind: "click", value: next() });
  else if (a === "--fill") opts.steps.push({ kind: "fill", value: next() });
  else if (a === "--scroll") opts.scroll = Number(next());
  else if (a === "--scroll-to") opts.scrollTo = next();
  else if (a === "--settle") opts.settle = Number(next());
  else if (a === "--wait") opts.wait = Number(next());
  else if (a === "--wait-for") opts.waitFor = next();
  else if (a === "--extract") opts.extract.push(next());
  else if (a === "--screenshot") opts.screenshot = next();
  else if (a === "--max") opts.max = Number(next());
  else if (a === "--timeout") opts.timeout = Number(next());
  else if (a === "--profile") opts.profile = next();
  else if (a === "--viewport") opts.viewport = next();
  else if (a === "-h" || a === "--help") {
    console.log(HELP);
    process.exit(EXIT_OK);
  } else if (a.startsWith("-")) {
    console.error(`error: unknown flag ${a}\nrun: look --help`);
    process.exit(EXIT_USAGE);
  } else positionals.push(a);
}

if (positionals.length > 1) {
  console.error(`error: one url at a time, got ${positionals.length}: ${positionals.join(" ")}`);
  process.exit(EXIT_USAGE);
}
opts.url = positionals[0] ?? null;

if (opts.steps.some((step) => (step.kind === "click" ? step.value === "" : !step.value.includes("=") || step.value.startsWith("=")))) {
  console.error("error: --click text cannot be empty, and --fill needs a non-empty <label>=<value>");
  process.exit(EXIT_USAGE);
}
if (opts.waitFor === "" || opts.scrollTo === "" || opts.extract.includes("")) {
  console.error("error: --wait-for, --scroll-to and --extract cannot be empty");
  process.exit(EXIT_USAGE);
}
if (!opts.viewport.match(/^[1-9]\d{1,4}x[1-9]\d{1,4}$/)) {
  console.error(`error: --viewport needs WIDTHxHEIGHT, got ${opts.viewport}`);
  process.exit(EXIT_USAGE);
}
for (const key of ["max", "wait", "settle", "scroll", "timeout"]) {
  const value = opts[key];
  if (!Number.isFinite(value) || value < 0) {
    console.error(`error: --${key} needs a number >= 0, got ${value}`);
    process.exit(EXIT_USAGE);
  }
}
if (opts.timeout <= 0) {
  console.error(`error: --timeout needs a number > 0, got ${opts.timeout}`);
  process.exit(EXIT_USAGE);
}

if (!opts.url) {
  console.error("error: no url. run: look --help");
  process.exit(EXIT_USAGE);
}

const note = (m) => {
  if (opts.verbose) console.error(`[look] ${m}`);
};

function firstLineLoose(text) {
  return String(text || "").split("\n").find((l) => l.trim()) ?? "";
}

const firstLine = firstLineLoose;

const expandHome = (p) => (p === "~" || p.startsWith("~/") ? join(homedir(), p.slice(1)) : p);

const profileDir = resolve(expandHome(opts.profile));
try {
  const st = statSync(profileDir, { throwIfNoEntry: false });
  if (st && !st.isDirectory()) {
    console.error(`error: --profile ${profileDir} exists and is not a directory`);
    process.exit(EXIT_USAGE);
  }
} catch {}
mkdirSync(profileDir, { recursive: true });

const lockPath = join(dirname(profileDir), `.${basename(profileDir)}.lock`);

const pidAlive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === "EPERM";
  }
};

const releaseLock = () => {
  try {
    const held = JSON.parse(readFileSync(lockPath, "utf8"));
    if (held.pid === process.pid) unlinkSync(lockPath);
  } catch {}
};

const acquireLock = () => {
  const body = JSON.stringify({ pid: process.pid, at: new Date().toISOString(), profile: profileDir });
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      writeFileSync(lockPath, body, { flag: "wx" });
      return;
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
      let held = null;
      try {
        held = JSON.parse(readFileSync(lockPath, "utf8"));
      } catch {}
      if (held && Number.isInteger(held.pid) && held.pid !== process.pid && pidAlive(held.pid)) {
        console.error(`error: another look is running on this profile (pid ${held.pid}, started ${held.at ?? "unknown"}).`);
        console.error(`  lock: ${lockPath}`);
        console.error("  wait for that run to finish, or delete the lock file if that pid is gone.");
        process.exit(EXIT_LOCKED);
      }
      note(`removing stale lock ${lockPath}`);
      try {
        unlinkSync(lockPath);
      } catch {}
    }
  }
  console.error(`error: could not take the profile lock ${lockPath}. delete it if no look is running.`);
  process.exit(EXIT_LOCKED);
};

const displayRemediation = () => {
  const runtimeDir = `/run/user/${process.getuid()}`;
  let auth = join(runtimeDir, ".mutter-Xwaylandauth.XXXXXX");
  try {
    const found = readdirSync(runtimeDir).filter((f) => f.startsWith(".mutter-Xwaylandauth"));
    if (found.length) auth = join(runtimeDir, found[0]);
  } catch {}
  const runtime = process.env.XDG_RUNTIME_DIR || `/run/user/${process.getuid()}`;
  console.error("  the agent shell usually has no display variables. export these first:");
  console.error(`    export XDG_RUNTIME_DIR=${runtime}`);
  console.error("    export DISPLAY=:0                        # Xwayland on this desktop");
  console.error(`    export XAUTHORITY=${auth}`);
  console.error(`  discovery: ls ${runtime}/.mutter-Xwaylandauth.*  and  ls /tmp/.X11-unix`);
  console.error("  headless is not a substitute: it is fingerprinted and rate-limits the connection.");
  console.error("  if you really want headless anyway, pass --headless explicitly.");
};

const [width, height] = opts.viewport.split("x").map(Number);
const contextOptions = {
  viewport: { width, height },
  locale: "en-IN",
  timezoneId: "Asia/Kolkata",
  args: ["--disable-blink-features=AutomationControlled"],
};

if (opts.headless) {
  console.error("WARNING: headless mode requested. It is detectable (UA advertises HeadlessChrome) and");
  console.error("WARNING: gets rate-limited or blocked on search engines, maps and directory sites.");
}

const preflightDisplay = () => {
  if (opts.headless) return;
  if (!process.env.DISPLAY) {
    console.error("error: no DISPLAY, so a headed browser cannot start. refusing to fall back to headless.");
    displayRemediation();
    process.exit(EXIT_LAUNCH);
  }
};

preflightDisplay();
acquireLock();
process.on("exit", releaseLock);
for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) {
  process.on(signal, () => {
    releaseLock();
    process.exit(EXIT_LAUNCH);
  });
}

const mode = opts.headless ? "headless-explicit" : "headed";
let browser;
try {
  browser = await chromium.launchPersistentContext(profileDir, { ...contextOptions, headless: opts.headless });
} catch (error) {
  releaseLock();
  console.error(`error: ${mode} launch failed: ${firstLine(error.message)}`);
  if (!opts.headless) {
    console.error("  not retrying headless: that would be detected and would quietly poison the session.");
    displayRemediation();
  }
  process.exit(EXIT_LAUNCH);
}

const page = browser.pages()[0] ?? (await browser.newPage());
page.setDefaultTimeout(opts.timeout);
const started = Date.now();
const out = { url: opts.url, mode, actions: [], failures: [] };

const selectorArg = (raw) => {
  if (raw.startsWith("css=")) return { kind: "css", value: raw.slice(4) };
  if (raw.startsWith("xpath=")) return { kind: "xpath", value: raw.slice(6) };
  if (raw.startsWith("//")) return { kind: "xpath", value: raw };
  if (/^[#.[]/.test(raw)) return { kind: "css", value: raw };
  return null;
};

const markClickTarget = (needle) =>
  page.evaluate((text) => {
    const clean = (s) => (s || "").replace(/\s+/g, " ").trim();
    const q = clean(text).toLowerCase();
    const sel =
      "a,button,[role=button],[role=link],[role=tab],[role=menuitem],[role=option],[role=switch],[role=radio],input[type=button],input[type=submit],summary,label,[onclick],[tabindex]";
    const hits = [];
    for (const el of document.querySelectorAll(sel)) {
      const label = clean(el.innerText) || clean(el.value) || clean(el.getAttribute("aria-label")) || clean(el.getAttribute("title"));
      if (!label || !label.toLowerCase().includes(q)) continue;
      const rect = el.getBoundingClientRect();
      if (rect.width < 2 || rect.height < 2) continue;
      const style = getComputedStyle(el);
      if (style.visibility === "hidden" || style.display === "none" || style.pointerEvents === "none") continue;
      if (el.disabled) continue;
      hits.push({ el, label, own: clean(el.innerText || el.value).length });
    }
    if (!hits.length) return null;
    hits.sort((a, b) => (a.own === 0 ? 1 : 0) - (b.own === 0 ? 1 : 0) || a.own - b.own);
    const best = hits[0];
    best.el.setAttribute("data-look-target", "1");
    return { tag: best.el.tagName.toLowerCase(), role: best.el.getAttribute("role") || "", text: best.label.slice(0, 90) };
  }, needle);

const clickTarget = async (raw) => {
  const result = { click: raw, ok: false };
  const explicit = selectorArg(raw);
  if (explicit) {
    try {
      await page.locator(raw.replace(/^css=/, "")).first().click({ timeout: 8000 });
      result.ok = true;
      result.matched = { kind: explicit.kind, selector: explicit.value };
    } catch (error) {
      result.reason = firstLine(error.message).replace(/^locator\.click: /, "").slice(0, 160);
    }
    return result;
  }

  const rolePattern = new RegExp(raw.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
  const candidates = [];
  for (const role of ["tab", "button", "link", "menuitem", "option", "radio", "switch"]) {
    const locator = page.getByRole(role, { name: rolePattern });
    const count = Math.min(await locator.count().catch(() => 0), 25);
    for (let i = 0; i < count; i += 1) {
      const one = locator.nth(i);
      const label = (
        await one
          .evaluate((el) => (el.innerText || el.value || el.getAttribute("aria-label") || el.title || "").replace(/\s+/g, " ").trim())
          .catch(() => "")
      ).slice(0, 120);
      if (!label) continue;
      const exact = label.toLowerCase() === raw.toLowerCase() ? 0 : 1;
      candidates.push({ locator: one, role, label, score: exact * 1000 + label.length });
    }
  }
  candidates.sort((a, b) => a.score - b.score);
  for (const candidate of candidates) {
    try {
      await candidate.locator.click({ timeout: 4000 });
      result.ok = true;
      result.matched = { kind: "role", role: candidate.role, text: candidate.label.slice(0, 90) };
      return result;
    } catch (error) {
      note(`role ${candidate.role} "${candidate.label.slice(0, 40)}" click failed: ${firstLine(error.message)}`);
    }
  }
  if (candidates.length) result.reason = `matched ${candidates.length} role element(s) but none could be clicked`;
  const found = await markClickTarget(raw);
  if (found) {
    try {
      await page.locator('[data-look-target="1"]').first().click({ timeout: 8000 });
      result.ok = true;
      result.matched = { kind: "dom", ...found };
      return result;
    } catch (error) {
      result.reason = firstLine(error.message).replace(/^locator\.click: /, "").slice(0, 160);
      return result;
    } finally {
      await page.evaluate(() => document.querySelectorAll("[data-look-target]").forEach((el) => el.removeAttribute("data-look-target"))).catch(() => {});
    }
  }

  result.reason ??= "no actionable element (button, link, tab, role, input, label) matched; plain text is not clickable";
  return result;
};

const sampleScroller = (doScroll) =>
  page.evaluate((scrollNow) => {
    const clean = (value) => (value || "").replace(/\s+/g, " ").trim();
    const doc = document.scrollingElement || document.documentElement;
    const candidates = [];
    if (doc && doc.scrollHeight > doc.clientHeight + 24) candidates.push(doc);
    for (const el of document.querySelectorAll("div,main,section,ul,ol,[role=main],[role=feed],[role=list]")) {
      const style = getComputedStyle(el);
      if (!/auto|scroll|overlay/.test(style.overflowY)) continue;
      const gain = el.scrollHeight - el.clientHeight;
      if (gain <= 24) continue;
      const rect = el.getBoundingClientRect();
      if (rect.width < 120 || rect.height < 120) continue;
      candidates.push(el);
    }
    candidates.sort((a, b) => b.scrollHeight - b.clientHeight - (a.scrollHeight - a.clientHeight));
    const el = candidates[0] || doc;
    if (!el) return { isDocument: true, height: 0, scrollTop: 0, atEnd: true, hash: 0, len: 0, rect: null };
    const isDocument = el === doc;
    if (scrollNow) el.scrollTop = el.scrollHeight;
    const text = clean(el.innerText || "");
    let hash = 0x811c9dc5;
    const bounded = text.length > 60000 ? text.slice(0, 60000) : text;
    for (let i = 0; i < bounded.length; i += 1) {
      hash ^= bounded.charCodeAt(i);
      hash = Math.imul(hash, 0x01000193) >>> 0;
    }
    const rect = el.getBoundingClientRect();
    return {
      isDocument,
      height: el.scrollHeight,
      scrollTop: Math.round(el.scrollTop),
      atEnd: el.scrollTop + el.clientHeight >= el.scrollHeight - 4,
      hash,
      len: text.length,
      rect: { x: Math.round(rect.x), y: Math.round(rect.y), w: Math.round(rect.width), h: Math.round(rect.height) },
    };
  }, doScroll);

const doScroll = async (times) => {
  const first = await sampleScroller(false);
  const log = {
    requested: times,
    done: 0,
    strategy: first.isDocument ? "programmatic" : "wheel",
    target: first.isDocument ? "document" : "container",
    heightBefore: first.height,
    heightAfter: first.height,
    scrollTop: first.scrollTop,
    grew: false,
    atEnd: first.atEnd,
    contentChanged: false,
    wheelTicks: 0,
    stalled: false,
  };
  if (!first.rect) {
    log.stalled = true;
    return log;
  }
  let prev = first;
  const hover = async () => page.mouse.move(first.rect.x + Math.round(first.rect.w / 2), first.rect.y + Math.round(first.rect.h / 2));
  if (log.strategy === "wheel") await hover();

  const step = async (mode) => {
    if (mode === "wheel") {
      await hover();
      await page.mouse.wheel(0, Math.max(600, Math.round(first.rect.h * 1.4)));
      log.wheelTicks += 1;
    } else {
      await sampleScroller(true);
    }
    await page.waitForTimeout(opts.settle);
    return sampleScroller(false);
  };

  for (let i = 0; i < times; i += 1) {
    let now = await step(log.strategy);
    const progressed = now.hash !== prev.hash || now.scrollTop !== prev.scrollTop || now.height !== prev.height;
    log.done += 1;
    log.heightAfter = now.height;
    log.scrollTop = now.scrollTop;
    log.atEnd = now.atEnd;
    if (now.height > log.heightBefore) log.grew = true;
    if (now.hash !== prev.hash) log.contentChanged = true;

    if (!progressed && log.strategy === "wheel") {
      log.strategy = "wheel+programmatic";
      now = await step("programmatic");
      log.done += 1;
      if (now.hash !== prev.hash || now.scrollTop !== prev.scrollTop) {
        log.contentChanged = log.contentChanged || now.hash !== prev.hash;
        log.scrollTop = now.scrollTop;
        log.atEnd = now.atEnd;
        prev = now;
        continue;
      }
    }

    prev = now;
    if (!progressed) {
      log.stalled = true;
      break;
    }
  }
  return log;
};

try {
  const response = await page.goto(opts.url, { waitUntil: "domcontentloaded", timeout: opts.timeout });
  out.status = response ? response.status() : null;
  out.contentType = response ? response.headers()["content-type"] ?? null : null;
  await page.waitForTimeout(1200);

  const snapshot = () =>
    page.evaluate(() => {
      const text = document.body?.innerText ?? "";
      let hash = 0x811c9dc5;
      const bounded = text.length > 100000 ? text.slice(0, 100000) : text;
      for (let i = 0; i < bounded.length; i += 1) {
        hash ^= bounded.charCodeAt(i);
        hash = Math.imul(hash, 0x01000193) >>> 0;
      }
      return { len: text.length, hash, url: location.href };
    });

  const fillField = async (spec) => {
    const idx = spec.indexOf("=");
    const label = spec.slice(0, idx);
    const value = spec.slice(idx + 1);
    const re = new RegExp(label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
    const filled = { fill: label, ok: false };
    const candidates = [
      page.getByLabel(re),
      page.getByPlaceholder(re),
      page.getByRole("combobox", { name: re }),
      page.getByRole("searchbox", { name: re }),
      page.getByRole("textbox", { name: re }),
      page.locator(`input[name="${label.replace(/"/g, '\\"')}"], textarea[name="${label.replace(/"/g, '\\"')}"]`),
    ];
    for (const locator of candidates) {
      const count = Math.min(await locator.count().catch(() => 0), 10);
      for (let i = 0; i < count; i += 1) {
        const one = locator.nth(i);
        try {
          if (!(await one.isVisible())) continue;
          await one.fill(value, { timeout: 6000 });
          filled.ok = true;
          filled.matched = (await one.evaluate((el) => el.tagName.toLowerCase() + (el.name ? `[name=${el.name}]` : ""))).slice(0, 60);
          return filled;
        } catch (error) {
          note(`fill ${label} candidate ${i}: ${firstLine(error.message)}`);
        }
      }
      if (filled.ok) break;
    }
    filled.reason = "no visible input matched that label, placeholder, role or name";
    return filled;
  };

  for (const step of opts.steps) {
    if (step.kind === "fill") {
      const result = await fillField(step.value);
      out.actions.push(result);
      if (!result.ok) break;
      continue;
    }
    const before = await snapshot();
    const result = await clickTarget(step.value);
    if (result.ok) await page.waitForTimeout(900);
    const after = await snapshot();
    result.changed = after.url !== before.url || after.hash !== before.hash;
    result.textDelta = after.len - before.len;
    if (result.changed) {
      try {
        await page.waitForLoadState("domcontentloaded", { timeout: 5000 });
      } catch {}
      await page.waitForTimeout(600);
    }
    out.actions.push(result);
    if (!result.ok) break;
  }

  if (opts.waitFor) {
    const began = Date.now();
    const waited = { waitFor: opts.waitFor, ok: false };
    try {
      const target = selectorArg(opts.waitFor);
      if (target) await page.locator(opts.waitFor.replace(/^(css|xpath)=/, "")).first().waitFor({ state: "visible", timeout: opts.timeout });
      else await page.getByText(new RegExp(opts.waitFor, "i")).first().waitFor({ state: "visible", timeout: opts.timeout });
      waited.ok = true;
    } catch (error) {
      waited.reason = `timed out after ${Date.now() - began} ms`;
      note(`wait-for: ${firstLine(error.message)}`);
    }
    waited.ms = Date.now() - began;
    out.actions.push(waited);
  }

  if (opts.wait) await page.waitForTimeout(opts.wait);

  if (opts.scrollTo) {
    const target = selectorArg(opts.scrollTo);
    const scrollTo = { scrollTo: opts.scrollTo, ok: false, scrolls: 0 };
    for (let i = 0; i <= 12; i += 1) {
      let hit = false;
      try {
        if (target) {
          const loc = page.locator(opts.scrollTo.replace(/^(css|xpath)=/, "")).first();
          hit = (await loc.count()) > 0;
          if (hit) await loc.scrollIntoViewIfNeeded({ timeout: 3000 });
        } else {
          const loc = page.getByText(new RegExp(opts.scrollTo, "i")).first();
          hit = (await loc.count()) > 0;
          if (hit) await loc.scrollIntoViewIfNeeded({ timeout: 3000 });
        }
      } catch {
        hit = false;
      }
      if (hit) {
        scrollTo.ok = true;
        break;
      }
      await sampleScroller(true);
      scrollTo.scrolls += 1;
      await page.waitForTimeout(opts.settle);
    }
    if (!scrollTo.ok) scrollTo.reason = `not found after ${scrollTo.scrolls} scrolls`;
    out.actions.push(scrollTo);
  }

  if (opts.scroll > 0) {
    const log = await doScroll(opts.scroll);
    out.scroll = log;
  }

  const text = await page.evaluate(() => (document.body ? document.body.innerText : ""));
  const cleaned = text.replace(/\n{3,}/g, "\n\n").trim();
  out.finalUrl = page.url();
  out.redirected = page.url().replace(/\/$/, "") !== opts.url.replace(/\/$/, "");
  out.title = await page.title();
  out.webdriver = await page.evaluate(() => navigator.webdriver);
  out.ua = await page.evaluate(() => navigator.userAgent);
  out.bytes = cleaned.length;
  out.ms = Date.now() - started;

  const haystack = `${out.title}\n${cleaned.slice(0, 40000)}`;
  const wall = WALLS.find(([re]) => re.test(haystack));
  let found = wall ? wall[1] : null;
  if (!found && /consent\.google\./.test(out.finalUrl)) found = "google-consent";
  if (!found && cleaned.length === 0) found = "empty-content";
  const htmlLike = !out.contentType || /html|xml/.test(out.contentType);
  if (!found && cleaned.length < THIN_TEXT_CHARS && htmlLike && !opts.screenshot) found = "thin-content";
  if (found && SOFT_WALLS.has(found)) out.partial = found;
  else out.wall = found;

  out.text = opts.max > 0 ? cleaned.slice(0, opts.max) : cleaned;

  if (opts.links) {
    out.links = await page.evaluate(() =>
      [...document.querySelectorAll("a[href]")]
        .map((a) => ({ text: (a.innerText || "").replace(/\s+/g, " ").trim().slice(0, 80), href: a.href }))
        .filter((l) => l.text && l.href.startsWith("http"))
        .slice(0, 80),
    );
  }

  if (opts.extract.length) {
    out.matches = {};
    for (const pattern of opts.extract) {
      let re;
      try {
        re = new RegExp(pattern, "g");
      } catch (error) {
        out.failures.push(`bad regex ${pattern}: ${firstLine(error.message)}`);
        out.matches[pattern] = [];
        continue;
      }
      out.matches[pattern] = [...cleaned.matchAll(re)].map((m) => m[0]).slice(0, 40);
    }
  }

  if (opts.screenshot) {
    await page.screenshot({ path: expandHome(opts.screenshot), fullPage: true });
    out.screenshot = expandHome(opts.screenshot);
  }

  if (out.wall) out.failures.push(`wall: ${out.wall}`);
  if (typeof out.status === "number" && out.status >= 400) out.failures.push(`http ${out.status}`);
  for (const action of out.actions) if (action.ok === false) out.failures.push(`action failed: ${Object.keys(action)[0]}=${action[Object.keys(action)[0]]}`);
  if (out.webdriver) out.failures.push("webdriver flag is true: wrong engine, do not trust this run");
  if (/HeadlessChrome/.test(out.ua) && !opts.headless) out.failures.push("UA advertises HeadlessChrome in headed mode");
} catch (error) {
  out.error = firstLine(error.message);
  out.failures.push(`error: ${out.error}`);
  out.ms = Date.now() - started;
} finally {
  await browser.close().catch(() => {});
  releaseLock();
}

out.ok = out.failures.length === 0;

if (opts.json) {
  console.log(JSON.stringify(out, null, 2));
} else {
  if (out.wall) console.log(`BLOCKED [${out.wall}]`);
  if (out.partial) console.log(`PARTIAL [${out.partial}] page is real but degraded; content below may be incomplete`);
  if (out.error) console.log(`ERROR ${out.error}`);
  if (typeof out.status === "number" && out.status >= 400) console.log(`HTTP ${out.status}`);
  for (const action of out.actions) {
    if (action.ok === false) console.log(`FAILED ${Object.keys(action)[0]}=${action[Object.keys(action)[0]]}${action.reason ? ` (${action.reason})` : ""}`);
  }
  if (out.webdriver) console.log("TRUST [webdriver=true] wrong engine, content is not trustworthy");
  console.log(`url:   ${out.finalUrl ?? opts.url}${out.redirected ? "  (redirected)" : ""}`);
  console.log(`title: ${out.title ?? "-"}`);
  console.log(`status: ${out.status ?? "-"}  mode: ${out.mode}  ms: ${out.ms}  webdriver: ${out.webdriver}`);
  if (out.ua && /HeadlessChrome/.test(out.ua)) console.log("ua:    advertises HeadlessChrome (detectable)");
  if (out.actions.length) console.log(`actions: ${JSON.stringify(out.actions)}`);
  if (out.scroll) console.log(`scroll: ${JSON.stringify(out.scroll)}`);
  if (out.matches) for (const [k, v] of Object.entries(out.matches)) console.log(`extract ${k}: ${JSON.stringify(v)} (${v.length} matches)`);
  if (out.links) console.log(`links:\n${out.links.map((l) => `  ${l.text}  ${l.href}`).join("\n")}`);
  if (out.screenshot) console.log(`screenshot: ${out.screenshot}`);
  console.log("---");
  console.log(out.text ?? "");
}

process.exit(out.ok ? EXIT_OK : EXIT_BLOCKED);
