# Changelog

All notable changes to this project are documented here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and
the project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

Every change bumps the version — see [CONTRIBUTING.md](CONTRIBUTING.md).

## [1.2.0] - 2026-08-14

### Added

- **A way through to Commands from the project detail.** It was the one view
  with no route from there — Goals and the board had one, Commands did not. The
  button carries the command count and opens that project's commands.
- **Tags link to the release they name.** Clicking one opens its page on
  whichever service the project is hosted on: GitHub gets the releases page,
  everything else the tree view. The URL is built in the backend from that
  project's own remote and the tag has to be one the project actually has — the
  frontend names a project and a tag, never a URL, so this stays a link to your
  own repository rather than a way to open anything at all. A project with no
  remote shows its tags plainly instead of pretending to be clickable.
- **Group headings fold.** Every grouped list — Projects, Goals, Commands —
  collapses a block from its heading, and which ones are folded is remembered.
  The state is namespaced per list, since the same folder heads a block in all
  three and folding it in one says nothing about the others.
- **A favourites-only filter**, on all three lists and driven by one setting, so
  the answer is the same wherever it is asked. Also remembered: it is a way of
  working rather than a momentary filter.

## [1.1.0] - 2026-08-14

### Fixed

- **The window opened empty even though the previous session had scanned.** The
  cache carried a version tag, and any release that added a field bumped it and
  threw the whole file away — so the very releases that added the most were the
  ones that opened to nothing. It never needed to: every field of a cached
  project already tolerates being absent, so an older file reads back with the
  new fields empty and the rescan fills them in. The tag is still written, but
  nothing is rejected for it.

### Added

- **A cache that gives up much less easily.** One unreadable entry is skipped
  instead of costing the other thirty-six. A project whose folder has gone is
  only dropped when the watched folder it lives under is itself reachable — an
  unplugged external disk or an offline share no longer erases the list, since
  only a reachable root can prove a project deleted. The cache is also written
  on the way out, not just after a scan.
- **The command log is tabbed, one tab per run.** Two dev servers in the same
  project used to interleave into a single pane, which made both unreadable.
  Tabs belong to the open project, carry a live dot while the process runs, and
  can be closed individually; the pane follows the tail of whichever is on
  screen. Twelve streams are kept, four hundred lines each.
- **A port that is already taken is now a question, not a surprise.** Half a
  dozen projects on one machine all default to 3000 or 5173, and the second dev
  server of the day would die with `EADDRINUSE` several seconds in, in a log
  nobody was watching. Before starting, the port the command will ask for is
  worked out from the project's own files — an explicit `--port`, a `.env`, a
  vite/nuxt/astro config, a compose file's host-side mappings, and only then a
  framework default — and checked by trying to bind it, which is exactly the
  question the command itself is about to ask.

  When it is taken, a dialog says so before anything runs. If the holder is a
  command this app started, it is named and can be stopped and replaced in one
  click. If it is anything else, that is said plainly and the only offers are
  *start anyway* or *cancel* — stopping a process the app did not start is not
  something to do from a dialog.

### Changed

- Sample data in the browser build keys running commands by project id, the way
  the backend always did. Keying by name meant the running indicator matched
  nothing there.

## [1.0.0] - 2026-08-14

The first stable release. Everything the app was meant to do is in place, and
the last gap — being told *why* a project will not start — is closed.

### Added

- **A requirements card on every project.** The toolchains a project needs are
  read off the manifests already found by the scanner — Node and the package
  manager its lockfile names, cargo, Python, Go, Docker, Make, CMake, PHP and
  Composer, Elixir, Ruby, Java with Gradle or Maven, Flutter, .NET — and each
  is checked against PATH. Present ones show their version and the executable
  actually being used, which is the answer when a machine has two Pythons.
  Missing ones say which manifest asked for them and come first in the list.
  `npm run dev` failing because Node is simply absent is the most common reason
  a freshly cloned project will not start, and now the app says so.
- **One-click install for what is missing.** Where the tool is packaged, the
  card offers the install command; clicking *Install* shows the exact command
  before anything runs, and the installer's output streams into the same log
  the project commands use. The frontend sends only a tool id — the command is
  owned by the backend, so this cannot be talked into running something else.
  Every winget id was checked against the public repository; Composer, Elixir,
  Gradle and Maven are not packaged there, so those point at the documentation
  rather than offering a command that would fail.
