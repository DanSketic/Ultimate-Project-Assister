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
import { GitBranch } from "../components/Icons";
import { EnvPills, runFailed, runTone } from "../components/Ci";
import { duration, num, since } from "../format";
import type { App } from "../useApp";
import type { PullRequest, RepoCi, WorkflowRun } from "../types";

const mono = "'JetBrains Mono',monospace";
const GRID = "minmax(240px,1fr) 150px 104px 96px 78px 84px";

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

      <RunAction run={run} projectId={projectId} app={app} />
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
        gridTemplateColumns: "minmax(240px,1fr) 200px 104px 92px",
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
