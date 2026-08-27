// What GitHub lets this machine see, and how to widen it.
//
// Private repositories are the reason this exists. A token without the `repo`
// scope does not get a polite refusal for them - GitHub answers 404, as though
// they were not there at all - so an app that only reported what it was told
// would say "no such repository" where the truth is "no such permission".

import { useEffect } from "react";

import type { App } from "../useApp";

const mono = "'JetBrains Mono',monospace";

export function GitHubConnection({ app }: { app: App }) {
  const { t, github } = app;

  useEffect(() => {
    if (github) return;
    void app.refreshGithub();
  }, [github, app]);

  if (!github) return <div style={note}>{t.checking}</div>;
  if (!github.available) return <div style={note}>{t.actionsNoGh}</div>;
  if (!github.authenticated) {
    return <div style={{ ...note, color: "var(--warnTx)" }}>{github.error || t.actionsNoAuth}</div>;
  }

  const missing = github.missingScopes;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 8, flexWrap: "wrap" }}>
        <span style={label}>{t.ghConnAs}</span>
        <span style={{ fontFamily: mono, fontSize: 12, fontWeight: 500 }}>{github.login}</span>
      </div>

      <div style={{ display: "flex", alignItems: "baseline", gap: 8, flexWrap: "wrap" }}>
        <span style={label}>{t.ghScopes}</span>
        <span style={{ display: "flex", flexWrap: "wrap", gap: 5 }}>
          {github.scopes.map((scope) => (
            <Pill key={scope} label={scope} />
          ))}
          {missing.map((scope) => (
            <Pill key={scope} label={scope} missing />
          ))}
        </span>
      </div>

      {missing.length === 0 ? (
        <div style={{ fontSize: 11.5, color: "rgba(var(--trgb),.45)" }}>{t.ghAllGood}</div>
      ) : (
        <>
          <div style={{ fontSize: 11.5, color: "var(--warnTx)" }}>
            {t.ghMissing}: {missing.join(", ")}
          </div>
          <div
            style={{
              fontFamily: mono,
              fontSize: 11,
              border: "1px solid rgba(var(--wrgb),.1)",
              background: "rgba(var(--wrgb),.04)",
              borderRadius: 9,
              padding: "8px 10px",
              userSelect: "text",
              overflowX: "auto",
              whiteSpace: "nowrap",
            }}
          >
            {github.fixCommand}
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button
              type="button"
              className="h-accent"
              onClick={() => void app.copyGithubFix()}
              style={button(true)}
            >
              {t.ghCopyCmd}
            </button>
            {/* The command is interactive - it opens a browser and waits - so
                it belongs in a terminal rather than in this app's runner. */}
            <button
              type="button"
              className="h-ghost"
              onClick={() => void app.openHomeTerminal()}
              style={button(false)}
            >
              {t.ghOpenTerm}
            </button>
          </div>
          <div style={{ fontSize: 11.5, color: "rgba(var(--trgb),.45)", maxWidth: "68ch" }}>
            {t.ghFixHint}
          </div>
        </>
      )}
    </div>
  );
}

const note = { fontSize: 11.5, color: "rgba(var(--trgb),.5)" } as const;

const label = {
  fontSize: 9.5,
  letterSpacing: ".08em",
  textTransform: "uppercase",
  color: "rgba(var(--trgb),.45)",
} as const;

function button(accent: boolean) {
  return {
    border: `1px solid ${accent ? "rgba(var(--accrgb),.45)" : "rgba(var(--wrgb),.12)"}`,
    borderRadius: 9,
    background: accent ? "rgba(var(--accrgb),.12)" : "rgba(var(--wrgb),.03)",
    color: accent ? "var(--accTx)" : "rgba(var(--trgb),.7)",
    padding: "6px 12px",
    cursor: "pointer",
    fontSize: 11.5,
    fontWeight: 500,
  } as const;
}

function Pill({ label: text, missing = false }: { label: string; missing?: boolean }) {
  return (
    <span
      style={{
        fontFamily: mono,
        fontSize: 9.5,
        // There is no warn tint in the palette, only a warn ink; the missing
        // one is drawn in it, struck through, on the ordinary ground.
        border: `1px solid ${missing ? "var(--warnTx)" : "rgba(var(--wrgb),.12)"}`,
        background: "rgba(var(--wrgb),.03)",
        color: missing ? "var(--warnTx)" : "rgba(var(--trgb),.7)",
        borderRadius: 99,
        padding: "1px 8px",
        whiteSpace: "nowrap",
        textDecoration: missing ? "line-through" : undefined,
      }}
    >
      {text}
    </span>
  );
}
