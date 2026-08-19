// Typed bridge to the Rust backend.
//
// Every call degrades to the sample dataset in `mock.ts` when the UI runs in a
// plain browser (`npm run dev:vite`), so the frontend can be iterated on
// without a Rust toolchain in the loop.

import type {
  Anchor,
  ClaudeMessage,
  ClaudeStats,
  CleanProgress,
  Container,
  DeleteReport,
  DockerStatus,
  Goal,
  LogLine,
  Note,
  PortConflict,
  ProcessInfo,
  Project,
  RebaseReport,
  ScanProgress,
  ScanResult,
  Settings,
  SyncStatus,
  ToolStatus,
} from "./types";
import * as mock from "./mock";

export const IS_TAURI =
  typeof window !== "undefined" && "__TAURI_INTERNALS__" in (window as object);

type Unlisten = () => void;

async function core() {
  return await import("@tauri-apps/api/core");
}

async function call<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  const { invoke } = await core();
  return invoke<T>(cmd, args);
}

// ---------------------------------------------------------------------------
// Settings, goals, notes
// ---------------------------------------------------------------------------

export async function getSettings(): Promise<Settings> {
  return IS_TAURI ? call<Settings>("get_settings") : mock.settings();
}

export async function saveSettings(settings: Settings): Promise<Settings> {
  return IS_TAURI ? call<Settings>("save_settings", { settings }) : settings;
}

export async function getGoals(): Promise<Goal[]> {
  return IS_TAURI ? call<Goal[]>("get_goals") : mock.goals();
}

export async function saveGoals(goals: Goal[]): Promise<void> {
  if (IS_TAURI) await call<void>("save_goals", { goals });
}

export async function getNotes(): Promise<Note[]> {
  return IS_TAURI ? call<Note[]>("get_notes") : mock.notes();
}

export async function saveNotes(notes: Note[]): Promise<void> {
  if (IS_TAURI) await call<void>("save_notes", { notes });
}

// ---------------------------------------------------------------------------
// Scanning
// ---------------------------------------------------------------------------

export async function cachedProjects(): Promise<Project[]> {
  // The mock hands back its own live array; copying it keeps the identity
  // changing across calls, the way a real IPC response always would.
  return IS_TAURI ? call<Project[]>("cached_projects") : [...mock.projects()];
}

export async function scanProjects(): Promise<ScanResult> {
  if (!IS_TAURI) {
    const projects = mock.projects();
    await new Promise((r) => setTimeout(r, 420));
    return { projects, elapsedMs: 420, roots: mock.settings().folders };
  }
  return call<ScanResult>("scan_projects");
}

export async function rescanProject(id: string): Promise<Project | null> {
  if (!IS_TAURI) return mock.projects().find((p) => p.id === id) ?? null;
  return call<Project | null>("rescan_project", { id });
}

// ---------------------------------------------------------------------------
// Cleanup
// ---------------------------------------------------------------------------

export async function deleteTargets(keys: string[]): Promise<DeleteReport> {
  if (!IS_TAURI) return mock.deleteTargets(keys);
  return call<DeleteReport>("delete_targets", { keys });
}

// ---------------------------------------------------------------------------
// Docker and toolchains
// ---------------------------------------------------------------------------

export async function dockerStatus(): Promise<DockerStatus> {
  if (!IS_TAURI) return mock.dockerStatus();
  return call<DockerStatus>("docker_status");
}

export async function projectContainers(projectId: string): Promise<Container[]> {
  if (!IS_TAURI) return mock.containers(projectId);
  return call<Container[]>("project_containers", { projectId });
}

export async function projectRequirements(projectId: string): Promise<ToolStatus[]> {
  if (!IS_TAURI) return mock.requirements(projectId);
  return call<ToolStatus[]>("project_requirements", { projectId });
}

/**
 * Installs a toolchain. Only the id crosses the boundary — the backend owns the
 * command, so this cannot be talked into running something else.
 */
export async function installTool(id: string): Promise<string> {
  if (!IS_TAURI) return mock.installTool(id);
  return call<string>("install_tool", { id });
}

// ---------------------------------------------------------------------------
// Command runner
// ---------------------------------------------------------------------------

