// What a project needs installed, and what to do when something is missing.

import { useState } from "react";

import { Check, Close, Refresh } from "./Icons";
import { size } from "../format";
import type { App } from "../useApp";
import type { Container, DockerStatus, ToolStatus } from "../types";

const mono = "'JetBrains Mono',monospace";

/** Green when present, red when not — the only two answers that matter here. */
function Mark({ ok }: { ok: boolean }) {
  return (
    <span
      style={{
        width: 17,
        height: 17,
        flex: "0 0 17px",
        borderRadius: 99,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        border: `1px solid ${ok ? "rgba(var(--accrgb),.5)" : "rgba(var(--danrgb),.5)"}`,
        background: ok ? "rgba(var(--accrgb),.16)" : "rgba(var(--danrgb),.14)",
        color: ok ? "var(--accTx)" : "var(--danTx)",
      }}
    >
      {ok ? <Check size={9} /> : <Close size={10} strokeWidth={2.4} />}
    </span>
  );
}

function ToolRow({ tool, app }: { tool: ToolStatus; app: App }) {
  const { t } = app;
  const busy = app.installing.has(tool.id);
  // Installing software is not something to do on a stray click, and the
  // command is worth reading before it runs rather than hovering for it.
  const [confirming, setConfirming] = useState(false);

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        flexWrap: "wrap",
        gap: 10,
        padding: "9px 0",
        borderTop: "1px solid rgba(var(--wrgb),.06)",
      }}
    >
      <Mark ok={tool.found} />

      <span style={{ flex: 1, minWidth: 0 }}>
        <span style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
          <span style={{ fontSize: 12.5, fontWeight: 500 }}>{tool.name}</span>
          {tool.version && (
            <span style={{ fontFamily: mono, fontSize: 10.5, color: "rgba(var(--trgb),.5)" }}>
              {tool.version}
            </span>
          )}
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
          // The path says which of several installs is actually on PATH, which
          // is the question when a machine has two Pythons.
          title={tool.found ? tool.path : tool.docs}
        >
          {tool.found ? tool.path : `${t.requiredBy} ${tool.requiredBy.join(" · ")}`}
        </span>
      </span>

      {!tool.found &&
        (tool.install ? (
          <button
            type="button"
            className="h-accent"
            disabled={busy}
            onClick={() => setConfirming((v) => !v)}
            aria-expanded={confirming}
            style={{
              border: "1px solid rgba(var(--accrgb),.45)",
              borderRadius: 9,
              background: "rgba(var(--accrgb),.12)",
              color: "var(--accTx)",
              padding: "5px 11px",
              cursor: busy ? "default" : "pointer",
              fontSize: 11,
              fontWeight: 600,
              flex: "0 0 auto",
              opacity: busy ? 0.6 : 1,
            }}
          >
            {busy ? t.installing : t.install}
          </button>
        ) : (
          // No packaged installer for this one; saying where to get it beats
          // offering a command that would fail.
          <span
            style={{
              fontFamily: mono,
              fontSize: 9.5,
              color: "rgba(var(--trgb),.5)",
              maxWidth: 190,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
              flex: "0 0 auto",
            }}
            title={tool.docs}
          >
            {tool.docs.replace(/^https:\/\//, "")}
          </span>
        ))}

      {confirming && !busy && (
        <div
          style={{
            flex: "1 0 100%",
            display: "flex",
            alignItems: "center",
            flexWrap: "wrap",
            gap: 9,
            marginTop: 2,
            padding: "9px 11px",
            borderRadius: 10,
            border: "1px solid rgba(var(--accrgb),.3)",
            background: "rgba(var(--accrgb),.06)",
          }}
        >
          <span style={{ flex: "1 0 100%", fontSize: 11.5, color: "rgba(var(--trgb),.72)" }}>
            {t.installBody}
          </span>
          <code
            style={{
              flex: "1 0 100%",
              fontFamily: mono,
              fontSize: 10.5,
              color: "var(--accTx)",
              wordBreak: "break-all",
            }}
          >
            {tool.install}
          </code>
          <button
            type="button"
            className="h-accent-strong"
            onClick={() => {
              setConfirming(false);
              void app.installTool(tool);
            }}
            style={{
              border: "1px solid rgba(var(--accrgb),.5)",
              borderRadius: 9,
              background: "rgba(var(--accrgb),.16)",
              color: "var(--accTx)",
              padding: "5px 12px",
              cursor: "pointer",
              fontSize: 11,
              fontWeight: 600,
            }}
          >
            {t.installGo}
          </button>
          <button
            type="button"
            className="h-ghost"
            onClick={() => setConfirming(false)}
            style={{
              border: "1px solid rgba(var(--wrgb),.12)",
              borderRadius: 9,
              background: "rgba(var(--wrgb),.04)",
              color: "rgba(var(--trgb),.75)",
              padding: "5px 12px",
              cursor: "pointer",
              fontSize: 11,
              fontWeight: 500,
            }}
          >
            {t.cancel}
          </button>
        </div>
      )}
    </div>
  );
}

export function RequirementsBody({ app }: { app: App }) {
  const { t, requirements } = app;

  if (requirements === null) {
    return <div style={{ fontSize: 11.5, color: "rgba(var(--trgb),.44)" }}>{t.checking}</div>;
  }
  if (requirements.length === 0) {
    return <div style={{ fontSize: 11.5, color: "rgba(var(--trgb),.44)" }}>{t.noRequirements}</div>;
  }

  const missing = requirements.filter((r) => !r.found);

  return (
    <>
      <div style={{ fontSize: 11.5, color: missing.length ? "var(--danTx)" : "rgba(var(--trgb),.5)" }}>
        {missing.length === 0
          ? t.allPresent
          : `${missing.length} ${t.missingCount}: ${missing.map((m) => m.name).join(", ")}`}
      </div>
      {requirements.map((tool) => (
        <ToolRow key={tool.id} tool={tool} app={app} />
      ))}
    </>
  );
}

