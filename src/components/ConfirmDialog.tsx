import { useEffect, useMemo } from "react";

import { size, tailPath } from "../format";
import type { App } from "../useApp";
import type { CleanTarget } from "../types";

/** Rows grouped by project, biggest project first. */
function groupByProject(rows: CleanTarget[]) {
  const byProject = new Map<string, CleanTarget[]>();
  for (const row of rows) {
    const list = byProject.get(row.project);
    if (list) list.push(row);
    else byProject.set(row.project, [row]);
  }

  return [...byProject.entries()]
    .map(([project, items]) => ({
      project,
      items: items.slice().sort((a, b) => b.bytes - a.bytes),
      bytes: items.reduce((total, r) => total + r.bytes, 0),
    }))
    .sort((a, b) => b.bytes - a.bytes);
}

export function ConfirmDialog({ app }: { app: App }) {
  const { t, confirmOpen, selectedRows, selectedBytes, cleanProgress } = app;
  const running = cleanProgress !== null;

  useEffect(() => {
    if (!confirmOpen) return;
    const onKey = (e: KeyboardEvent) => {
      // Escape must not abandon a cleanup that is already underway.
      if (e.key === "Escape" && !running) app.setConfirmOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [confirmOpen, running, app]);

  const groups = useMemo(() => groupByProject(selectedRows), [selectedRows]);

  if (!confirmOpen) return null;

  // Only the first few projects are listed; the rest are counted in the footer.
  const shown = groups.slice(0, 4);
  const hiddenDirs = groups.slice(4).reduce((total, g) => total + g.items.length, 0);
  const foot = hiddenDirs > 0 ? `+${hiddenDirs} ${t.moreL}` : t.totalL;

  const pct = cleanProgress?.total
    ? Math.round((cleanProgress.done / cleanProgress.total) * 100)
    : 0;

  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        background: "var(--backdrop)",
        backdropFilter: "blur(8px)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 36,
        zIndex: 40,
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-busy={running}
        style={{
          width: "min(560px,100%)",
          background: "var(--elev)",
          border: "1px solid rgba(var(--wrgb),.1)",
          borderRadius: 16,
          boxShadow: "var(--shDlg)",
          display: "flex",
          flexDirection: "column",
          maxHeight: "100%",
          overflow: "hidden",
        }}
      >
        <div style={{ padding: "17px 20px 14px" }}>
          <div style={{ fontSize: 19, fontWeight: 600, letterSpacing: "-.02em" }}>
            {running ? t.cleaning : t.confirm}
          </div>
          <div
            style={{
              fontSize: 12.5,
              color: "rgba(var(--trgb),.5)",
              maxWidth: "56ch",
              marginTop: 5,
              textWrap: "pretty",
            }}
          >
            {running ? t.cleaningBody : t.confirmBody}
          </div>
        </div>

        {running ? (
          <div style={{ padding: "0 20px 4px" }}>
            <div
              style={{
                height: 6,
                borderRadius: 99,
                background: "rgba(var(--wrgb),.09)",
                overflow: "hidden",
              }}
            >
              <div
                style={{
                  height: 6,
                  borderRadius: 99,
                  background: "var(--acc)",
                  width: `${pct}%`,
                  transition: "width 200ms",
                }}
              />
            </div>

            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                gap: 12,
                marginTop: 10,
                fontFamily: "'JetBrains Mono',monospace",
                fontSize: 11,
                color: "rgba(var(--trgb),.55)",
              }}
            >
              <span>
                {cleanProgress.phase === "rescan" ? t.cleaningRescan : t.cleaningDelete}{" "}
                {cleanProgress.done} / {cleanProgress.total}
              </span>
              <span style={{ color: "var(--accTx)" }}>{size(cleanProgress.freedBytes)}</span>
            </div>

            <div
              style={{
                marginTop: 8,
                fontFamily: "'JetBrains Mono',monospace",
                fontSize: 11,
                color: "rgba(var(--trgb),.45)",
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
                minHeight: 16,
              }}
              title={cleanProgress.current}
            >
              {cleanProgress.current ? tailPath(cleanProgress.current, 56) : ""}
            </div>
          </div>
        ) : (
          <div style={{ padding: "0 20px", overflow: "auto" }}>
            {shown.map((group) => (
              <div key={group.project} style={{ borderTop: "1px solid rgba(var(--wrgb),.06)" }}>
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    gap: 10,
                    padding: "9px 0 4px",
                    fontSize: 12.5,
                    fontWeight: 600,
                  }}
                >
                  <span
                    style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}
                  >
                    {group.project}
                  </span>
                  <span
                    style={{
                      fontFamily: "'JetBrains Mono',monospace",
                      fontSize: 11.5,
                      color: "rgba(var(--trgb),.55)",
                      fontWeight: 500,
                    }}
                  >
                    {group.items.length} · {size(group.bytes)}
                  </span>
                </div>

                {group.items.map((row) => (
                  <div
                    key={row.key}
                    style={{
                      display: "flex",
                      gap: 10,
                      padding: "3px 0 3px 12px",
                      fontFamily: "'JetBrains Mono',monospace",
                      fontSize: 11,
                    }}
                  >
                    <span
                      style={{
                        flex: 1,
                        minWidth: 0,
                        whiteSpace: "nowrap",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        color: "rgba(var(--trgb),.55)",
                      }}
                      title={row.path}
                    >
                      {row.part ? `${row.part}/ ` : ""}
                      {row.cat}
                    </span>
                    <span style={{ fontWeight: 500 }}>{size(row.bytes)}</span>
                  </div>
                ))}
              </div>
            ))}

            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                borderTop: "1px solid rgba(var(--wrgb),.12)",
                marginTop: 10,
                padding: "10px 0 0",
                fontFamily: "'JetBrains Mono',monospace",
                fontSize: 12,
                fontWeight: 500,
              }}
            >
              <span style={{ color: "rgba(var(--trgb),.55)" }}>{foot}</span>
              <span style={{ color: "var(--accTx)" }}>{size(selectedBytes)}</span>
            </div>
          </div>
        )}

        <div style={{ display: "flex", gap: 9, padding: "16px 20px", justifyContent: "flex-end" }}>
          <button
            type="button"
            className="h-ghost"
            onClick={() => app.setConfirmOpen(false)}
            disabled={running}
            style={{
              border: "1px solid rgba(var(--wrgb),.1)",
              borderRadius: 10,
              background: "transparent",
              padding: "8px 14px",
              cursor: running ? "default" : "pointer",
              fontSize: 12.5,
              fontWeight: 500,
              color: running ? "rgba(var(--trgb),.35)" : "rgba(var(--trgb),.75)",
            }}
          >
            {t.cancel}
          </button>
          <button
            type="button"
            className="h-danger"
            onClick={() => void app.doClean()}
            disabled={running}
            style={{
              border: "1px solid rgba(var(--danrgb),.5)",
              borderRadius: 10,
              background: "rgba(var(--danrgb),.16)",
              color: "var(--danTx2)",
              padding: "8px 16px",
              cursor: running ? "progress" : "pointer",
              fontSize: 12.5,
              fontWeight: 600,
              opacity: running ? 0.6 : 1,
            }}
          >
            {running ? `${pct}%` : `${t.del} · ${size(selectedBytes)}`}
          </button>
        </div>
      </div>
    </div>
  );
}