/** Whether the port this command wants is free, and who has it if not. */
export async function checkPort(
  projectId: string,
  cmd: string,
  cwd = "",
): Promise<PortConflict> {
  if (!IS_TAURI) return mock.checkPort(projectId, cmd, cwd);
  return call<PortConflict>("check_port", { projectId, cmd, cwd });
}

/**
 * Ends whatever is holding a port. Only the port number crosses the boundary —
 * the backend resolves the holder and refuses system processes, so this cannot
 * be asked to end a process of the caller's choosing.
 */
export async function freePort(port: number): Promise<string> {
  if (!IS_TAURI) return mock.freePort(port);
  return call<string>("free_port", { port });
}

/**
 * Starts a command. `port` moves it to another one — the backend rewrites the
 * line, so the command stays filed under what the user actually pressed.
 */
export async function runCommand(
  projectId: string,
  cmd: string,
  cwd = "",
  port?: number,
): Promise<void> {
  if (!IS_TAURI) return mock.runCommand(projectId, cmd, cwd, port);
  await call<void>("run_command", { projectId, cmd, cwd, port: port ?? null });
}

export async function stopCommand(projectId: string, cmd: string, cwd = ""): Promise<void> {
  if (!IS_TAURI) return mock.stopCommand(projectId, cmd, cwd);
  await call<void>("stop_command", { projectId, cmd, cwd });
}

/** Everything running that belongs to a project, holds a port, or is ours. */
export async function runningProcesses(): Promise<ProcessInfo[]> {
  if (!IS_TAURI) return mock.runningProcesses();
  return call<ProcessInfo[]>("running_processes");
}

/**
 * Stops a process by pid. Only the pid crosses the boundary — the backend
 * resolves the name and refuses system processes.
 */
export async function stopProcess(pid: number): Promise<string> {
  if (!IS_TAURI) return mock.stopProcess(pid);
  return call<string>("stop_process", { pid });
}

export async function runningCommands(): Promise<string[]> {
  if (!IS_TAURI) return mock.runningCommands();
  return call<string[]>("running_commands");
}

// ---------------------------------------------------------------------------
// Git sync
// ---------------------------------------------------------------------------

/**
 * Where a project stands against the branch it tracks, read from refs on disk.
 * Costs nothing and never touches the network, so it is safe to ask for
 * whenever a view needs it.
 */
export async function gitSyncStatus(projectId: string): Promise<SyncStatus> {
  if (!IS_TAURI) return mock.syncStatus(projectId);
  return call<SyncStatus>("git_sync_status", { projectId });
}

/**
 * Asks the remote what it has. Only the project id crosses the boundary - the
 * path and the remote are the project's own - and nothing in the working tree
 * is touched: a fetch moves remote-tracking refs and nothing else.
 */
export async function gitFetch(projectId: string): Promise<SyncStatus> {
  if (!IS_TAURI) return mock.gitFetch(projectId);
  return call<SyncStatus>("git_fetch", { projectId });
}

/** The same, for every project that has a remote. Reports on `sync-progress`. */
export async function gitFetchAll(): Promise<SyncStatus[]> {
  if (!IS_TAURI) return mock.gitFetchAll();
  return call<SyncStatus[]>("git_fetch_all");
}

/**
 * Replays the project's local commits on top of the remote's. The backend
 * builds the command from that project's own upstream, so this cannot be asked
 * to rebase onto a branch of the caller's choosing.
 */
export async function gitRebase(projectId: string): Promise<RebaseReport> {
  if (!IS_TAURI) return mock.gitRebase(projectId);
  return call<RebaseReport>("git_rebase", { projectId });
}

/** Puts the branch back where it was before a rebase stopped. */
export async function gitRebaseAbort(projectId: string): Promise<RebaseReport> {
  if (!IS_TAURI) return mock.gitRebaseAbort(projectId);
  return call<RebaseReport>("git_rebase_abort", { projectId });
}

// ---------------------------------------------------------------------------
// Claude Code history
// ---------------------------------------------------------------------------

/**
 * Every Claude Code session on this machine, summarised from its logs. The
 * first call reads them whole; later ones only read what has been appended.
 */
