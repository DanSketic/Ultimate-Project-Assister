// Captures the README screenshots from the browser build.
//
//   npm run dev:vite      # in one terminal
//   node scripts/shoot.mjs
//
// Each view is loaded with `?view=<name>&lang=en&theme=light`, which seeds the
// initial view, language and theme when the UI runs in a browser. The theme is
// pinned because `auto` follows the machine: the same script run after dark
// otherwise produces a dark set. Rendering happens in headless Edge or Chrome
// at 2x, so the images stay crisp on high-DPI displays.

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = resolve(ROOT, "docs/screenshots");
const URL_BASE = process.env.UPA_URL ?? "http://localhost:1420";

/** Width and height each view is captured at, in CSS pixels. */
const VIEWS = {
  projects: [1440, 900],
  detail: [1440, 980],
  clean: [1440, 900],
  goals: [1440, 900],
  board: [1600, 900],
  cmd: [1440, 900],
  procs: [1440, 900],
  containers: [1440, 900],
  claude: [1440, 980],
  actions: [1440, 900],
};

const CANDIDATES = [
  process.env.UPA_BROWSER,
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
].filter(Boolean);

const browser = CANDIDATES.find((p) => existsSync(p));
if (!browser) {
  console.error("No Chrome or Edge found. Set UPA_BROWSER to the executable path.");
  process.exit(1);
}

// Without this check a stopped dev server yields six screenshots of the
// browser's "can't reach this page", which is easy to miss and worse than none.
try {
  const probe = await fetch(URL_BASE, { signal: AbortSignal.timeout(3000) });
  if (!probe.ok) throw new Error(`HTTP ${probe.status}`);
} catch (err) {
  console.error(`${URL_BASE} is not serving the app (${err.message}).`);
  console.error("Start it first:  npm run dev:vite");
  process.exit(1);
}

mkdirSync(OUT, { recursive: true });

for (const [view, [width, height]] of Object.entries(VIEWS)) {
  const file = resolve(OUT, `${view}.png`);
  // A fresh profile per capture: a browser process that lingers after one run
  // otherwise holds the profile lock and stalls the next one.
  const profile = mkdtempSync(join(tmpdir(), "upa-shot-"));

  try {
    // The launcher can return before the image is on disk - Edge hands the
    // work to a child and exits - so a capture used to be reported while last
    // time's file was still in place. Each one is waited for, checked against
    // the clock and retried; one that never lands fails the run.
    const started = Date.now();
    const capture = () =>
      execFileSync(
        browser,
        [
          "--headless=new",
          "--disable-gpu",
          "--hide-scrollbars",
          "--no-first-run",
          "--no-default-browser-check",
          "--force-device-scale-factor=2",
          `--user-data-dir=${profile}`,
          `--window-size=${width},${height}`,
          // Give React, the fonts and the mock scan time to settle.
          "--virtual-time-budget=6000",
          `--screenshot=${file}`,
          `${URL_BASE}/?view=${view}&lang=en&theme=light`,
        ],
        { stdio: "ignore", timeout: 60_000 },
      );
    const fresh = () => existsSync(file) && statSync(file).mtimeMs >= started;
    const landed = () => {
      for (let waited = 0; waited < 10_000 && !fresh(); waited += 250) {
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 250);
      }
      return fresh();
    };
    for (let attempt = 0; attempt < 3; attempt++) {
      capture();
      if (landed()) break;
    }
    if (!fresh()) {
      console.error(`docs/screenshots/${view}.png was not written`);
      process.exitCode = 1;
      continue;
    }
    console.log(`docs/screenshots/${view}.png  ${width}x${height} @2x`);
  } finally {
    // Windows releases the browser's handles on the profile a moment after the
    // process exits, so a delete straight afterwards can still find the
    // directory in use. Retry, and if it still will not go, leave it: a stray
    // temp directory is not worth losing the captures already taken to.
    try {
      rmSync(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 250 });
    } catch {
      console.warn(`could not remove ${profile}; it can be deleted by hand.`);
    }
  }
}
