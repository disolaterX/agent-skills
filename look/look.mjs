#!/usr/bin/env node
import { linkSync, mkdirSync, writeFileSync, readFileSync, readdirSync, lstatSync, renameSync, statSync, unlinkSync } from "node:fs";
import { createRequire } from "node:module";
import { homedir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const EXIT_OK = 0;
const EXIT_BLOCKED = 1;
const EXIT_USAGE = 2;
const EXIT_LAUNCH = 3;
const EXIT_LOCKED = 4;
const EXIT_INTERRUPT = 130;

const labDir = join(homedir(), ".local/share/browser-lab");

function firstLine(text) {
  return String(text || "").split("\n").find((line) => line.trim()) ?? "";
}

const sanitize = (value) =>
  String(value ?? "")
    .replace(/\u001b\][^\u0007\u001b]*(\u0007|\u001b\\)/g, "")
    .replace(/\u001b\[[0-9;?]*[ -/]*[@-~]/g, "")
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f\u0080-\u009f]/g, "")
    .replace(/\r/g, "");

const escapeRe = (text) => String(text).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const SOFT_WALLS = [
  [/sign-in to get the best of google maps/i, "google-maps-signin-wall"],
  [/you.re seeing a limited view/i, "google-maps-limited-view"],
  [/limited view of google maps/i, "google-maps-limited-view"],
  [/before you continue to google/i, "google-consent"],
];

const HARD_WALLS = [
  [/just a moment/i, "cloudflare-js-challenge"],
  [/attention required/i, "cloudflare-block"],
  [/verify(ing)? you are human/i, "captcha-interstitial"],
  [/unusual traffic/i, "google-rate-limit"],
  [/our systems have detected/i, "google-automated-queries"],
  [/are you a robot/i, "robot-check"],
  [/challenge-platform/i, "challenge-platform"],
  [/sorry\/index/i, "google-sorry"],
  [/pardon our interruption/i, "akamai-block"],
];

const GENERIC_WALLS = [
  [/access denied/i, "access-denied"],
  [/enable javascript/i, "js-required-wall"],
  [/ddos protection/i, "ddos-wall"],
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
  deadline: 0,
  profile: join(labDir, "profile"),
  viewport: "1440x900",
  allowLocal: false,
  verbose: false,
};

const HELP = `look <url> [options]

  --click <text>          click the first *actionable* element matching text
  --fill <label=value>    fill an input by label, placeholder, role or name
                          --click and --fill run in the order you give them
  --scroll <n>            scroll the page's main scrollable area to the bottom n times
  --scroll-to <text>      scroll until text (or css=/xpath= selector) is in view
  --settle <ms>           pause after each scroll, default 700
  --wait <ms>             sleep after the steps
  --wait-for <text>       wait until text (or css=/xpath= selector) appears; absent = timeout = exit 1
  --extract <regex>       print up to 40 matches of a regex (repeatable)
  --links                 append anchor list
  --screenshot <path>     save a png
  --max <chars>           cap text output (default 4000, 0 = unlimited)
  --timeout <ms>          per-navigation and per-wait timeout, default 45000
  --deadline <ms>         hard cap on the whole run, 0 = auto
  --viewport <wxh>        default 1440x900
  --allow-local           permit file:// urls (refused by default)
  --headless              force headless (detectable; avoid search/maps/directory sites)
  --profile <dir>         persistent profile (default ~/.local/share/browser-lab/profile)
  --json                  structured output
  --verbose               print diagnostics to stderr

Steps run in argument order. --wait, --wait-for, --scroll-to and --scroll always run
after every step, in that order, wherever they appear on the command line.

Exit codes: 0 content, 1 wall/error/empty, 2 usage, 3 no display or engine failure,
4 another look holds the lock, 130 interrupted`;

