// What GitHub is doing with these projects: builds, releases, deployments.
//
// The remote half of the Running view. That one shows the processes on this
// machine; this one shows the ones running on somebody else's, for the same
// projects and in the same shape - grouped by project, newest first, with the
// thing that is still going marked as such.

import { useMemo } from "react";

import { ChipGroup } from "../components/Chips";
import { FolderHeader } from "../components/GroupHeader";
import { RefreshAction } from "../components/Requirements";
import { GitBranch } from "../components/Icons";
import { duration, num, since } from "../format";
import type { App } from "../useApp";
import type { RepoCi, WorkflowRun } from "../types";

const mono = "'JetBrains Mono',monospace";
const GRID = "minmax(240px,1fr) 150px 104px 96px 78px";

/** The one word for a run's state, and the colour that word is said in. */
export function runTone(run: WorkflowRun, t: App["t"]) {
  if (run.status === "queued") {
    return { label: t.runQueued, fg: "rgba(var(--trgb),.6)", dot: "rgba(var(--trgb),.35)" };
  }
  if (run.status !== "completed") {
    return { label: t.runInProgress, fg: "var(--accTx)", dot: "var(--acc)", live: true };
  }
  switch (run.conclusion) {
    case "success":
      return { label: t.runSuccess, fg: "var(--accTx)", dot: "var(--acc)" };
    case "failure":
    case "timed_out":
      return {
        label: run.conclusion === "failure" ? t.runFailure : t.runTimedOut,
        fg: "var(--danTx)",
        dot: "var(--danTx)",
      };
    case "cancelled":
      return { label: t.runCancelled, fg: "rgba(var(--trgb),.55)", dot: "rgba(var(--trgb),.3)" };
    case "skipped":
      return { label: t.runSkipped, fg: "rgba(var(--trgb),.55)", dot: "rgba(var(--trgb),.3)" };
    default:
      return { label: run.conclusion, fg: "rgba(var(--trgb),.6)", dot: "rgba(var(--trgb),.3)" };
  }
}

/** True when a run ended in a way that wants looking at. */
export function runFailed(run: WorkflowRun): boolean {
  return (
    run.status === "completed" &&
    (run.conclusion === "failure" || run.conclusion === "timed_out")
  );
}

