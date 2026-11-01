// What GitHub is doing with these projects: builds, releases, deployments.
//
// The remote half of the Running view. That one shows the processes on this
// machine; this one shows the ones running on somebody else's, for the same
// projects and in the same shape - grouped by project, newest first, with the
// thing that is still going marked as such.

import { useEffect, useMemo, useState } from "react";

import { ChipGroup } from "../components/Chips";
import { FolderHeader } from "../components/GroupHeader";
import { RefreshAction } from "../components/Requirements";
import { ChevronLeft, GitBranch } from "../components/Icons";
import { EnvPills, runFailed, runTone } from "../components/Ci";
import { duration, num, since } from "../format";
import type { App } from "../useApp";
import type { PullRequest, RepoCi, WorkflowRun } from "../types";

const mono = "'JetBrains Mono',monospace";
const GRID = "minmax(240px,1fr) 150px 104px 96px 78px 148px";

type Sort = "state" | "recent" | "name" | "length";

/** How far back each window reaches, in milliseconds; 0 is "all of it". */
const WINDOW: Record<string, number> = { any: 0, day: 864e5, week: 7 * 864e5 };

const newest = (a: WorkflowRun, b: WorkflowRun) => b.startedAt.localeCompare(a.startedAt);
const live = (run: WorkflowRun) => (run.status !== "completed" ? 0 : 1);
const broken = (run: WorkflowRun) => (runFailed(run) ? 0 : 1);

/**
 * Runs inside one project. Only two of the orders say anything about a single
 * run; under `name` the project's own order is what moved, so its runs stay
 * newest first, the way they arrive.
 */
const RUN_SORTERS: Record<Sort, (a: WorkflowRun, b: WorkflowRun) => number> = {
  state: (a, b) => live(a) - live(b) || broken(a) - broken(b) || newest(a, b),
  recent: newest,
  name: newest,
  length: (a, b) => b.elapsedSecs - a.elapsedSecs || newest(a, b),
};

/** The projects themselves, ordered by the same measure as the rows in them. */
const GROUP_SORTERS: Record<Sort, (a: RepoCi, b: RepoCi) => number> = {
  // What is still going is what you came to look at, then what broke.
  state: (a, b) =>
    Math.min(...a.runs.map(live), 1) - Math.min(...b.runs.map(live), 1) ||
    Math.min(...a.runs.map(broken), 1) - Math.min(...b.runs.map(broken), 1) ||
    (b.runs[0]?.startedAt ?? "").localeCompare(a.runs[0]?.startedAt ?? ""),
  recent: (a, b) => (b.runs[0]?.startedAt ?? "").localeCompare(a.runs[0]?.startedAt ?? ""),
  name: (a, b) => a.project.localeCompare(b.project),
  length: (a, b) =>
    Math.max(...b.runs.map((r) => r.elapsedSecs), 0) -
    Math.max(...a.runs.map((r) => r.elapsedSecs), 0),
};