- **Docker status.** Whether the CLI is installed, whether the daemon is
  answering, its version, container and image counts, and what it is holding.
  "Installed but not started" is its own state with its own hint, rather than
  being folded into "unavailable". A chip in the Commands view carries the same
  state next to the buttons that would start a stack, because that is where a
  stopped daemon is about to bite.
- **A project's own containers.** The compose stack belonging to the open
  project is listed with each service's state, matched by the project name
  compose itself would derive from the directory.
- **The changelog card shows five versions**, with the rest one click away, so a
  long history no longer pushes the commit list off the page.

### Changed

- Docker's numbers moved out of the cleaner into a module of their own, and the
  cleaner is now only about deletion.

## [0.11.0] - 2026-08-14

### Added

- **The description card reads the whole README**, rendered as markdown —
  headings, lists, tables, fenced code, quotes and emphasis. It opens clamped
  to about the height the old one-line summary took, so nothing on the page
  grew; a *Read all of it* toggle expands the rest. Whether the toggle appears
  at all is measured from the laid-out height rather than guessed from a
  character count. Links are shown with their address in the tooltip, not
  followed — the app has no business opening URLs out of a file it merely
  scanned.
- **A `CHANGELOG.md` is read and shown per version**, each section collapsed to
  its first couple of lines with the same toggle. The file wins over the git
  tags, which stay as the fallback for a project that keeps no changelog.
- **Commands are grouped by the file they were read out of** — `package.json`,
  `Cargo.toml`, `docker-compose.yml`, a `Makefile`. In a monorepo the directory
  is part of the heading, so `frontend/package.json` and `backend/go.mod` are
  plainly separate.
- **Headline operations stand out.** The commands that start, build or check a
  project are tinted, outlined and sorted to the top of their group; the
  housekeeping around them stays flat. A variant such as `test:e2e` is not
  promoted alongside `test` — promoting everything would promote nothing.
- **Commands can be pinned**, the way projects already could. Pinned ones
  gather in a block above the file groups and lead the detail view's quick-run
  card. They still appear under their own file as well: one command in two
  places, not a command that has moved somewhere unexpected.
- **The cleanup selection is remembered.** What was ticked comes back on the
  next launch, including entries whose directory is currently gone — so a
  `target/` that was cleaned and has since built up again returns already
  selected. Keys belonging to a project that no longer exists are pruned.
  Clearing the selection is stored as a real answer, not as "never chosen".

### Fixed

- **Most buttons had no hover or pressed state at all.** The rules were written
  as a `background` on a class, but nearly every control sets its background
  inline, and an inline style beats any class rule — so the declarations never
  applied and the interface felt dead under the pointer. The tint is now an
  inset `box-shadow`, which paints over whatever background is already there,
  needs no `!important`, and leaves a selected row still looking selected.
  Every interactive class now has both a hover and a pressed state, buttons
  that carried no class at all were given one, and a disabled button no longer
  answers as though it could act.

## [0.10.0] - 2026-08-12

### Added

- **A search box above the project rail in Goals and Commands**, matching the
  one the projects list already had. It sits outside the scrolling list, so it
  stays put however far down you are. Filtering the rail does not change which
  project is open on the right.

### Fixed

- **Only the first six package.json scripts were offered.** Every script is now
  listed. They are written by hand, so a cap only hid something the developer
  deliberately put there; the ones reached for most often still sort first.
  Makefile rules keep a bound, since those are recognised heuristically.
- **Dev server output showed raw colour codes**, so a Nuxt or Vite line arrived
  as `[90m[[90mnuxt:tailwindcss[90m][39m` instead of `[nuxt:tailwindcss]`. ANSI
  escape sequences are stripped before a line reaches the log, which applies its
  own colours anyway.

## [0.9.0] - 2026-08-12

### Added

- **The sidebar follows the anchored window edge.** Setting *Fixed edge* to the
  right edge now moves the menu column there too, so the thing you click stays
  under the pointer instead of sliding across the screen every time a view
  resizes the window. Its divider and collapse arrow face the content either
  way, and the rail is rendered in visual order so tab order matches what is on
  screen.
- **The side cards in the project detail stay put while the page scrolls.**
  Facts, tags, notes and quick run pin below the toolbar instead of sliding
  away with the changelog and commit history. When they no longer fit the space
  available the column scrolls on its own, so the bottom card stays reachable.
  Both the offset and the space available are measured, not assumed.

## [0.8.0] - 2026-08-12

### Added