export async function claudeStats(): Promise<ClaudeStats> {
  if (!IS_TAURI) return mock.claudeStats();
  return call<ClaudeStats>("claude_stats");
}

/**
 * One session's conversation. Only the session id crosses the boundary - the
 * backend resolves it against the logs it has already seen, so this cannot be
 * asked to open a file of the caller's choosing.
 */
export async function claudeSession(id: string): Promise<ClaudeMessage[]> {
  if (!IS_TAURI) return mock.claudeSession(id);
  return call<ClaudeMessage[]>("claude_session", { id });
}

// ---------------------------------------------------------------------------
// Shell integration
// ---------------------------------------------------------------------------

export async function openEditor(path: string): Promise<void> {
  if (IS_TAURI) await call<void>("open_editor", { path });
}

export async function openTerminal(path: string): Promise<void> {
  if (IS_TAURI) await call<void>("open_terminal", { path });
}

/**
 * Opens a tag's page on the hosting service. Only a project and a tag cross
 * the boundary — the backend builds the URL from that project's own remote,
 * so this cannot be asked to open something else.
 */
export async function openTag(projectId: string, tag: string): Promise<string> {
  if (!IS_TAURI) return `https://github.com/example/${projectId}/releases/tag/${tag}`;
  return call<string>("open_tag", { projectId, tag });
}

export async function reveal(path: string): Promise<void> {
  if (IS_TAURI) await call<void>("reveal", { path });
}

export async function rssBytes(): Promise<number> {
  if (!IS_TAURI) return 38 * 1024 * 1024;
  const stats = await call<{ rssBytes: number }>("sys_stats");
  return stats.rssBytes;
}

/** Native folder picker; returns null when the user cancels. */
export async function pickFolder(): Promise<string | null> {
  if (!IS_TAURI) return null;
  const { open } = await import("@tauri-apps/plugin-dialog");
  const picked = await open({ directory: true, multiple: false });
  return typeof picked === "string" ? picked : null;
}

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------

async function on<T>(event: string, handler: (payload: T) => void): Promise<Unlisten> {
  if (!IS_TAURI) return () => {};
  const { listen } = await import("@tauri-apps/api/event");
  return listen<T>(event, (e) => handler(e.payload));
}

export const onLog = (h: (line: LogLine) => void) => on<LogLine>("upa://log", h);
export const onCmdExit = (h: (key: string) => void) => on<string>("upa://cmd-exit", h);
export const onCleanProgress = (h: (p: CleanProgress) => void): Promise<Unlisten> =>
  IS_TAURI
    ? on<CleanProgress>("upa://clean-progress", h)
    : Promise.resolve(mock.onCleanProgress(h));
export const onScanProgress = (h: (p: ScanProgress) => void) =>
  on<ScanProgress>("upa://scan-progress", h);
export const onSyncProgress = (h: (p: ScanProgress) => void) =>
  on<ScanProgress>("upa://sync-progress", h);
export const onProjectsChanged = (h: (ids: string[]) => void) =>
  on<string[]>("upa://projects-changed", h);

/** Browser-mode log stream, so the Commands view is alive without Tauri. */
export function onMockLog(h: (line: LogLine) => void): Unlisten {
  return IS_TAURI ? () => {} : mock.onLog(h);
}

// ---------------------------------------------------------------------------
// Window control
// ---------------------------------------------------------------------------

async function win() {
  const { getCurrentWindow } = await import("@tauri-apps/api/window");
  return getCurrentWindow();
}

export async function showWindow(): Promise<void> {
  if (!IS_TAURI) return;
  await (await win()).show();
}

export async function minimizeWindow(): Promise<void> {
  if (!IS_TAURI) return;
  await (await win()).minimize();
}

export async function toggleMaximizeWindow(): Promise<boolean> {
  if (!IS_TAURI) return false;
  const w = await win();
  await w.toggleMaximize();
  return w.isMaximized();
}

export async function closeWindow(): Promise<void> {
  if (!IS_TAURI) return;
  await (await win()).close();
}

export async function isMaximized(): Promise<boolean> {
  if (!IS_TAURI) return false;
  return (await win()).isMaximized();
}

