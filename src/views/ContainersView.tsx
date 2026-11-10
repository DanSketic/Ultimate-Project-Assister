// Every Docker container on the machine, by the project it belongs to.
//
// Docker Desktop lists containers by compose stack, and a stack whose database
// has died just keeps going round: the rest of it fails on start, `always`
// brings it back, and it does so again after every reboot. Here a container
// is shown under its project - or its stack, when no project claims it - with
// what makes a crash loop visible: its state, how many times it has been
// restarted, its health, and the tail of its log. Stopping one makes the stop
// last, and a stack can be stopped or removed in one go.

import { useMemo } from "react";

import { ChipGroup } from "../components/Chips";
import { FolderHeader } from "../components/GroupHeader";
import { RefreshAction } from "../components/Requirements";
import { Play, Stop, Trash } from "../components/Icons";
import { duration } from "../format";
import type { App } from "../useApp";
import type { Container, ContainerAction } from "../types";

const mono = "'JetBrains Mono',monospace";
const GRID = "minmax(200px,1fr) 160px 90px 320px";

/** Failing: caught in a restart loop, or reporting itself unhealthy. */
export function isFailing(c: Container): boolean {
  return c.state === "restarting" || c.health === "unhealthy";
}

const isUp = (c: Container) => c.state === "running" || c.state === "restarting" || c.state === "paused";

export function ContainersView({ app }: { app: App }) {
  const { t, boxes, boxFilter } = app;

  const shown = useMemo(() => {
    if (!boxes) return boxes;
    return boxes.filter((c) => {
      if (boxFilter === "running") return c.state === "running" && !isFailing(c);
      if (boxFilter === "problem") return isFailing(c);
      if (boxFilter === "stopped") return !isUp(c);
      return true;
    });
  }, [boxes, boxFilter]);

  /**
   * By project, then by stack for what no project claims, then the rest.
   * Failing groups first - they are the reason anyone opens this view - then
   * the ones with something running, then by name.
   */
  const groups = useMemo(() => {
    const byKey = new Map<string, { label: string; kind: "project" | "stack" | "single"; items: Container[] }>();
    for (const c of shown ?? []) {
      const key = c.projectId ? `p:${c.projectId}` : c.stack ? `s:${c.stack}` : "single";
      const kind = c.projectId ? "project" : c.stack ? "stack" : "single";
      const label = c.project || c.stack || t.ctStandalone;
      const group = byKey.get(key);
      if (group) group.items.push(c);
      else byKey.set(key, { label, kind, items: [c] });
    }
    return [...byKey.entries()]
      .map(([key, g]) => ({
        key,
        ...g,
        failing: g.items.filter(isFailing).length,
        up: g.items.filter((c) => c.state === "running").length,
        items: g.items.slice().sort(
          (a, b) => Number(isFailing(b)) - Number(isFailing(a)) || Number(isUp(b)) - Number(isUp(a)) || a.name.localeCompare(b.name),
        ),
      }))
      .sort(
        (a, b) =>
          Number(b.failing > 0) - Number(a.failing > 0) ||
          Number(b.up > 0) - Number(a.up > 0) ||
          Number(a.kind === "single") - Number(b.kind === "single") ||
          a.label.localeCompare(b.label),
      );
  }, [shown, t.ctStandalone]);

  const off = app.docker && !app.docker.daemonRunning;

  return (
    <div style={{ display: "flex", flexDirection: "column", minHeight: 0, height: "100%", padding: "0 20px 20px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", padding: "0 12px 8px", flex: "0 0 auto" }}>
        <ChipGroup
          items={[
            { key: "all", label: t.ctAll },
            { key: "running", label: t.ctRunning },
            { key: "problem", label: t.ctProblem },
            { key: "stopped", label: t.ctStopped },
          ]}
          active={boxFilter}
          onPick={app.setBoxFilter}
        />
        <span style={{ fontSize: 11, color: "rgba(var(--trgb),.42)" }}>{t.ctHint}</span>
        <span style={{ marginLeft: "auto" }}>
          <RefreshAction onClick={() => void app.refreshBoxes()} title={t.recheck} />
        </span>
      </div>

      <div style={{ overflow: "auto", minHeight: 0, paddingBottom: 10 }}>
        {shown === null && <Note text={t.checking} />}
        {shown && groups.length === 0 && (
          <Note text={off ? t.ctDockerOff : boxFilter === "all" ? t.ctNone : t.ctNoneFiltered} />
        )}
        {groups.map((g) => {
          // Only stopped containers in it: context, folded until asked for.
          const quiet = g.failing === 0 && g.up === 0;
          const collapsed = app.isCollapsed("containers", g.key, quiet);
          const ids = g.items.map((c) => c.id);
          const busy = ids.some((id) => app.boxBusy.has(id));
          const anyUp = g.items.some(isUp);
          const anyDown = g.items.some((c) => !isUp(c));
          return (
            <div key={g.key} style={{ marginBottom: 4 }}>
              <FolderHeader
                label={g.label}
                title={g.kind === "stack" ? `${t.ctStack}: ${g.label}` : g.label}
                collapsed={collapsed}
                onToggle={() => app.toggleGroup("containers", g.key, quiet)}
              >
                {g.kind === "stack" && <Tag text={t.ctStack} />}
                {g.failing > 0 && <Tag text={`${g.failing} ${t.ctProblem.toLowerCase()}`} danger />}
                <span style={{ fontFamily: mono, fontSize: 10.5, color: "rgba(var(--trgb),.5)" }}>
                  {g.up}/{g.items.length}
                </span>
                {/* Whole-stack actions. The header folds on click, so these
                    keep their clicks to themselves. */}
                <span style={{ display: "flex", gap: 4 }} onClick={(e) => e.stopPropagation()}>
                  {anyDown && (
                    <Action label={t.ctStartAll} busy={busy} onClick={() => void app.boxAct(ids, "start")} />
                  )}
                  {anyUp && (
                    <Action
                      label={t.ctStopAll}
                      busy={busy}
                      title={t.ctStopHint}
                      onClick={() => void app.boxAct(ids.filter((id) => isUp(g.items.find((c) => c.id === id)!)), "stop")}
                    />
                  )}
                  {g.kind !== "single" && (
                    <Action label={t.ctRemoveAll} busy={busy} danger onClick={() => app.askRemove(ids, g.label)} />
                  )}
                </span>
              </FolderHeader>
              {!collapsed && g.items.map((c) => <Row key={c.id} box={c} app={app} />)}
            </div>
          );
        })}
      </div>

      <RemoveDialog app={app} />
    </div>
  );
}

