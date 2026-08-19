import type { ReactNode } from "react";

import { isOverdue, size } from "../format";
import {
  Activity,
  Folder,
  PanelLeft,
  Refresh,
  Sliders,
  Spark,
  StickyNote,
  Target,
  Terminal,
  Trash,
} from "./Icons";
import type { App } from "../useApp";
import type { View } from "../types";

export function Sidebar({ app }: { app: App }) {
  const { t, view, navOpen, projects, notes, running } = app;

  const navWidth = navOpen ? 214 : 58;
  // The rail follows the anchored window edge, so its divider and the collapse
  // arrow have to face the content rather than always pointing left.
  const onRight = app.settings?.anchor === "right";
  const pad = navOpen ? "8px 9px" : "8px 0";
  const justify = navOpen ? "flex-start" : "center";

  const cell = (k: View) => ({
    background: view === k ? "rgba(var(--wrgb),.075)" : "transparent",
    color: view === k ? "var(--t0)" : "rgba(var(--trgb),.55)",
  });

  const totalReclaim = projects.reduce((a, p) => a + p.reclaimBytes, 0);
  const openFeatures = projects.reduce((a, p) => {
    const r = app.goalRatio(p.id);
    return a + (r.all - r.done);
  }, 0);
  const withDue = notes.filter((n) => n.due).length;
  const anyOverdue = notes.some((n) => isOverdue(n.due));

  const item = (key: View, icon: ReactNode, label: string, badge?: ReactNode) => (
    <button
      type="button"
      className="h-nav"
      onClick={() => app.setView(key)}
      title={navOpen ? undefined : label}
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: justify,
        gap: 11,
        padding: pad,
        border: 0,
        borderRadius: 9,
        cursor: "pointer",
        textAlign: "left",
        transition: "background 140ms",
        ...cell(key),
      }}
    >
      {icon}
      {navOpen && (
        <span style={{ display: "flex", alignItems: "center", gap: 8, flex: 1, minWidth: 0 }}>
          <span style={{ fontSize: 13, fontWeight: 500, whiteSpace: "nowrap", flex: 1 }}>
            {label}
          </span>
          {badge}
        </span>
      )}
    </button>
  );

  const mono = (color = "rgba(var(--trgb),.54)", weight = 400) => ({
    fontFamily: "'JetBrains Mono',monospace",
    fontSize: 10,
    color,
    fontWeight: weight,
  });

  return (
    <nav
      style={{
        flex: "0 0 auto",
        [onRight ? "borderLeft" : "borderRight"]: "1px solid rgba(var(--wrgb),.07)",
        display: "flex",
        flexDirection: "column",
        transition: "width 300ms cubic-bezier(.2,.7,.25,1)",
        overflow: "hidden",
        padding: "10px 8px",
        gap: 2,
        width: navWidth,
      }}
    >
      <button
        type="button"
        className="h-nav-toggle"
        onClick={app.toggleNav}
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: justify,
          gap: 11,
          padding: pad,
          border: 0,
          borderRadius: 9,
          background: "transparent",
          color: "rgba(var(--trgb),.4)",
          cursor: "pointer",
          textAlign: "left",
          marginBottom: 6,
        }}
      >
        <PanelLeft
          size={16}
          style={{ flex: "0 0 16px", transform: onRight ? "scaleX(-1)" : undefined }}
        />
        {navOpen && (
          <span style={{ fontSize: 11, letterSpacing: ".02em", whiteSpace: "nowrap", flex: 1 }}>
            {t.collapse}
          </span>
        )}
      </button>

      {item(
        "projects",
        <Folder size={16} style={{ flex: "0 0 16px" }} />,
        t.navProjects,
        <span style={mono()}>{projects.length}</span>,
      )}
      {item(
        "clean",
        <Trash size={16} style={{ flex: "0 0 16px" }} />,
        t.navClean,
        <span style={mono("var(--danTx)", 500)}>{size(totalReclaim)}</span>,
      )}
      {item(
        "goals",
        <Target size={16} style={{ flex: "0 0 16px" }} />,
        t.navGoals,
        <span style={mono()}>{openFeatures}</span>,
      )}
      {item(
        "board",
        <StickyNote size={16} style={{ flex: "0 0 16px" }} />,
        t.navBoard,
        <span style={mono(anyOverdue ? "var(--danTx)" : "rgba(var(--trgb),.54)", 500)}>
          {withDue}
        </span>,
      )}
      {item(
        "cmd",
        <Terminal size={16} style={{ flex: "0 0 16px" }} />,
        t.navCmd,
        <span
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 5,
            fontFamily: "'JetBrains Mono',monospace",
            fontSize: 10,
            fontWeight: 500,
            color: "var(--acc)",
          }}
        >
          <span
            style={{
              width: 5,
              height: 5,
              borderRadius: 99,
              background: running.size ? "var(--acc)" : "rgba(var(--trgb),.25)",
              animation: running.size ? "upaPulse 1.8s infinite" : undefined,
            }}
          />
          {running.size}
        </span>,
      )}
      {item(
        "procs",
        <Activity size={16} style={{ flex: "0 0 16px" }} />,
        t.processes,
        <span style={mono()}>{app.processes?.length ?? ""}</span>,
      )}
      {item(
        "claude",
        <Spark size={16} style={{ flex: "0 0 16px" }} />,
        t.navClaude,
        <span style={mono()}>{app.claude?.sessions.length ?? ""}</span>,
      )}

      {/* Settings sits at the foot with Rescan rather than among the views:
          both are things you do to the app, not places in it. */}
      <div style={{ marginTop: "auto", display: "flex", flexDirection: "column", gap: 8 }}>
        <button
          type="button"
          className="h-accent"
          onClick={() => void app.rescan()}
          disabled={app.scanning}
          title={t.rescan}
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: justify,
            gap: 9,
            padding: pad,
            border: "1px solid rgba(var(--wrgb),.1)",
            borderRadius: 9,
            background: "rgba(var(--wrgb),.03)",
            color: "rgba(var(--trgb),.75)",
            cursor: app.scanning ? "progress" : "pointer",
            textAlign: "left",
          }}
        >
          <Refresh
            size={14}
            style={{
              flex: "0 0 14px",
              transform: `rotate(${app.scanRot}deg)`,
              transition: "transform 800ms cubic-bezier(.2,.7,.25,1)",
            }}
          />
          {navOpen && (
            <span style={{ fontSize: 11.5, fontWeight: 500, whiteSpace: "nowrap", flex: 1 }}>
              {app.scanning ? t.scanning : t.rescan}
            </span>
          )}
        </button>

        {item("set", <Sliders size={16} style={{ flex: "0 0 16px" }} />, t.navSet)}
        {navOpen && (
          <div
            style={{
              fontFamily: "'JetBrains Mono',monospace",
              fontSize: 9.5,
              color: "rgba(var(--trgb),.44)",
              whiteSpace: "nowrap",
              overflow: "hidden",
              padding: "0 9px",
            }}
          >
            v{__APP_VERSION__} · {navigator.platform.includes("Win") ? "win-x64" : "desktop"}
          </div>
        )}
      </div>
    </nav>
  );
}