export function ActionsView({ app }: { app: App }) {
  const { t, lang, ci, github } = app;

  const rows: RepoCi[] = useMemo(() => ci ?? [], [ci]);

  /** Inside the window, so the four numbers count the runs on screen. */
  const inWindow = useMemo(() => {
    const span = WINDOW[app.actionsWhen] ?? 0;
    if (!span) return (_run: WorkflowRun) => true;
    const from = Date.now() - span;
    return (run: WorkflowRun) => new Date(run.startedAt).getTime() >= from;
  }, [app.actionsWhen]);

  const counts = useMemo(() => {
    let running = 0;
    let failed = 0;
    let passed = 0;
    for (const row of rows) {
      for (const run of row.runs) {
        if (!inWindow(run)) continue;
        if (run.status !== "completed") running += 1;
        else if (runFailed(run)) failed += 1;
        else if (run.conclusion === "success") passed += 1;
      }
    }
    return { running, failed, passed, repos: rows.filter((r) => r.available).length };
  }, [rows, inWindow]);

  /** The filters narrow the runs, not the projects: an empty group drops out. */
  const groups = useMemo(() => {
    const sort = (app.actionsSort as Sort) in RUN_SORTERS ? (app.actionsSort as Sort) : "state";
    const keep = (run: WorkflowRun) => {
      if (!inWindow(run)) return false;
      if (app.actionsFilter === "running") return run.status !== "completed";
      if (app.actionsFilter === "failed") return runFailed(run);
      return true;
    };

    return rows
      .map((row) => ({ ...row, runs: [...row.runs.filter(keep)].sort(RUN_SORTERS[sort]) }))
      .filter(
        (row) =>
          row.runs.length > 0 ||
          // A repository that could not be read has nothing to date, so it is
          // only worth a row while nothing is being narrowed away.
          (app.actionsFilter === "all" && app.actionsWhen === "any" && row.error),
      )
      .sort(GROUP_SORTERS[sort]);
  }, [rows, app.actionsFilter, app.actionsSort, app.actionsWhen, inWindow]);

  if (github && !github.available) return <Note text={t.actionsNoGh} />;
  if (github && !github.authenticated) return <Note text={github.error || t.actionsNoAuth} />;
  if (app.logRun) return <RunLog app={app} />;
  if (app.actionsFilter === "pulls") return <Pulls app={app} />;
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
            { key: "pulls", label: t.actionsPulls },
          ]}
          active={app.actionsFilter}
          onPick={app.setActionsFilter}
        />
        {/* How far back to look. A build from last month is history; the two
            short windows are the ones a working day asks about. */}
        <ChipGroup
          items={[
            { key: "any", label: t.whenAny },
            { key: "day", label: t.whenDay },
            { key: "week", label: t.whenWeek },
          ]}
          active={app.actionsWhen}
          onPick={app.setActionsWhen}
        />
        {/* The same ordering the projects list offers, on the axes a run has. */}
        <span
          style={{
            fontSize: 10.5,
            letterSpacing: ".08em",
            textTransform: "uppercase",
            color: "rgba(var(--trgb),.52)",
          }}
        >
          {t.sort}
        </span>
        <ChipGroup
          items={[
            { key: "state", label: t.sState },
            { key: "recent", label: t.sRecent },
            { key: "name", label: t.sName },
            { key: "length", label: t.sLength },
          ]}
          active={app.actionsSort}
          onPick={app.setActionsSort}
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
            <div />
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
                  <EnvPills deployments={row.deployments} app={app} compact />
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
    // A div rather than a button: it holds a button of its own, and a button
    // inside a button is not a thing the browser will render.
    <div
      className="h-soft"
      role="button"
      tabIndex={0}
      onClick={() => void app.openRun(projectId, run.id)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") void app.openRun(projectId, run.id);
      }}
      title={t.actionsOpenRun}
      style={{
        display: "grid",
        gridTemplateColumns: GRID,
        gap: 10,
        alignItems: "center",
        width: "100%",
        padding: "8px 12px",
        borderTop: "1px solid rgba(var(--wrgb),.05)",
        borderRadius: 10,
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

      <span style={{ display: "flex", justifyContent: "flex-end", gap: 6 }}>
        {runFailed(run) && (
          <button
            type="button"
            className="h-ghost"
            title={app.t.runLogTitle}
            onClick={(e) => {
              e.stopPropagation();
              void app.openRunLog(projectId, run);
            }}
            style={{
              border: "1px solid rgba(var(--wrgb),.12)",
              borderRadius: 8,
              background: "rgba(var(--wrgb),.03)",
              color: "rgba(var(--trgb),.7)",
              padding: "4px 9px",
              cursor: "pointer",
              fontSize: 10.5,
              fontWeight: 600,
              whiteSpace: "nowrap",
            }}
          >
            {app.t.runLog}
          </button>
        )}
        <RunAction run={run} projectId={projectId} app={app} />
      </span>
    </div>
  );
}

/**
 * What is waiting on you, and what of yours is waiting on somebody else.
 *
 * Not narrowed to the projects on this disk: a review request is a review
 * request whether or not that repository happens to be checked out here.
 */
