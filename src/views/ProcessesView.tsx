// What is running, what it belongs to, and what it is costing.
//
// Not a task manager: only processes this app started, processes holding a
// port, and processes working inside a known project. Everything else on the
// machine is somebody else's problem while you are looking at your projects.
//
// Running Docker containers sit in the same groups: a project's database in a
// container is as much a part of what it is running as its dev server.

import { useMemo } from "react";

import { ChipGroup } from "../components/Chips";
import { FolderHeader } from "../components/GroupHeader";
import { RefreshAction } from "../components/Requirements";
import { Stop } from "../components/Icons";
import { duration, size } from "../format";
import type { App } from "../useApp";
import type { Container, ProcessInfo } from "../types";

const mono = "'JetBrains Mono',monospace";
const GRID = "minmax(190px,1fr) 128px 96px 92px 74px 86px";

export function ProcessesView({ app }: { app: App }) {
  const { t, procFilter, procPorts } = app;
  // The filtered list: what is shown, grouped and counted, is one and the same.
  const processes = app.visibleProcesses;
  const containers = app.visibleContainers;

  /**
   * Grouped by project, with everything that belongs to none of them last.
   * A dev server is only interesting because of what it is serving, and that
   * is the project it sits in.
   */
  const groups = useMemo(() => {
    if (!processes) return [];
    const byProject = new Map<string, { label: string; items: ProcessInfo[]; boxes: Container[] }>();
    const slot = (key: string, label: string) => {
      let group = byProject.get(key);
      if (!group) byProject.set(key, (group = { label, items: [], boxes: [] }));
      return group;
    };
    for (const p of processes) slot(p.projectId || "", p.project).items.push(p);
    for (const c of containers ?? []) slot(c.projectId || "", c.project).boxes.push(c);

    return [...byProject.entries()]
      .map(([key, { label, items, boxes }]) => ({
        key: key || "__other__",
        label: label || t.otherProcesses,
        orphan: !key,
        items,
        boxes,
        // Docker does not say what a container costs without a slow `stats`
        // call, so the total is the processes' alone.
        memory: items.reduce((total, p) => total + p.memoryBytes, 0),
        ports: [...items.flatMap((p) => p.ports), ...boxes.flatMap((c) => c.hostPorts)],
      }))
      .sort((a, b) => Number(a.orphan) - Number(b.orphan) || b.memory - a.memory);
  }, [processes, containers, t.otherProcesses]);

  if (processes === null) {
    return <Note text={t.checking} />;
  }

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
          // Two chip groups and a sentence: on a narrow window the sentence
          // moves to its own line rather than squeezing the chips.
          flexWrap: "wrap",
          padding: "0 12px 8px",
          flex: "0 0 auto",
        }}
      >
        {/* Everything on this machine is never the answer; the narrow list is
            the default, and the wide one is there when a stray port holder has
            to be found. */}
        <ChipGroup
          items={[
            { key: "direct", label: t.procsDirect },
            { key: "all", label: t.procsAll },
          ]}
          active={procFilter}
          onPick={app.setProcFilter}
        />
        {/* The other axis, and the one that answers "what is on that port":
            whether a process is holding one at all. */}
        <ChipGroup
          items={[
            { key: "any", label: t.procsPortAny },
            { key: "ports", label: t.procsWithPort },
            { key: "free", label: t.procsNoPort },
          ]}
          active={procPorts}
          onPick={app.setProcPorts}
        />
        {/* The count and the total are already in the page header; repeating
            them here would just be the same sentence twice. */}
        <span style={{ fontSize: 11, color: "rgba(var(--trgb),.42)" }}>{t.processesHint}</span>
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
        {groups.length === 0 && (
          <Note
            text={
              procPorts !== "any"
                ? t.noFilteredProcesses
                : procFilter === "direct"
                  ? t.noDirectProcesses
                  : t.noProcesses
            }
          />
        )}
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

            {!app.isCollapsed("procs", group.key, group.orphan) && (
              <>
                {group.items.map((p) => (
                  <Row key={p.pid} process={p} app={app} />
                ))}
                {group.boxes.map((c) => (
                  <ContainerRow key={c.id} container={c} app={app} />
                ))}
              </>
            )}
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

/**
 * A running container, in the same columns as a process: its ports, how long
 * it has been up, and its id where a process has its PID. Memory is left
 * blank rather than guessed.
 */
function ContainerRow({ container: c, app }: { container: Container; app: App }) {
  const { t } = app;
  const busy = app.stoppingContainers.has(c.id);

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
      title={`${c.image} · ${c.status}`}
    >
      <span style={{ minWidth: 0, display: "flex", alignItems: "center", gap: 8 }}>
        {/* Square rather than round: a container, not a process. */}
        <span
          style={{
            width: 6,
            height: 6,
            flex: "0 0 6px",
            borderRadius: 2,
            background: "rgba(var(--coolrgb),.8)",
          }}
        />
        <span style={{ minWidth: 0 }}>
          <span
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              fontSize: 12.5,
              fontWeight: 500,
              whiteSpace: "nowrap",
              overflow: "hidden",
            }}
          >
            <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{c.name}</span>
            <span
              style={{
                flex: "0 0 auto",
                fontSize: 9,
                fontWeight: 600,
                letterSpacing: ".04em",
                textTransform: "uppercase",
                color: "rgba(var(--trgb),.5)",
                border: "1px solid rgba(var(--coolrgb),.3)",
                borderRadius: 5,
                padding: "0 5px",
              }}
            >
              {t.containerL}
            </span>
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
            {c.service ? `${c.image} · ${c.service}` : c.image}
          </span>
        </span>
      </span>

      <span style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
        {c.hostPorts.map((port) => (
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

      <span style={{ textAlign: "right", fontFamily: mono, fontSize: 11.5, color: "rgba(var(--trgb),.35)" }}>
        —
      </span>
      <span style={{ textAlign: "right", fontFamily: mono, fontSize: 10.5, color: "rgba(var(--trgb),.55)" }}>
        {c.runSecs ? duration(c.runSecs, app.lang) : c.state}
      </span>
      <span
        style={{
          textAlign: "right",
          fontFamily: mono,
          fontSize: 10,
          color: "rgba(var(--trgb),.42)",
          overflow: "hidden",
          textOverflow: "ellipsis",
        }}
      >
        {c.id}
      </span>

      <span style={{ display: "flex", justifyContent: "flex-end" }}>
        <button
          type="button"
          className="h-danger"
          disabled={busy}
          onClick={() => void app.stopContainer(c)}
          title={`${t.stop} ${c.name}`}
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
      </span>
    </div>
  );
}

function Note({ text }: { text: string }) {
  return (
    <div style={{ padding: "24px 14px", fontSize: 12.5, color: "rgba(var(--trgb),.5)" }}>{text}</div>
  );
}