- **Favourites, handled the same way in Projects, Goals and Commands.** A star
  on any project pins it, and pinned projects gather in a block above the folder
  groups in all three lists, so a favourite is in the same place whichever list
  you are looking at. Stored with the settings.
- **The board asks which project a new note belongs to.** Opening the board from
  a project still pins it there, and new notes take that project without asking.
  With no project filter there is nothing to infer from, so a picker offers the
  projects — searchable, grouped by folder, favourites first — instead of
  quietly attaching the note to whichever project happened to be open last.
- **A note's project can be changed afterwards** by clicking its label.

### Fixed

- **A sliver of the project list showed above the pinned header while
  scrolling.** The toolbar and the column titles were pinned separately, the
  second offset by a hard-coded 57 pixels. The toolbar is not exactly that
  tall, so the difference left a strip for rows to scroll through. They are now
  pinned as one block, which cannot drift apart.
- The project rows in the Goals and Commands rails were `<button>` elements, so
  the new favourite toggle would have nested a button inside a button. They are
  now focusable rows with the same keyboard behaviour.
- `src/grouping.ts` had picked up a stray NUL byte, the second time that has
  happened. `npm run check` now fails the build on any stray control character
  in a tracked source file.

## [0.7.2] - 2026-08-12

### Fixed

- **Projects that share a name were treated as the same project.** Two
  checkouts each holding a `server` is ordinary — one per monorepo — but the
  app identified projects by name, so selecting one selected the other. The
  same root cause meant they also shared goals and notes, a command started in
  one showed as running in the other, and their build junk was merged into a
  single cleanup block. Projects are now identified by path everywhere:
  selection, goals, notes, running commands and cleanup grouping.
- Goals and notes saved before this release were filed under a project name.
  They are rebound to the owning project the first time the projects are known,
  and written back once. A name shared by several projects can only be resolved
  to one of them — the first by path — which is the most that can be recovered
  from data that never recorded which one it meant.

### Changed

- The sample dataset used by `npm run dev:vite` now contains two folders that
  each hold a `clients` and a `server`, so this class of bug is visible in the
  browser build without a real disk.

## [0.7.1] - 2026-08-11

### Fixed

- **The Goals view scrolled as one page**, so running down the project rail
  carried the goal cards away with it. The two panes now scroll independently,
  matching the Commands view.
- Goal cards no longer compress to fit the pane. Their `overflow: hidden`
  switches off a flex item's automatic minimum size, so once the pane had a
  bounded height the cards shrank and clipped their own features instead of
  letting the pane scroll.

## [0.7.0] - 2026-08-11

### Added

- **Projects, Goals and Commands group by folder**, the way the cleanup list
  already grouped by project. Projects that sit in the same directory are shown
  together under a heading; in the projects list that heading carries the
  project count, the total size and the total reclaimable.
- Folder headings drop the path prefix every group shares, so
  `C:\dev\_GIT\_GITHUB\OWN` and `C:\dev\_TEST` read as `_GIT\_GITHUB\OWN` and
  `_TEST` rather than repeating the common root.
- Folder order follows the active sort chip in the projects list — by newest
  commit, name, total size or dirty count. In Goals the folders with the most
  unfinished features come first; in Commands the folders with something
  running do.

### Changed

- Headings are hidden when every project sits in the same folder, since a
  single heading over the whole list carries no information.

### Fixed

- "1 projects" now reads "1 project". Hungarian keeps the single form.

## [0.6.0] - 2026-08-11

### Added

- **The last scan is cached and shown at startup.** The window opens on the
  previous session's projects instead of an empty list while the rescan runs.
  The status bar reads `From last scan · 2 h ago` until fresh results arrive.
  Projects whose folder has disappeared since are dropped from the cache, and a
  cache written by an incompatible build is discarded rather than half-read.
- **Documentation screenshots**, and the app icon in the README.
- **`?view=` and `?lang=` startup overrides** when the UI is opened in a browser,
  so the documentation screenshots can be regenerated without hand-driving the
  app. Inert in the packaged app, which loads no query string.

### Changed

- `Project` now tolerates fields added by a newer build when read back from the
  cache, instead of discarding the whole file.

### Fixed

- `src/format.ts` contained two literal NUL bytes, left over from a placeholder
  used while expanding glob patterns. Git treated the file as binary, so its
  diffs were unreadable. The glob expansion now runs in a single pass and needs
  no placeholder.

## [0.5.0] - 2026-08-11

The first published release. Everything below landed on top of the initial
implementation built from the design.

