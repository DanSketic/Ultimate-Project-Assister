import { useEffect, useMemo } from "react";

import { size } from "../format";
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
  const { t, confirmOpen, selectedRows, selectedBytes } = app;
  // The cleanup no longer runs behind this dialog - it closes and the status
  // bar takes over - so there is nothing here that must not be interrupted.

  useEffect(() => {
    if (!confirmOpen) return;
    const onKey = (e: KeyboardEvent) => {
      // Escape must not abandon a cleanup that is already underway.
      if (e.key === "Escape") app.setConfirmOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [confirmOpen, app]);

  const groups = useMemo(() => groupByProject(selectedRows), [selectedRows]);

  if (!confirmOpen) return null;

  // Only the first few projects are listed; the rest are counted in the footer.
  const shown = groups.slice(0, 4);
  const hiddenDirs = groups.slice(4).reduce((total, g) => total + g.items.length, 0);
  const foot = hiddenDirs > 0 ? `+${hiddenDirs} ${t.moreL}` : t.totalL;

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
            {t.confirm}
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
            {t.confirmBody}
          </div>
        </div>

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

        <div style={{ display: "flex", gap: 9, padding: "16px 20px", justifyContent: "flex-end" }}>
          <button
            type="button"
            className="h-ghost"
            onClick={() => app.setConfirmOpen(false)}
            style={{
              border: "1px solid rgba(var(--wrgb),.1)",
              borderRadius: 10,
              background: "transparent",
              padding: "8px 14px",
              cursor: "pointer",
              fontSize: 12.5,
              fontWeight: 500,
              color: "rgba(var(--trgb),.75)",
            }}
          >
            {t.cancel}
          </button>
          <button
            type="button"
            className="h-danger"
            onClick={() => void app.doClean()}
            style={{
              border: "1px solid rgba(var(--danrgb),.5)",
              borderRadius: 10,
              background: "rgba(var(--danrgb),.16)",
              color: "var(--danTx2)",
              padding: "8px 16px",
              cursor: "pointer",
              fontSize: 12.5,
              fontWeight: 600,
            }}
          >
            {`${t.del} · ${size(selectedBytes)}`}
          </button>
        </div>
      </div>
    </div>
  );
}
