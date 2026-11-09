// Prune and compact Docker - the two halves of getting its space back.
//
// A prune deletes what Docker no longer uses, but on Windows that space stays
// inside Docker Desktop's disk file: the file only ever grows. Compacting is
// what hands it back to the machine, and it is the heavier of the two - Docker
// Desktop stops for it, and Windows asks for administrator rights - so the
// dialog says all of that before anything starts, and shows each step while
// it runs.

import { useEffect } from "react";

import { size } from "../format";
import type { App } from "../useApp";
import type { CompactStep, PruneTarget } from "../types";
import { Check } from "./Icons";

const mono = "'JetBrains Mono',monospace";

const STEPS: CompactStep[] = ["trim", "stop", "detach", "compact", "start"];

const ghost = {
  border: "1px solid rgba(var(--wrgb),.12)",
  borderRadius: 10,
  background: "rgba(var(--wrgb),.04)",
  color: "rgba(var(--trgb),.8)",
  padding: "7px 14px",
  cursor: "pointer",
  fontSize: 12,
  fontWeight: 500,
} as const;

const strong = {
  border: "1px solid rgba(var(--accrgb),.5)",
  borderRadius: 10,
  background: "rgba(var(--accrgb),.16)",
  color: "var(--accTx)",
  padding: "7px 14px",
  cursor: "pointer",
  fontSize: 12,
  fontWeight: 600,
} as const;