function Pulls({ app }: { app: App }) {
  const { t, lang, pulls } = app;

  const groups = useMemo(() => {
    const waiting = (pulls ?? []).filter((pull) => pull.reviewRequested);
    const mine = (pulls ?? []).filter((pull) => !pull.reviewRequested);
    return [
      { key: "waiting", label: t.pullsWaiting, items: waiting },
      { key: "mine", label: t.pullsMine, items: mine },
    ].filter((group) => group.items.length > 0);
  }, [pulls, t]);

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
            { key: "pulls", label: t.actionsPulls },
          ]}
          active={app.actionsFilter}
          onPick={app.setActionsFilter}
        />
        <span style={{ marginLeft: "auto" }}>
          <RefreshAction onClick={() => void app.refreshPulls()} title={t.recheck} />
        </span>
      </div>

      {pulls === null ? (
        <Note text={t.checking} />
      ) : groups.length === 0 ? (
        <Note text={t.pullsNone} />
      ) : (
        <div style={{ overflow: "auto", minHeight: 0, flex: 1, paddingBottom: 10 }}>
          {groups.map((group) => (
            <div key={group.key}>
              <FolderHeader
                label={group.label}
                title={group.label}
                collapsed={app.isCollapsed("pulls", group.key)}
                onToggle={() => app.toggleGroup("pulls", group.key)}
              >
                <span style={{ fontFamily: mono, fontSize: 10, color: "rgba(var(--trgb),.45)" }}>
                  {group.items.length}
                </span>
              </FolderHeader>

              {!app.isCollapsed("pulls", group.key) &&
                group.items.map((pull) => (
                  <PullRow key={pull.url} pull={pull} app={app} lang={lang} />
                ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function PullRow({
  pull,
  app,
  lang,
}: {
  pull: PullRequest;
  app: App;
  lang: App["lang"];
}) {
  const { t } = app;
  const updated = new Date(pull.updatedAt);

  return (
    <a
      className="h-soft"
      href={pull.url}
      target="_blank"
      rel="noreferrer"
      style={{
        display: "grid",
        gridTemplateColumns: "minmax(240px,1fr) 200px 104px 92px 68px",
        gap: 10,
        alignItems: "center",
        padding: "8px 12px",
        borderTop: "1px solid rgba(var(--wrgb),.05)",
        borderRadius: 10,
        color: "inherit",
        textDecoration: "none",
      }}
    >
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
          {pull.title}
        </span>
        <span style={{ fontFamily: mono, fontSize: 9.5, color: "rgba(var(--trgb),.44)" }}>
          #{pull.number} · {pull.author}
          {pull.draft && ` · ${t.pullDraft}`}
          {pull.comments > 0 && ` · ${pull.comments} ${t.pullComments}`}
        </span>
      </span>

      <span
        style={{
          fontFamily: mono,
          fontSize: 10.5,
          color: "rgba(var(--trgb),.6)",
          whiteSpace: "nowrap",
          overflow: "hidden",
          textOverflow: "ellipsis",
        }}
        title={pull.repo}
      >
        {pull.project || pull.repo}
      </span>

      <span style={{ fontFamily: mono, fontSize: 10.5, color: "rgba(var(--trgb),.55)" }}>
        {Number.isNaN(updated.getTime())
          ? "—"
          : since(Math.round(updated.getTime() / 1000), lang)}
      </span>

      <span
        style={{
          textAlign: "right",
          fontSize: 10.5,
          fontWeight: 600,
          color: pull.reviewRequested ? "var(--accTx)" : "rgba(var(--trgb),.55)",
          whiteSpace: "nowrap",
        }}
      >
        {pull.reviewRequested ? t.pullsWaiting : t.pullsMine}
      </span>

      {/* The board is where things that need doing already live, and a review
          waiting on you is one of those. */}
      <span style={{ display: "flex", justifyContent: "flex-end" }}>
        <button
          type="button"
          className="h-ghost"
          title={t.pullToNoteTitle}
          onClick={(e) => {
            e.preventDefault();
            app.noteFromPull(pull);
          }}
          style={{
            border: "1px solid rgba(var(--wrgb),.12)",
            borderRadius: 8,
            background: "rgba(var(--wrgb),.03)",
            color: "rgba(var(--trgb),.65)",
            padding: "3px 8px",
            cursor: "pointer",
            fontSize: 10,
            fontWeight: 600,
          }}
        >
          {t.pullToNote}
        </button>
      </span>
    </a>
  );
}

/**
 * Re-run or cancel, asked twice.
 *
 * The second press is the confirmation: a dialog for something this small
 * would be in the way, but a build that starts because a row was clicked by
 * accident costs minutes and money.
 */
function RunAction({
  run,
  projectId,
  app,
}: {
  run: WorkflowRun;
  projectId: string;
  app: App;
}) {
  const { t } = app;
  const [armed, setArmed] = useState(false);
  const busy = app.runBusy.has(run.id);
  const live = run.status !== "completed";
  const failed = runFailed(run);

  useEffect(() => {
    if (!armed) return;
    const id = window.setTimeout(() => setArmed(false), 3000);
    return () => window.clearTimeout(id);
  }, [armed]);

  if (!live && !failed) return <span />;

  return (
    <span style={{ display: "flex", justifyContent: "flex-end" }}>
      <button
        type="button"
        className={live ? "h-danger" : "h-accent"}
        disabled={busy}
        title={live ? t.runCancelTitle : t.runRerunTitle}
        onClick={(e) => {
          // The row itself opens the run on GitHub; this is a different act.
          e.stopPropagation();
          if (!armed) {
            setArmed(true);
            return;
          }
          setArmed(false);
          void app.runAction(projectId, run.id, live ? "cancel" : "rerun");
        }}
        style={{
          border: `1px solid ${live ? "rgba(var(--danrgb),.4)" : "rgba(var(--accrgb),.45)"}`,
          borderRadius: 8,
          background: live ? "rgba(var(--danrgb),.1)" : "rgba(var(--accrgb),.12)",
          color: live ? "var(--danTx2)" : "var(--accTx)",
          padding: "4px 9px",
          cursor: busy ? "default" : "pointer",
          fontSize: 10.5,
          fontWeight: 600,
          opacity: busy ? 0.55 : 1,
          whiteSpace: "nowrap",
        }}
      >
        {armed ? t.runSure : live ? t.runCancel : t.runRerun}
      </button>
    </span>
  );
}

/**
 * The end of a failed run's log, and a way to take it somewhere useful.
 *
 * Not a log viewer: the whole thing lives on GitHub and is better read there.
 * This is the last few hundred lines - where the failure is - and a button
 * that puts the failure on the clipboard as a message worth pasting into
 * whatever you were going to ask about it.
 */
function RunLog({ app }: { app: App }) {
  const { t, logRun, runLog } = app;
  if (!logRun) return null;

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        minHeight: 0,
        height: "100%",
        padding: "0 20px 20px",
        gap: 10,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 10, flex: "0 0 auto" }}>
        <button
          type="button"
          className="h-ghost"
          onClick={app.closeRunLog}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 5,
            border: "1px solid rgba(var(--wrgb),.1)",
            borderRadius: 9,
            background: "rgba(var(--wrgb),.03)",
            color: "rgba(var(--trgb),.7)",
            padding: "5px 10px",
            cursor: "pointer",
            fontSize: 11,
            fontWeight: 500,
          }}
        >
          <ChevronLeft size={12} />
          {t.back}
        </button>

        <span style={{ minWidth: 0, flex: 1 }}>
          <span
            style={{
              display: "block",
              fontSize: 13,
              fontWeight: 600,
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
            }}
          >
            {logRun.run.name} #{logRun.run.number}
          </span>
          <span style={{ fontFamily: mono, fontSize: 9.5, color: "rgba(var(--trgb),.45)" }}>
            {logRun.run.branch} · {logRun.run.sha} · {t.runLogHint}
          </span>
        </span>

        <button
          type="button"
          className="h-accent"
          disabled={runLog === null}
          onClick={() => void app.copyRunPrompt()}
          style={{
            border: "1px solid rgba(var(--accrgb),.45)",
            borderRadius: 9,
            background: "rgba(var(--accrgb),.12)",
            color: "var(--accTx)",
            padding: "5px 11px",
            cursor: runLog === null ? "default" : "pointer",
            fontSize: 11,
            fontWeight: 600,
            opacity: runLog === null ? 0.5 : 1,
            whiteSpace: "nowrap",
          }}
        >
          {t.runCopyPrompt}
        </button>
      </div>

      {runLog === null ? (
        <Note text={t.checking} />
      ) : (
        <pre
          style={{
            flex: 1,
            minHeight: 0,
            overflow: "auto",
            margin: 0,
            padding: "12px 14px",
            border: "1px solid rgba(var(--wrgb),.08)",
            borderRadius: 12,
            background: "rgba(var(--wrgb),.03)",
            fontFamily: mono,
            fontSize: 11,
            lineHeight: 1.55,
            color: "rgba(var(--trgb),.82)",
            whiteSpace: "pre-wrap",
            wordBreak: "break-word",
          }}
        >
          {runLog}
        </pre>
      )}
    </div>
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
