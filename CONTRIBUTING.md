# Contributing

## Getting set up

Requirements: **Node 18+**, **Rust stable**, and on Windows the
[Microsoft C++ Build Tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/)
plus WebView2.

```bash
npm install
npm run dev
```

`npm run dev:vite` runs the interface in a plain browser against the sample
dataset in `src/mock.ts`. It needs no Rust toolchain and is the fastest way to
work on layout and interaction.

## Before you open a pull request

```bash
npm run check                     # stray control characters in sources
npm run typecheck                 # frontend
cd src-tauri && cargo test        # backend
cd src-tauri && cargo clippy      # backend lints
```

All four must be clean. `npm run check` also runs as part of `npm run build`:
a NUL byte in a `.ts` or `.rs` file is invisible in an editor but makes git
treat the file as binary, so its diffs stop being reviewable. That has happened
twice, both times from a mistyped placeholder character. The backend currently builds with zero warnings; please
keep it that way.

## Changelog

**Every change earns a [CHANGELOG.md](CHANGELOG.md) entry, in the same commit**,
under `Added`, `Changed`, `Fixed` or `Removed`. Write what changed for the person
using the app, not which function you edited.

New entries go under an `## [Unreleased]` heading. They stay there until a
release is actually cut — the version number moves at release time, not on every
commit, so there are never version numbers that were never shipped.

## Releasing

Cutting a release is a deliberate, separate step. It is not something a change
triggers on its own.

1. Choose the version. The project follows
   [Semantic Versioning](https://semver.org/spec/v2.0.0.html):

   - **patch** (`1.2.0` → `1.2.1`) — a fix with no change to behaviour anyone
     relied on
   - **minor** (`1.2.0` → `1.3.0`) — a new capability, or a behaviour change
     that is visible but not disruptive
   - **major** (`1.2.0` → `2.0.0`) — a breaking change to stored data or the IPC
     surface

2. Rename the `Unreleased` heading to the version and its date, and add the
   comparison link at the foot of the file.

3. Set that version in three files, which must agree:

   | File | Field |
   | --- | --- |
   | `package.json` | `version` |
   | `src-tauri/Cargo.toml` | `package.version` |
   | `src-tauri/tauri.conf.json` | `version` |

   The status bar reads the version from `package.json` at build time, so it
   needs no separate update. Edit these by hand or with an editor that writes
   plain UTF-8 — a BOM in any of them stops the build, and PowerShell's
   `Set-Content` has put one there before.

4. `npm run check`, `npx tsc --noEmit` and `cargo test --lib` all clean.

5. Regenerate the screenshots if anything visible changed, then `npm run build`
   and attach the three installers to the GitHub release.

## Regenerating the screenshots

The README images are captured from the browser build against the sample
dataset, so they need no real projects on disk. Start the dev server, then:

```bash
npm run dev:vite
node scripts/shoot.mjs
```

`scripts/shoot.mjs` drives headless Edge or Chrome over `?view=<name>&lang=en`.
Those two query parameters seed the initial view and language when the UI runs
in a browser; a packaged app is loaded without a query string, so they have no
effect in production.

## Documentation language

The interface is bilingual — English and Hungarian, both in `src/i18n.ts`. A new
user-visible string must be added to **both** dictionaries; TypeScript will fail
the build if one is missing.

**All documentation is English only**: README, CHANGELOG, this file, code
comments and commit messages.

## Things worth knowing before you change them

**Deletion is guarded on purpose.** `clean.rs::validate` requires three
independent conditions before removing a directory. If you add a cleanup
category, add its directory name to `DELETABLE_NAMES` too, and make sure the new
rule cannot contain another rule or another monorepo part — the
`cleaning_never_covers_another_bucket` test enforces this. A row must free
exactly what it says it frees.

**Window geometry belongs to the backend.** `geometry.rs` samples the window and
writes it to the store; the frontend only reports which view is on screen.
`Store::set_settings` deliberately ignores the geometry the frontend sends.

**Scanning walks each project once.** `scan.rs::walk` attributes every byte to
either a cleanable bucket or the source tree in a single pass, and feeds the
language stats and line counts from the same walk. Adding a second walk over the
same tree is the easy way to make scanning twice as slow.
