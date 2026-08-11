import { useMemo, useState } from "react";

import { ChipGroup } from "../components/Chips";
import { Check, Close, Info, Plus } from "../components/Icons";
import { ago, isExcluded, size, tailPath } from "../format";
import type { App } from "../useApp";

// Rows sit under a project header, so the project column is gone and the path
// gets the room instead.
const GRID = "24px 132px minmax(180px,1fr) 88px 92px";

/** Categories that regenerate on the next build get the hotter badge. */
function isHot(cat: string): boolean {
  return cat.startsWith("target") || cat === "node_modules" || cat === "docker images";
}

/** Threshold behind the "larger than 1 GB" quick filter. */
const BIG_BYTES = 1024 * 1024 * 1024;

/** A checkbox-style quick filter in the cleanup toolbar. */
function FilterToggle({
  on,
  label,
  onClick,
}: {
  on: boolean;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={on}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 7,
        border: `1px solid ${on ? "rgba(var(--accrgb),.45)" : "rgba(var(--wrgb),.08)"}`,
        borderRadius: 10,
        background: on ? "rgba(var(--accrgb),.14)" : "rgba(var(--wrgb),.035)",
        color: on ? "var(--accTx)" : "rgba(var(--trgb),.55)",
        padding: "6px 10px",
        cursor: "pointer",
        fontSize: 11,
        fontWeight: 500,
        whiteSpace: "nowrap",
      }}
    >
      <span
        style={{
          width: 12,
          height: 12,
          borderRadius: 4,
          border: "1px solid currentColor",
          background: on ? "var(--acc)" : "transparent",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          flex: "0 0 12px",
        }}
      />
      {label}
    </button>
  );
}

const pickButton = {
  border: 0,
  background: "transparent",
  padding: 0,
  fontSize: 11.5,
  fontWeight: 500,
} as const;

