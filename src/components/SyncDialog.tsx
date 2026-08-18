// What the remote has that this checkout does not, and the way out of it.
//
// A project sat on for a week while somebody else pushed is the ordinary case,
// and the ordinary answer - fetch, look at what arrived, rebase your own work
// on top - is three commands nobody remembers the flags for. This says what
// happened in words, shows the commits and who wrote them, and offers exactly
// the one operation that fits the situation it found.

import type { ReactNode } from "react";

import * as api from "../api";
import { ago } from "../format";
import { GitBranch, Refresh } from "./Icons";
import type { App } from "../useApp";
import type { Commit } from "../types";

const mono = "'JetBrains Mono',monospace";

/** Severity of a state, which is all the colouring ever depends on. */
type Tone = "ok" | "warn" | "danger";

const TONE: Record<string, Tone> = {
  ok: "ok",
  ahead: "ok",
  behind: "warn",
  diverged: "warn",
  "no-upstream": "warn",
  "no-remote": "ok",
  detached: "warn",
  unborn: "ok",
  "not-a-repo": "ok",
  rebasing: "danger",
  merging: "danger",
  busy: "danger",
};

const COLOUR: Record<Tone, { fg: string; bd: string; bg: string }> = {
  ok: { fg: "var(--accTx)", bd: "rgba(var(--accrgb),.45)", bg: "rgba(var(--accrgb),.12)" },
  warn: { fg: "var(--warnTx)", bd: "rgba(255,212,121,.4)", bg: "rgba(255,212,121,.12)" },
  danger: { fg: "var(--danTx2)", bd: "rgba(var(--danrgb),.45)", bg: "rgba(var(--danrgb),.12)" },
};