try {
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
    else if (a === "--allow-local") opts.allowLocal = true;
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
    else if (a === "--deadline") opts.deadline = Number(next());
    else if (a === "--profile") opts.profile = next();
    else if (a === "--viewport") opts.viewport = next();
    else if (a === "-h" || a === "--help") {
      console.log(HELP);
      process.exit(EXIT_OK);
    } else if (a.startsWith("-")) {
      throw new Error(`unknown flag ${a}`);
    } else positionals.push(a);
  }
} catch (error) {
  console.error(`error: ${firstLine(error.message)}`);
  console.error("run: look --help");
  process.exit(EXIT_USAGE);
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
for (const key of ["max", "wait", "settle", "scroll", "timeout", "deadline"]) {
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

const scheme = (() => {
  try {
    return new URL(opts.url).protocol;
  } catch {
    return null;
  }
})();
if (scheme && !["http:", "https:", "file:"].includes(scheme)) {
  console.error(`error: refusing ${scheme} urls; http, https and file (with --allow-local) only`);
  process.exit(EXIT_USAGE);
}
if (scheme === "file:" && !opts.allowLocal) {
  console.error("error: file:// urls are refused by default; pass --allow-local if you mean to read a local file");
  process.exit(EXIT_USAGE);
}

const note = (m) => {
  if (opts.verbose) console.error(`[look] ${m}`);
};

const expandHome = (p) => (p === "~" || p.startsWith("~/") ? join(homedir(), p.slice(1)) : p);

const profileDir = resolve(expandHome(opts.profile));
if (dirname(profileDir) === profileDir) {
  console.error("error: --profile cannot be the filesystem root");
  process.exit(EXIT_USAGE);
}
const existing = statSync(profileDir, { throwIfNoEntry: false });
if (existing && !existing.isDirectory()) {
  console.error(`error: --profile ${profileDir} exists and is not a directory`);
  process.exit(EXIT_USAGE);
}
try {
  mkdirSync(profileDir, { recursive: true });
} catch (error) {
  console.error(`error: cannot create --profile ${profileDir}: ${firstLine(error.message)}`);
  process.exit(EXIT_USAGE);
}
const profileStat = statSync(profileDir);
if (profileStat.uid !== process.getuid()) {
  console.error(`error: --profile ${profileDir} is owned by uid ${profileStat.uid}, not you; refusing to put cookies there`);
  process.exit(EXIT_USAGE);
}

const lockPath = join(dirname(profileDir), `.${basename(profileDir)}.lock`);

const pidAlive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === "EPERM";
  }
};

const readLockFile = (path) => {
  const info = lstatSync(path, { throwIfNoEntry: false });
  if (!info) return null;
  if (!info.isFile() || info.size > 4096) return { unreadable: true };
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8"));
    return parsed && typeof parsed === "object" ? parsed : { unreadable: true };
  } catch {
    return { unreadable: true };
  }
};

const releaseLock = () => {
  try {
    const held = readLockFile(lockPath);
    if (held && !held.unreadable && held.pid === process.pid) unlinkSync(lockPath);
  } catch {}
};

const busy = (held) => {
  console.error(`error: another look is running on this profile (pid ${held.pid}, started ${held.at ?? "unknown"}).`);
  console.error(`  lock: ${lockPath}`);
  console.error("  wait for that run to finish, or delete that file if the pid is gone.");
  process.exit(EXIT_LOCKED);
};

const acquireLock = async () => {
  const body = JSON.stringify({ pid: process.pid, at: new Date().toISOString(), profile: profileDir });
  for (let attempt = 0; attempt < 6; attempt += 1) {
    try {
      writeFileSync(lockPath, body, { flag: "wx" });
      return;
    } catch (error) {
      if (error.code !== "EEXIST") {
        console.error(`error: cannot write the profile lock ${lockPath}: ${firstLine(error.message)}`);
        process.exit(EXIT_LOCKED);
      }
    }
    const held = readLockFile(lockPath);
    if (held === null) continue;
    if (held.unreadable || !Number.isInteger(held.pid)) {
      console.error(`error: ${lockPath} exists but is not a lock file this tool wrote; refusing to touch it.`);
      process.exit(EXIT_LOCKED);
    }
    if (held.pid !== process.pid && pidAlive(held.pid)) busy(held);

    const claim = `${lockPath}.${process.pid}.stale`;
    try {
      renameSync(lockPath, claim);
    } catch {
      continue;
    }
    const claimed = readLockFile(claim);
    if (claimed && Number.isInteger(claimed.pid) && pidAlive(claimed.pid)) {
      try {
        linkSync(claim, lockPath);
      } catch {
        note("a newer lock appeared while reclaiming; leaving it alone");
      }
      try {
        unlinkSync(claim);
      } catch {}
      busy(claimed);
    }
    try {
      unlinkSync(claim);
    } catch {}
    note(`removed stale lock for pid ${held.pid ?? "?"}`);
  }
  console.error(`error: could not take the profile lock ${lockPath}; delete it if no look is running.`);
  process.exit(EXIT_LOCKED);
};