let resizeToken = 0;

/** True when the point is on one of the monitors currently attached. */
async function onSomeMonitor(x: number, y: number, factor: number): Promise<boolean> {
  const { availableMonitors } = await import("@tauri-apps/api/window");
  const monitors = await availableMonitors();
  if (monitors.length === 0) return true;

  return monitors.some((m) => {
    const left = m.position.x / factor;
    const top = m.position.y / factor;
    const right = left + m.size.width / factor;
    const bottom = top + m.size.height / factor;
    // A little slack so a window flush against an edge still counts.
    return x >= left - 32 && x <= right - 64 && y >= top - 32 && y <= bottom - 64;
  });
}

/**
 * Puts the window back where it was last time. A saved position on a monitor
 * that is no longer attached is dropped, so the window cannot come back
 * off-screen; the size is still restored in that case.
 */
export async function restoreWindow(
  state: { x: number | null; y: number | null; height: number | null; maximized: boolean },
  width: number,
): Promise<void> {
  if (!IS_TAURI) return;
  const w = await win();
  const { LogicalSize, LogicalPosition } = await import("@tauri-apps/api/dpi");
  const factor = await w.scaleFactor();

  const inner = await w.innerSize();
  const height = state.height ?? Math.round(inner.height / factor);
  await w.setSize(new LogicalSize(width, height));

  if (state.x !== null && state.y !== null) {
    if (await onSomeMonitor(state.x, state.y, factor)) {
      await w.setPosition(new LogicalPosition(state.x, state.y));
    }
  }

  if (state.maximized) {
    await w.maximize();
  }
}

/**
 * Tells the backend which view is on screen. The geometry watcher lives in
 * Rust and files a remembered width against the view it was measured on.
 */
export async function setWindowContext(view: string, navWidth: number): Promise<void> {
  if (!IS_TAURI) return;
  await call<void>("set_window_context", { view, navWidth });
}

/**
 * Resizes the window to the width the current view asks for.
 *
 * `anchor` decides which edge stays put: with `left` the window simply grows
 * and shrinks to the right, with `right` it is repositioned every step so the
 * right edge holds still and the window grows leftwards.
 */
export async function setWindowWidth(width: number, anchor: Anchor = "left"): Promise<void> {
  if (!IS_TAURI) return;
  const w = await win();
  if (await w.isMaximized()) return;

  const { LogicalSize, LogicalPosition } = await import("@tauri-apps/api/dpi");
  const factor = await w.scaleFactor();
  const inner = await w.innerSize();
  const outer = await w.outerPosition();

  const fromWidth = Math.round(inner.width / factor);
  const height = Math.round(inner.height / factor);
  const fromX = Math.round(outer.x / factor);
  const top = Math.round(outer.y / factor);
  const right = fromX + fromWidth;

  if (Math.abs(fromWidth - width) < 2) return;

  // Right edge of the screen the window sits on, so a wide view cannot push the
  // window off the display in either anchoring mode.
  const { currentMonitor } = await import("@tauri-apps/api/window");
  const monitor = await currentMonitor();
  const screenRight = monitor
    ? Math.round((monitor.position.x + monitor.size.width) / factor)
    : Number.POSITIVE_INFINITY;

  const token = ++resizeToken;
  const steps = 12;
  const ease = (t: number) => 1 - Math.pow(1 - t, 3);

  for (let i = 1; i <= steps; i++) {
    if (token !== resizeToken) return;
      const next = Math.round(fromWidth + (width - fromWidth) * ease(i / steps));
    await w.setSize(new LogicalSize(next, height));

    const x =
      anchor === "right"
        ? right - next
        : // Left-anchored: hold fromX unless the window would overhang.
          Math.min(fromX, screenRight - next);

    if (x !== fromX || anchor === "right") {
      await w.setPosition(new LogicalPosition(Math.max(0, x), top));
    }
    if (i < steps) await new Promise((r) => requestAnimationFrame(() => r(null)));
  }
}

export async function startDragging(): Promise<void> {
  if (!IS_TAURI) return;
  await (await win()).startDragging();
}