export function SyncDialog({ app }: { app: App }) {
  const { t, sync, syncFor, syncBusy, syncReport } = app;
  if (!syncFor) return null;

  const project = app.projects.find((p) => p.id === syncFor);
  const tone = sync ? (TONE[sync.state] ?? "warn") : "ok";
  const colour = COLOUR[tone];

  const title: Record<string, string> = {
    ok: t.syncOkT,
    behind: t.syncBehindT,
    ahead: t.syncAheadT,
    diverged: t.syncDivergedT,
    "no-upstream": t.syncNoUpstreamT,
    "no-remote": t.syncNoRemoteT,
    detached: t.syncDetachedT,
    unborn: t.syncUnbornT,
    "not-a-repo": t.notARepo,
    rebasing: t.syncRebasingT,
    merging: t.syncMergingT,
    busy: t.syncBusyT,
  };

  const body: Record<string, string> = {
    ok: t.syncOkB,
    behind: t.syncBehindB,
    ahead: t.syncAheadB,
    diverged: t.syncDivergedB,
    "no-upstream": `${t.syncNoUpstreamB}${sync?.branch ?? ""}`,
    "no-remote": t.syncNoRemoteB,
    detached: t.syncDetachedB,
    unborn: t.syncUnbornB,
    "not-a-repo": t.syncNoRemoteB,
    rebasing: t.syncRebasingB,
    merging: t.syncMergingB,
    busy: t.syncBusyB,
  };

  // A finished attempt outranks the state it left behind: the user pressed the
  // button, and what happened is what they are waiting to read.
  const outcome = syncReport?.outcome;
  const headline =
    outcome === "conflict"
      ? t.syncConflictNote
      : outcome === "stash-conflict"
        ? t.syncStashConflictB
        : (title[sync?.state ?? "ok"] ?? "");
  const explain =
    outcome === "conflict"
      ? t.syncConflictB
      : outcome === "stash-conflict"
        ? t.syncStashConflictB
        : (body[sync?.state ?? "ok"] ?? "");

  const canRebase = !!sync && sync.behind > 0 && (sync.state === "behind" || sync.state === "diverged");
  const fastForward = !!sync && sync.outgoing.length === 0;
  const canCheck = !!sync && sync.state !== "not-a-repo" && sync.state !== "no-remote";
  const interrupted = sync?.state === "rebasing";
  // Stale means the counts predate today's work somewhere else, so they are not
  // an answer to "am I behind" - only a fetch is.
  const stale = !!sync && canCheck && (sync.fetchDays === null || sync.fetchDays >= 1);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={t.syncTitle}
      onClick={app.closeSync}
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
          width: "min(620px, 100%)",
          maxHeight: "calc(100vh - 48px)",
          display: "flex",
          flexDirection: "column",
          borderRadius: 16,
          border: "1px solid rgba(var(--wrgb),.1)",
          background: "var(--elev)",
          boxShadow: "var(--shDlg)",
        }}
      >
        {/* --- head ------------------------------------------------------- */}
        <div style={{ padding: "20px 22px 0", flex: "0 0 auto" }}>
          <div style={{ display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
            <span style={{ fontSize: 15, fontWeight: 650, letterSpacing: "-.01em" }}>
              {t.syncTitle}
            </span>
            <span
              style={{
                fontFamily: mono,
                fontSize: 11.5,
                color: "rgba(var(--trgb),.6)",
                minWidth: 0,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {sync?.project || project?.name || ""}
            </span>
            {sync && (
              <span
                style={{
                  marginLeft: "auto",
                  fontFamily: mono,
                  fontSize: 11,
                  fontWeight: 600,
                  color: colour.fg,
                  border: `1px solid ${colour.bd}`,
                  background: colour.bg,
                  borderRadius: 99,
                  padding: "1px 9px",
                  whiteSpace: "nowrap",
                }}
              >
                ↑{sync.ahead} ↓{sync.behind}
              </span>
            )}
          </div>

          <div style={{ fontSize: 14, fontWeight: 600, margin: "14px 0 6px" }}>
            {sync ? headline : t.syncChecking}
          </div>
          <p
            style={{
              margin: 0,
              fontSize: 12.5,
              lineHeight: 1.6,
              color: "rgba(var(--trgb),.75)",
              textWrap: "pretty",
            }}
          >
            {sync ? explain : ""}
          </p>
        </div>

        {/* --- body ------------------------------------------------------- */}
        <div
          style={{
            padding: "16px 22px",
            display: "flex",
            flexDirection: "column",
            gap: 12,
            minHeight: 0,
            overflowY: "auto",
          }}
        >
          {sync && (
            <div
              style={{
                borderRadius: 11,
                border: "1px solid rgba(var(--wrgb),.09)",
                background: "rgba(var(--wrgb),.03)",
                padding: "10px 13px",
              }}
            >
              <Fact label={t.syncBranchL} value={sync.branch || "—"} icon />
              <Fact label={t.syncUpstreamL} value={sync.upstream || "—"} />
              <Fact
                label={t.syncCheckedL}
                value={sync.fetchDays === null ? t.syncNever : ago(sync.fetchDays, app.lang)}
                fg={stale ? "var(--warnTx)" : undefined}
              />
              {sync.dirty > 0 && (
                <Fact label={t.dirtyL} value={`±${sync.dirty}`} fg="var(--danTx)" />
              )}
            </div>
          )}

          {stale && !syncBusy && (
            <div style={{ fontSize: 11.5, color: "var(--warnTx)", lineHeight: 1.5 }}>
              {t.syncStale}
            </div>
          )}

          {sync && sync.error && (
            <Block title={t.syncFetchFailed} tone="danger">
              <code style={{ fontFamily: mono, fontSize: 10.5, wordBreak: "break-word" }}>
                {sync.error}
              </code>
            </Block>
          )}

          {sync && sync.incoming.length > 0 && (
            <Block
              title={`${t.syncIncomingL} · ${sync.behind} ${sync.behind === 1 ? t.syncCommit : t.syncCommits}`}
              note={sync.authors.length ? `${t.syncFrom}: ${sync.authors.join(", ")}` : undefined}
            >
              <CommitList commits={sync.incoming} app={app} accent />
            </Block>
          )}

          {sync && sync.outgoing.length > 0 && (
            <Block title={`${t.syncOutgoingL} · ${sync.ahead}`}>
              <CommitList commits={sync.outgoing} app={app} />
            </Block>
          )}

          {sync && sync.dirty > 0 && canRebase && (
            <div style={{ fontSize: 11.5, color: "rgba(var(--trgb),.7)", lineHeight: 1.55 }}>
              {t.syncDirtyB}
            </div>
          )}

          {sync && sync.conflicts.length > 0 && (
            <Block title={`${t.syncConflictsL} · ${sync.conflicts.length}`} tone="danger">
              {sync.conflicts.map((file) => (
                <div
                  key={file}
                  style={{
                    fontFamily: mono,
                    fontSize: 11,
                    color: "var(--danTx2)",
                    padding: "2px 0",
                    wordBreak: "break-all",
                  }}
                >
                  {file}
                </div>
              ))}
            </Block>
          )}

          {/* The commands themselves, because this is somebody else's
              repository and they are entitled to know what was run in it. */}
          {sync && (canRebase || interrupted) && (
            <Block title={t.syncRuns}>
              {(interrupted
                ? ["git rebase --continue", "git rebase --abort"]
                : ["git fetch --prune", `git rebase --autostash ${sync.upstream}`]
              ).map((line) => (
                <div
                  key={line}
                  style={{
                    fontFamily: mono,
                    fontSize: 10.5,
                    color: "var(--accTx)",
                    padding: "2px 0",
                    wordBreak: "break-all",
                  }}
                >
                  {line}
                </div>
              ))}
            </Block>
          )}

          {syncReport?.output && (
            <Block title={t.syncOutputL}>
              <pre
                style={{
                  margin: 0,
                  fontFamily: mono,
                  fontSize: 10.5,
                  lineHeight: 1.5,
                  color: "rgba(var(--trgb),.7)",
                  whiteSpace: "pre-wrap",
                  wordBreak: "break-word",
                }}
              >
                {syncReport.output}
              </pre>
            </Block>
          )}
        </div>

        {/* --- actions ---------------------------------------------------- */}
        <div
          style={{
            flex: "0 0 auto",
            display: "flex",
            flexWrap: "wrap",
            gap: 8,
            justifyContent: "flex-end",
            padding: "0 22px 20px",
          }}
        >
          <button type="button" className="h-ghost" onClick={app.closeSync} style={ghost}>
            {t.syncClose}
          </button>

          {project && (interrupted || (sync?.conflicts.length ?? 0) > 0) && (
            <button
              type="button"
              className="h-ghost"
              onClick={() => void api.openTerminal(project.path)}
              style={ghost}
            >
              {t.openTerm}
            </button>
          )}

          {canCheck && (
            <button
              type="button"
              className="h-ghost"
              onClick={() => void app.checkRemote()}
              disabled={syncBusy}
              style={{ ...ghost, opacity: syncBusy ? 0.55 : 1, gap: 7, display: "flex", alignItems: "center" }}
            >
              <Refresh size={12} />
              {syncBusy ? t.syncChecking : t.syncCheck}
            </button>
          )}

          {interrupted && (
            <button
              type="button"
              className="h-danger"
              onClick={() => void app.abortRebase()}
              disabled={syncBusy}
              style={{
                border: "1px solid rgba(var(--danrgb),.45)",
                borderRadius: 10,
                background: "rgba(var(--danrgb),.12)",
                color: "var(--danTx2)",
                padding: "7px 14px",
                cursor: syncBusy ? "default" : "pointer",
                fontSize: 12,
                fontWeight: 600,
                opacity: syncBusy ? 0.55 : 1,
              }}
            >
              {t.syncAbort}
            </button>
          )}

          {canRebase && (
            <button
              type="button"
              className="h-accent-strong"
              onClick={() => void app.rebaseProject()}
              disabled={syncBusy}
              style={{
                border: "1px solid rgba(var(--accrgb),.5)",
                borderRadius: 10,
                background: "rgba(var(--accrgb),.16)",
                color: "var(--accTx)",
                padding: "7px 14px",
                cursor: syncBusy ? "default" : "pointer",
                fontSize: 12,
                fontWeight: 600,
                opacity: syncBusy ? 0.55 : 1,
              }}
            >
              {fastForward ? t.syncFf : t.syncRebase}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

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

function Fact({
  label,
  value,
  fg,
  icon = false,
}: {
  label: string;
  value: string;
  fg?: string;
  icon?: boolean;
}) {
  return (
    <div style={{ display: "flex", alignItems: "baseline", gap: 10, padding: "3px 0" }}>
      <span style={{ fontSize: 11, color: "rgba(var(--trgb),.5)", flex: "0 0 88px" }}>{label}</span>
      <span
        style={{
          fontFamily: mono,
          fontSize: 11.5,
          color: fg ?? "rgba(var(--trgb),.85)",
          minWidth: 0,
          display: "flex",
          alignItems: "center",
          gap: 5,
          wordBreak: "break-word",
        }}
      >
        {icon && <GitBranch size={11} style={{ opacity: 0.55 }} />}
        {value}
      </span>
    </div>
  );
}

function Block({
  title,
  note,
  tone = "plain",
  children,
}: {
  title: string;
  note?: string;
  tone?: "plain" | "danger";
  children: ReactNode;
}) {
  return (
    <div
      style={{
        borderRadius: 11,
        border: `1px solid ${tone === "danger" ? "rgba(var(--danrgb),.3)" : "rgba(var(--wrgb),.09)"}`,
        background: tone === "danger" ? "rgba(var(--danrgb),.07)" : "rgba(var(--wrgb),.03)",
        padding: "10px 13px",
      }}
    >
      <div style={{ display: "flex", alignItems: "baseline", gap: 10, marginBottom: 7 }}>
        <span
          style={{
            fontSize: 10.5,
            letterSpacing: ".08em",
            textTransform: "uppercase",
            color: "rgba(var(--trgb),.5)",
          }}
        >
          {title}
        </span>
        {note && (
          <span
            style={{
              fontSize: 11,
              color: "rgba(var(--trgb),.62)",
              marginLeft: "auto",
              minWidth: 0,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
            title={note}
          >
            {note}
          </span>
        )}
      </div>
      {children}
    </div>
  );
}

function CommitList({
  commits,
  app,
  accent = false,
}: {
  commits: Commit[];
  app: App;
  accent?: boolean;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
      {commits.map((c, i) => (
        <div
          key={`${c.sha}-${i}`}
          style={{
            display: "grid",
            gridTemplateColumns: "64px minmax(0,1fr) auto",
            gap: 9,
            alignItems: "baseline",
            padding: "2px 0",
          }}
        >
          <span
            style={{
              fontFamily: mono,
              fontSize: 10.5,
              color: accent ? "var(--accTx)" : "rgba(var(--trgb),.45)",
            }}
          >
            {c.sha}
          </span>
          <span
            style={{
              fontSize: 11.5,
              color: "rgba(var(--trgb),.82)",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
            title={c.msg}
          >
            {c.msg}
          </span>
          <span
            style={{
              fontFamily: mono,
              fontSize: 10,
              color: "rgba(var(--trgb),.45)",
              whiteSpace: "nowrap",
            }}
            title={c.author}
          >
            {/* The author is the point of this list, so it is what the row ends
                on; the date only earns its place when there is no name. */}
            {c.author || ago(c.days, app.lang)}
          </span>
        </div>
      ))}
    </div>
  );
}