export function CleanView({ app }: { app: App }) {
  const { t, lang, settings, allCleanRows, pickedSet, selectedRows, selectedBytes } = app;
  const [draft, setDraft] = useState("");

  const catChips = useMemo(() => {
    const totals = new Map<string, number>();
    for (const row of allCleanRows) totals.set(row.cat, (totals.get(row.cat) ?? 0) + row.bytes);
    const top = [...totals.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([cat]) => ({ key: cat, label: cat }));
    return [{ key: "all", label: t.all }, ...top];
  }, [allCleanRows, t.all]);

  const rows = useMemo(() => {
    let out = allCleanRows;
    if (app.cat !== "all") out = out.filter((r) => r.cat === app.cat);
    if (app.onlyOld) out = out.filter((r) => r.ageDays >= 30);
    if (app.onlyBig) out = out.filter((r) => r.bytes >= BIG_BYTES);
    return out;
  }, [allCleanRows, app.cat, app.onlyOld, app.onlyBig]);

  // The All / None actions apply to what is on screen, so their enabled state
  // follows the visible rows rather than the whole selection.
  const anySelected = rows.some((r) => pickedSet[r.key]);
  const allSelected = rows.length > 0 && rows.every((r) => pickedSet[r.key]);

  /**
   * One block per project, biggest first. Inside a block the rows are ordered
   * by package and then by size, so a monorepo's frontend directories stay
   * together instead of being scattered by size across the whole list.
   */
  const groups = useMemo(() => {
    const byProject = new Map<string, typeof rows>();
    for (const row of rows) {
      const list = byProject.get(row.project);
      if (list) list.push(row);
      else byProject.set(row.project, [row]);
    }

    return [...byProject.entries()]
      .map(([project, items]) => ({
        project,
        items: items
          .slice()
          .sort((a, b) => a.part.localeCompare(b.part) || b.bytes - a.bytes),
        bytes: items.reduce((total, r) => total + r.bytes, 0),
      }))
      .sort((a, b) => b.bytes - a.bytes);
  }, [rows]);

  const addRule = () => {
    if (!draft.trim() || !settings) return;
    app.patchSettings({
      rules: [...settings.rules, { pattern: draft.trim(), scope: t.allProjects }],
    });
    setDraft("");
  };

  const removeRule = (index: number) => {
    if (!settings) return;
    app.patchSettings({ rules: settings.rules.filter((_, i) => i !== index) });
  };

  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "1fr 300px",
        gap: 16,
        alignItems: "start",
        padding: "0 20px 24px",
      }}
    >
      <div>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 9,
            padding: "0 0 12px",
            flexWrap: "wrap",
            position: "sticky",
            top: 0,
            background: "var(--bg)",
            zIndex: 5,
          }}
        >
          <ChipGroup items={catChips} active={app.cat} onPick={app.setCat} />

          <FilterToggle on={app.onlyOld} label={t.older} onClick={() => app.setOnlyOld(!app.onlyOld)} />
          <FilterToggle on={app.onlyBig} label={t.bigger} onClick={() => app.setOnlyBig(!app.onlyBig)} />

          <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 9 }}>
            <span
              style={{
                fontFamily: "'JetBrains Mono',monospace",
                fontSize: 11,
                color: "rgba(var(--trgb),.45)",
              }}
            >
              {selectedRows.length} × {size(selectedBytes)}
            </span>
            <span
              style={{
                display: "flex",
                alignItems: "center",
                gap: 6,
                border: "1px solid rgba(var(--wrgb),.1)",
                borderRadius: 9,
                background: "rgba(var(--wrgb),.03)",
                padding: "0 10px",
                height: 30,
              }}
            >
              <span
                style={{
                  fontSize: 10.5,
                  letterSpacing: ".07em",
                  textTransform: "uppercase",
                  color: "rgba(var(--trgb),.45)",
                }}
              >
                {t.selectL}
              </span>
              <button
                type="button"
                className="h-link"
                onClick={() => app.setCleanSelection(rows, true)}
                disabled={allSelected}
                title={t.cleanAllTitle}
                style={{
                  ...pickButton,
                  color: allSelected ? "rgba(var(--trgb),.3)" : "rgba(var(--trgb),.8)",
                  cursor: allSelected ? "default" : "pointer",
                }}
              >
                {t.cleanAll}
              </button>
              <span style={{ color: "rgba(var(--trgb),.2)" }}>·</span>
              <button
                type="button"
                className="h-link"
                onClick={() => app.setCleanSelection(rows, false)}
                disabled={!anySelected}
                title={t.cleanNoneTitle}
                style={{
                  ...pickButton,
                  color: anySelected ? "rgba(var(--trgb),.8)" : "rgba(var(--trgb),.3)",
                  cursor: anySelected ? "pointer" : "default",
                }}
              >
                {t.cleanNone}
              </button>
            </span>
            <button
              type="button"
              className="h-accent-strong"
              onClick={() =>
                selectedRows.length ? app.setConfirmOpen(true) : app.flash(t.nothingSelected)
              }
              style={{
                border: "1px solid rgba(var(--accrgb),.5)",
                borderRadius: 9,
                background: "rgba(var(--accrgb),.15)",
                color: "var(--accTx)",
                padding: "6px 12px",
                cursor: "pointer",
                fontSize: 11.5,
                fontWeight: 600,
              }}
            >
              {t.cleanSel}
            </button>
          </div>
        </div>

        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 9,
            padding: "10px 13px",
            border: "1px solid rgba(var(--wrgb),.08)",
            borderRadius: 12,
            background: "rgba(var(--wrgb),.022)",
            marginBottom: 12,
          }}
        >
          <Info size={14} style={{ flex: "0 0 14px", color: "var(--acc)" }} />
          <span style={{ fontSize: 12, color: "rgba(var(--trgb),.62)" }}>{t.previewNote}</span>
        </div>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: GRID,
            gap: 10,
            padding: "0 12px 8px",
            fontSize: 10.5,
            letterSpacing: ".07em",
            textTransform: "uppercase",
            color: "rgba(var(--trgb),.52)",
          }}
        >
          <div />
          <div>{t.cat}</div>
          <div>{t.pathL}</div>
          <div style={{ textAlign: "right" }}>{t.colSize}</div>
          <div style={{ textAlign: "right" }}>{t.ageL}</div>
        </div>

        {rows.length === 0 && (
          <div style={{ padding: "24px 12px", fontSize: 12.5, color: "rgba(var(--trgb),.5)" }}>
            {t.emptyClean}
          </div>
        )}

        {groups.map((group) => {
          const groupOn = group.items.every((r) => pickedSet[r.key]);
          const groupSome = !groupOn && group.items.some((r) => pickedSet[r.key]);

          return (
            <div key={group.project} style={{ marginBottom: 10 }}>
              <div
                className="h-soft-3"
                onClick={() => app.setCleanSelection(group.items, !groupOn)}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  padding: "7px 12px",
                  marginTop: 4,
                  borderRadius: 9,
                  cursor: "pointer",
                  borderBottom: "1px solid rgba(var(--wrgb),.07)",
                }}
              >
                <div
                  style={{
                    width: 16,
                    height: 16,
                    borderRadius: 5,
                    border: `1px solid ${groupOn || groupSome ? "var(--acc)" : "rgba(var(--wrgb),.2)"}`,
                    background: groupOn ? "var(--acc)" : "transparent",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    flex: "0 0 16px",
                  }}
                >
                  {groupOn && <Check size={10} />}
                  {groupSome && (
                    <span
                      style={{ width: 8, height: 2, borderRadius: 2, background: "var(--acc)" }}
                    />
                  )}
                </div>

                <span
                  style={{
                    fontSize: 13,
                    fontWeight: 600,
                    letterSpacing: "-.01em",
                    whiteSpace: "nowrap",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                  }}
                >
                  {group.project}
                </span>

                <span
                  style={{
                    marginLeft: "auto",
                    fontFamily: "'JetBrains Mono',monospace",
                    fontSize: 11,
                    color: "rgba(var(--trgb),.45)",
                  }}
                >
                  {group.items.length} {t.groupDirs}
                </span>
                <span
                  style={{
                    fontFamily: "'JetBrains Mono',monospace",
                    fontSize: 11.5,
                    fontWeight: 500,
                    color: "var(--danTx)",
                    minWidth: 64,
                    textAlign: "right",
                  }}
                >
                  −{size(group.bytes)}
                </span>
              </div>

              {group.items.map((r) => {
                const on = !!pickedSet[r.key];
                const hot = isHot(r.cat);
                const excluded = isExcluded(r, settings?.rules ?? []);

                return (
                  <div
                    key={r.key}
                    className="h-soft"
                    onClick={() => app.toggleClean(r.key)}
                    style={{
                      display: "grid",
                      gridTemplateColumns: GRID,
                      gap: 10,
                      padding: "8px 12px",
                      borderRadius: 11,
                      border: `1px solid ${on ? "rgba(var(--accrgb),.25)" : "transparent"}`,
                      background: on ? "rgba(var(--accrgb),.07)" : "transparent",
                      cursor: "pointer",
                      alignItems: "center",
                      marginBottom: 1,
                      opacity: excluded && !on ? 0.55 : 1,
                    }}
                  >
                    <div
                      style={{
                        width: 16,
                        height: 16,
                        borderRadius: 5,
                        border: `1px solid ${on ? "var(--acc)" : "rgba(var(--wrgb),.2)"}`,
                        background: on ? "var(--acc)" : "transparent",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                      }}
                    >
                      {on && <Check size={10} />}
                    </div>

                    <div>
                      <span
                        style={{
                          fontSize: 10.5,
                          fontWeight: 500,
                          border: `1px solid ${hot ? "rgba(var(--danrgb),.35)" : "rgba(var(--wrgb),.1)"}`,
                          background: hot ? "rgba(var(--danrgb),.12)" : "rgba(var(--wrgb),.04)",
                          color: hot ? "var(--danTx2)" : "rgba(var(--trgb),.6)",
                          borderRadius: 99,
                          padding: "2px 8px",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {r.cat}
                      </span>
                    </div>

                    <div
                      style={{
                        display: "flex",
                        alignItems: "baseline",
                        gap: 7,
                        minWidth: 0,
                      }}
                      title={r.path}
                    >
                      {r.part && (
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
                            flex: "0 0 auto",
                          }}
                        >
                          {r.part}
                        </span>
                      )}
                      <span
                        style={{
                          fontFamily: "'JetBrains Mono',monospace",
                          fontSize: 10.5,
                          color: "rgba(var(--trgb),.58)",
                          whiteSpace: "nowrap",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                        }}
                      >
                        {tailPath(r.path, 44)}
                      </span>
                    </div>

                    <div
                      style={{
                        textAlign: "right",
                        fontFamily: "'JetBrains Mono',monospace",
                        fontSize: 11.5,
                        fontWeight: 500,
                      }}
                    >
                      {size(r.bytes)}
                    </div>

                    <div
                      style={{
                        textAlign: "right",
                        fontFamily: "'JetBrains Mono',monospace",
                        fontSize: 10.5,
                        color: r.ageDays >= 90 ? "var(--danTx)" : "rgba(var(--trgb),.56)",
                      }}
                    >
                      {ago(r.ageDays, lang)}
                    </div>
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 14, position: "sticky", top: 0 }}>
        <div
          style={{
            border: "1px solid rgba(var(--accrgb),.28)",
            borderRadius: 14,
            background: "linear-gradient(160deg,rgba(var(--accrgb),.1),rgba(var(--accrgb),.02))",
            padding: 16,
          }}
        >
          <div
            style={{
              fontSize: 10.5,
              letterSpacing: ".09em",
              textTransform: "uppercase",
              color: "rgba(var(--trgb),.45)",
              marginBottom: 8,
            }}
          >
            {t.reclaimTotal}
          </div>
          <div
            style={{
              fontFamily: "'JetBrains Mono',monospace",
              fontWeight: 700,
              fontSize: 34,
              lineHeight: 1,
              letterSpacing: "-.03em",
              color: "var(--accTx)",
            }}
          >
            {size(selectedBytes)}
          </div>
          <div style={{ fontSize: 11.5, color: "rgba(var(--trgb),.45)", marginTop: 6 }}>
            {selectedRows.length} {t.dirsSelected}
          </div>

          <div style={{ height: 1, background: "rgba(var(--wrgb),.1)", margin: "14px 0" }} />

          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11.5 }}>
            <span style={{ color: "rgba(var(--trgb),.45)" }}>{t.freedT}</span>
            <span style={{ fontFamily: "'JetBrains Mono',monospace", fontWeight: 500 }}>
              {size(settings?.freedBytes ?? 0)}
            </span>
          </div>

          {app.docker?.available && (
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                fontSize: 11.5,
                marginTop: 6,
              }}
            >
              <span style={{ color: "rgba(var(--trgb),.45)" }}>{t.dockerReclaim}</span>
              <span style={{ fontFamily: "'JetBrains Mono',monospace", fontWeight: 500 }}>
                {size(app.docker.imagesBytes + app.docker.buildCacheBytes)}
              </span>
            </div>
          )}
        </div>

        <div
          style={{
            border: "1px solid rgba(var(--wrgb),.08)",
            borderRadius: 14,
            background: "rgba(var(--wrgb),.022)",
            padding: "15px 16px",
          }}
        >
          <div
            style={{
              fontSize: 10.5,
              letterSpacing: ".09em",
              textTransform: "uppercase",
              color: "rgba(var(--trgb),.56)",
              marginBottom: 6,
            }}
          >
            {t.rules}
          </div>

          {(settings?.rules ?? []).map((rule, i) => (
            <div
              key={`${rule.pattern}-${i}`}
              style={{
                display: "flex",
                alignItems: "flex-start",
                gap: 8,
                padding: "8px 0",
                borderTop: "1px solid rgba(var(--wrgb),.06)",
              }}
            >
              <div style={{ flex: 1, minWidth: 0 }}>
                <div
                  style={{
                    fontFamily: "'JetBrains Mono',monospace",
                    fontSize: 11,
                    fontWeight: 500,
                  }}
                >
                  {rule.pattern}
                </div>
                <div style={{ fontSize: 10.5, color: "rgba(var(--trgb),.58)" }}>{rule.scope}</div>
              </div>
              <button
                type="button"
                className="h-rule-x"
                onClick={() => removeRule(i)}
                title={t.removeL}
                style={{
                  border: 0,
                  background: "transparent",
                  color: "rgba(var(--trgb),.56)",
                  cursor: "pointer",
                  padding: 2,
                  borderRadius: 6,
                  display: "flex",
                }}
              >
                <Close size={12} strokeWidth={2} />
              </button>
            </div>
          ))}

          <div style={{ display: "flex", gap: 6, marginTop: 12 }}>
            <input
              className="input"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && addRule()}
              placeholder={t.rulePh}
              style={{
                flex: 1,
                minWidth: 0,
                border: "1px solid rgba(var(--wrgb),.1)",
                borderRadius: 9,
                background: "rgba(var(--wrgb),.035)",
                padding: "6px 9px",
                fontFamily: "'JetBrains Mono',monospace",
                fontSize: 11,
                outline: "none",
              }}
            />
            <button
              type="button"
              className="h-accent"
              onClick={addRule}
              style={{
                border: "1px solid rgba(var(--wrgb),.1)",
                borderRadius: 9,
                background: "rgba(var(--wrgb),.03)",
                width: 32,
                cursor: "pointer",
                color: "rgba(var(--trgb),.8)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <Plus size={13} />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
