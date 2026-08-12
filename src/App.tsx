import { useEffect } from "react";

import { ConfirmDialog } from "./components/ConfirmDialog";
import { Sidebar } from "./components/Sidebar";
import { StatusBar } from "./components/StatusBar";
import { TitleBar } from "./components/TitleBar";
import { Toast } from "./components/Toast";
import { isOverdue, projectCount, size } from "./format";
import { BoardView } from "./views/BoardView";
import { CleanView } from "./views/CleanView";
import { CommandsView } from "./views/CommandsView";
import { DetailView } from "./views/DetailView";
import { GoalsView } from "./views/GoalsView";
import { ProjectsView } from "./views/ProjectsView";
import { SettingsView } from "./views/SettingsView";
import { useApp } from "./useApp";

export function App() {
  const app = useApp();
  const { t, lang, settings, projects, view } = app;

  // The theme lives on <html> so the scrollbars and the backdrop pick it up.
  useEffect(() => {
    document.documentElement.setAttribute("data-theme", app.resolvedTheme);
  }, [app.resolvedTheme]);

  useEffect(() => {
    document.documentElement.lang = lang;
  }, [lang]);

  if (!settings) {
    return (
      <div
        style={{
          height: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "var(--bg)",
          color: "rgba(var(--trgb),.5)",
          fontSize: 12.5,
        }}
      >
        {t.scanning}
      </div>
    );
  }

  const totalSize = projects.reduce((a, p) => a + p.sizeBytes, 0);
  const totalReclaim = projects.reduce((a, p) => a + p.reclaimBytes, 0);
  const goalProject = projects.find((p) => p.id === app.goalSel) ?? projects[0];
  const goalRatio = goalProject ? app.goalRatio(goalProject.id) : { all: 0, done: 0, pct: 0 };
  const cmdProject =
    projects.find((p) => p.id === app.cmdSel) ?? projects.find((p) => p.commands.length);
  const overdue = app.notes.filter((n) => isOverdue(n.due)).length;

  const heads: Record<typeof view, { kicker: string; title: string; meta: string }> = {
    projects: {
      kicker: t.navProjects,
      title: t.navProjects,
      meta: `${projectCount(projects.length, t)} · ${size(totalSize)} · ${size(totalReclaim)} ${t.reclaimable}`,
    },
    detail: {
      kicker: app.current ? `${app.current.stack} · ${app.current.git.branch || "—"}` : "",
      title: app.current?.name ?? "—",
      meta: app.current?.path ?? "",
    },
    clean: {
      kicker: t.navClean,
      title: lang === "hu" ? "Build szemét és cache" : "Build junk and caches",
      meta: `${size(totalReclaim)} ${t.totalL} · ${app.allCleanRows.length} ${t.dirsL}`,
    },
    goals: {
      kicker: t.navGoals,
      title: goalProject?.name ?? "—",
      meta: `${goalRatio.done} / ${goalRatio.all} ${lang === "hu" ? "funkció kész" : "features done"}`,
    },
    board: {
      kicker: t.navBoard,
      title: lang === "hu" ? "Cetlik és határidők" : "Notes and deadlines",
      meta: `${app.notes.length} note · ${overdue} ${t.overdue.toLowerCase()}`,
    },
    cmd: {
      kicker: t.navCmd,
      title: cmdProject?.name ?? "—",
      meta: `${cmdProject?.commands.length ?? 0} ${t.cmdL} · ${app.running.size} ${t.runningL}`,
    },
    set: {
      kicker: t.navSet,
      title: t.navSet,
      meta: `${settings.folders.length} ${t.watchedFolders}`,
    },
  };

  const head = heads[view];

  return (
    <div
      data-theme={app.resolvedTheme}
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100vh",
        background: "var(--bg)",
        color: "var(--t0)",
        overflow: "hidden",
        position: "relative",
      }}
    >
      <div
        style={{
          position: "absolute",
          inset: "0 0 auto",
          height: 180,
          background: "var(--sheen)",
          pointerEvents: "none",
          zIndex: 1,
        }}
      />

      <TitleBar app={app} />

      <div style={{ flex: 1, minHeight: 0, display: "flex", position: "relative", zIndex: 2 }}>
        <Sidebar app={app} />

        <main style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
          <div
            style={{
              flex: "0 0 auto",
              padding: "18px 20px 14px",
              display: "flex",
              alignItems: "flex-end",
              gap: 16,
            }}
          >
            <div style={{ flex: 1, minWidth: 0 }}>
              <div
                style={{
                  fontSize: 10.5,
                  letterSpacing: ".1em",
                  textTransform: "uppercase",
                  color: "rgba(var(--trgb),.56)",
                  fontWeight: 500,
                  marginBottom: 5,
                }}
              >
                {head.kicker}
              </div>
              <div
                style={{
                  fontSize: 25,
                  fontWeight: 600,
                  lineHeight: 1.05,
                  letterSpacing: "-.028em",
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                }}
              >
                {head.title}
              </div>
            </div>
            <div
              style={{
                fontFamily: "'JetBrains Mono',monospace",
                fontSize: 10.5,
                color: "rgba(var(--trgb),.56)",
                textAlign: "right",
                whiteSpace: "nowrap",
                paddingBottom: 4,
                overflow: "hidden",
                textOverflow: "ellipsis",
                maxWidth: "50%",
              }}
              title={head.meta}
            >
              {head.meta}
            </div>
          </div>

          <div style={{ flex: 1, minHeight: 0, overflow: "auto", position: "relative" }}>
            {view === "projects" && <ProjectsView app={app} />}
            {view === "detail" && <DetailView app={app} />}
            {view === "clean" && <CleanView app={app} />}
            {view === "goals" && <GoalsView app={app} />}
            {view === "board" && <BoardView app={app} />}
            {view === "cmd" && <CommandsView app={app} />}
            {view === "set" && <SettingsView app={app} />}
          </div>

          <StatusBar app={app} />
        </main>
      </div>

      <ConfirmDialog app={app} />
      <Toast message={app.toast} />
    </div>
  );
}
