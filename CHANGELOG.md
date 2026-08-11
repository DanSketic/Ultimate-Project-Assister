# Changelog

All notable changes to this project are documented here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and
the project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

Every change bumps the version — see [CONTRIBUTING.md](CONTRIBUTING.md).

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

[0.5.0]: https://github.com/DanSketic/Ultimate-Project-Assister/releases/tag/v0.5.0
