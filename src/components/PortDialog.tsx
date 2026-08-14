// Asked before starting a command whose port is already taken.
//
// Half a dozen projects on one machine all default to 3000 or 5173. Without
// this the second dev server of the day dies with EADDRINUSE several seconds
// after it looked like it started, in a log nobody was watching.

import type { App } from "../useApp";

const mono = "'JetBrains Mono',monospace";

export function PortDialog({ app }: { app: App }) {
  const { t, portAsk: ask } = app;
  if (!ask) return null;

  const { conflict, command, project } = ask;
  const holder = conflict.holder;
  const process = conflict.process;
  // Either kind of holder can be cleared: one through the runner that owns it,
  // the other by ending the process. A system process is the only case with
  // nothing to offer.
  const canResolve = !!holder || !!process?.killable;
  const foreign = !holder && !!process;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={t.portTitle}
      onClick={app.dismissPortAsk}
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
          width: "min(520px, 100%)",
          borderRadius: 16,
          border: "1px solid rgba(var(--wrgb),.1)",
          background: "var(--elev)",
          boxShadow: "var(--shDlg)",
          padding: "20px 22px",
        }}
      >
        <div style={{ display: "flex", alignItems: "baseline", gap: 10, marginBottom: 10 }}>
          <span style={{ fontSize: 15, fontWeight: 650, letterSpacing: "-.01em" }}>
            {t.portTitle}
          </span>
          <span
            style={{
              fontFamily: mono,
              fontSize: 12,
              fontWeight: 600,
              color: "var(--warnTx)",
              border: "1px solid rgba(255,212,121,.4)",
              background: "rgba(255,212,121,.12)",
              borderRadius: 99,
              padding: "1px 9px",
            }}
          >
            :{conflict.port}
          </span>
        </div>

        <p style={{ margin: "0 0 12px", fontSize: 12.5, color: "rgba(var(--trgb),.75)", lineHeight: 1.55 }}>
          {holder
            ? t.portHeldByUs
            : process?.killable
              ? t.portHeldByProcess
              : process
                ? t.portHeldBySystem
                : t.portHeldByOther}
        </p>

        <div
          style={{
            borderRadius: 11,
            border: "1px solid rgba(var(--wrgb),.09)",
            background: "rgba(var(--wrgb),.03)",
            padding: "11px 13px",
            marginBottom: 16,
          }}
        >
          {holder && (
            <Row label={t.portHolder} value={`${holder.project} · ${holder.cmd}`} accent />
          )}
          {process && (
            <Row
              label={t.portHolder}
              value={`${process.name} · PID ${process.pid}`}
              hint={process.exe}
              accent
            />
          )}
          <Row label={t.portWaiting} value={`${project.name} · ${command.cmd}`} />
        </div>

        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, justifyContent: "flex-end" }}>
          <button
            type="button"
            className="h-ghost"
            onClick={app.dismissPortAsk}
            style={{
              border: "1px solid rgba(var(--wrgb),.12)",
              borderRadius: 10,
              background: "rgba(var(--wrgb),.04)",
              color: "rgba(var(--trgb),.8)",
              padding: "7px 14px",
              cursor: "pointer",
              fontSize: 12,
              fontWeight: 500,
            }}
          >
            {t.portCancel}
          </button>

          <button
            type="button"
            className="h-ghost"
            onClick={() => void app.startAnyway()}
            title={t.portAnywayHint}
            style={{
              border: "1px solid rgba(var(--wrgb),.12)",
              borderRadius: 10,
              background: "rgba(var(--wrgb),.04)",
              color: "rgba(var(--trgb),.8)",
              padding: "7px 14px",
              cursor: "pointer",
              fontSize: 12,
              fontWeight: 500,
            }}
          >
            {t.portAnyway}
          </button>

          {/* Ending a process the app did not start is the heavier of the two,
              so it says whose name it is and is styled as what it is. */}
          {canResolve && (
            <button
              type="button"
              className={foreign ? "h-danger" : "h-accent-strong"}
              onClick={() => void app.resolvePortAndStart()}
              style={{
                border: `1px solid ${foreign ? "rgba(var(--danrgb),.5)" : "rgba(var(--accrgb),.5)"}`,
                borderRadius: 10,
                background: foreign ? "rgba(var(--danrgb),.16)" : "rgba(var(--accrgb),.16)",
                color: foreign ? "var(--danTx2)" : "var(--accTx)",
                padding: "7px 14px",
                cursor: "pointer",
                fontSize: 12,
                fontWeight: 600,
              }}
            >
              {foreign ? `${t.portKill} ${process?.name}` : t.portResolve}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function Row({
  label,
  value,
  hint,
  accent = false,
}: {
  label: string;
  value: string;
  hint?: string;
  accent?: boolean;
}) {
  return (
    <div style={{ display: "flex", alignItems: "baseline", gap: 10, padding: "3px 0" }}>
      <span style={{ fontSize: 11, color: "rgba(var(--trgb),.5)", flex: "0 0 92px" }}>{label}</span>
      <span style={{ minWidth: 0 }}>
        <span
          style={{
            display: "block",
            fontFamily: mono,
            fontSize: 11.5,
            color: accent ? "var(--accTx)" : "rgba(var(--trgb),.85)",
            wordBreak: "break-word",
          }}
        >
          {value}
        </span>
        {/* The executable path is what tells two `node.exe` apart. */}
        {hint && (
          <span
            style={{
              display: "block",
              fontFamily: mono,
              fontSize: 9.5,
              color: "rgba(var(--trgb),.45)",
              wordBreak: "break-all",
            }}
          >
            {hint}
          </span>
        )}
      </span>
    </div>
  );
}
