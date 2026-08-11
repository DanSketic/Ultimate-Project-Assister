<img src="src-tauri/icons/icon.png" width="88" align="left" alt="" hspace="16" />

# Ultimate Project Assister

A desktop dashboard for a folder full of side projects: see what you have, find
out what is eating your disk, keep track of what you meant to finish, and run
the project's own commands without leaving the window.

<br clear="left" />

**Rust (Tauri 2) backend · TypeScript + React frontend · Windows, macOS, Linux**

The interface is available in **English and Hungarian**; the documentation is
English only.

![The projects list](docs/screenshots/projects.png)

---

## What it does

| View | What actually happens |
| --- | --- |
| **Projects** | Grouped by the folder they live in. Walks your watched folders and recognises projects by their manifests (`Cargo.toml`, `package.json`, `pyproject.toml`, `go.mod`, `pubspec.yaml`, `composer.json`, `mix.exs`, `CMakeLists.txt`, compose files, `Makefile`). Reports size on disk, file and line counts, language breakdown and git state. A monorepo stays one row with several parts. |
| **Cleanup** | Measures build junk per category (`target/debug`, `node_modules`, `.venv`, `__pycache__`, `vendor`, `_build`, …) together with its age, grouped by project. Nothing is removed without confirmation, and the removal is guarded three ways. |
| **Goals** | Goals and features per project with progress bars. Stored as plain JSON. |
| **Board** | A free canvas of draggable notes with a project tag, a deadline and three colours. |
| **Commands** | Runnable commands read out of the manifests — npm/pnpm/yarn/bun scripts, Makefile targets, cargo, compose. Start and stop them, with output streamed live. |
| **Settings** | Watched folders, scanning options, cleanup age threshold, window anchoring, language. |

---

## Screenshots

Every list groups things that belong together. Projects, Goals and Commands
group by the folder the projects live in; Cleanup groups by project. Headings
carry the totals for the block, and disappear when there is only one of them.

### Cleanup

Grouped by project, biggest first, with per-project totals and a tri-state group
checkbox. Category badges turn red for directories that regenerate on the next
build. The blue chips mark which package of a monorepo a directory belongs to.

![The cleanup view](docs/screenshots/clean.png)

### Project detail

![The project detail view](docs/screenshots/detail.png)

### Goals

![The goals view](docs/screenshots/goals.png)

### Board

![The notes board](docs/screenshots/board.png)

### Commands

![The commands view](docs/screenshots/cmd.png)

---

## Install

