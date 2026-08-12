import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import * as api from "./api";
import { dict, type T } from "./i18n";
import { bindToProjects, cmdKey, isExcluded, newId, size, todayIso } from "./format";
import type {
  CleanProgress,
  CommandDef,
  DockerUsage,
  Feature,
  Goal,
  Lang,
  LogLine,
  Note,
  NoteColor,
  Project,
  Settings,
  Theme,
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
  set: 840,
};

const NAV_OPEN = 214;
const NAV_CLOSED = 58;
const MAX_LOG_LINES = 200;
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
  const [docker, setDocker] = useState<DockerUsage | null>(null);

  // --- goals / board / commands ------------------------------------------
  const [goalSel, setGoalSel] = useState("");
  const [boardFilter, setBoardFilter] = useState("all");
  const [cmdSel, setCmdSel] = useState("");
  const [running, setRunning] = useState<Set<string>>(new Set());
  const [log, setLog] = useState<LogEntry[]>([]);

  // --- chrome -------------------------------------------------------------
  const [toast, setToast] = useState("");
  const [scanning, setScanning] = useState(false);
  const [scanNote, setScanNote] = useState("");
  const [elapsedMs, setElapsedMs] = useState(0);
  const [rss, setRss] = useState(0);
  const [sysLight, setSysLight] = useState(false);
  const [busy, setBusy] = useState(false);

  const toastTimer = useRef<number | undefined>(undefined);
  const saveTimer = useRef<number | undefined>(undefined);

  const lang: Lang = settings?.lang ?? "hu";
  const theme: Theme = settings?.theme ?? "auto";
  const t: T = useMemo(() => dict(lang), [lang]);
  const resolvedTheme = theme === "auto" ? (sysLight ? "light" : "dark") : theme;
  const navOpen = !(settings?.navCollapsed ?? false);

  const flash = useCallback((message: string) => {
    setToast(message);
    window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(""), 3200);
  }, []);

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
      window.clearTimeout(toastTimer.current);
      window.clearTimeout(saveTimer.current);
    };
    // Boot runs once; `rescan` is stable enough for this single call.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
      setLog((prev) => [...prev, { time: line.time, text: line.text, fg: logColour(line) }].slice(-MAX_LOG_LINES));
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

  // --- docker ---------------------------------------------------------
  useEffect(() => {
    if (!settings?.toggles.docker) {
      setDocker(null);
      return;
    }
    let alive = true;
    void api.dockerUsage().then((usage) => alive && setDocker(usage));
    return () => {
      alive = false;
    };
  }, [settings?.toggles.docker]);

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
        setPicked(null);
        rebindSavedData(result.projects);
        const d = dict(active.lang);
        flash(
          `${d.rescanToast} ${result.projects.length} ${d.rescanIn} · ${(result.elapsedMs / 1000).toFixed(1)} s`,
        );
      } catch (e) {
        flash(String(e));
      } finally {
        setScanning(false);
        setScanNote("");
      }
    },
    [settings, flash],
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

  const allCleanRows = useMemo(
    () => projects.flatMap((p) => p.cleanTargets).sort((a, b) => b.bytes - a.bytes),
    [projects],
  );

  /**
   * Selection defaults to everything older than the configured threshold, minus
   * whatever the exclusion rules protect.
   */
  const pickedSet = useMemo(() => {
    if (picked) return picked;
    const auto: Record<string, boolean> = {};
    const threshold = settings?.ageDays ?? 30;
    const rules = settings?.rules ?? [];
    for (const row of allCleanRows) {
      if (row.ageDays >= threshold && !isExcluded(row, rules)) auto[row.key] = true;
    }
    return auto;
  }, [picked, allCleanRows, settings?.ageDays, settings?.rules]);

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

  const toggleMax = useCallback(async () => {
    setMaxed(await api.toggleMaximizeWindow());
  }, []);

  const toggleClean = useCallback((key: string) => {
    setPicked((prev) => {
      const base = prev ?? pickedSet;
      return { ...base, [key]: !base[key] };
    });
  }, [pickedSet]);

  /**
   * Ticks or unticks the rows currently on screen. Rows hidden by a filter are
   * left as they are, so switching category never silently drops a selection
   * the user cannot see.
   */
  const setCleanSelection = useCallback(
    (rows: { key: string }[], on: boolean) => {
      setPicked((prev) => {
        const next = { ...(prev ?? pickedSet) };
        for (const r of rows) next[r.key] = on;
        return next;
      });
    },
    [pickedSet],
  );

  const doClean = useCallback(async () => {
    // The dialog stays open and turns into a progress view: a cleanup can run
    // for a while, and closing it would leave the user with no feedback.
    setBusy(true);
    setCleanProgress({ phase: "delete", done: 0, total: selectedRows.length, current: "", freedBytes: 0 });
    try {
      const keys = selectedRows.map((r) => r.key);
      const report = await api.deleteTargets(keys);
      const fresh = await api.cachedProjects();
      setProjects(fresh);
      setPicked({});

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

      if (report.errors.length) {
        flash(`${t.cleanFailed}: ${report.errors[0]}`);
      } else {
        flash(
          `${size(report.freedBytes)} ${t.freedToast} · ${report.removed.length} ${t.removedDirs}`,
        );
      }
    } catch (e) {
      flash(`${t.deleteFailed}: ${e}`);
    } finally {
      setBusy(false);
      setCleanProgress(null);
      setConfirmOpen(false);
    }
  }, [selectedRows, settings, patchSettings, flash, t]);

  const toggleCommand = useCallback(
    async (project: Project, command: CommandDef) => {
      const key = cmdKey(project.id, command);
      const isRunning = running.has(key);
      try {
        if (isRunning) {
          await api.stopCommand(project.id, command.cmd, command.cwd);
          setRunning((prev) => {
            const next = new Set(prev);
            next.delete(key);
            return next;
          });
        } else {
          await api.runCommand(project.id, command.cmd, command.cwd);
          setRunning((prev) => new Set(prev).add(key));
        }
      } catch (e) {
        flash(`${t.cmdFailed}: ${e}`);
      }
    },
    [running, flash, t],
  );

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
    docker,
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
    log,
    clearLog: () => setLog([]),
    // chrome
    toast,
    flash,
    scanning,
    scanNote,
    scanRot,
    elapsedMs,
    rss,
    busy,
    rescan,
    patchSettings,
  };
}

export type App = ReturnType<typeof useApp>;
