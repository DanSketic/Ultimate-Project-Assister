// Captures the README screenshots from the browser build.
//
//   npm run dev:vite      # in one terminal
//   node scripts/shoot.mjs
//
// Each view is loaded with `?view=<name>&lang=en`, which seeds the initial view
// and language when the UI runs in a browser. Rendering happens in headless
// Edge or Chrome at 2x, so the images stay crisp on high-DPI displays.

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
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
        `${URL_BASE}/?view=${view}&lang=en`,
      ],
      { stdio: "ignore", timeout: 60_000 },
    );
    console.log(`docs/screenshots/${view}.png  ${width}x${height} @2x`);
  } finally {
    rmSync(profile, { recursive: true, force: true });
  }
}
