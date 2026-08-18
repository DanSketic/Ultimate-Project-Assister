import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import * as api from "./api";
import { dict, type T } from "./i18n";
import { bindToProjects, cmdKey, isExcluded, newId, size, todayIso } from "./format";
import { ensurePermission as requestOsPermission, send as sendOsNotification } from "./notify";
import type {
  CleanProgress,
  CommandDef,
  Container,
  DockerStatus,
  Feature,
  Goal,
  Lang,
  LogLine,
  Note,
  NoteColor,
  PortConflict,
  ProcessInfo,
  Project,
  RebaseReport,
  Settings,
  SyncStatus,
  Theme,
  ToolStatus,
  View,
} from "./types";

/** Default width each view asks for, before the sidebar is added. */
const VIEW_WIDTH: Record<View, number> = {
  projects: 1030,
  detail: 1220,
  clean: 1160,
  goals: 1030,
  board: 1740,
  cmd: 1120,
  procs: 1120,
  set: 840,
};

const NAV_OPEN = 214;
const NAV_CLOSED = 58;
const MAX_LOG_LINES = 400;
/** How many finished runs keep their output before the oldest is let go. */
const MAX_LOG_STREAMS = 12;

/**
 * Bounds how many streams are retained. Insertion order is the order runs first
 * produced output, so dropping from the front lets the oldest go first.
 */
function capStreams(streams: Record<string, LogEntry[]>): Record<string, LogEntry[]> {
  const keys = Object.keys(streams);
  if (keys.length <= MAX_LOG_STREAMS) return streams;
  const kept: Record<string, LogEntry[]> = {};
  for (const key of keys.slice(keys.length - MAX_LOG_STREAMS)) kept[key] = streams[key]!;
  return kept;
}
/** Ignore recorded widths this far from sane - a stale file should not trap
 *  the window at 40 px. */
const MIN_CONTENT_WIDTH = 600;
const MAX_CONTENT_WIDTH = 4000;

/**
 * Width the window should have for a view: whatever the user last dragged it
 * to on that view, otherwise the design's default. Stored widths exclude the
 * sidebar so collapsing it still narrows the window by exactly its width.
 */
function widthFor(view: View, navOpen: boolean, settings: Settings | null): number {
  const saved = settings?.window?.widths?.[view];
  const content =
    saved && saved >= MIN_CONTENT_WIDTH && saved <= MAX_CONTENT_WIDTH ? saved : VIEW_WIDTH[view];
  return content + (navOpen ? NAV_OPEN : NAV_CLOSED);
}

/**
 * Startup overrides read from the query string, used when the UI is opened in a
 * browser: `?view=clean&lang=en`. They only seed the initial state and are
 * never written back to the settings file. A packaged app is loaded without a
 * query string, so this is inert in production - it exists so the documentation
 * screenshots can be regenerated without hand-driving the app.
 */
function startupParam(name: string): string | null {
  if (typeof location === "undefined") return null;
  return new URLSearchParams(location.search).get(name);
}

export interface LogEntry {
  time: string;
  text: string;
  fg: string;
}

export type NoticeKind = "success" | "info" | "warn" | "error";

export interface Notice {
  id: string;
  kind: NoticeKind;
  title: string;
  body?: string;
}

/**
 * How long a notice stays before it goes on its own. A failure never does: an
 * error that vanishes after three seconds is an error nobody read.
 */
const NOTICE_LIFE: Record<NoticeKind, number> = {
  success: 3600,
  info: 3600,
  warn: 6000,
  error: 0,
};

/** How many notices are on screen at once before the oldest is dropped. */
const MAX_NOTICES = 4;

export interface GoalRatio {
  all: number;
  done: number;
  pct: number;
}

function logColour(line: LogLine): string {
  if (line.stream === "cmd") return "var(--acc)";
  if (line.stream === "exit") return "var(--danTx2)";
  const text = line.text.toLowerCase();
  if (text.includes("warn")) return "var(--warnTx)";
  if (line.stream === "err" || text.includes("error")) return "var(--danTx)";
  return "rgba(var(--trgb),.8)";
}