const displayRemediation = () => {
  const runtimeDir = `/run/user/${process.getuid()}`;
  let auth = join(runtimeDir, ".mutter-Xwaylandauth.XXXXXX");
  try {
    const found = readdirSync(runtimeDir).filter((f) => f.startsWith(".mutter-Xwaylandauth"));
    if (found.length) auth = join(runtimeDir, found[0]);
  } catch {}
  const runtime = process.env.XDG_RUNTIME_DIR || runtimeDir;
  console.error("  the agent shell usually has no display variables. export these first:");
  console.error(`    export XDG_RUNTIME_DIR=${runtime}`);
  console.error("    export DISPLAY=:0                        # Xwayland on this desktop");
  console.error(`    export XAUTHORITY=${auth}`);
  console.error(`  discovery: ls ${runtime}/.mutter-Xwaylandauth.*  and  ls /tmp/.X11-unix`);
  console.error("  headless is not a substitute: it is fingerprinted and rate-limits the connection.");
  console.error("  if you really want headless anyway, pass --headless explicitly.");
};

const looksLikeDisplayProblem = (message) =>
  /XServer|xserver|authorization|authority|cannot open display|DISPLAY|Missing X server|Wayland|platform failed to initialize/i.test(message);

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

if (!opts.headless && !process.env.DISPLAY) {
  console.error("error: no DISPLAY, so a headed browser cannot start. refusing to fall back to headless.");
  displayRemediation();
  process.exit(EXIT_LAUNCH);
}

const { chromium } = await (async () => {
  const failures = [];
  try {
    return await import("patchright");
  } catch (error) {
    failures.push(`${firstLine(error.message)}`);
  }
  try {
    const requireFromLab = createRequire(join(labDir, "package.json"));
    return await import(pathToFileURL(requireFromLab.resolve("patchright")).href);
  } catch (error) {
    failures.push(`${labDir}: ${firstLine(error.message)}`);
  }
  console.error("error: the patchright engine is not loadable, so no browser can start.");
  for (const failure of failures) console.error(`  ${failure}`);
  console.error("  install it:");
  console.error(`    mkdir -p ${labDir} && cd ${labDir} && npm init -y && npm install patchright && npx patchright install chromium`);
  process.exit(EXIT_LAUNCH);
})();

await acquireLock();
process.on("exit", releaseLock);

const mode = opts.headless ? "headless-explicit" : "headed";
let browser;
try {
  browser = await chromium.launchPersistentContext(profileDir, { ...contextOptions, headless: opts.headless });
} catch (error) {
  releaseLock();
  console.error(`error: ${mode} launch failed: ${firstLine(error.message)}`);
  if (!opts.headless) {
    console.error("  not retrying headless: that would be detected and would quietly poison the session.");
    if (/Opening in existing browser session|profile is already in use/i.test(error.message)) {
      console.error(`  another Chromium is using ${profileDir}, and it may not be look. wait a few seconds, or use --profile with a scratch dir.`);
    } else if (looksLikeDisplayProblem(error.message)) {
      displayRemediation();
    } else {
      console.error("  if the browser build is missing: npx patchright install chromium");
    }
  }
  process.exit(EXIT_LAUNCH);
}

let exiting = false;
const shutdown = (code) => {
  if (exiting) return;
  exiting = true;
  console.error("error: interrupted; releasing the profile lock and exiting.");
  releaseLock();
  const force = setTimeout(() => process.exit(code), 1500);
  browser
    .close()
    .catch(() => {})
    .finally(() => {
      clearTimeout(force);
      process.exit(code);
    });
};
for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) process.on(signal, () => shutdown(EXIT_INTERRUPT));

const page = browser.pages()[0] ?? (await browser.newPage());
page.setDefaultTimeout(opts.timeout);
const started = Date.now();
const out = { url: opts.url, mode, actions: [], failures: [] };

const stepBudget =
  opts.steps.filter((s) => s.kind === "click").length * 60000 +
  opts.steps.filter((s) => s.kind === "fill").length * 40000 +
  (opts.scrollTo ? 60000 : 0) +
  opts.wait +
  opts.scroll * opts.settle;
