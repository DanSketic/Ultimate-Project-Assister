// What is running, what it belongs to, and what it is costing.
//
// Not a task manager: only processes this app started, processes holding a
// port, and processes working inside a known project. Everything else on the
// machine is somebody else's problem while you are looking at your projects.

import { useMemo } from "react";

import { FolderHeader } from "../components/GroupHeader";
import { RefreshAction } from "../components/Requirements";
import { Stop } from "../components/Icons";
import { duration, size } from "../format";
import type { App } from "../useApp";
import type { ProcessInfo } from "../types";

const mono = "'JetBrains Mono',monospace";
const GRID = "minmax(190px,1fr) 128px 96px 92px 74px 86px";

export function ProcessesView({ app }: { app: App }) {
  const { t, processes } = app;

  /**
   * Grouped by project, with everything that belongs to none of them last.
   * A dev server is only interesting because of what it is serving, and that
   * is the project it sits in.
   */
  const groups = useMemo(() => {
    if (!processes) return [];
    const byProject = new Map<string, ProcessInfo[]>();
    for (const p of processes) {
      const key = p.projectId || "";
      const list = byProject.get(key);
      if (list) list.push(p);
      else byProject.set(key, [p]);
    }

    return [...byProject.entries()]
      .map(([key, items]) => ({
        key: key || "__other__",
        label: items[0]?.project || t.otherProcesses,
        orphan: !key,
        items,
        memory: items.reduce((total, p) => total + p.memoryBytes, 0),
        ports: items.flatMap((p) => p.ports),
      }))
      .sort((a, b) => Number(a.orphan) - Number(b.orphan) || b.memory - a.memory);
  }, [processes, t.otherProcesses]);

  if (processes === null) {
    return <Note text={t.checking} />;
  }
  if (processes.length === 0) {
    return <Note text={t.noProcesses} />;
  }

  const total = processes.reduce((sum, p) => sum + p.memoryBytes, 0);

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        minHeight: 0,
        height: "100%",
        padding: "0 20px 20px",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          padding: "0 12px 8px",
          flex: "0 0 auto",
        }}
      >
        <span style={{ fontSize: 11.5, color: "rgba(var(--trgb),.55)" }}>
          {processes.length} {t.processesRunning} · {size(total)}
        </span>
        <span style={{ marginLeft: "auto" }}>
          <RefreshAction onClick={() => void app.refreshProcesses()} title={t.recheck} />
        </span>
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: GRID,
          gap: 10,
          padding: "0 12px 6px",
          fontSize: 10,
          letterSpacing: ".07em",
          textTransform: "uppercase",
          color: "rgba(var(--trgb),.5)",
          flex: "0 0 auto",
        }}
      >
        <div>{t.colProcess}</div>
        <div>{t.colPorts}</div>
        <div style={{ textAlign: "right" }}>{t.colMemory}</div>
        <div style={{ textAlign: "right" }}>{t.colUptime}</div>
        <div style={{ textAlign: "right" }}>PID</div>
        <div />
      </div>

      <div style={{ overflow: "auto", minHeight: 0, paddingBottom: 10 }}>
        {groups.map((group) => (
          <div key={group.key}>
            {/* Processes belonging to no project start folded: they are
                context for the ones that do, not the thing being looked at. */}
            <FolderHeader
              label={group.label}
              title={group.orphan ? t.otherProcesses : group.label}
              collapsed={app.isCollapsed("procs", group.key, group.orphan)}
              onToggle={() => app.toggleGroup("procs", group.key, group.orphan)}
            >
              <span style={{ fontFamily: mono, fontSize: 10, color: "rgba(var(--trgb),.45)" }}>
                {group.ports.length ? group.ports.map((p) => `:${p}`).join(" ") : ""}
              </span>
              <span style={{ fontFamily: mono, fontSize: 11, fontWeight: 500 }}>
                {size(group.memory)}
              </span>
            </FolderHeader>

            {!app.isCollapsed("procs", group.key, group.orphan) &&
              group.items.map((p) => <Row key={p.pid} process={p} app={app} />)}
          </div>
        ))}
      </div>
    </div>
  );
}

