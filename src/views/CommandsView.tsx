import { useEffect, useMemo, useRef } from "react";

import { FavouriteButton, RailHeader } from "../components/GroupHeader";
import { Play, Stop } from "../components/Icons";
import { cmdKey, manifestLabel } from "../format";
import { groupWithFavourites } from "../grouping";
import type { App } from "../useApp";

export function CommandsView({ app }: { app: App }) {
  const { t, projects, cmdSel, running, log } = app;

  const logRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const el = logRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [log]);

  const runnable = projects.filter((p) => p.commands.length > 0);
  const selected = runnable.find((p) => p.id === cmdSel) ?? runnable[0];

  // Folders with something running float to the top, then the busiest ones.
  const groups = useMemo(
    () =>
      groupWithFavourites(
        runnable,
        app.favourites,
        (items) => {
          const active = items.filter((p) =>
            p.commands.some((c) => running.has(cmdKey(p.id, c))),
          ).length;
          return active * 1000 + items.length;
        },
        t.favourites,
      ),
    [runnable, running, app.favourites, t.favourites],
  );
  const showHeaders = groups.length > 1;

  const runningLabel = [...running]
    .map((k) => {
      const [project = "", cwd = "", cmd = ""] = k.split("|");
      return `${cmd} → ${project}${cwd ? `/${cwd}` : ""}`;
    })
    .join("   ·   ");

  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "246px 1fr",
        gap: 16,
        alignItems: "stretch",
        height: "100%",
        minHeight: 0,
        padding: "0 20px 20px",
      }}
    >
      <div style={{ overflow: "auto", minHeight: 0, display: "flex", flexDirection: "column", gap: 2 }}>
        {groups.map((group) => (
          <div key={group.key}>
            {showHeaders && (
              <RailHeader
                label={group.label}
                title={group.favourite ? t.favourites : group.key}
                pinned={group.favourite}
                meta={
                  <span
                    style={{
                      fontFamily: "'JetBrains Mono',monospace",
                      fontSize: 9.5,
                      color: "rgba(var(--trgb),.42)",
                    }}
                  >
                    {group.items.length}
                  </span>
                }
              />
            )}
            {group.items.map((p) => {
          const on = p.id === selected?.id;
          const hasRunning = p.commands.some((c) => running.has(cmdKey(p.id, c)));
          return (
            // A div, not a button: it carries the favourite toggle, and a
            // button may not be nested inside another button.
            <div
              key={p.id}
              role="button"
              tabIndex={0}
              aria-pressed={on}
              className="h-soft"
              onClick={() => app.setCmdSel(p.id)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  app.setCmdSel(p.id);
                }
              }}
              style={{
                width: "100%",
                display: "flex",
                alignItems: "center",
                gap: 8,
                textAlign: "left",
                border: `1px solid ${on ? "rgba(var(--wrgb),.12)" : "transparent"}`,
                borderRadius: 11,
                background: on ? "rgba(var(--wrgb),.06)" : "transparent",
                padding: "9px 11px",
                cursor: "pointer",
              }}
            >
              <span style={{ flex: 1, minWidth: 0 }}>
                <span
                  style={{
                    display: "block",
                    fontSize: 12.5,
                    fontWeight: 500,
                    whiteSpace: "nowrap",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    color: on ? "var(--t0)" : "rgba(var(--trgb),.65)",
                  }}
                >
                  {p.name}
                </span>
                <span
                  style={{
                    display: "block",
                    fontFamily: "'JetBrains Mono',monospace",
                    fontSize: 9.5,
                    color: "rgba(var(--trgb),.54)",
                    whiteSpace: "nowrap",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    marginTop: 1,
                  }}
                >
                  {manifestLabel(p.manifests)}
                </span>
              </span>
              {hasRunning && (
                <span
                  style={{
                    width: 6,
                    height: 6,
                    borderRadius: 99,
                    background: "var(--acc)",
                    boxShadow: "0 0 10px rgba(var(--accrgb),.8)",
                    animation: "upaPulse 1.8s infinite",
                    flex: "0 0 6px",
                  }}
                />
              )}
              <FavouriteButton
                on={app.favourites.has(p.id)}
                onClick={() => app.toggleFavourite(p.id)}
                title={app.favourites.has(p.id) ? t.removeFav : t.addFav}
              />
            </div>
          );
            })}
          </div>
        ))}
      </div>

      <div style={{ display: "flex", flexDirection: "column", minHeight: 0, gap: 14 }}>
        <div
          style={{
            flex: 1,
            minHeight: 0,
            overflow: "auto",
            border: "1px solid rgba(var(--wrgb),.08)",
            borderRadius: 14,
            background: "rgba(var(--wrgb),.022)",
            padding: "14px 16px",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 9, marginBottom: 6 }}>
            <span
              style={{
                fontSize: 10.5,
                letterSpacing: ".09em",
                textTransform: "uppercase",
                color: "rgba(var(--trgb),.56)",
              }}
            >
              {t.detected}
            </span>
            <span
              style={{
                fontFamily: "'JetBrains Mono',monospace",
                fontSize: 10.5,
                color: "rgba(var(--trgb),.5)",
              }}
            >
              {selected ? manifestLabel(selected.manifests) : "—"}
            </span>
          </div>

          {!selected && (
            <div style={{ fontSize: 12.5, color: "rgba(var(--trgb),.5)", padding: "8px 0" }}>
              {t.emptyCmds}
            </div>
          )}

          {selected?.commands.map((c) => {
            const key = cmdKey(selected.id, c);
            const on = running.has(key);
            const strong = c.kind === "docker" || c.kind === "cargo";

            return (
              <div
                key={key}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 11,
                  padding: "10px 0",
                  borderTop: "1px solid rgba(var(--wrgb),.06)",
                }}
              >
                <span
                  style={{
                    fontSize: 10.5,
                    fontWeight: 500,
                    border: `1px solid ${strong ? "rgba(var(--accrgb),.3)" : "rgba(var(--wrgb),.1)"}`,
                    background: strong ? "rgba(var(--accrgb),.1)" : "rgba(var(--wrgb),.04)",
                    color: strong ? "var(--accTx)" : "rgba(var(--trgb),.6)",
                    borderRadius: 99,
                    padding: "2px 8px",
                    flex: "0 0 auto",
                  }}
                >
                  {c.kind}
                </span>

                <span style={{ minWidth: 0, flex: 1 }}>
                  <span
                    style={{ display: "flex", alignItems: "baseline", gap: 7, fontSize: 13, fontWeight: 500 }}
                  >
                    {c.name}
                    {c.cwd && (
                      <span
                        style={{
                          fontFamily: "'JetBrains Mono',monospace",
                          fontSize: 9.5,
                          fontWeight: 500,
                          border: "1px solid rgba(var(--coolrgb),.35)",
                          background: "rgba(var(--coolrgb),.12)",
                          color: "rgba(var(--trgb),.7)",
                          borderRadius: 99,
                          padding: "1px 7px",
                        }}
                      >
                        {c.cwd}
                      </span>
                    )}
                  </span>
                  <span
                    style={{
                      display: "block",
                      fontFamily: "'JetBrains Mono',monospace",
                      fontSize: 10.5,
                      color: "rgba(var(--trgb),.4)",
                      whiteSpace: "nowrap",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                    }}
                  >
                    {c.cmd}
                  </span>
                </span>

                <span
                  style={{
                    fontFamily: "'JetBrains Mono',monospace",
                    fontSize: 10,
                    color: on ? "var(--acc)" : "rgba(var(--trgb),.46)",
                    whiteSpace: "nowrap",
                  }}
                >
                  {on ? `● ${t.runningL}` : t.idleL}
                </span>

                <button
                  type="button"
                  onClick={() => void app.toggleCommand(selected, c)}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 6,
                    border: `1px solid ${on ? "rgba(var(--danrgb),.45)" : "rgba(var(--wrgb),.12)"}`,
                    borderRadius: 9,
                    background: on ? "rgba(var(--danrgb),.14)" : "rgba(var(--wrgb),.04)",
                    color: on ? "var(--danTx2)" : "rgba(var(--trgb),.85)",
                    padding: "6px 11px",
                    cursor: "pointer",
                    fontSize: 11.5,
                    fontWeight: 600,
                    flex: "0 0 auto",
                  }}
                >
                  {on ? <Stop size={8} /> : <Play size={9} />}
                  {on ? t.stop : t.run}
                </button>
              </div>
            );
          })}
        </div>

        <div
          style={{
            flex: "0 0 230px",
            height: 230,
            minHeight: 0,
            border: "1px solid rgba(var(--wrgb),.08)",
            borderRadius: 14,
            background: "var(--term)",
            display: "flex",
            flexDirection: "column",
            overflow: "hidden",
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 9,
              padding: "9px 14px",
              borderBottom: "1px solid rgba(var(--wrgb),.07)",
            }}
          >
            <span
              style={{
                fontSize: 10.5,
                letterSpacing: ".09em",
                textTransform: "uppercase",
                color: "rgba(var(--trgb),.56)",
              }}
            >
              {t.logs}
            </span>
            <span
              style={{
                fontFamily: "'JetBrains Mono',monospace",
                fontSize: 10,
                color: "rgba(var(--accrgb),.55)",
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
              }}
            >
              {runningLabel || "idle"}
            </span>
            <button
              type="button"
              className="h-ghost"
              onClick={app.clearLog}
              style={{
                marginLeft: "auto",
                border: "1px solid rgba(var(--wrgb),.1)",
                borderRadius: 8,
                background: "transparent",
                color: "rgba(var(--trgb),.55)",
                padding: "3px 9px",
                cursor: "pointer",
                fontSize: 10.5,
                fontWeight: 500,
                flex: "0 0 auto",
              }}
            >
              {t.clearLog}
            </button>
          </div>

          <div
            ref={logRef}
            style={{
              flex: 1,
              overflow: "auto",
              padding: "9px 14px",
              fontFamily: "'JetBrains Mono',monospace",
              fontSize: 11,
              lineHeight: 1.6,
            }}
          >
            {log.length === 0 && (
              <div style={{ display: "flex", gap: 11 }}>
                <span style={{ color: "rgba(var(--trgb),.44)", flex: "0 0 52px" }}>--:--:--</span>
                <span style={{ color: "rgba(var(--trgb),.52)" }}>
                  {app.lang === "hu"
                    ? "Nincs futó parancs. Indíts el egy scriptet a log megjelenítéséhez."
                    : "Nothing running. Start a script to stream its log here."}
                </span>
              </div>
            )}
            {log.map((line, i) => (
              <div key={i} style={{ display: "flex", gap: 11 }}>
                <span style={{ color: "rgba(var(--trgb),.44)", flex: "0 0 52px" }}>{line.time}</span>
                <span style={{ color: line.fg, whiteSpace: "pre-wrap", minWidth: 0, wordBreak: "break-word" }}>
                  {line.text}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