export function DockerDialog({ app }: { app: App }) {
  const { t, dockerTask: task } = app;

  useEffect(() => {
    if (!task) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && app.closeDockerTask();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [task, app]);

  if (!task) return null;
  const busy = task.phase === "busy";
  const title = task.mode === "prune" ? t.pruneTitle : t.compactTitle;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={title}
      onClick={app.closeDockerTask}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 60,
        background: "var(--backdrop)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 24,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "min(540px, 100%)",
          maxHeight: "100%",
          overflow: "auto",
          borderRadius: 16,
          border: "1px solid rgba(var(--wrgb),.1)",
          background: "var(--elev)",
          boxShadow: "var(--shDlg)",
          padding: "20px 22px",
        }}
      >
        <div style={{ fontSize: 15, fontWeight: 650, letterSpacing: "-.01em", marginBottom: 10 }}>
          {title}
        </div>

        {task.mode === "prune" ? <Prune app={app} /> : <Compact app={app} />}

        {task.error && (
          <p style={{ margin: "12px 0 0", fontSize: 12, color: "var(--danTx)", lineHeight: 1.5 }}>
            {t.dockerTaskFailed} {task.error}
          </p>
        )}

        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 16 }}>
          {task.phase === "ask" ? (
            <>
              <button type="button" className="h-ghost" onClick={app.closeDockerTask} style={ghost}>
                {t.cancel}
              </button>
              {task.mode === "prune" ? (
                <button
                  type="button"
                  className="h-accent-strong"
                  disabled={app.pruneTargets.size === 0}
                  onClick={() => void app.runPrune()}
                  style={{ ...strong, opacity: app.pruneTargets.size === 0 ? 0.5 : 1 }}
                >
                  {t.pruneRun}
                </button>
              ) : (
                <button type="button" className="h-accent-strong" onClick={() => void app.runCompact()} style={strong}>
                  {t.compactRun}
                </button>
              )}
            </>
          ) : (
            <button
              type="button"
              className="h-ghost"
              disabled={busy}
              onClick={app.closeDockerTask}
              style={{ ...ghost, opacity: busy ? 0.5 : 1, cursor: busy ? "default" : "pointer" }}
            >
              {t.dockerClose}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function Prune({ app }: { app: App }) {
  const { t, docker, dockerTask: task } = app;

  if (task?.phase === "busy") return <Muted text={t.pruneBusy} />;
  if (task?.phase === "done") {
    return task.prune ? (
      <>
        <Line label={t.pruneFreed} value={size(task.prune.freedBytes)} accent />
        {task.prune.errors.map((e) => (
          <p key={e} style={{ margin: "8px 0 0", fontSize: 11.5, color: "var(--danTx)" }}>
            {e}
          </p>
        ))}
      </>
    ) : null;
  }

  // Cheap first, then the ones that take something somebody may still want.
  const options: { key: PruneTarget; label: string; hint: string; bytes?: number }[] = [
    { key: "images", label: t.pruneImages, hint: t.pruneImagesH },
    { key: "cache", label: t.pruneCache, hint: t.pruneCacheH, bytes: docker?.buildCacheBytes },
    { key: "containers", label: t.pruneContainers, hint: t.pruneContainersH, bytes: docker?.containersBytes },
    { key: "images-all", label: t.pruneImagesAll, hint: t.pruneImagesAllH, bytes: docker?.imagesBytes },
    { key: "volumes", label: t.pruneVolumes, hint: t.pruneVolumesH, bytes: docker?.volumesBytes },
  ];

  return (
    <>
      <Muted text={t.pruneIntro} />
      <div style={{ display: "flex", flexDirection: "column", gap: 4, marginTop: 12 }}>
        {options.map((o) => {
          const on = app.pruneTargets.has(o.key);
          return (
            <button
              key={o.key}
              type="button"
              className="h-soft"
              aria-pressed={on}
              onClick={() => app.togglePruneTarget(o.key)}
              style={{
                display: "flex",
                alignItems: "flex-start",
                gap: 10,
                textAlign: "left",
                border: `1px solid ${on ? "rgba(var(--accrgb),.35)" : "rgba(var(--wrgb),.07)"}`,
                borderRadius: 10,
                background: on ? "rgba(var(--accrgb),.07)" : "transparent",
                padding: "8px 11px",
                cursor: "pointer",
                color: "inherit",
              }}
            >
              <span
                style={{
                  width: 13,
                  height: 13,
                  flex: "0 0 13px",
                  marginTop: 2,
                  borderRadius: 4,
                  border: "1px solid currentColor",
                  color: on ? "var(--accTx)" : "rgba(var(--trgb),.4)",
                  background: on ? "var(--acc)" : "transparent",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                {on && <Check size={8} style={{ color: "var(--bg)" }} />}
              </span>
              <span style={{ flex: 1, minWidth: 0 }}>
                <span style={{ display: "block", fontSize: 12.5, fontWeight: 500 }}>{o.label}</span>
                <span style={{ display: "block", fontSize: 11, color: "rgba(var(--trgb),.5)", lineHeight: 1.45 }}>
                  {o.hint}
                </span>
              </span>
              {o.bytes !== undefined && (
                <span style={{ fontFamily: mono, fontSize: 11, color: "rgba(var(--trgb),.6)" }}>{size(o.bytes)}</span>
              )}
            </button>
          );
        })}
      </div>
    </>
  );
}

function Compact({ app }: { app: App }) {
  const { t, docker, dockerTask: task } = app;
  const labels: Record<CompactStep, string> = {
    trim: t.compactStepTrim,
    stop: t.compactStepStop,
    detach: t.compactStepDetach,
    compact: t.compactStepCompact,
    start: t.compactStepStart,
  };

  if (task?.phase === "done") {
    const report = task.compact;
    if (!report) return null;
    return (
      <>
        <Line label={t.compactBefore} value={size(report.beforeBytes)} />
        <Line label={t.compactAfter} value={size(report.afterBytes)} accent />
        {report.trimmed && (
          <code
            style={{
              display: "block",
              marginTop: 10,
              fontFamily: mono,
              fontSize: 10.5,
              color: "rgba(var(--trgb),.55)",
              whiteSpace: "pre-wrap",
            }}
          >
            {report.trimmed}
          </code>
        )}
        {report.restartError && (
          <p style={{ margin: "10px 0 0", fontSize: 12, color: "var(--warnTx)", lineHeight: 1.5 }}>
            {t.compactRestartFailed} {report.restartError}
          </p>
        )}
      </>
    );
  }

  const at = task?.step ? STEPS.indexOf(task.step) : -1;
  return (
    <>
      {task?.phase === "ask" && (
        <>
          <Muted text={t.compactIntro} />
          {docker && docker.diskBytes > 0 && (
            <div style={{ margin: "12px 0" }}>
              <Line label={t.dockerDiskFile} value={size(docker.diskBytes)} />
              {docker.daemonRunning && <Line label={t.dockerDiskUsed} value={size(docker.usedBytes)} />}
            </div>
          )}
          <p
            style={{
              margin: "0 0 12px",
              fontSize: 12,
              lineHeight: 1.55,
              color: "var(--warnTx)",
              border: "1px solid rgba(255,212,121,.35)",
              background: "rgba(255,212,121,.08)",
              borderRadius: 10,
              padding: "9px 12px",
            }}
          >
            {t.compactWarn}
          </p>
        </>
      )}

      {/* The plan before it starts, and where it has got to while it runs. */}
      <ol style={{ margin: 0, padding: 0, listStyle: "none", display: "flex", flexDirection: "column", gap: 6 }}>
        {STEPS.map((step, i) => {
          const done = at > i;
          const now = at === i;
          return (
            <li
              key={step}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 9,
                fontSize: 12,
                color: now ? "var(--accTx)" : done ? "rgba(var(--trgb),.75)" : "rgba(var(--trgb),.5)",
                fontWeight: now ? 600 : 400,
              }}
            >
              <span
                style={{
                  width: 16,
                  height: 16,
                  flex: "0 0 16px",
                  borderRadius: 99,
                  border: `1px solid ${now || done ? "rgba(var(--accrgb),.5)" : "rgba(var(--wrgb),.15)"}`,
                  background: done ? "rgba(var(--accrgb),.18)" : "transparent",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontFamily: mono,
                  fontSize: 9,
                  animation: now ? "upaPulse 1.8s infinite" : undefined,
                }}
              >
                {done ? <Check size={7} /> : i + 1}
              </span>
              {labels[step]}
            </li>
          );
        })}
      </ol>
    </>
  );
}

function Line({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, padding: "3px 0" }}>
      <span style={{ color: "rgba(var(--trgb),.55)" }}>{label}</span>
      <span style={{ fontFamily: mono, fontWeight: accent ? 650 : 500, color: accent ? "var(--accTx)" : undefined }}>
        {value}
      </span>
    </div>
  );
}

function Muted({ text }: { text: string }) {
  return <p style={{ margin: 0, fontSize: 12.5, lineHeight: 1.55, color: "rgba(var(--trgb),.72)" }}>{text}</p>;
}