/** One line summarising the daemon, used as a card action. */
export function DockerChip({ status, t }: { status: DockerStatus | null; t: App["t"] }) {
  const [label, fg, bd, bg] = !status
    ? [t.checking, "rgba(var(--trgb),.5)", "rgba(var(--wrgb),.12)", "rgba(var(--wrgb),.04)"]
    : status.daemonRunning
      ? [t.dockerUp, "var(--accTx)", "rgba(var(--accrgb),.45)", "rgba(var(--accrgb),.12)"]
      : status.installed
        ? [t.dockerDown, "var(--warnTx)", "rgba(255,212,121,.4)", "rgba(255,212,121,.12)"]
        : [t.dockerAbsent, "rgba(var(--trgb),.55)", "rgba(var(--wrgb),.12)", "rgba(var(--wrgb),.04)"];

  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        fontFamily: mono,
        fontSize: 9.5,
        fontWeight: 500,
        border: `1px solid ${bd}`,
        background: bg,
        color: fg,
        borderRadius: 99,
        padding: "2px 9px",
      }}
      title={status?.error || status?.serverVersion || ""}
    >
      <span
        style={{
          width: 6,
          height: 6,
          borderRadius: 99,
          background: "currentColor",
          animation: status?.daemonRunning ? "upaPulse 2.4s infinite" : undefined,
        }}
      />
      {label}
    </span>
  );
}

export function DockerBody({ app }: { app: App }) {
  const { t, docker: status, containers } = app;

  if (!status) {
    return <div style={{ fontSize: 11.5, color: "rgba(var(--trgb),.44)" }}>{t.checking}</div>;
  }

  if (!status.installed) {
    return (
      <div style={{ fontSize: 11.5, color: "rgba(var(--trgb),.5)" }}>
        {t.dockerNotInstalled}
      </div>
    );
  }

  const facts: Array<[string, string]> = status.daemonRunning
    ? [
        [t.dockerVersion, status.serverVersion || status.cliVersion],
        [t.dockerContainers, `${status.containersRunning} / ${status.containersTotal}`],
        [t.dockerImages, `${status.images} · ${size(status.imagesBytes)}`],
        [t.dockerCache, size(status.buildCacheBytes)],
      ]
    : [[t.dockerVersion, status.cliVersion]];

  return (
    <>
      {!status.daemonRunning && (
        <div
          style={{
            fontSize: 11.5,
            color: "var(--warnTx)",
            padding: "2px 0 8px",
            wordBreak: "break-word",
          }}
        >
          {t.dockerStartHint}
          {status.error && (
            <span style={{ display: "block", fontFamily: mono, fontSize: 10, opacity: 0.75, marginTop: 4 }}>
              {status.error}
            </span>
          )}
        </div>
      )}

      {facts.map(([k, v]) => (
        <div
          key={k}
          style={{
            display: "flex",
            justifyContent: "space-between",
            gap: 10,
            padding: "6px 0",
            borderTop: "1px solid rgba(var(--wrgb),.06)",
          }}
        >
          <span style={{ fontSize: 11.5, color: "rgba(var(--trgb),.5)" }}>{k}</span>
          <span style={{ fontFamily: mono, fontSize: 11.5, fontWeight: 500 }}>{v || "—"}</span>
        </div>
      ))}

      {containers.length > 0 && (
        <div style={{ marginTop: 10 }}>
          <div
            style={{
              fontSize: 10,
              letterSpacing: ".07em",
              textTransform: "uppercase",
              color: "rgba(var(--trgb),.45)",
              marginBottom: 2,
            }}
          >
            {t.dockerStack}
          </div>
          {containers.map((c) => (
            <ContainerRow key={c.id} container={c} />
          ))}
        </div>
      )}
    </>
  );
}

function ContainerRow({ container }: { container: Container }) {
  const up = container.state === "running";
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        padding: "7px 0",
        borderTop: "1px solid rgba(var(--wrgb),.06)",
      }}
      title={`${container.image}${container.ports ? ` · ${container.ports}` : ""}`}
    >
      <span
        style={{
          width: 7,
          height: 7,
          flex: "0 0 7px",
          borderRadius: 99,
          background: up ? "var(--acc)" : "rgba(var(--trgb),.3)",
          boxShadow: up ? "0 0 8px rgba(var(--accrgb),.7)" : undefined,
        }}
      />
      <span style={{ flex: 1, minWidth: 0 }}>
        <span
          style={{
            display: "block",
            fontSize: 11.5,
            fontWeight: 500,
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
        >
          {container.service || container.name}
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
          {container.status}
        </span>
      </span>
    </div>
  );
}

/** Shared refresh affordance for both cards. */
export function RefreshAction({ onClick, title }: { onClick: () => void; title: string }) {
  return (
    <button
      type="button"
      className="h-link"
      onClick={onClick}
      title={title}
      style={{
        display: "flex",
        alignItems: "center",
        border: 0,
        background: "transparent",
        padding: 2,
        cursor: "pointer",
        color: "rgba(var(--trgb),.5)",
      }}
    >
      <Refresh size={12} />
    </button>
  );
}