### Added

- **Monorepo support.** A folder holding several packages is now one project
  with several *parts*, instead of being missed or split into unrelated rows.
  Discovery treats a git repository root as a project even when it carries no
  manifest of its own, which is the common `frontend/` + `backend/` layout.
  Size and reclaimable junk are measured per part, commands run in their own
  directory, and search and the stack filter match parts as well.
- **Window position and size are remembered.** Position, height and maximised
  state are restored on launch. Width is remembered per view, so widening the
  board does not disturb the projects list. A position on a monitor that is no
  longer attached is dropped and the window opens centred, keeping its size.
- **Fixed edge setting.** Chooses which window edge stays put while a view
  resizes the window. Defaults to the left edge.
- **Cleanup progress.** The confirmation dialog stays open and becomes a
  progress view: a bar, a counter, the directory being removed, and a running
  total of what has been freed. Re-measuring is reported as its own phase.
- **Cleanup selection controls.** `Select · All · None` replaces the single
  "select all" button, so a selection can be cleared in one click.
- **`Larger than 1 GB` quick filter**, next to `Older than 30 days`.
- **Cleanup list is grouped by project**, biggest first, with a per-project
  total and a tri-state group checkbox. Rows inside a group are ordered by part
  and then by size, so a monorepo's directories stay together. The confirmation
  dialog groups the same way.
- **Exclusion rules are functional.** Glob patterns keep matching directories
  out of the automatic selection; `keep: <project>` scopes a rule to one project.
- Notes on the board are editable in place, with an auto-growing text area and a
  date picker for the deadline.

### Changed

- Version is now injected from `package.json` at build time instead of being
  hard-coded in the status bar.
- `save_settings` no longer overwrites the stored window geometry with whatever
  the frontend sends, so changing a setting while the window is being dragged
  cannot write back a stale position.
- Cleanup selection actions apply only to the rows currently on screen. Filtered
  out rows keep their state instead of being silently deselected.
- Lines of code no longer counts JSON, YAML, TOML and MDX; those still
  contribute to the language breakdown.

### Fixed

- **A cleanup entry could free more than it claimed.** `target/debug/incremental`
  sat inside `target/debug`, so removing the parent took the child with it while
  the row showed only the parent's size. Nested entries are no longer offered,
  and a test asserts the rule set can never nest again.
- A UTF-8 BOM in `settings.json` made the app silently fall back to defaults —
  it now loads correctly, and a corrupt file no longer discards the rest.
- Elixir and Erlang `deps/` directories are no longer walked, so dependencies
  are not listed as projects of their own.
- Long paths are truncated deterministically instead of relying on a
  `direction: rtl` trick that reordered Windows path separators.
- A wide view can no longer push the window off the edge of the screen.

## [0.4.2] - 2026-08-06

Initial implementation, generated from the Claude Design source. Seven views
(projects, detail, cleanup, goals, board, commands, settings), English and
Hungarian interface, light and dark themes, per-view window sizing, project
scanning with git analysis, guarded cleanup, and a process runner with live log
streaming. Never published.

[1.2.0]: https://github.com/DanSketic/Ultimate-Project-Assister/releases/tag/v1.2.0
[1.1.0]: https://github.com/DanSketic/Ultimate-Project-Assister/releases/tag/v1.1.0
[1.0.0]: https://github.com/DanSketic/Ultimate-Project-Assister/releases/tag/v1.0.0
[0.11.0]: https://github.com/DanSketic/Ultimate-Project-Assister/releases/tag/v0.11.0
[0.10.0]: https://github.com/DanSketic/Ultimate-Project-Assister/releases/tag/v0.10.0
[0.9.0]: https://github.com/DanSketic/Ultimate-Project-Assister/releases/tag/v0.9.0
[0.8.0]: https://github.com/DanSketic/Ultimate-Project-Assister/releases/tag/v0.8.0
[0.7.2]: https://github.com/DanSketic/Ultimate-Project-Assister/releases/tag/v0.7.2
[0.7.1]: https://github.com/DanSketic/Ultimate-Project-Assister/releases/tag/v0.7.1
[0.7.0]: https://github.com/DanSketic/Ultimate-Project-Assister/releases/tag/v0.7.0
[0.6.0]: https://github.com/DanSketic/Ultimate-Project-Assister/releases/tag/v0.6.0
[0.5.0]: https://github.com/DanSketic/Ultimate-Project-Assister/releases/tag/v0.5.0