export function ActionsView({ app }: { app: App }) {
  const { t, lang, ci, github } = app;

  const rows: RepoCi[] = useMemo(() => ci ?? [], [ci]);

  const counts = useMemo(() => {
    let running = 0;
    let failed = 0;
    let passed = 0;
    for (const row of rows) {
      for (const run of row.runs) {
        if (run.status !== "completed") running += 1;
        else if (runFailed(run)) failed += 1;
        else if (run.conclusion === "success") passed += 1;
      }
    }
    return { running, failed, passed, repos: rows.filter((r) => r.available).length };
  }, [rows]);

  /** The filter narrows the runs, not the projects: an empty group drops out. */
  const groups = useMemo(() => {
    const keep = (run: WorkflowRun) => {
      if (app.actionsFilter === "running") return run.status !== "completed";
      if (app.actionsFilter === "failed") return runFailed(run);
      return true;
    };

    return rows
      .map((row) => ({ ...row, runs: row.runs.filter(keep) }))
      .filter((row) => row.runs.length > 0 || (app.actionsFilter === "all" && row.error))
      .sort((a, b) => {
        // Whatever is running is what you came to look at.
        const live = (row: RepoCi) => (row.runs.some((r) => r.status !== "completed") ? 0 : 1);
        const broken = (row: RepoCi) => (row.runs.some(runFailed) ? 0 : 1);
        return (
          live(a) - live(b) ||
          broken(a) - broken(b) ||
          (b.runs[0]?.startedAt ?? "").localeCompare(a.runs[0]?.startedAt ?? "")
        );
      });
  }, [rows, app.actionsFilter]);

  if (github && !github.available) return <Note text={t.actionsNoGh} />;
  if (github && !github.authenticated) return <Note text={github.error || t.actionsNoAuth} />;
  if (ci === null) return <Note text={t.checking} />;

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 14,
        minHeight: 0,
        height: "100%",
        padding: "0 20px 20px",
      }}
    >
      <div
        style={{ display: "flex", alignItems: "center", gap: 10, flex: "0 0 auto", flexWrap: "wrap" }}
      >
        <ChipGroup
          items={[
            { key: "all", label: t.all },
            { key: "running", label: t.actionsRunning },
            { key: "failed", label: t.actionsFailed },
          ]}
          active={app.actionsFilter}
          onPick={app.setActionsFilter}
        />
        <span style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 10 }}>
          {github?.login && (
            <span style={{ fontFamily: mono, fontSize: 10, color: "rgba(var(--trgb),.45)" }}>
              {github.login} · {num(github.rateRemaining, lang)} {t.actionsRate}
            </span>
          )}
          <RefreshAction onClick={() => void app.refreshCi()} title={t.recheck} />
        </span>
      </div>

      <div
        style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 10, flex: "0 0 auto" }}
      >
        <Stat label={t.actionsRunning} value={num(counts.running, lang)} live={counts.running > 0} />
        <Stat label={t.actionsFailed} value={num(counts.failed, lang)} danger={counts.failed > 0} />
        <Stat label={t.actionsPassed} value={num(counts.passed, lang)} />
        <Stat label={t.actionsRepos} value={num(counts.repos, lang)} />
      </div>

      {groups.length === 0 ? (
        <Note text={t.actionsNone} />
      ) : (
        <div style={{ display: "flex", flexDirection: "column", minHeight: 0, flex: 1 }}>
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
            <div>{t.colRun}</div>
            <div>{t.colBranch}</div>
            <div>{t.colWhen}</div>
            <div style={{ textAlign: "right" }}>{t.colLength}</div>
            <div style={{ textAlign: "right" }}>{t.colState}</div>
          </div>

          <div style={{ overflow: "auto", minHeight: 0, paddingBottom: 10 }}>
            {groups.map((row) => (
              <div key={row.projectId}>
                <FolderHeader
                  label={row.project}
                  title={row.repo || row.project}
                  collapsed={app.isCollapsed("actions", row.projectId)}
                  onToggle={() => app.toggleGroup("actions", row.projectId)}
                >
                  <span style={{ fontFamily: mono, fontSize: 10, color: "rgba(var(--trgb),.45)" }}>
                    {row.repo}
                  </span>
                </FolderHeader>

                {!app.isCollapsed("actions", row.projectId) &&
                  (row.runs.length === 0 ? (
                    <Note text={row.error || t.actionsNoRuns} small />
                  ) : (
                    row.runs.map((run) => (
                      <Row key={run.id} run={run} projectId={row.projectId} app={app} />
                    ))
                  ))}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function Stat({
  label,
  value,
  live = false,
  danger = false,
}: {
  label: string;
  value: string;
  live?: boolean;
  danger?: boolean;
}) {
  return (
    <div
      style={{
        border: "1px solid rgba(var(--wrgb),.08)",
        background: "rgba(var(--wrgb),.03)",
        borderRadius: 12,
        padding: "11px 13px",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          fontSize: 10,
          letterSpacing: ".07em",
          textTransform: "uppercase",
          color: "rgba(var(--trgb),.5)",
        }}
      >
        {live && (
          <span
            style={{
              width: 5,
              height: 5,
              borderRadius: 99,
              background: "var(--acc)",
              animation: "upaPulse 1.8s infinite",
            }}
          />
        )}
        {label}
      </div>
      <div
        style={{
          fontFamily: mono,
          fontSize: 19,
          fontWeight: 600,
          marginTop: 4,
          letterSpacing: "-.02em",
          color: danger ? "var(--danTx)" : live ? "var(--accTx)" : "var(--t0)",
        }}
      >
        {value}
      </div>
    </div>
  );
}

function Row({ run, projectId, app }: { run: WorkflowRun; projectId: string; app: App }) {
  const { t, lang } = app;
  const tone = runTone(run, t);
  const started = new Date(run.startedAt);
  const when = Number.isNaN(started.getTime())
    ? "—"
    : since(Math.round(started.getTime() / 1000), lang);

  return (
    <button
      type="button"
      className="h-soft"
      onClick={() => void app.openRun(projectId, run.id)}
      title={t.actionsOpenRun}
      style={{
        display: "grid",
        gridTemplateColumns: GRID,
        gap: 10,
        alignItems: "center",
        width: "100%",
        padding: "8px 12px",
        border: 0,
        borderTop: "1px solid rgba(var(--wrgb),.05)",
        borderRadius: 10,
        background: "transparent",
        color: "inherit",
        textAlign: "left",
        cursor: "pointer",
      }}
    >
      <span style={{ minWidth: 0, display: "flex", alignItems: "center", gap: 8 }}>
        <span
          style={{
            width: 6,
            height: 6,
            flex: "0 0 6px",
            borderRadius: 99,
            background: tone.dot,
            boxShadow: tone.live ? "0 0 8px rgba(var(--accrgb),.7)" : undefined,
            animation: tone.live ? "upaPulse 1.8s infinite" : undefined,
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
            {run.name} <span style={{ color: "rgba(var(--trgb),.45)" }}>#{run.number}</span>
            {run.attempt > 1 && (
              <span style={{ color: "rgba(var(--trgb),.45)" }}> · {run.attempt}.</span>
            )}
          </span>
          <span
            style={{
              display: "block",
              fontSize: 10.5,
              color: "rgba(var(--trgb),.5)",
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
            }}
          >
            {run.title || run.event}
          </span>
        </span>
      </span>

      <span
        style={{
          display: "flex",
          alignItems: "center",
          gap: 4,
          fontFamily: mono,
          fontSize: 10.5,
          color: "rgba(var(--trgb),.6)",
          minWidth: 0,
        }}
      >
        <GitBranch size={10} style={{ flex: "0 0 10px" }} />
        <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {run.branch}
        </span>
      </span>

      <span style={{ fontFamily: mono, fontSize: 10.5, color: "rgba(var(--trgb),.6)" }}>
        {when}
      </span>
      <span
        style={{
          textAlign: "right",
          fontFamily: mono,
          fontSize: 10.5,
          color: "rgba(var(--trgb),.55)",
        }}
      >
        {run.elapsedSecs ? duration(run.elapsedSecs, lang) : "—"}
      </span>
      <span
        style={{
          textAlign: "right",
          fontSize: 10.5,
          fontWeight: 600,
          color: tone.fg,
          whiteSpace: "nowrap",
        }}
      >
        {tone.label}
      </span>
    </button>
  );
}

function Note({ text, small = false }: { text: string; small?: boolean }) {
  return (
    <div
      style={{
        padding: small ? "10px 14px" : "24px 14px",
        fontSize: small ? 11.5 : 12.5,
        color: "rgba(var(--trgb),.5)",
      }}
    >
      {text}
    </div>
  );
}