export function useApp() {
  // --- persisted state ----------------------------------------------------
  const [settings, setSettings] = useState<Settings | null>(null);
  const [projects, setProjects] = useState<Project[]>([]);
  const [goals, setGoals] = useState<Goal[]>([]);
  const [notes, setNotes] = useState<Note[]>([]);

  // --- view state ---------------------------------------------------------
  const [view, setViewRaw] = useState<View>(startupParam("view") as View ?? "projects");
  const [selId, setSelId] = useState<string>("");
  const [q, setQ] = useState("");
  const [stack, setStack] = useState("all");
  const [sort, setSort] = useState<"recent" | "name" | "size" | "dirty">("recent");
  const [maxed, setMaxed] = useState(false);
  const [scanRot, setScanRot] = useState(0);

  // The geometry listener is installed once, so it reads the live view here
  // rather than closing over the value it saw at mount.
  const viewRef = useRef<View>("projects");
  useEffect(() => {
    viewRef.current = view;
  }, [view]);

  // --- cleaner ------------------------------------------------------------
  const [cat, setCat] = useState("all");
  const [onlyOld, setOnlyOld] = useState(false);
  const [onlyBig, setOnlyBig] = useState(false);
  const [picked, setPicked] = useState<Record<string, boolean> | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [cleanProgress, setCleanProgress] = useState<CleanProgress | null>(null);
  const [ruleDraft, setRuleDraft] = useState("");

  // --- docker and toolchains ----------------------------------------------
  const [docker, setDocker] = useState<DockerStatus | null>(null);
  const [containers, setContainers] = useState<Container[]>([]);
  /** Null while the check is still running, so the card can say so. */
  const [requirements, setRequirements] = useState<ToolStatus[] | null>(null);
  const [installing, setInstalling] = useState<Set<string>>(new Set());

  // --- goals / board / commands ------------------------------------------
  const [goalSel, setGoalSel] = useState("");
  const [boardFilter, setBoardFilter] = useState("all");
  const [cmdSel, setCmdSel] = useState("");
  const [running, setRunning] = useState<Set<string>>(new Set());
  /** One stream per run, keyed the same way a running command is. */
  const [logs, setLogs] = useState<Record<string, LogEntry[]>>({});
  const [logTab, setLogTab] = useState("");
  /** A start held back until the user decides what to do about the port. */
  const [portAsk, setPortAsk] = useState<{
    project: Project;
    command: CommandDef;
    conflict: PortConflict;
  } | null>(null);
  const [processes, setProcesses] = useState<ProcessInfo[] | null>(null);
  const [stopping, setStopping] = useState<Set<number>>(new Set());

  // --- git sync -----------------------------------------------------------
  /** The project the sync dialog is open on; empty when it is closed. */
  const [syncFor, setSyncFor] = useState("");
  /** Null while the first read is still running, so the dialog can say so. */
  const [sync, setSync] = useState<SyncStatus | null>(null);
  const [syncReport, setSyncReport] = useState<RebaseReport | null>(null);
  const [syncBusy, setSyncBusy] = useState(false);
  /** Progress of a run across every project, for the status bar. */
  const [syncNote, setSyncNote] = useState("");
  /**
   * Held in a ref because a scan can ask for it, and `rescan` is written above
   * the action itself. The ref is what lets the scan reach the current one
   * rather than the copy that existed when it was first built.
   */
  const checkAllRef = useRef<() => Promise<void>>(async () => {});

  // --- chrome -------------------------------------------------------------
  const [notices, setNotices] = useState<Notice[]>([]);
  const [scanning, setScanning] = useState(false);
  const [scanNote, setScanNote] = useState("");
  const [elapsedMs, setElapsedMs] = useState(0);
  const [rss, setRss] = useState(0);
  const [sysLight, setSysLight] = useState(false);

  /** Read through a ref so `notify` stays stable as the setting changes. */
  const osNotifications = useRef(false);
  const saveTimer = useRef<number | undefined>(undefined);

  const lang: Lang = settings?.lang ?? "hu";
  const theme: Theme = settings?.theme ?? "auto";
  const t: T = useMemo(() => dict(lang), [lang]);
  const resolvedTheme = theme === "auto" ? (sysLight ? "light" : "dark") : theme;
  const navOpen = !(settings?.navCollapsed ?? false);

  const dismissNotice = useCallback((id: string) => {
    setNotices((prev) => prev.filter((n) => n.id !== id));
  }, []);

  /**
   * The one way anything in the app says something.
   *
   * `os` asks for a desktop notification as well, which is only sent when the
   * user has turned them on in Settings - the in-app notice always appears
   * either way, so nothing is lost when they are off.
   */
  const notify = useCallback(
    (kind: NoticeKind, title: string, body?: string, os = false) => {
      const id = newId("n");
      setNotices((prev) => [...prev, { id, kind, title, body }].slice(-MAX_NOTICES));

      const life = NOTICE_LIFE[kind];
      if (life > 0) window.setTimeout(() => dismissNotice(id), life);

      if (os && osNotifications.current) void sendOsNotification(title, body ?? "");
    },
    [dismissNotice],
  );

  /** Kept as the short form for the many places that just report success. */
  const flash = useCallback(
    (message: string) => notify("success", message),
    [notify],
  );

  // --- boot ---------------------------------------------------------------
  useEffect(() => {
    let alive = true;

    (async () => {
      const [loaded, loadedGoals, loadedNotes, cached] = await Promise.all([
        api.getSettings(),
        api.getGoals(),
        api.getNotes(),
        api.cachedProjects(),
      ]);
      if (!alive) return;

      // Put the window back before it is shown, so the restore is never
      // visible as a jump.
      const navOpenAtBoot = !loaded.navCollapsed;
      await api.restoreWindow(loaded.window, widthFor("projects", navOpenAtBoot, loaded));
      setMaxed(loaded.window.maximized);

      const langParam = startupParam("lang");
      const seeded: Settings =
        langParam === "en" || langParam === "hu" ? { ...loaded, lang: langParam } : loaded;

      setSettings(seeded);
      setGoals(loadedGoals);
      setNotes(loadedNotes);
      setProjects(cached);
      // The cache is enough to rebind against, so goals and notes resolve
      // before the first scan finishes.
      rebindSavedData(cached);
      await api.showWindow();

      const keys = await api.runningCommands();
      if (alive) setRunning(new Set(keys));

      if (loaded.toggles.scanStart || cached.length === 0) {
        void rescan(loaded);
      }
    })();

    return () => {
      alive = false;
      window.clearTimeout(saveTimer.current);
    };
    // Boot runs once; `rescan` is stable enough for this single call.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Desktop notifications are opt-in; the ref keeps `notify` stable.
  useEffect(() => {
    osNotifications.current = settings?.osNotifications ?? false;
  }, [settings?.osNotifications]);

  // --- system theme -------------------------------------------------------
  useEffect(() => {
    if (!window.matchMedia) return;
    const mq = window.matchMedia("(prefers-color-scheme: light)");
    setSysLight(mq.matches);
    const onChange = (e: MediaQueryListEvent) => setSysLight(e.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  // --- live process output ------------------------------------------------
  useEffect(() => {
    const push = (line: LogLine) => {
      // Each run keeps its own stream. Two dev servers in one project used to
      // interleave into a single pane, which made both unreadable.
      setLogs((prev) => {
        const entry: LogEntry = { time: line.time, text: line.text, fg: logColour(line) };
        const next = { ...prev, [line.key]: [...(prev[line.key] ?? []), entry].slice(-MAX_LOG_LINES) };
        return capStreams(next);
      });
      if (line.stream === "exit") {
        setRunning((prev) => {
          const next = new Set(prev);
          next.delete(line.key);
          return next;
        });
      }
    };

    const stops: Array<() => void> = [api.onMockLog(push)];
    let alive = true;

    void api.onLog(push).then((un) => (alive ? stops.push(un) : un()));
    void api
      .onCmdExit((key) =>
        setRunning((prev) => {
          const next = new Set(prev);
          next.delete(key);
          return next;
        }),
      )
      .then((un) => (alive ? stops.push(un) : un()));

    return () => {
      alive = false;
      stops.forEach((s) => s());
    };
  }, []);

  // --- scan progress and filesystem changes -------------------------------
  useEffect(() => {
    const stops: Array<() => void> = [];
    let alive = true;

    void api
      .onScanProgress((p) => setScanNote(`${p.done} / ${p.total}`))
      .then((un) => (alive ? stops.push(un) : un()));

    void api
      .onCleanProgress((p) => setCleanProgress(p.phase === "done" ? null : p))
      .then((un) => (alive ? stops.push(un) : un()));

    void api
      .onSyncProgress((p) =>
        setSyncNote(p.done >= p.total ? "" : `${p.current} · ${p.done} / ${p.total}`),
      )
      .then((un) => (alive ? stops.push(un) : un()));

    void api
      .onProjectsChanged(async (ids) => {
        for (const id of ids) {
          const updated = await api.rescanProject(id);
          if (updated) {
            setProjects((prev) => prev.map((p) => (p.id === updated.id ? updated : p)));
          }
        }
      })
      .then((un) => (alive ? stops.push(un) : un()));

    return () => {
      alive = false;
      stops.forEach((s) => s());
    };
  }, []);

  // --- memory readout -----------------------------------------------------
  useEffect(() => {
    let alive = true;
    const tick = async () => {
      const bytes = await api.rssBytes();
      if (alive) setRss(bytes);
    };
    void tick();
    const id = window.setInterval(tick, 8000);
    return () => {
      alive = false;
      window.clearInterval(id);
    };
  }, []);

  // --- window sizing per view ---------------------------------------------
  useEffect(() => {
    if (maxed || !settings) return;
    void api.setWindowWidth(widthFor(view, navOpen, settings), settings.anchor);
    // Only the view, the sidebar and the anchor drive a resize. Reacting to
    // `settings.window` here would fight the user mid-drag.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, navOpen, maxed, settings?.anchor]);

  // The backend watcher records the geometry; it only needs to know which view
  // a remembered width belongs to.
  useEffect(() => {
    void api.setWindowContext(view, navOpen ? NAV_OPEN : NAV_CLOSED);
  }, [view, navOpen]);

  // --- docker -------------------------------------------------------------
  // Asking the daemon is slow when it is not listening, so this is deliberately
  // demand-driven: on the views that show it, and on an explicit refresh.
  const refreshDocker = useCallback(async () => {
    setDocker(null);
    setDocker(await api.dockerStatus());
  }, []);

  useEffect(() => {
    if (view !== "detail" && view !== "cmd" && view !== "clean") return;
    let alive = true;
    void api.dockerStatus().then((s) => alive && setDocker(s));
    return () => {
      alive = false;
    };
  }, [view]);

  // --- persistence helpers ------------------------------------------------
  const patchSettings = useCallback(
    (partial: Partial<Settings>) => {
      setSettings((prev) => {
        if (!prev) return prev;
        const next = { ...prev, ...partial };
        window.clearTimeout(saveTimer.current);
        saveTimer.current = window.setTimeout(() => void api.saveSettings(next), 250);
        return next;
      });
    },
    [],
  );

  const commitGoals = useCallback((next: Goal[]) => {
    setGoals(next);
    void api.saveGoals(next);
  }, []);

  const notesSaveTimer = useRef<number | undefined>(undefined);
  const commitNotes = useCallback((next: Note[], immediate = false) => {
    setNotes(next);
    window.clearTimeout(notesSaveTimer.current);
    if (immediate) {
      void api.saveNotes(next);
    } else {
      notesSaveTimer.current = window.setTimeout(() => void api.saveNotes(next), 400);
    }
  }, []);

  /**
   * Goals and notes used to be filed under a project name. Once a scan tells
   * us which projects exist, rewrite those to ids - otherwise two projects
   * sharing a name would share each other's goals.
   */
  const rebindSavedData = useCallback((scanned: Project[]) => {
    if (scanned.length === 0) return;

    setGoals((prev) => {
      const bound = bindToProjects(prev, scanned);
      if (bound) void api.saveGoals(bound);
      return bound ?? prev;
    });
    setNotes((prev) => {
      const bound = bindToProjects(prev, scanned);
      if (bound) void api.saveNotes(bound);
      return bound ?? prev;
    });
  }, []);

  // --- scanning -----------------------------------------------------------
  const rescan = useCallback(
    async (using?: Settings) => {
      const active = using ?? settings;
      if (!active) return;
      if (active.folders.length === 0) {
        setProjects([]);
        return;
      }

      setScanning(true);
      setScanRot((r) => r + 360);
      try {
        const result = await api.scanProjects();
        setProjects(result.projects);
        setElapsedMs(result.elapsedMs);
        // Drop back to the remembered selection rather than to this session's
        // in-memory copy of it.
        setPicked(null);
        rebindSavedData(result.projects);

        // A remembered selection outlives a rescan on purpose, but not the
        // project it belongs to. Keys read `<project id>|<category>|<path>`,
        // so once a project is gone its keys are dead weight.
        const live = new Set(result.projects.map((p) => p.id));
        const remembered = active.cleanPicked;
        if (remembered) {
          const kept = remembered.filter((key) => live.has(key.split("|")[0] ?? ""));
          if (kept.length !== remembered.length) patchSettings({ cleanPicked: kept });
        }
        const d = dict(active.lang);
        flash(
          `${d.rescanToast} ${result.projects.length} ${d.rescanIn} · ${(result.elapsedMs / 1000).toFixed(1)} s`,
        );

        // Only when asked for. A scan reads the disk; this reaches the network
        // once per project, which on twenty repositories is the slow part - and
        // it carries on behind the scan rather than holding it open.
        if (active.toggles.fetchOnScan) void checkAllRef.current();
      } catch (e) {
        flash(String(e));
      } finally {
        setScanning(false);
        setScanNote("");
      }
    },
    [settings, flash, patchSettings],
  );

  // --- derived data -------------------------------------------------------
  const current = useMemo(
    () => projects.find((p) => p.id === selId) ?? projects[0],
    [projects, selId],
  );

  // Projects are addressed by id throughout: two checkouts can share a name.
  const goalsFor = useCallback(
    (projectId: string) => goals.filter((g) => g.project === projectId),
    [goals],
  );

  const goalRatio = useCallback(
    (projectId: string): GoalRatio => {
      const mine = goals.filter((g) => g.project === projectId);
      const all = mine.reduce((a, g) => a + g.features.length, 0);
      const done = mine.reduce((a, g) => a + g.features.filter((f) => f.done).length, 0);
      return { all, done, pct: all ? Math.round((done / all) * 100) : 0 };
    },
    [goals],
  );

  // --- per-project requirements and containers ------------------------------
  const project = current?.id;
  useEffect(() => {
    if (!project || view !== "detail") return;
    let alive = true;
    setRequirements(null);
    void api.projectRequirements(project).then((r) => alive && setRequirements(r));
    void api.projectContainers(project).then((c) => alive && setContainers(c));
    return () => {
      alive = false;
    };
  }, [project, view]);

  const refreshProjectEnv = useCallback(async () => {
    if (!project) return;
    const [tools, running] = await Promise.all([
      api.projectRequirements(project),
      api.projectContainers(project),
    ]);
    setRequirements(tools);
    setContainers(running);
  }, [project]);

  /**
   * Runs a toolchain's installer. Only the id is sent - the backend owns the
   * command - and the output lands in the same log the project commands use.
   */
  const installTool = useCallback(
    async (tool: { id: string; name: string }) => {
      setInstalling((prev) => new Set(prev).add(tool.id));
      try {
        const cmd = await api.installTool(tool.id);
        flash(`${tool.name}: ${cmd}`);
      } catch (e) {
        flash(`${tool.name}: ${e}`);
      } finally {
        setInstalling((prev) => {
          const next = new Set(prev);
          next.delete(tool.id);
          return next;
        });
      }
    },
    [flash],
  );

  const allCleanRows = useMemo(
    () => projects.flatMap((p) => p.cleanTargets).sort((a, b) => b.bytes - a.bytes),
    [projects],
  );

  /**
   * What is ticked in the cleaner.
   *
   * The selection the user last left is restored, including keys whose
   * directory is currently absent - a `target/` that was cleaned and has since
   * built up again comes back already ticked, which is the whole point of
   * remembering it. Only when there is nothing remembered at all does this fall
   * back to the age-and-rules default.
   */
  const pickedSet = useMemo(() => {
    if (picked) return picked;

    // Null, not empty: clearing the selection is itself a choice, and must not
    // be read as "never chosen" and overwritten by the age default.
    const saved = settings?.cleanPicked;
    if (saved) {
      const restored: Record<string, boolean> = {};
      for (const key of saved) restored[key] = true;
      return restored;
    }

    const auto: Record<string, boolean> = {};
    const threshold = settings?.ageDays ?? 30;
    const rules = settings?.rules ?? [];
    for (const row of allCleanRows) {
      if (row.ageDays >= threshold && !isExcluded(row, rules)) auto[row.key] = true;
    }
    return auto;
  }, [picked, allCleanRows, settings?.ageDays, settings?.rules, settings?.cleanPicked]);

  const selectedRows = useMemo(
    () => allCleanRows.filter((r) => pickedSet[r.key]),
    [allCleanRows, pickedSet],
  );
  const selectedBytes = useMemo(
    () => selectedRows.reduce((a, r) => a + r.bytes, 0),
    [selectedRows],
  );

  // --- actions ------------------------------------------------------------
  const setView = useCallback((next: View) => setViewRaw(next), []);

  const openProject = useCallback((project: Project) => {
    setSelId(project.id);
    setGoalSel(project.id);
    setCmdSel(project.id);
    setViewRaw("detail");
  }, []);

  const toggleNav = useCallback(
    () => patchSettings({ navCollapsed: navOpen }),
    [patchSettings, navOpen],
  );

  const favourites = useMemo(
    () => new Set(settings?.favourites ?? []),
    [settings?.favourites],
  );

  const toggleFavourite = useCallback(
    (projectId: string) => {
      const next = new Set(favourites);
      if (!next.delete(projectId)) next.add(projectId);
      patchSettings({ favourites: [...next] });
    },
    [favourites, patchSettings],
  );

  /** Pinned commands, keyed the same way a running command is: id|cwd|cmd. */
  const cmdFavourites = useMemo(
    () => new Set(settings?.cmdFavourites ?? []),
    [settings?.cmdFavourites],
  );

  const toggleCmdFavourite = useCallback(
    (key: string) => {
      const next = new Set(cmdFavourites);
      if (!next.delete(key)) next.add(key);
      patchSettings({ cmdFavourites: [...next] });
    },
    [cmdFavourites, patchSettings],
  );

  const favouritesOnly = settings?.favouritesOnly ?? false;

  const toggleFavouritesOnly = useCallback(
    () => patchSettings({ favouritesOnly: !favouritesOnly }),
    [patchSettings, favouritesOnly],
  );

  /**
   * Folded group headings, remembered across sessions.
   *
   * Namespaced by view: the same folder heads a block in Projects, Goals and
   * Commands, and folding it in one is not a statement about the others.
   */
  const collapsedGroups = useMemo(
    () => new Set(settings?.collapsedGroups ?? []),
    [settings?.collapsedGroups],
  );

  /**
   * Whether a group is folded.
   *
   * `byDefault` lets a block start closed — the processes that belong to no
   * project, say, which are context rather than work. Because "absent" then no
   * longer means "open", an explicit choice to open such a group is recorded
   * under an `open:` prefix; the two together give three states out of one list.
   */
  const isCollapsed = useCallback(
    (view: string, key: string, byDefault = false) => {
      const id = `${view}:${key}`;
      if (collapsedGroups.has(id)) return true;
      if (collapsedGroups.has(`open:${id}`)) return false;
      return byDefault;
    },
    [collapsedGroups],
  );

  const toggleGroup = useCallback(
    (view: string, key: string, byDefault = false) => {
      const id = `${view}:${key}`;
      const next = new Set(collapsedGroups);
      // Whichever way it was decided, the old answer goes before the new one.
      next.delete(id);
      next.delete(`open:${id}`);
      if (isCollapsed(view, key, byDefault)) next.add(`open:${id}`);
      else next.add(id);
      patchSettings({ collapsedGroups: [...next] });
    },
    [collapsedGroups, isCollapsed, patchSettings],
  );

  /** Opens a tag on the hosting service; reports why when it cannot. */
  const openTag = useCallback(
    async (projectId: string, tag: string) => {
      try {
        await api.openTag(projectId, tag);
      } catch (e) {
        flash(String(e));
      }
    },
    [flash],
  );

  /**
   * Turns desktop notifications on or off.
   *
   * Turning them on asks the operating system first and says so if it refuses,
   * rather than leaving a switch that looks on and does nothing. A confirmation
   * notice is sent on success, so the switch proves itself.
   */
  const setOsNotifications = useCallback(
    async (on: boolean) => {
      if (!on) {
        osNotifications.current = false;
        patchSettings({ osNotifications: false });
        return;
      }
      const granted = await requestOsPermission();
      if (!granted) {
        notify("warn", t.osNotifyDenied);
        patchSettings({ osNotifications: false });
        return;
      }
      osNotifications.current = true;
      patchSettings({ osNotifications: true });
      notify("success", t.osNotifyTest, undefined, true);
    },
    [patchSettings, notify, t],
  );

  const toggleMax = useCallback(async () => {
    setMaxed(await api.toggleMaximizeWindow());
  }, []);

  /**
   * Records the selection so the next session opens with it. Only the ticked
   * keys are stored; an unticked one is simply absent.
   */
  const commitPicked = useCallback(
    (next: Record<string, boolean>) => {
      setPicked(next);
      patchSettings({ cleanPicked: Object.keys(next).filter((key) => next[key]) });
    },
    [patchSettings],
  );

  const toggleClean = useCallback(
    (key: string) => commitPicked({ ...pickedSet, [key]: !pickedSet[key] }),
    [pickedSet, commitPicked],
  );

  /**
   * Ticks or unticks the rows currently on screen. Rows hidden by a filter are
   * left as they are, so switching category never silently drops a selection
   * the user cannot see.
   */
  const setCleanSelection = useCallback(
    (rows: { key: string }[], on: boolean) => {
      const next = { ...pickedSet };
      for (const r of rows) next[r.key] = on;
      commitPicked(next);
    },
    [pickedSet, commitPicked],
  );

  const doClean = useCallback(async () => {
    // The dialog closes at once and the work carries on behind it. A cleanup
    // can run for minutes, and holding a modal over the whole app for that long
    // means the one thing you cannot do while tidying up is use the app. The
    // status bar carries the progress instead, and a notification says when it
    // is done - including a desktop one, since the window will not be in front.
    setConfirmOpen(false);
    setCleanProgress({
      phase: "delete",
      done: 0,
      total: selectedRows.length,
      current: "",
      freedBytes: 0,
      totalBytes: selectedBytes,
    });
    try {
      const keys = selectedRows.map((r) => r.key);
      const report = await api.deleteTargets(keys);
      const fresh = await api.cachedProjects();
      setProjects(fresh);
      // The selection is deliberately left alone. The rows just removed are no
      // longer in `allCleanRows`, so nothing shows as selected - but the keys
      // stay remembered, and a directory that builds up again comes back
      // already ticked. A row whose deletion failed also stays ticked, which
      // is right: it still needs cleaning.

      // The backend owns the "freed today" counter; read it back rather than
      // recomputing it here. In browser mode there is no backend to ask.
      if (api.IS_TAURI) {
        setSettings(await api.getSettings());
      } else if (settings) {
        patchSettings({
          freedBytes:
            (settings.freedDate === todayIso() ? settings.freedBytes : 0) + report.freedBytes,
          freedDate: todayIso(),
        });
      }

      // Worth reaching the desktop for: a cleanup can run for minutes, and
      // the window is usually not the one being looked at by then.
      if (report.errors.length) {
        notify("error", t.cleanFailed, report.errors[0], true);
      } else {
        notify(
          "success",
          `${size(report.freedBytes)} ${t.freedToast}`,
          `${report.removed.length} ${t.removedDirs}`,
          true,
        );
      }
    } catch (e) {
      notify("error", t.deleteFailed, String(e), true);
    } finally {
      setCleanProgress(null);
    }
  }, [selectedRows, selectedBytes, settings, patchSettings, notify, t]);

  // --- running processes ----------------------------------------------------
  const refreshProcesses = useCallback(async () => {
    try {
      setProcesses(await api.runningProcesses());
    } catch (e) {
      flash(String(e));
    }
  }, [flash]);

  /**
   * Polled only while the list is on screen. Reading the whole process table
   * and the socket tables is not free, and a panel nobody is looking at has no
   * business doing it every few seconds.
   */
  useEffect(() => {
    if (view !== "procs") return;
    let alive = true;

    const tick = async () => {
      const found = await api.runningProcesses().catch(() => null);
      if (alive && found) setProcesses(found);
    };
    void tick();
    const id = window.setInterval(tick, 4000);
    return () => {
      alive = false;
      window.clearInterval(id);
    };
  }, [view]);

  /**
   * Stops a process. One this app started goes through the runner that owns it,
   * so its bookkeeping and its log tab stay correct; anything else is stopped
   * by pid, with the backend refusing system processes.
   */
  const stopProcess = useCallback(
    async (process: ProcessInfo) => {
      setStopping((prev) => new Set(prev).add(process.pid));
      try {
        if (process.commandKey) {
          const [projectId = "", cwd = "", cmd = ""] = process.commandKey.split("|");
          await api.stopCommand(projectId, cmd, cwd);
          setRunning((prev) => {
            const next = new Set(prev);
            next.delete(process.commandKey);
            return next;
          });
        } else {
          const name = await api.stopProcess(process.pid);
          flash(`${name} · PID ${process.pid} — ${t.stopped}`);
        }
      } catch (e) {
        flash(String(e));
      } finally {
        setStopping((prev) => {
          const next = new Set(prev);
          next.delete(process.pid);
          return next;
        });
        await refreshProcesses();
      }
    },
    [flash, t, refreshProcesses],
  );

  /** Drops one run's output, and moves off its tab if it was the open one. */
  const closeLog = useCallback((key: string) => {
    setLogs((prev) => {
      const next = { ...prev };
      delete next[key];
      return next;
    });
    setLogTab((current) => (current === key ? "" : current));
  }, []);

  /** Empties the open stream, leaving the tab in place while it still runs. */
  const clearLog = useCallback(() => {
    setLogs((prev) => (logTab && prev[logTab] ? { ...prev, [logTab]: [] } : {}));
  }, [logTab]);

  /** Starts a command for real, optionally moved to another port. */
  const startCommand = useCallback(
    async (project: Project, command: CommandDef, port?: number) => {
      const key = cmdKey(project.id, command);
      try {
        await api.runCommand(project.id, command.cmd, command.cwd, port);
        setRunning((prev) => new Set(prev).add(key));
        setLogTab(key);
      } catch (e) {
        flash(`${t.cmdFailed}: ${e}`);
      }
    },
    [flash, t],
  );

  const stopCommand = useCallback(
    async (project: Project, command: CommandDef) => {
      const key = cmdKey(project.id, command);
      try {
        await api.stopCommand(project.id, command.cmd, command.cwd);
        setRunning((prev) => {
          const next = new Set(prev);
          next.delete(key);
          return next;
        });
      } catch (e) {
        flash(`${t.cmdFailed}: ${e}`);
      }
    },
    [flash, t],
  );

  /**
   * Starting asks first whether the port is free. Half a dozen projects on one
   * machine all default to 3000 or 5173, and the alternative is a dev server
   * that dies with EADDRINUSE several seconds after it looked like it started.
   */
  const toggleCommand = useCallback(
    async (project: Project, command: CommandDef) => {
      const key = cmdKey(project.id, command);
      if (running.has(key)) {
        await stopCommand(project, command);
        return;
      }

      // A failed check used to be swallowed and the command started anyway,
      // which looks exactly like the feature not existing: no dialog, then the
      // command dies on a port it was never asked about. Say so instead.
      const conflict = await api
        .checkPort(project.id, command.cmd, command.cwd)
        .catch((e) => {
          flash(`${t.portCheckFailed}: ${e}`);
          return null;
        });

      if (conflict?.taken) {
        // The decision is the user's; the dialog carries what is known about
        // who holds the port and what can be done about it.
        setPortAsk({ project, command, conflict });
        return;
      }
      await startCommand(project, command);
    },
    [running, startCommand, stopCommand, flash, t],
  );

  /**
   * Frees the port and starts the waiting command.
   *
   * A command this app started is stopped through the runner that owns it. A
   * process it did not start is ended by the backend, which resolves the holder
   * itself and refuses system processes — only the port number is sent.
   */
  const resolvePortAndStart = useCallback(async () => {
    const ask = portAsk;
    if (!ask) return;
    setPortAsk(null);

    const { holder, port } = ask.conflict;
    if (holder) {
      const [, cwd = "", cmd = ""] = holder.key.split("|");
      try {
        await api.stopCommand(holder.projectId, cmd, cwd);
        setRunning((prev) => {
          const next = new Set(prev);
          next.delete(holder.key);
          return next;
        });
      } catch (e) {
        flash(`${t.cmdFailed}: ${e}`);
        return;
      }
      // A socket is not released the instant the process is asked to stop.
      await new Promise((r) => setTimeout(r, 400));
    } else {
      try {
        const name = await api.freePort(port);
        flash(`${name} — ${t.portFreed} :${port}`);
      } catch (e) {
        flash(String(e));
        return;
      }
    }
    await startCommand(ask.project, ask.command);
  }, [portAsk, startCommand, flash, t]);

  const startAnyway = useCallback(async () => {
    const ask = portAsk;
    if (!ask) return;
    setPortAsk(null);
    await startCommand(ask.project, ask.command);
  }, [portAsk, startCommand]);

  /**
   * Runs the command on the free port next door instead, leaving whatever holds
   * the wanted one alone. Usually the answer nobody has to think about.
   */
  const startOnFreePort = useCallback(async () => {
    const ask = portAsk;
    if (!ask?.conflict.suggestedPort) return;
    setPortAsk(null);
    await startCommand(ask.project, ask.command, ask.conflict.suggestedPort);
    flash(`${ask.command.name} → :${ask.conflict.suggestedPort}`);
  }, [portAsk, startCommand, flash]);

  // --- git sync -------------------------------------------------------------
  /** Pulls the backend's refreshed copy of the projects into the UI. */
  const reloadProjects = useCallback(async () => {
    setProjects(await api.cachedProjects());
  }, []);

  const checkRemoteFor = useCallback(
    async (projectId: string) => {
      setSyncBusy(true);
      try {
        const status = await api.gitFetch(projectId);
        setSync(status);
        await reloadProjects();
        if (status.error) notify("warn", t.syncFetchFailed, status.error);
      } catch (e) {
        notify("error", t.syncFetchFailed, String(e));
      } finally {
        setSyncBusy(false);
      }
    },
    [notify, reloadProjects, t],
  );

  /**
   * Reads the state from disk, opens the dialog on it, and only then goes to
   * the remote - and only when what it read is stale.
   *
   * `behind` is counted against a ref that moves on a fetch and at no other
   * time, so a number from last month is not an answer to "am I behind". One
   * from today is, and re-fetching it would be a round trip nobody asked for.
   */
  const openSync = useCallback(
    async (project: Project) => {
      setSyncFor(project.id);
      setSyncReport(null);
      setSync(null);

      const status = await api.gitSyncStatus(project.id);
      setSync(status);

      const stale = status.fetchDays === null || status.fetchDays >= 1;
      const worth = status.state !== "not-a-repo" && status.state !== "no-remote";
      if (stale && worth) await checkRemoteFor(project.id);
    },
    [checkRemoteFor],
  );

  const closeSync = useCallback(() => {
    setSyncFor("");
    setSync(null);
    setSyncReport(null);
  }, []);

  const checkRemote = useCallback(async () => {
    if (syncFor) await checkRemoteFor(syncFor);
  }, [syncFor, checkRemoteFor]);

  /**
   * Fetches every project that has a remote.
   *
   * This is what makes the badge in the list worth anything: without it a
   * project is only as behind as it was the last time somebody happened to
   * fetch it by hand, which for most of them is the day they were cloned.
   */
  const checkAllRemotes = useCallback(async () => {
    setSyncBusy(true);
    try {
      const all = await api.gitFetchAll();
      await reloadProjects();

      const behind = all.filter((s) => s.behind > 0);
      const failed = all.filter((s) => s.error);
      if (behind.length === 0) {
        notify(
          "success",
          t.syncAllCurrent,
          failed.length ? `${failed.length} · ${t.syncFetchFailed}` : undefined,
        );
      } else {
        // Naming them is the point: the summary is what sends the user to the
        // project that has moved, rather than to a number.
        notify(
          "warn",
          `${behind.length} ${t.syncBehindSummary}`,
          behind
            .slice(0, 6)
            .map((s) => `${s.project} ↓${s.behind}`)
            .join(" · "),
          true,
        );
      }
    } catch (e) {
      notify("error", t.syncFetchFailed, String(e));
    } finally {
      setSyncBusy(false);
      setSyncNote("");
    }
  }, [notify, reloadProjects, t]);

  /** What to say about a finished attempt, by outcome. */
  const reportNotice = useCallback(
    (report: RebaseReport) => {
      switch (report.outcome) {
        case "up-to-date":
          return notify("info", t.syncUpToDate);
        case "fast-forward":
          return notify("success", t.syncFfDone, report.status.branch, true);
        case "rebased":
          return notify("success", t.syncRebasedDone, report.status.branch, true);
        case "conflict":
          return notify("warn", t.syncConflictNote, report.conflicts.join(", "), true);
        case "stash-conflict":
          return notify("warn", t.syncStashConflictB, report.conflicts.join(", "), true);
        case "aborted":
          return notify("info", t.syncAbortedNote);
        default:
          return notify("error", t.syncFailedNote, report.output);
      }
    },
    [notify, t],
  );

  const runRebase = useCallback(
    async (attempt: (id: string) => Promise<RebaseReport>) => {
      if (!syncFor) return;
      setSyncBusy(true);
      try {
        const report = await attempt(syncFor);
        setSyncReport(report);
        setSync(report.status);
        await reloadProjects();
        reportNotice(report);
      } catch (e) {
        notify("error", t.syncFailedNote, String(e));
      } finally {
        setSyncBusy(false);
      }
    },
    [syncFor, notify, reloadProjects, reportNotice, t],
  );

  const rebaseProject = useCallback(() => runRebase(api.gitRebase), [runRebase]);
  const abortRebase = useCallback(() => runRebase(api.gitRebaseAbort), [runRebase]);

  useEffect(() => {
    checkAllRef.current = checkAllRemotes;
  }, [checkAllRemotes]);

  // --- goals --------------------------------------------------------------
  const addGoal = useCallback(
    (project: string, title: string) => {
      if (!title.trim()) return;
      commitGoals([
        ...goals,
        { id: newId("g"), project, title: title.trim(), sub: "", features: [] },
      ]);
    },
    [goals, commitGoals],
  );

  const removeGoal = useCallback(
    (id: string) => commitGoals(goals.filter((g) => g.id !== id)),
    [goals, commitGoals],
  );

  const addFeature = useCallback(
    (goalId: string, title: string) => {
      if (!title.trim()) return;
      const feature: Feature = { id: newId("f"), title: title.trim(), done: false, est: "" };
      commitGoals(
        goals.map((g) => (g.id === goalId ? { ...g, features: [...g.features, feature] } : g)),
      );
    },
    [goals, commitGoals],
  );

  const toggleFeature = useCallback(
    (goalId: string, featureId: string) => {
      commitGoals(
        goals.map((g) =>
          g.id === goalId
            ? {
                ...g,
                features: g.features.map((f) =>
                  f.id === featureId ? { ...f, done: !f.done } : f,
                ),
              }
            : g,
        ),
      );
    },
    [goals, commitGoals],
  );

  const removeFeature = useCallback(
    (goalId: string, featureId: string) => {
      commitGoals(
        goals.map((g) =>
          g.id === goalId ? { ...g, features: g.features.filter((f) => f.id !== featureId) } : g,
        ),
      );
    },
    [goals, commitGoals],
  );

  // --- notes --------------------------------------------------------------
  const addNote = useCallback(
    (project: string) => {
      const z = notes.reduce((a, n) => Math.max(a, n.z), 0) + 1;
      commitNotes(
        [
          ...notes,
          {
            id: newId("n"),
            x: 40 + (notes.length % 6) * 40,
            y: 40 + (notes.length % 4) * 36,
            project,
            text: "",
            due: "",
            color: "paper" as NoteColor,
            z,
          },
        ],
        true,
      );
    },
    [notes, commitNotes],
  );

  const patchNote = useCallback(
    (id: string, partial: Partial<Note>, immediate = false) => {
      commitNotes(
        notes.map((n) => (n.id === id ? { ...n, ...partial } : n)),
        immediate,
      );
    },
    [notes, commitNotes],
  );

  const removeNote = useCallback(
    (id: string) => commitNotes(notes.filter((n) => n.id !== id), true),
    [notes, commitNotes],
  );

  const raiseNote = useCallback(
    (id: string) => {
      const z = notes.reduce((a, n) => Math.max(a, n.z), 0) + 1;
      setNotes((prev) => prev.map((n) => (n.id === id ? { ...n, z } : n)));
    },
    [notes],
  );

  return {
    // data
    settings,
    projects,
    goals,
    notes,
    current,
    // docker and toolchains
    docker,
    refreshDocker,
    containers,
    requirements,
    refreshProjectEnv,
    installing,
    installTool,
    // i18n / theme
    t,
    lang,
    theme,
    resolvedTheme,
    // view
    view,
    setView,
    selId,
    openProject,
    navOpen,
    toggleNav,
    favourites,
    toggleFavourite,
    favouritesOnly,
    toggleFavouritesOnly,
    setOsNotifications,
    isCollapsed,
    toggleGroup,
    openTag,
    maxed,
    toggleMax,
    // list controls
    q,
    setQ,
    stack,
    setStack,
    sort,
    setSort,
    // cleaner
    cat,
    setCat,
    onlyOld,
    setOnlyOld,
    onlyBig,
    setOnlyBig,
    allCleanRows,
    pickedSet,
    toggleClean,
    setCleanSelection,
    selectedRows,
    selectedBytes,
    confirmOpen,
    setConfirmOpen,
    cleanProgress,
    doClean,
    ruleDraft,
    setRuleDraft,
    // goals
    goalSel,
    setGoalSel,
    goalsFor,
    goalRatio,
    addGoal,
    removeGoal,
    addFeature,
    toggleFeature,
    removeFeature,
    // board
    boardFilter,
    setBoardFilter,
    addNote,
    patchNote,
    removeNote,
    raiseNote,
    // commands
    cmdSel,
    setCmdSel,
    running,
    toggleCommand,
    cmdFavourites,
    toggleCmdFavourite,
    logs,
    logTab,
    setLogTab,
    closeLog,
    processes,
    refreshProcesses,
    stopProcess,
    stopping,
    portAsk,
    dismissPortAsk: () => setPortAsk(null),
    // git sync
    syncFor,
    sync,
    syncReport,
    syncBusy,
    syncNote,
    openSync,
    closeSync,
    checkRemote,
    checkAllRemotes,
    rebaseProject,
    abortRebase,
    resolvePortAndStart,
    startAnyway,
    startOnFreePort,
    clearLog,
    // chrome
    notices,
    notify,
    dismissNotice,
    flash,
    scanning,
    scanNote,
    scanRot,
    elapsedMs,
    rss,
    rescan,
    patchSettings,
  };
}

export type App = ReturnType<typeof useApp>;
