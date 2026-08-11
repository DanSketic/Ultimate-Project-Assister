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
npm run typecheck                 # frontend
cd src-tauri && cargo test        # backend
cd src-tauri && cargo clippy      # backend lints
```

All three must be clean. The backend currently builds with zero warnings; please
keep it that way.

## Versioning

**Every change bumps the version.** The project follows
[Semantic Versioning](https://semver.org/spec/v2.0.0.html):

- **patch** (`0.5.0` → `0.5.1`) — a fix with no change to behaviour anyone
  relied on
- **minor** (`0.5.0` → `0.6.0`) — a new capability, or a behaviour change that is
  visible but not disruptive
- **major** (`0.5.0` → `1.0.0`) — a breaking change to stored data or the IPC
  surface

The version lives in three files and they must agree:

| File | Field |
| --- | --- |
| `package.json` | `version` |
| `src-tauri/Cargo.toml` | `package.version` |
| `src-tauri/tauri.conf.json` | `version` |

The status bar reads the version from `package.json` at build time, so it needs
no separate update.

Add a [CHANGELOG.md](CHANGELOG.md) entry in the same commit, under `Added`,
`Changed`, `Fixed` or `Removed`. Write what changed for the person using the
app, not which function you edited.

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