Download an installer from the [releases](https://github.com/DanSketic/Ultimate-Project-Assister/releases),
or build from source.

### Build from source

Requirements: **Node 18+**, **Rust stable**, and on Windows the
[Microsoft C++ Build Tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/)
plus WebView2 (already present on Windows 11).

```bash
npm install
npm run dev
```

To produce installers (`.msi` and `.exe` on Windows):

```bash
npm run build
```

The interface can also be run in a plain browser against a sample dataset, with
no Rust toolchain involved — useful for working on the UI:

```bash
npm run dev:vite
```

---

## How the window behaves

Two behaviours are deliberate and worth knowing about.

**The window sizes itself to the view.** Each view asks for the width it needs,
so the board is wide and the settings screen is narrow, and the rest of your
monitor stays free. **Settings → Fixed edge** decides which edge stays put while
that happens; the default is the left edge, so the window grows to the right.

**It remembers where you left it.** Position, height and maximised state are
restored on the next launch. Width is remembered *per view*: widen the board and
it opens wide next time, while the projects list keeps its own width. If the
saved position lands on a monitor that is no longer attached, the window opens
centred and keeps only the size.

**It opens on last session's results.** The scan is cached, so the window shows
your projects immediately instead of an empty list, and the status bar says
`From last scan · 2 h ago` until the fresh scan replaces it. Projects whose
folder has since disappeared are dropped from the cache rather than shown as
ghosts.

---

## Monorepo support

A project is **one folder that may contain several packages**. Discovery stops at
a directory when it either

- contains a manifest, or
- is a git repository root (`.git`) — even with no manifest of its own, or
- declares a workspace (`pnpm-workspace.yaml`, `go.work`, `turbo.json`,
  `nx.json`, `lerna.json`, `rush.json`).

Inside that root it then looks for **parts**, up to three levels deep. So this is
a single project with two parts, not two unrelated projects:

```
shopflow/
├─ .git/
├─ frontend/   package.json   → TypeScript
└─ backend/    Cargo.toml     → Rust
```

What that buys you:

- **Size and junk are measured per part.** `frontend/node_modules` belongs to the
  frontend, `backend/target/debug` to the backend. The project's headline stack
  comes from whichever part holds the most source.
- **Commands run in their own directory.** `npm run dev` in the frontend and in
  the backend are two independent processes, because a running command is keyed
  by its working directory as well as its name.
- **Search and the stack filter match parts too**, so the project above shows up
  under both `TypeScript` and `Rust`.
- A **nested git repository** (a submodule, or a repo cloned inside another) is
  never treated as a part — it belongs to itself.

---

## Safety when deleting

`remove_dir_all` is the one irreversible thing this app does, so
`clean.rs::validate` demands three independent conditions before a directory is
removed:

1. the target resolves **inside** its project root (after canonicalisation),
2. it is not the project root itself,
3. its directory name appears in the `DELETABLE_NAMES` allowlist.

A bug in discovery therefore cannot turn into a deleted source tree.

Two further rules keep the numbers honest: a cleanup entry is never offered if it
**contains another entry** (which is why `target/debug/incremental` is folded
into `target/debug` rather than listed separately), and never if it would
swallow another part of a monorepo. What a row says it frees is what it frees.

Exclusion rules in the cleanup sidebar accept glob patterns and keep matching
directories out of the automatic selection. Scope a rule to a single project by
writing `keep: <project>` — you can always still tick the row by hand.

---

## Layout

```
src/                     TypeScript + React frontend
  api.ts                 typed bridge to Rust (falls back to sample data without Tauri)
  useApp.ts              the whole application state in one hook
  i18n.ts                English / Hungarian dictionary
  format.ts              size, date and rule formatting
  theme.css              design tokens, light and dark
  components/            title bar, sidebar, status bar, dialog, icons
  views/                 the seven views
src-tauri/               Rust backend
  scan.rs                project discovery, measurement, language stats
  git.rs                 branch, dirty state, tags and changelog via git2
  clean.rs               guarded deletion plus Docker usage
  cmds.rs                runnable commands read from manifests
  runner.rs              process spawning, log streaming, process-tree kill
  watcher.rs             filesystem watching via notify
  geometry.rs            window position and size persistence
  store.rs               settings, goals and notes as JSON
  commands.rs            the IPC surface
scripts/gen-icons.mjs    icon generation (PNG + ICO, no external tooling)
```

### Where your data lives

`%APPDATA%\dev.upa.ultimate-project-assister\` on Windows, the equivalent config
directory elsewhere: `settings.json`, `goals.json`, `notes.json` and the scan
cache `projects.json`. Plain, hand-editable JSON — missing keys fall back to
defaults, a UTF-8 BOM is tolerated, and a corrupt file makes the app fall back
to defaults rather than crash. Deleting `projects.json` costs nothing; the next
scan rebuilds it.

---

## Known limitations

- **Fonts** are loaded from Google Fonts (`Instrument Sans`, `JetBrains Mono`).
  On an offline machine the system fallback is used. To bundle them, drop the
  woff2 files into `public/` and replace the link in `index.html` with
  `@font-face` rules.
- **Docker** figures come from parsing `docker system df`; if the daemon is not
  running the panel simply does not appear.
- **Filesystem watching is deliberately shallow** — the project root and its
  `.git` directory, not the whole tree — so that `node_modules` cannot drown the
  notify watcher.
- **Cleanup progress advances per directory**, not per byte. Removing a single
  3 GB `node_modules` holds the bar at one position while the path label shows
  what is being worked on.

---

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). Every change bumps the version and adds a
[CHANGELOG.md](CHANGELOG.md) entry.

## License

[MIT](LICENSE) © DanSketic
