// The build state of a project, in the two sizes the app needs it.
//
// A dot in the lists, where it has to sit next to a name without taking a
// column; a list of runs in the project detail, where there is room to say
// what actually happened.

import { GitBranch } from "./Icons";
import { duration, since } from "../format";
import type { App } from "../useApp";
import type { RepoCi, WorkflowRun } from "../types";

const mono = "'JetBrains Mono',monospace";

/** True when a run ended in a way that wants looking at. */
export function runFailed(run: WorkflowRun): boolean {
  return (
    run.status === "completed" && (run.conclusion === "failure" || run.conclusion === "timed_out")
  );
}

/** The one word for a run's state, and the colour that word is said in. */
export function runTone(run: WorkflowRun, t: App["t"]) {
  if (run.status === "queued") {
    return { label: t.runQueued, fg: "rgba(var(--trgb),.6)", dot: "rgba(var(--trgb),.35)", live: false };
  }
  if (run.status !== "completed") {
    return { label: t.runInProgress, fg: "var(--accTx)", dot: "var(--acc)", live: true };
  }
  switch (run.conclusion) {
    case "success":
      return { label: t.runSuccess, fg: "var(--accTx)", dot: "var(--acc)", live: false };
    case "failure":
      return { label: t.runFailure, fg: "var(--danTx)", dot: "var(--danTx)", live: false };
    case "timed_out":
      return { label: t.runTimedOut, fg: "var(--danTx)", dot: "var(--danTx)", live: false };
    case "cancelled":
      return { label: t.runCancelled, fg: "rgba(var(--trgb),.55)", dot: "rgba(var(--trgb),.3)", live: false };
    case "skipped":
      return { label: t.runSkipped, fg: "rgba(var(--trgb),.55)", dot: "rgba(var(--trgb),.3)", live: false };
    default:
      return { label: run.conclusion, fg: "rgba(var(--trgb),.6)", dot: "rgba(var(--trgb),.3)", live: false };
  }
}

/**
 * The run a project is judged by: whatever is still going, otherwise the last
 * one to have finished. A green run from an hour ago says less than a red one
 * happening now.
 */
export function headlineRun(row: RepoCi | undefined): WorkflowRun | undefined {
  if (!row?.available) return undefined;
  return row.runs.find((run) => run.status !== "completed") ?? row.runs[0];
}

/**
 * One dot, for the lists. Nothing is drawn when GitHub has not been asked
 * about this project, or has nothing to say - an empty column would only
 * raise a question it cannot answer.
 */
export function CiDot({ row, app }: { row: RepoCi | undefined; app: App }) {
  const run = headlineRun(row);
  if (!run) return null;

  const tone = runTone(run, app.t);
  return (
    <span
      title={`${run.name} #${run.number} · ${tone.label} · ${run.branch}`}
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
  );
}

/** The last few runs of one project, for the detail view's side column. */
export function CiBody({ row, app }: { row: RepoCi | undefined; app: App }) {
  const { t, lang } = app;

  if (!row) return <Note text={t.checking} />;
  if (!row.available) return <Note text={row.error || t.actionsNoRuns} />;
  if (row.runs.length === 0) return <Note text={t.actionsNoRuns} />;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      {row.runs.slice(0, 5).map((run) => {
        const tone = runTone(run, t);
        const started = new Date(run.startedAt);
        return (
          <button
            key={run.id}
            type="button"
            className="h-soft"
            onClick={() => void app.openRun(row.projectId, run.id)}
            title={t.actionsOpenRun}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              width: "100%",
              border: 0,
              borderRadius: 9,
              background: "transparent",
              color: "inherit",
              padding: "5px 7px",
              cursor: "pointer",
              textAlign: "left",
            }}
          >
            <span
              style={{
                width: 6,
                height: 6,
                flex: "0 0 6px",
                borderRadius: 99,
                background: tone.dot,
                animation: tone.live ? "upaPulse 1.8s infinite" : undefined,
              }}
            />
            <span style={{ minWidth: 0, flex: 1 }}>
              <span
                style={{
                  display: "block",
                  fontSize: 12,
                  fontWeight: 500,
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                }}
              >
                {run.name} <span style={{ color: "rgba(var(--trgb),.45)" }}>#{run.number}</span>
              </span>
              <span
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 4,
                  fontFamily: mono,
                  fontSize: 9.5,
                  color: "rgba(var(--trgb),.45)",
                  whiteSpace: "nowrap",
                }}
              >
                <GitBranch size={9} />
                {run.branch}
                {run.elapsedSecs > 0 && <span>· {duration(run.elapsedSecs, lang)}</span>}
              </span>
            </span>
            <span style={{ textAlign: "right", whiteSpace: "nowrap" }}>
              <span style={{ display: "block", fontSize: 10.5, fontWeight: 600, color: tone.fg }}>
                {tone.label}
              </span>
              <span style={{ fontFamily: mono, fontSize: 9.5, color: "rgba(var(--trgb),.42)" }}>
                {Number.isNaN(started.getTime())
                  ? "—"
                  : since(Math.round(started.getTime() / 1000), lang)}
              </span>
            </span>
          </button>
        );
      })}
    </div>
  );
}

function Note({ text }: { text: string }) {
  return <div style={{ fontSize: 11.5, color: "rgba(var(--trgb),.5)" }}>{text}</div>;
}