const watchdogBudget = opts.deadline > 0 ? opts.deadline : Math.max(300000, opts.timeout * 2 + stepBudget + 120000);
const watchdog = setTimeout(() => {
  console.error(`error: run exceeded its ${Math.round(watchdogBudget / 1000)}s deadline and was killed (a page or script call is not returning).`);
  console.error(`  raise --deadline if this page is legitimately slow. lock: ${lockPath}`);
  releaseLock();
  process.exit(EXIT_BLOCKED);
}, watchdogBudget);

const selectorArg = (raw) => {
  if (raw.startsWith("css=")) return { kind: "css", value: raw.slice(4) };
  if (raw.startsWith("xpath=")) return { kind: "xpath", value: raw.slice(6) };
  return null;
};

const findClickTarget = (needle) =>
  page.evaluateHandle((text) => {
    const clean = (s) => (s || "").replace(/\s+/g, " ").trim();
    const q = clean(text).toLowerCase();
    const inherent = "a,button,summary,label,option,select,textarea,input";
    const sel =
      "a,button,[role=button],[role=link],[role=tab],[role=menuitem],[role=option],[role=switch],[role=radio],input[type=button],input[type=submit],summary,label,[onclick],[tabindex]:not([tabindex='-1'])";
    const hits = [];
    for (const el of document.querySelectorAll(sel)) {
      const label = clean(el.innerText) || clean(el.value) || clean(el.getAttribute("aria-label")) || clean(el.getAttribute("title"));
      if (!label || !label.toLowerCase().includes(q)) continue;
      if (!el.matches(inherent) && el.querySelectorAll("a,button,[role=button],[role=tab],input").length >= 2) continue;
      if (!el.matches(inherent) && label.length > q.length * 6 + 80) continue;
      const rect = el.getBoundingClientRect();
      if (rect.width < 2 || rect.height < 2) continue;
      const style = getComputedStyle(el);
      if (style.visibility === "hidden" || style.display === "none" || style.pointerEvents === "none") continue;
      if (el.disabled) continue;
      hits.push({ el, label, own: clean(el.innerText || el.value).length });
    }
    if (!hits.length) return null;
    hits.sort((a, b) => (a.own === 0 ? 1 : 0) - (b.own === 0 ? 1 : 0) || a.own - b.own);
    return hits[0].el;
  }, needle);

