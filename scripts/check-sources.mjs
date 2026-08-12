// Refuses to build if a source file carries a stray control character.
//
//   npm run check
//
// A NUL in a .ts or .rs file is invisible in an editor but makes git treat the
// file as binary, so its diffs stop being reviewable. It has slipped in twice
// from a mistyped placeholder character, hence this check.
//
// The scan compares character codes rather than matching a regex: a pattern
// covering the control range has to spell those characters out, which is
// exactly the hazard being checked for.

import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname, extname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const TEXT = new Set([".ts", ".tsx", ".rs", ".mjs", ".js", ".json", ".css", ".html", ".md", ".toml"]);

const TAB = 9;
const LINE_FEED = 10;
const CARRIAGE_RETURN = 13;
const FIRST_PRINTABLE = 32;

/** Index of the first disallowed control character, or -1. */
function findControlChar(text) {
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code >= FIRST_PRINTABLE) continue;
    if (code === TAB || code === LINE_FEED || code === CARRIAGE_RETURN) continue;
    return i;
  }
  return -1;
}

let files;
try {
  files = execFileSync("git", ["ls-files"], { cwd: ROOT, encoding: "utf8" })
    .split("\n")
    .map((f) => f.trim())
    .filter(Boolean);
} catch {
  console.error("check-sources: not a git repository, skipping.");
  process.exit(0);
}

const bad = [];
let scanned = 0;

for (const file of files) {
  if (!TEXT.has(extname(file))) continue;

  let text;
  try {
    text = readFileSync(resolve(ROOT, file), "utf8");
  } catch {
    continue; // staged for deletion but still listed
  }
  scanned++;

  const at = findControlChar(text);
  if (at === -1) continue;

  const line = text.slice(0, at).split("\n").length;
  const code = text.charCodeAt(at).toString(16).toUpperCase().padStart(4, "0");
  bad.push(`${file}:${line}  contains U+${code}`);
}

if (bad.length) {
  console.error("Stray control characters in source files:\n");
  for (const b of bad) console.error(`  ${b}`);
  console.error("\nThese make git treat the file as binary. Remove them.");
  process.exit(1);
}

console.log(`check-sources: ${scanned} source files clean.`);
