// Mirrors src-tauri/src/model.rs and src-tauri/src/store.rs.

export type View = "projects" | "detail" | "clean" | "goals" | "board" | "cmd" | "set";
export type Lang = "hu" | "en";
export type Theme = "auto" | "light" | "dark";
export type NoteColor = "paper" | "accent" | "ink";
/** Which window edge stays put while the window is resized per view. */
export type Anchor = "left" | "right";

export interface LangShare {
  name: string;
  pct: number;
}

export interface Commit {
  sha: string;
  msg: string;
  days: number;
  date: string;
}

export interface Release {
  ver: string;
  date: string;
  notes: string[];
}

/** One version section of a CHANGELOG.md; `body` is still markdown. */
export interface ChangeEntry {
  ver: string;
  date: string;
  body: string;
}

export interface GitInfo {
  isRepo: boolean;
  branch: string;
  dirty: number;
  ahead: number;
  behind: number;
  /** Days since the last commit; -1 when the repo has no commits. */
  days: number;
  tag: string;
  tags: string[];
  commits: Commit[];
  releases: Release[];
  firstCommit: string;
  lastCommit: string;
  /**
   * The remote as a browsable page, e.g. `https://github.com/owner/repo`.
   * Empty when there is no remote, or none with a web page.
   */
  remote: string;
}

export interface CleanTarget {
  key: string;
  /** Identity of the owning project; two projects can share a name. */
  projectId: string;
  project: string;
  /** Package this directory belongs to; empty for a single-package project. */
  part: string;
  cat: string;
  path: string;
  bytes: number;
  ageDays: number;
}

export interface CommandDef {
  kind: "npm" | "cargo" | "docker" | "make" | "py";
  name: string;
  cmd: string;
  /** Directory to run in, relative to the project root; empty means the root. */
  cwd: string;
  /** Display label of the part this command belongs to. */
  part: string;
  /** Manifest the command was read out of; the commands list groups by this. */
  source: string;
  /** A headline operation: starts, builds or checks the project. */
  primary: boolean;
}

/** One package inside a project. More than one part means a monorepo. */
export interface ProjectPart {
  name: string;
  rel: string;
  path: string;
  stack: string;
  manifests: string[];
  sizeBytes: number;
  reclaimBytes: number;
  sourceBytes: number;
}

export interface Project {
  id: string;
  name: string;
  path: string;
  stack: string;
  langs: LangShare[];
  files: number;
  loc: number;
  sizeBytes: number;
  reclaimBytes: number;
  version: string;
  /** One-line summary for the lists. */
  desc: string;
  /** The whole README, still markdown; empty when there is none. */
  readme: string;
  /** CHANGELOG.md split into version sections, newest first. */
  changelog: ChangeEntry[];
  manifests: string[];
  /** Always at least one entry. */
  parts: ProjectPart[];
  commands: CommandDef[];
  cleanTargets: CleanTarget[];
  git: GitInfo;
  scannedAt: number;
}

export interface ScanProgress {
  done: number;
  total: number;
  current: string;
}

export interface ScanResult {
  projects: Project[];
  elapsedMs: number;
  roots: string[];
}

export interface LogLine {
  key: string;
  project: string;
  cmd: string;
  text: string;
  stream: "cmd" | "out" | "err" | "exit";
  time: string;
}

export interface CleanProgress {
  phase: "delete" | "rescan" | "done";
  done: number;
  total: number;
  current: string;
  freedBytes: number;
}

export interface DeleteReport {
  freedBytes: number;
  removed: string[];
  errors: string[];
}

/**
 * `installed` and `daemonRunning` are separate: Docker Desktop present but shut
 * down is an ordinary state with an obvious remedy, and collapsing it into
 * "unavailable" would hide that.
 */
export interface DockerStatus {
  installed: boolean;
  cliVersion: string;
  daemonRunning: boolean;
  serverVersion: string;
  containersRunning: number;
  containersTotal: number;
  images: number;
  imagesBytes: number;
  buildCacheBytes: number;
  volumesBytes: number;
  /** Why the daemon could not be reached; empty when it could. */
  error: string;
}

/** One container of a project's compose stack. */
export interface Container {
  id: string;
  name: string;
  image: string;
  /** `running`, `exited`, `created`, `paused`, ... */
  state: string;
  /** Human status, e.g. `Up 3 hours (healthy)`. */
  status: string;
  ports: string;
  service: string;
}

/** A command this app started that already holds the port. */
export interface PortUser {
  key: string;
  projectId: string;
  project: string;
  cmd: string;
}

/** The answer to "can this command have its port?". */
export interface PortConflict {
  /** 0 when the command serves nothing and no check applies. */
  port: number;
  taken: boolean;
  /**
   * Set only when the holder is a command this app started. A port held by
   * something else is reported as taken with no holder, rather than guessed.
   */
  holder: PortUser | null;
}

/** A toolchain a project needs, and whether this machine has it. */
export interface ToolStatus {
  id: string;
  name: string;
  found: boolean;
  version: string;
  path: string;
  /** The manifests in this project that call for it. */
  requiredBy: string[];
  /** Ready-to-run install command, empty when there is no packaged install. */
  install: string;
  docs: string;
}

export interface Toggles {
  scanStart: boolean;
  watchFs: boolean;
  deepGit: boolean;
  docker: boolean;
}

export interface Rule {
  pattern: string;
  scope: string;
}

/** Where the window was and how big it was when the app last closed. */
export interface WindowState {
  x: number | null;
  y: number | null;
  height: number | null;
  maximized: boolean;
  /** View name -> content width (window width minus the sidebar). */
  widths: Record<string, number>;
}

export interface Settings {
  lang: Lang;
  theme: Theme;
  navCollapsed: boolean;
  anchor: Anchor;
  folders: string[];
  toggles: Toggles;
  ageDays: number;
  rules: Rule[];
  /** Project ids the user pinned; shown first in the lists. */
  favourites: string[];
  /** `<project id>|<cwd>|<command>` for each command the user pinned. */
  cmdFavourites: string[];
  /** Show only pinned projects in the lists. */
  favouritesOnly: boolean;
  /** Folded group headings, as `<view>:<group key>`. */
  collapsedGroups: string[];
  /**
   * Cleanup target keys last ticked, kept even while a directory is absent.
   * `null` means never chosen, so the cleaner picks by age instead; an empty
   * array means the user deliberately cleared the selection.
   */
  cleanPicked: string[] | null;
  freedBytes: number;
  freedDate: string;
  window: WindowState;
}

export interface Feature {
  id: string;
  title: string;
  done: boolean;
  est: string;
}

export interface Goal {
  id: string;
  /**
   * Project id. Files written before 0.7.2 hold the project *name* here;
   * `bindToProjects` rewrites those once the projects are known.
   */
  project: string;
  title: string;
  sub: string;
  features: Feature[];
}

export interface Note {
  id: string;
  x: number;
  y: number;
  /** Project id; legacy files hold the project name - see `bindToProjects`. */
  project: string;
  text: string;
  /** `YYYY-MM-DD`, or empty for "no deadline". */
  due: string;
  color: NoteColor;
  z: number;
}