const clickTarget = async (raw) => {
  const result = { click: raw, ok: false };
  const explicit = selectorArg(raw);
  if (explicit) {
    try {
      await page.locator(raw).first().click({ timeout: 8000 });
      result.ok = true;
      result.matched = { kind: explicit.kind, selector: raw };
    } catch (error) {
      result.reason = firstLine(error.message).replace(/^locator\.click: /, "").slice(0, 160);
    }
    return result;
  }

  const rolePattern = new RegExp(escapeRe(raw), "i");
  const candidates = [];
  for (const role of ["tab", "button", "link", "menuitem", "option", "radio", "switch"]) {
    const locator = page.getByRole(role, { name: rolePattern });
    const count = Math.min(await locator.count().catch(() => 0), 8);
    for (let i = 0; i < count; i += 1) {
      const one = locator.nth(i);
      if (!(await one.isVisible().catch(() => false))) continue;
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
  for (const candidate of candidates.slice(0, 12)) {
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

  const handle = await findClickTarget(raw);
  const element = handle.asElement();
  if (element) {
    try {
      const found = await element.evaluate((el) => ({
        tag: el.tagName.toLowerCase(),
        role: el.getAttribute("role") || "",
        text: ((el.innerText || el.value || el.getAttribute("aria-label") || "").replace(/\s+/g, " ").trim() || "").slice(0, 90),
      }));
      await element.click({ timeout: 8000 });
      result.ok = true;
      result.matched = { kind: "dom", ...found };
      return result;
    } catch (error) {
      result.reason = firstLine(error.message).replace(/^locator\.click: /, "").slice(0, 160);
      return result;
    } finally {
      await handle.dispose().catch(() => {});
    }
  }

  result.reason ??= "no actionable element (button, link, tab, role, input, label) matched; plain text and page wrappers are not clickable";
  return result;
};

const snapshot = async () => {
  try {
    return await page.evaluate(() => {
      const text = document.body?.innerText ?? "";
      let hash = 0x811c9dc5;
      const bounded = text.length > 100000 ? text.slice(0, 100000) : text;
      for (let i = 0; i < bounded.length; i += 1) {
        hash ^= bounded.charCodeAt(i);
        hash = Math.imul(hash, 0x01000193) >>> 0;
      }
      return { len: text.length, hash, url: location.href };
    });
  } catch {
    return null;
  }
};

const fillField = async (spec) => {
  const idx = spec.indexOf("=");
  const label = spec.slice(0, idx);
  const value = spec.slice(idx + 1);
  const wanted = label.toLowerCase();
  const filled = { fill: label, ok: false };
  const handles = await page.$$("input,textarea,select,[contenteditable=''],[contenteditable=true]");
  const candidates = [];
  for (const one of handles) {
    if (candidates.length >= 12) break;
    if (!(await one.isVisible().catch(() => false))) continue;
    const info = await one
      .evaluate((el) => ({
        names: [
          el.getAttribute("aria-label") || "",
          (el.getAttribute("aria-labelledby") || "")
            .split(/\s+/)
            .filter(Boolean)
            .map((id) => document.getElementById(id)?.innerText || "")
            .join(" "),
          el.labels && el.labels.length ? el.labels[0].innerText : "",
          el.placeholder || "",
          el.name || "",
          el.id || "",
        ]
          .map((v) => String(v).replace(/\s+/g, " ").trim())
          .filter(Boolean),
      }))
      .catch(() => null);
    if (!info) continue;
    if (!info.names.some((name) => name.toLowerCase().includes(wanted))) continue;
    candidates.push({ one, exact: info.names.some((name) => name.toLowerCase() === wanted) });
  }
  candidates.sort((a, b) => Number(b.exact) - Number(a.exact));
  const errors = [];
  for (const candidate of candidates) {
    try {
      await candidate.one.fill(value, { timeout: 2500 });
      filled.ok = true;
      filled.matched = await candidate.one
        .evaluate((el) => el.tagName.toLowerCase() + (el.name ? `[name=${el.name}]` : ""))
        .catch(() => label);
      return filled;
    } catch (error) {
      errors.push(firstLine(error.message));
    }
  }
  filled.reason = candidates.length
    ? `matched ${candidates.length} field(s), none accepted the value: ${errors[0] ?? ""}`.trim()
    : "no visible input matched that label, placeholder, role or name";
  return filled;
};

const pickScroller = () =>
  page.evaluateHandle(() => {
    const doc = document.scrollingElement || document.documentElement;
    const candidates = [];
    if (doc && doc.scrollHeight > doc.clientHeight + 24) candidates.push(doc);
    for (const el of document.querySelectorAll("div,main,section,ul,ol,[role=main],[role=feed],[role=list]")) {
      const style = getComputedStyle(el);
      if (!/auto|scroll|overlay/.test(style.overflowY)) continue;
      if (el.scrollHeight <= el.clientHeight + 24) continue;
      const rect = el.getBoundingClientRect();
      if (rect.width < 120 || rect.height < 120) continue;
      candidates.push(el);
    }
    candidates.sort((a, b) => b.scrollHeight - b.clientHeight - (a.scrollHeight - a.clientHeight));
    return candidates[0] || doc;
  });

const sampleScroller = (handle) =>
  handle.evaluate((el) => {
    const text = (el.innerText || "").replace(/\s+/g, " ").trim();
    let hash = 0x811c9dc5;
    const bounded = text.length > 60000 ? text.slice(0, 60000) : text;
    for (let i = 0; i < bounded.length; i += 1) {
      hash ^= bounded.charCodeAt(i);
      hash = Math.imul(hash, 0x01000193) >>> 0;
    }
    const rect = el.getBoundingClientRect();
    return {
      connected: el.isConnected,
      isDocument: el === (document.scrollingElement || document.documentElement),
      height: el.scrollHeight,
      scrollTop: Math.round(el.scrollTop),
      atEnd: el.scrollTop + el.clientHeight >= el.scrollHeight - 4,
      hash,
      len: text.length,
      rect: { x: Math.round(rect.x), y: Math.round(rect.y), w: Math.round(rect.width), h: Math.round(rect.height) },
    };
  });

const scrollToBottom = (handle) =>
  handle.evaluate((el) => {
    el.scrollTop = el.scrollHeight;
  });

const doScroll = async (times) => {
  let handle = await pickScroller();
  const first = await sampleScroller(handle);
  const primary = first.isDocument ? "programmatic" : "wheel";
  const log = {
    requested: times,
    done: 0,
    strategy: primary,
    target: first.isDocument ? "document" : "container",
    heightBefore: first.height,
    heightAfter: first.height,
    scrollTop: first.scrollTop,
    grew: false,
    atEnd: first.atEnd,
    contentChanged: false,
    wheelTicks: 0,
    fallback: null,
    stalled: false,
  };
  let prev = first;
  let alternate = false;
  for (let i = 0; i < times; i += 1) {
    const useWheel = alternate ? primary === "programmatic" : primary === "wheel";
    if (useWheel) {
      const box = await handle.evaluate((el) => {
        const r = el.getBoundingClientRect();
        const left = Math.max(0, r.left);
        const top = Math.max(0, r.top);
        const right = Math.min(window.innerWidth, r.right);
        const bottom = Math.min(window.innerHeight, r.bottom);
        const visible = right > left && bottom > top;
        return {
          x: visible ? (left + right) / 2 : window.innerWidth / 2,
          y: visible ? (top + bottom) / 2 : window.innerHeight / 2,
          h: Math.max(1, Math.min(r.height, window.innerHeight)),
        };
      });
      await page.mouse.move(Math.round(box.x), Math.round(box.y));
      await page.mouse.wheel(0, Math.max(600, Math.round(box.h * 1.4)));
      log.wheelTicks += 1;
    } else {
      await scrollToBottom(handle);
    }
    await page.waitForTimeout(opts.settle);
    let now = await sampleScroller(handle);
    const targetStale = !now.connected || now.height <= now.rect.h + 24;
    if (targetStale && (log.reResolved ?? 0) < 3) {
      await handle.dispose().catch(() => {});
      handle = await pickScroller();
      now = await sampleScroller(handle);
      prev = now;
      log.reResolved = (log.reResolved ?? 0) + 1;
      log.done += 1;
      if (log.done === 1) log.heightBefore = now.height;
      log.heightAfter = now.height;
      log.scrollTop = now.scrollTop;
      log.atEnd = now.atEnd;
      continue;
    }
    log.done += 1;
    log.heightAfter = now.height;
    log.scrollTop = now.scrollTop;
    log.atEnd = now.atEnd;
    if (now.height > log.heightBefore) log.grew = true;
    if (now.hash !== prev.hash) log.contentChanged = true;
    const progressed = now.hash !== prev.hash || now.scrollTop !== prev.scrollTop || now.height !== prev.height;
    prev = now;
    if (!progressed) {
      if (!alternate) {
        alternate = true;
        log.fallback = primary === "wheel" ? "programmatic" : "wheel";
        continue;
      }
      log.stalled = true;
      break;
    }
    alternate = false;
  }
  await handle.dispose().catch(() => {});
  return log;
};

const normalizeUrl = (value) => {
  try {
    const u = new URL(value);
    const port = u.port === "80" || u.port === "443" ? "" : `:${u.port}`;
    return `${u.protocol}//${u.hostname.toLowerCase()}${port}${u.pathname.replace(/\/$/, "")}${u.search}`;
  } catch {
    return String(value).replace(/\/$/, "");
  }
};

try {
  const response = await page.goto(opts.url, { waitUntil: "domcontentloaded", timeout: opts.timeout });
  out.status = response ? response.status() : null;
  out.contentType = response ? response.headers()["content-type"] ?? null : null;
  await page.waitForTimeout(1200);

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
    result.changed = before && after ? after.url !== before.url || after.hash !== before.hash : null;
    if (before && after) result.textDelta = after.len - before.len;
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
      if (target) await page.locator(opts.waitFor).first().waitFor({ state: "visible", timeout: opts.timeout });
      else await page.getByText(new RegExp(escapeRe(opts.waitFor), "i")).first().waitFor({ state: "visible", timeout: opts.timeout });
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
    const scrollTo = { scrollTo: opts.scrollTo, ok: false, scrolls: 0, strategy: null };
    let handle = await pickScroller();
    const startSample = await sampleScroller(handle);
    let strategy = startSample.isDocument ? "programmatic" : "wheel";
    scrollTo.strategy = strategy;
    let alternate = false;
    for (let i = 0; i < 12; i += 1) {
      try {
        const loc = target ? page.locator(opts.scrollTo).first() : page.getByText(new RegExp(escapeRe(opts.scrollTo), "i")).first();
        if ((await loc.count()) > 0) {
          await loc.scrollIntoViewIfNeeded({ timeout: 3000 });
          scrollTo.ok = true;
          break;
        }
      } catch {
        note(`scroll-to probe failed at ${i}`);
      }
      const useWheel = alternate ? strategy === "programmatic" : strategy === "wheel";
      const before = await sampleScroller(handle);
      if (useWheel) {
        const box = await handle.evaluate((el) => {
          const r = el.getBoundingClientRect();
          const left = Math.max(0, r.left);
          const top = Math.max(0, r.top);
          const right = Math.min(window.innerWidth, r.right);
          const bottom = Math.min(window.innerHeight, r.bottom);
          const visible = right > left && bottom > top;
          return {
            x: visible ? (left + right) / 2 : window.innerWidth / 2,
            y: visible ? (top + bottom) / 2 : window.innerHeight / 2,
            h: Math.max(1, Math.min(r.height, window.innerHeight)),
          };
        });
        await page.mouse.move(Math.round(box.x), Math.round(box.y));
        await page.mouse.wheel(0, Math.max(400, Math.round(box.h * 0.9)));
        await page.mouse.wheel(0, Math.max(400, Math.round(box.h * 0.9)));
      } else {
        await scrollToBottom(handle);
      }
      scrollTo.scrolls += 1;
      await page.waitForTimeout(opts.settle);
      let after = await sampleScroller(handle);
      if ((!after.connected || after.height <= after.rect.h + 24) && (scrollTo.reResolved ?? 0) < 3) {
        await handle.dispose().catch(() => {});
        handle = await pickScroller();
        after = await sampleScroller(handle);
        scrollTo.reResolved = (scrollTo.reResolved ?? 0) + 1;
      }
      const progressed = after.scrollTop !== before.scrollTop || after.height !== before.height || after.hash !== before.hash;
      if (!progressed) {
        if (alternate) break;
        alternate = true;
        scrollTo.strategy = `${strategy}+${strategy === "wheel" ? "programmatic" : "wheel"}`;
      } else {
        alternate = false;
      }
    }
    if (!scrollTo.ok) {
      try {
        const loc = target ? page.locator(opts.scrollTo).first() : page.getByText(new RegExp(escapeRe(opts.scrollTo), "i")).first();
        if ((await loc.count()) > 0) {
          await loc.scrollIntoViewIfNeeded({ timeout: 3000 });
          scrollTo.ok = true;
        }
      } catch {}
    }
    await handle.dispose().catch(() => {});
    if (!scrollTo.ok) scrollTo.reason = `not found after ${scrollTo.scrolls} scrolls`;
    out.actions.push(scrollTo);
  }

  if (opts.scroll > 0) out.scroll = await doScroll(opts.scroll);

  const text = await page.evaluate(() => (document.body ? document.body.innerText : ""));
  const cleaned = text.replace(/\n{3,}/g, "\n\n").trim();
  out.finalUrl = page.url();
  out.redirected = normalizeUrl(out.finalUrl) !== normalizeUrl(opts.url);
  out.title = await page.title();
  out.webdriver = await page.evaluate(() => navigator.webdriver);
  out.ua = await page.evaluate(() => navigator.userAgent);
  out.iframes = await page.evaluate(() => document.querySelectorAll("iframe,frame").length).catch(() => 0);
  out.bytes = cleaned.length;
  out.ms = Date.now() - started;

  out.linkCount = await page.evaluate(() => [...document.querySelectorAll("a[href]")].filter((a) => a.href.startsWith("http")).length).catch(() => 0);
  const titleText = (out.title || "").replace(/\s+/g, " ").trim();
  const lines = cleaned.split("\n").map((line) => line.trim()).filter((line) => line && line.length <= 200);
  const dominates = (text, re) => {
    const m = text.match(re);
    return Boolean(m) && m[0].length / Math.max(1, text.length) >= 0.6;
  };
  const bannerHit = (list, allowTitle) =>
    list.find(([re]) => (allowTitle && dominates(titleText, re)) || lines.some((line) => dominates(line, re)));
  const shortPage = cleaned.length < 1500;
  const hard = bannerHit(HARD_WALLS, true) ?? (shortPage ? bannerHit(GENERIC_WALLS, false) : undefined);
  const soft = SOFT_WALLS.find(([re]) => re.test(`${titleText}\n${cleaned.slice(0, 2000)}`));
  if (hard) out.wall = hard[1];
  else if (soft) out.partial = soft[1];
  else if (/consent\.google\./.test(out.finalUrl)) out.partial = "google-consent";
  else if (cleaned.length === 0) out.wall = "empty-content";
  else if (cleaned.length < THIN_TEXT_CHARS && (!out.contentType || /html|xml/.test(out.contentType)) && !opts.screenshot) out.wall = "thin-content";

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
    const hay = cleaned.length > 200000 ? cleaned.slice(0, 200000) : cleaned;
    for (const pattern of opts.extract) {
      let re;
      try {
        re = new RegExp(pattern, "g");
      } catch (error) {
        out.failures.push(`bad regex ${pattern}: ${firstLine(error.message)}`);
        out.matches[pattern] = [];
        continue;
      }
      const found = [];
      for (const match of hay.matchAll(re)) {
        found.push(match[0]);
        if (found.length >= 40) break;
      }
      out.matches[pattern] = found;
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
  if (exiting) {
    releaseLock();
    process.exit(EXIT_INTERRUPT);
  }
  out.error = firstLine(error.message);
  out.failures.push(`error: ${out.error}`);
  out.ms = Date.now() - started;
  out.loaded = out.status !== undefined;
  if (out.loaded) {
    try {
      out.finalUrl = page.url();
      out.title = await page.title();
      const text = await page.evaluate(() => (document.body ? document.body.innerText : ""));
      out.text = opts.max > 0 ? text.slice(0, opts.max) : text;
    } catch {}
  }
} finally {
  await Promise.race([browser.close().catch(() => {}), new Promise((r) => setTimeout(r, 5000))]);
  clearTimeout(watchdog);
  releaseLock();
}

out.ok = out.failures.length === 0;

if (opts.json) {
  console.log(JSON.stringify(out, null, 2));
} else {
  if (out.wall) console.log(`BLOCKED [${out.wall}]`);
  if (out.partial) console.log(`PARTIAL [${out.partial}] page is real but degraded; content below may be incomplete`);
  if (out.error) console.log(`ERROR ${sanitize(out.error)}`);
  if (typeof out.status === "number" && out.status >= 400) console.log(`HTTP ${out.status}`);
  for (const action of out.actions) {
    if (action.ok === false) console.log(`FAILED ${Object.keys(action)[0]}=${sanitize(action[Object.keys(action)[0]])}${action.reason ? ` (${sanitize(action.reason)})` : ""}`);
  }
  if (out.webdriver) console.log("TRUST [webdriver=true] wrong engine, content is not trustworthy");
  console.log(`url:   ${sanitize(out.finalUrl ?? opts.url)}${out.redirected ? "  (redirected)" : ""}`);
  console.log(`title: ${sanitize(out.title ?? "-")}`);
  console.log(`status: ${out.status ?? "-"}  mode: ${out.mode}  ms: ${out.ms}  webdriver: ${out.webdriver}`);
  if (out.ua && /HeadlessChrome/.test(out.ua)) console.log("ua:    advertises HeadlessChrome (detectable)");
  if (out.iframes) console.log(`iframes: ${out.iframes} (their content is not read)`);
  if (out.actions.length) console.log(`actions: ${sanitize(JSON.stringify(out.actions))}`);
  if (out.scroll) console.log(`scroll: ${JSON.stringify(out.scroll)}`);
  if (out.matches) for (const [k, v] of Object.entries(out.matches)) console.log(`extract ${k}: ${sanitize(JSON.stringify(v))} (${v.length} matches${v.length >= 40 ? ", capped" : ""})`);
  if (out.links) console.log(`links:\n${out.links.map((l) => `  ${sanitize(l.text)}  ${sanitize(l.href)}`).join("\n")}`);
  if (out.screenshot) console.log(`screenshot: ${out.screenshot}`);
  console.log("---");
  console.log(sanitize(out.text ?? ""));
}

process.exit(exiting ? EXIT_INTERRUPT : out.ok ? EXIT_OK : EXIT_BLOCKED);