function Row({ process: p, app }: { process: ProcessInfo; app: App }) {
  const { t } = app;
  const busy = app.stopping.has(p.pid);
  // Ours are the ones the user is answerable for; the rest are context.
  const ours = !!p.commandKey;

  return (
    <div
      className="h-soft"
      style={{
        display: "grid",
        gridTemplateColumns: GRID,
        gap: 10,
        alignItems: "center",
        padding: "8px 12px",
        borderRadius: 10,
        borderTop: "1px solid rgba(var(--wrgb),.05)",
      }}
      title={p.cmd || p.exe}
    >
      <span style={{ minWidth: 0, display: "flex", alignItems: "center", gap: 8 }}>
        <span
          style={{
            width: 6,
            height: 6,
            flex: "0 0 6px",
            borderRadius: 99,
            background: ours ? "var(--acc)" : "rgba(var(--trgb),.3)",
            boxShadow: ours ? "0 0 8px rgba(var(--accrgb),.7)" : undefined,
          }}
        />
        <span style={{ minWidth: 0 }}>
          <span
            style={{
              display: "block",
              fontSize: 12.5,
              fontWeight: 500,
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
            }}
          >
            {p.name}
          </span>
          <span
            style={{
              display: "block",
              fontFamily: mono,
              fontSize: 9.5,
              color: "rgba(var(--trgb),.44)",
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
            }}
          >
            {/* What it is, in the terms that identify it: the command this app
                started, or the command line it was launched with. */}
            {ours ? p.commandKey.split("|").slice(2).join("|") : p.cmd || p.cwd}
          </span>
        </span>
      </span>

      <span style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
        {p.ports.map((port) => (
          <span
            key={port}
            style={{
              fontFamily: mono,
              fontSize: 9.5,
              fontWeight: 500,
              border: "1px solid rgba(var(--coolrgb),.35)",
              background: "rgba(var(--coolrgb),.12)",
              color: "rgba(var(--trgb),.75)",
              borderRadius: 99,
              padding: "1px 7px",
            }}
          >
            :{port}
          </span>
        ))}
      </span>

      <span style={{ textAlign: "right", fontFamily: mono, fontSize: 11.5, fontWeight: 500 }}>
        {size(p.memoryBytes)}
      </span>
      <span style={{ textAlign: "right", fontFamily: mono, fontSize: 10.5, color: "rgba(var(--trgb),.55)" }}>
        {duration(p.runSecs, app.lang)}
      </span>
      <span style={{ textAlign: "right", fontFamily: mono, fontSize: 10, color: "rgba(var(--trgb),.42)" }}>
        {p.pid}
      </span>

      <span style={{ display: "flex", justifyContent: "flex-end" }}>
        {p.killable ? (
          <button
            type="button"
            className="h-danger"
            disabled={busy}
            onClick={() => void app.stopProcess(p)}
            title={`${t.stop} ${p.name} · PID ${p.pid}`}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 5,
              border: "1px solid rgba(var(--danrgb),.4)",
              borderRadius: 8,
              background: "rgba(var(--danrgb),.1)",
              color: "var(--danTx2)",
              padding: "4px 9px",
              cursor: busy ? "default" : "pointer",
              fontSize: 10.5,
              fontWeight: 600,
              opacity: busy ? 0.55 : 1,
            }}
          >
            <Stop size={7} />
            {t.stop}
          </button>
        ) : (
          // A system process is listed for context and nothing else.
          <span style={{ fontSize: 9.5, color: "rgba(var(--trgb),.35)" }}>{t.systemProcess}</span>
        )}
      </span>
    </div>
  );
}

function Note({ text }: { text: string }) {
  return (
    <div style={{ padding: "24px 14px", fontSize: 12.5, color: "rgba(var(--trgb),.5)" }}>{text}</div>
  );
}