function Row({ box: c, app }: { box: Container; app: App }) {
  const { t, lang } = app;
  const busy = app.boxBusy.has(c.id);
  const failing = isFailing(c);
  const logs = app.boxLogs[c.id];
  const open = c.id in app.boxLogs;
  const act = (action: ContainerAction) => void app.boxAct([c.id], action);

  const [stateLabel, color] =
    c.state === "running"
      ? [`${t.ctUp} · ${duration(c.runSecs, lang)}`, "var(--accTx)"]
      : c.state === "restarting"
        ? [`${t.ctRestarting} · ${c.restartCount}×`, "var(--danTx)"]
        : c.state === "paused"
          ? [t.ctPaused, "var(--warnTx)"]
          : c.state === "created"
            ? [t.ctCreated, "rgba(var(--trgb),.5)"]
            : [
                `${t.ctExited} (${c.exitCode})${c.stoppedSecs ? ` · ${duration(c.stoppedSecs, lang)}` : ""}`,
                c.exitCode ? "var(--warnTx)" : "rgba(var(--trgb),.5)",
              ];

  return (
    <div style={{ borderTop: "1px solid rgba(var(--wrgb),.05)" }}>
      <div
        className="h-soft"
        style={{ display: "grid", gridTemplateColumns: GRID, gap: 12, alignItems: "center", padding: "8px 12px", borderRadius: 10 }}
        title={`${c.image} · ${c.status}`}
      >
        <span style={{ minWidth: 0, display: "flex", alignItems: "center", gap: 9 }}>
          <span
            style={{
              width: 7,
              height: 7,
              flex: "0 0 7px",
              borderRadius: 2,
              background: failing ? "rgb(var(--danrgb))" : c.state === "running" ? "var(--acc)" : "rgba(var(--trgb),.25)",
              animation: c.state === "restarting" ? "upaPulse 1.2s infinite" : undefined,
            }}
          />
          <span style={{ minWidth: 0 }}>
            <span style={{ display: "block", fontSize: 12.5, fontWeight: 500, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
              {c.name}
            </span>
            <span style={{ display: "block", fontFamily: mono, fontSize: 9.5, color: "rgba(var(--trgb),.44)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
              {c.service ? `${c.image} · ${c.service}` : c.image}
            </span>
          </span>
        </span>

        <span style={{ display: "flex", flexDirection: "column", gap: 3, minWidth: 0 }}>
          <span style={{ fontFamily: mono, fontSize: 10.5, fontWeight: 500, color }}>{stateLabel}</span>
          <span style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
            {c.health && <Tag text={c.health} danger={c.health === "unhealthy"} />}
            {c.restartPolicy && c.restartPolicy !== "no" && <Tag text={c.restartPolicy} />}
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

        <span style={{ display: "flex", gap: 4, justifyContent: "flex-end", flexWrap: "wrap" }}>
          <Action label={t.ctLogs} active={open} onClick={() => void app.toggleBoxLogs(c.id)} />
          {isUp(c) ? (
            <>
              <Action label={t.ctRestart} busy={busy} onClick={() => act("restart")} />
              <Action label={t.ctStop} busy={busy} icon="stop" title={t.ctStopHint} onClick={() => act("stop")} />
            </>
          ) : (
            <Action label={t.ctStart} busy={busy} icon="play" onClick={() => act("start")} />
          )}
          <Action label={t.ctRemove} busy={busy} icon="trash" danger onClick={() => app.askRemove([c.id], c.name)} />
        </span>
      </div>

      {failing && c.state === "restarting" && (
        <div style={{ padding: "0 12px 6px 28px", fontSize: 11, color: "var(--danTx)" }}>{t.ctLoopNote}</div>
      )}

      {open && (
        <div style={{ margin: "0 12px 10px 28px", borderRadius: 10, border: "1px solid rgba(var(--wrgb),.08)", background: "rgba(var(--wrgb),.03)" }}>
          <div style={{ display: "flex", justifyContent: "flex-end", padding: "4px 6px 0" }}>
            <Action label={t.ctReload} onClick={() => void app.reloadBoxLogs(c.id)} />
          </div>
          <pre
            ref={(el) => {
              // The newest line is the one that says why it died.
              if (el) el.scrollTop = el.scrollHeight;
            }}
            style={{
              margin: 0,
              padding: "6px 12px 10px",
              maxHeight: 260,
              overflow: "auto",
              fontFamily: mono,
              fontSize: 10.5,
              lineHeight: 1.5,
              whiteSpace: "pre-wrap",
              wordBreak: "break-word",
              color: "rgba(var(--trgb),.78)",
            }}
          >
            {logs === null ? t.checking : logs || t.ctLogsEmpty}
          </pre>
        </div>
      )}
    </div>
  );
}

function RemoveDialog({ app }: { app: App }) {
  const { t, boxRemove: ask } = app;
  if (!ask) return null;
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={t.ctRemoveTitle}
      onClick={app.cancelRemove}
      style={{ position: "fixed", inset: 0, zIndex: 60, background: "var(--backdrop)", display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "min(480px, 100%)",
          borderRadius: 16,
          border: "1px solid rgba(var(--wrgb),.1)",
          background: "var(--elev)",
          boxShadow: "var(--shDlg)",
          padding: "20px 22px",
        }}
      >
        <div style={{ fontSize: 15, fontWeight: 650, marginBottom: 6 }}>{t.ctRemoveTitle}</div>
        <div style={{ fontFamily: mono, fontSize: 12, color: "var(--danTx)", marginBottom: 10 }}>
          {ask.label} · {ask.ids.length} {t.ctRemoveCount}
        </div>
        <p style={{ margin: "0 0 16px", fontSize: 12.5, lineHeight: 1.55, color: "rgba(var(--trgb),.72)" }}>{t.ctRemoveBody}</p>
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
          <Action label={t.cancel} onClick={app.cancelRemove} large />
          <Action label={t.ctRemove} danger icon="trash" onClick={() => void app.confirmRemove()} large />
        </div>
      </div>
    </div>
  );
}

function Action({
  label,
  onClick,
  busy = false,
  danger = false,
  active = false,
  large = false,
  icon,
  title,
}: {
  label: string;
  onClick: () => void;
  busy?: boolean;
  danger?: boolean;
  active?: boolean;
  large?: boolean;
  icon?: "play" | "stop" | "trash";
  title?: string;
}) {
  return (
    <button
      type="button"
      className={danger ? "h-danger" : "h-ghost"}
      disabled={busy}
      title={title ?? label}
      onClick={onClick}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 5,
        border: `1px solid ${danger ? "rgba(var(--danrgb),.4)" : active ? "rgba(var(--accrgb),.45)" : "rgba(var(--wrgb),.12)"}`,
        borderRadius: 8,
        background: danger ? "rgba(var(--danrgb),.1)" : active ? "rgba(var(--accrgb),.12)" : "rgba(var(--wrgb),.04)",
        color: danger ? "var(--danTx2)" : active ? "var(--accTx)" : "rgba(var(--trgb),.78)",
        padding: large ? "7px 14px" : "3px 8px",
        cursor: busy ? "default" : "pointer",
        fontSize: large ? 12 : 10.5,
        fontWeight: 600,
        whiteSpace: "nowrap",
        opacity: busy ? 0.5 : 1,
      }}
    >
      {icon === "play" && <Play size={7} />}
      {icon === "stop" && <Stop size={7} />}
      {icon === "trash" && <Trash size={11} />}
      {label}
    </button>
  );
}

function Tag({ text, danger = false }: { text: string; danger?: boolean }) {
  return (
    <span
      style={{
        fontSize: 9,
        fontWeight: 600,
        letterSpacing: ".04em",
        textTransform: "uppercase",
        color: danger ? "var(--danTx)" : "rgba(var(--trgb),.5)",
        border: `1px solid ${danger ? "rgba(var(--danrgb),.4)" : "rgba(var(--wrgb),.14)"}`,
        borderRadius: 5,
        padding: "0 5px",
        whiteSpace: "nowrap",
      }}
    >
      {text}
    </span>
  );
}

function Note({ text }: { text: string }) {
  return <div style={{ padding: "24px 14px", fontSize: 12.5, color: "rgba(var(--trgb),.5)" }}>{text}</div>;
}
