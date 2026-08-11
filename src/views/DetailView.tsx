import type { ReactNode } from "react";

import * as api from "../api";
import { ChevronLeft, ChevronRight, Clock, Play, StickyNote, Stop, Tag, Target } from "../components/Icons";
import { ago, cmdKey, dueInfo, num, size } from "../format";
import type { App } from "../useApp";

function Card({
  title,
  action,
  children,
  pad = "16px 18px",
}: {
  title: string;
  action?: ReactNode;
  children: ReactNode;
  pad?: string;
}) {
  return (
    <div
      style={{
        border: "1px solid rgba(var(--wrgb),.08)",
        borderRadius: 14,
        background: "rgba(var(--wrgb),.022)",
        padding: pad,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
        <div
          style={{
            fontSize: 10.5,
            letterSpacing: ".09em",
            textTransform: "uppercase",
            color: "rgba(var(--trgb),.56)",
            flex: 1,
          }}
        >
          {title}
        </div>
        {action}
      </div>
      {children}
    </div>
  );
}

const toolButton = {
  border: "1px solid rgba(var(--wrgb),.1)",
  borderRadius: 9,
  background: "rgba(var(--wrgb),.03)",
  padding: "6px 11px",
  cursor: "pointer",
  fontSize: 11.5,
  fontWeight: 500,
  color: "rgba(var(--trgb),.8)",
  display: "flex",
  alignItems: "center",
  gap: 7,
} as const;

const empty = { fontSize: 11.5, color: "rgba(var(--trgb),.44)", padding: "4px 0" };

export function DetailView({ app }: { app: App }) {
  const { t, current: p, lang } = app;
  if (!p) return null;

  const ratio = app.goalRatio(p.name);
  const projectNotes = app.notes.filter((n) => n.project === p.name);
  const lastBuild = p.cleanTargets.length
    ? ago(Math.min(...p.cleanTargets.map((c) => c.ageDays)), lang)
    : "—";

  const facts: Array<{ k: string; v: string; fg?: string }> = [
    { k: t.files, v: num(p.files, lang) },
    { k: t.loc, v: num(p.loc, lang) },
    { k: t.size, v: size(p.sizeBytes) },
    { k: t.reclaim, v: `−${size(p.reclaimBytes)}`, fg: "var(--danTx)" },
    { k: t.branchL, v: p.git.branch || "—" },
    { k: t.dirtyL, v: p.git.dirty ? `±${p.git.dirty}` : "0", fg: p.git.dirty ? "var(--danTx)" : undefined },
    { k: t.aheadL, v: `↑${p.git.ahead} ↓${p.git.behind}` },
    { k: t.lastC, v: p.git.days >= 0 ? ago(p.git.days, lang) : "—" },
    { k: t.created, v: p.git.firstCommit || "—" },
    { k: t.buildL, v: lastBuild },
  ];

  const tags = p.git.tags.length ? p.git.tags : [t.noTags];

  return (
    <div style={{ padding: "0 20px 26px" }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "0 0 14px",
          position: "sticky",
          top: 0,
          background: "var(--bg)",
          zIndex: 5,
        }}
      >
        <button type="button" className="h-ghost" onClick={() => app.setView("projects")} style={toolButton}>
          <ChevronLeft size={13} />
          {t.back}
        </button>

        <div style={{ width: 1, height: 18, background: "rgba(var(--wrgb),.1)", margin: "0 3px" }} />

        <button
          type="button"
          className="h-accent"
          onClick={() => {
            app.setGoalSel(p.name);
            app.setView("goals");
          }}
          style={toolButton}
        >
          <Target size={13} />
          {t.navGoals}
          <span style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 10, color: "rgba(var(--trgb),.52)" }}>
            {ratio.all ? `${ratio.done}/${ratio.all}` : "0"}
          </span>
        </button>

        <button
          type="button"
          className="h-accent"
          onClick={() => {
            app.setBoardFilter(p.name);
            app.setView("board");
          }}
          style={toolButton}
        >
          <StickyNote size={13} />
          {t.notesL}
          <span style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 10, color: "rgba(var(--trgb),.52)" }}>
            {projectNotes.length}
          </span>
        </button>

        <div style={{ marginLeft: "auto", display: "flex", gap: 7 }}>
          <button type="button" className="h-ghost" style={toolButton} onClick={() => void api.openEditor(p.path)}>
            {t.openEditor}
          </button>
          <button type="button" className="h-ghost" style={toolButton} onClick={() => void api.openTerminal(p.path)}>
            {t.openTerm}
          </button>
          <button
            type="button"
            className="h-accent-soft"
            onClick={() => app.setView("clean")}
            style={{
              border: "1px solid rgba(var(--accrgb),.5)",
              borderRadius: 9,
              background: "rgba(var(--accrgb),.14)",
              color: "var(--accTx)",
              padding: "6px 12px",
              cursor: "pointer",
              fontSize: 11.5,
              fontWeight: 600,
            }}
          >
            {t.cleanL} −{size(p.reclaimBytes)}
          </button>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 328px", gap: 16, alignItems: "start" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <Card title={t.desc}>
            <div
              style={{
                fontSize: 14.5,
                lineHeight: 1.55,
                maxWidth: "62ch",
                textWrap: "pretty",
                color: p.desc ? "rgba(var(--trgb),.92)" : "rgba(var(--trgb),.44)",
              }}
            >
              {p.desc || t.noDesc}
            </div>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 13 }}>
              {p.langs.map((l) => (
                <span
                  key={l.name}
                  style={{
                    fontFamily: "'JetBrains Mono',monospace",
                    fontSize: 10.5,
                    border: "1px solid rgba(var(--wrgb),.09)",
                    background: "rgba(var(--wrgb),.035)",
                    borderRadius: 99,
                    padding: "3px 9px",
                    color: "rgba(var(--trgb),.7)",
                  }}
                >
                  {l.name} {l.pct}%
                </span>
              ))}
            </div>
          </Card>

          {p.parts.length > 1 && (
            <Card title={`${t.parts} · ${p.parts.length}`}>
              <div style={{ fontSize: 11.5, color: "rgba(var(--trgb),.42)", marginBottom: 4 }}>
                {t.partsHint}
              </div>
              {p.parts.map((part) => (
                <div
                  key={part.rel || "."}
                  style={{
                    display: "grid",
                    gridTemplateColumns: "minmax(120px,1fr) 96px 1fr 96px",
                    gap: 12,
                    alignItems: "center",
                    padding: "9px 0",
                    borderTop: "1px solid rgba(var(--wrgb),.06)",
                  }}
                >
                  <div
                    style={{
                      fontFamily: "'JetBrains Mono',monospace",
                      fontSize: 12,
                      fontWeight: 500,
                      whiteSpace: "nowrap",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                    }}
                    title={part.path}
                  >
                    {part.rel ? `${part.rel}/` : "."}
                  </div>
                  <div>
                    <span
                      style={{
                        display: "inline-block",
                        fontSize: 10.5,
                        fontWeight: 500,
                        padding: "2px 8px",
                        borderRadius: 99,
                        border: "1px solid rgba(var(--wrgb),.1)",
                        background: "rgba(var(--wrgb),.04)",
                        color: "rgba(var(--trgb),.7)",
                      }}
                    >
                      {part.stack}
                    </span>
                  </div>
                  <div
                    style={{
                      fontFamily: "'JetBrains Mono',monospace",
                      fontSize: 10.5,
                      color: "rgba(var(--trgb),.5)",
                      whiteSpace: "nowrap",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                    }}
                  >
                    {part.manifests.join(" · ") || "—"}
                  </div>
                  <div
                    style={{
                      textAlign: "right",
                      fontFamily: "'JetBrains Mono',monospace",
                      fontSize: 11,
                    }}
                  >
                    <div>{size(part.sizeBytes)}</div>
                    {part.reclaimBytes > 0 && (
                      <div style={{ fontSize: 10, color: "var(--danTx)" }}>
                        −{size(part.reclaimBytes)}
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </Card>
          )}

          <Card title={t.changelog}>
            {p.git.releases.length === 0 && <div style={empty}>{t.noChangelog}</div>}
            {p.git.releases.map((r) => (
              <div
                key={r.ver}
                style={{
                  display: "grid",
                  gridTemplateColumns: "96px 1fr",
                  gap: 14,
                  padding: "11px 0",
                  borderTop: "1px solid rgba(var(--wrgb),.06)",
                }}
              >
                <div>
                  <div
                    style={{
                      fontFamily: "'JetBrains Mono',monospace",
                      fontSize: 12,
                      fontWeight: 500,
                      color: "var(--accTx)",
                    }}
                  >
                    {r.ver}
                  </div>
                  <div
                    style={{
                      fontFamily: "'JetBrains Mono',monospace",
                      fontSize: 10,
                      color: "rgba(var(--trgb),.52)",
                    }}
                  >
                    {r.date}
                  </div>
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                  {r.notes.map((n, i) => (
                    <div
                      key={i}
                      style={{ display: "flex", gap: 9, fontSize: 12.5, color: "rgba(var(--trgb),.82)" }}
                    >
                      <span style={{ color: "rgba(var(--accrgb),.6)" }}>•</span>
                      <span>{n}</span>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </Card>

          <Card title={t.commits}>
            {p.git.commits.length === 0 && <div style={empty}>{t.noCommits}</div>}
            {p.git.commits.map((c) => (
              <div
                key={c.sha}
                style={{
                  display: "grid",
                  gridTemplateColumns: "64px 1fr 88px",
                  gap: 12,
                  padding: "7px 0",
                  borderTop: "1px solid rgba(var(--wrgb),.06)",
                  alignItems: "baseline",
                }}
              >
                <div
                  style={{
                    fontFamily: "'JetBrains Mono',monospace",
                    fontSize: 10.5,
                    color: "rgba(var(--accrgb),.75)",
                  }}
                >
                  {c.sha}
                </div>
                <div
                  style={{
                    fontSize: 12.5,
                    whiteSpace: "nowrap",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    color: "rgba(var(--trgb),.85)",
                  }}
                  title={c.msg}
                >
                  {c.msg}
                </div>
                <div
                  style={{
                    fontFamily: "'JetBrains Mono',monospace",
                    fontSize: 10,
                    color: "rgba(var(--trgb),.52)",
                    textAlign: "right",
                  }}
                >
                  {ago(c.days, lang)}
                </div>
              </div>
            ))}
          </Card>

          <Card
            title={t.navGoals}
            action={
              <button
                type="button"
                className="h-link"
                onClick={() => {
                  app.setGoalSel(p.name);
                  app.setView("goals");
                }}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 5,
                  border: 0,
                  background: "transparent",
                  padding: 0,
                  cursor: "pointer",
                  fontSize: 10.5,
                  fontWeight: 500,
                  color: "rgba(var(--trgb),.5)",
                }}
              >
                {t.openAll}
                <ChevronRight size={11} strokeWidth={2} />
              </button>
            }
          >
            {app.goalsFor(p.name).length === 0 && <div style={empty}>{t.emptyGoals}</div>}
            {app.goalsFor(p.name).map((g) => {
              const done = g.features.filter((f) => f.done).length;
              const pct = g.features.length ? Math.round((done / g.features.length) * 100) : 0;
              return (
                <div key={g.id} style={{ padding: "9px 0", borderTop: "1px solid rgba(var(--wrgb),.06)" }}>
                  <div style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
                    <div style={{ fontSize: 13, fontWeight: 500, flex: 1 }}>{g.title}</div>
                    <div
                      style={{
                        fontFamily: "'JetBrains Mono',monospace",
                        fontSize: 10.5,
                        color: "rgba(var(--trgb),.4)",
                      }}
                    >
                      {done}/{g.features.length}
                    </div>
                  </div>
                  <div
                    style={{
                      height: 5,
                      borderRadius: 99,
                      background: "rgba(var(--wrgb),.08)",
                      marginTop: 8,
                      overflow: "hidden",
                    }}
                  >
                    <div
                      style={{
                        height: 5,
                        borderRadius: 99,
                        background: "var(--acc)",
                        width: `${pct}%`,
                        transition: "width 300ms",
                      }}
                    />
                  </div>
                </div>
              );
            })}
          </Card>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <Card title={t.facts} pad="15px 16px">
            {facts.map((f) => (
              <div
                key={f.k}
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  gap: 10,
                  padding: "6px 0",
                  borderTop: "1px solid rgba(var(--wrgb),.06)",
                }}
              >
                <span style={{ fontSize: 11.5, color: "rgba(var(--trgb),.5)" }}>{f.k}</span>
                <span
                  style={{
                    fontFamily: "'JetBrains Mono',monospace",
                    fontSize: 11.5,
                    fontWeight: 500,
                    color: f.fg ?? "var(--t0)",
                  }}
                >
                  {f.v}
                </span>
              </div>
            ))}
          </Card>

          <Card title={t.tags} pad="15px 16px">
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
              {tags.map((tag) => (
                <span
                  key={tag}
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 5,
                    fontFamily: "'JetBrains Mono',monospace",
                    fontSize: 10.5,
                    border: "1px solid rgba(var(--wrgb),.09)",
                    background: "rgba(var(--wrgb),.035)",
                    borderRadius: 99,
                    padding: "3px 9px",
                    color: "rgba(var(--trgb),.75)",
                  }}
                >
                  <Tag size={10} style={{ color: "rgba(var(--accrgb),.7)" }} />
                  {tag}
                </span>
              ))}
            </div>
          </Card>

          <Card
            title={t.notesL}
            pad="15px 16px"
            action={
              <button
                type="button"
                className="h-link"
                onClick={() => {
                  app.setBoardFilter(p.name);
                  app.setView("board");
                }}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 5,
                  border: 0,
                  background: "transparent",
                  padding: 0,
                  cursor: "pointer",
                  fontSize: 10.5,
                  fontWeight: 500,
                  color: "rgba(var(--trgb),.5)",
                }}
              >
                {t.openAll}
                <ChevronRight size={11} strokeWidth={2} />
              </button>
            }
          >
            {projectNotes.map((n) => {
              const due = dueInfo(n.due, t);
              return (
                <div
                  key={n.id}
                  className="h-soft-3"
                  onClick={() => {
                    app.setBoardFilter(p.name);
                    app.setView("board");
                  }}
                  style={{
                    borderTop: "1px solid rgba(var(--wrgb),.06)",
                    padding: "8px 0",
                    cursor: "pointer",
                    display: "flex",
                    flexDirection: "column",
                    gap: 6,
                  }}
                >
                  <div
                    style={{
                      fontSize: 12,
                      lineHeight: 1.4,
                      color: "rgba(var(--trgb),.85)",
                      display: "-webkit-box",
                      WebkitLineClamp: 2,
                      WebkitBoxOrient: "vertical",
                      overflow: "hidden",
                    }}
                  >
                    {n.text}
                  </div>
                  <span
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 5,
                      alignSelf: "flex-start",
                      fontFamily: "'JetBrains Mono',monospace",
                      fontSize: 9.5,
                      fontWeight: 500,
                      border: `1px solid ${due.bd}`,
                      background: due.bg,
                      color: due.fg === "inherit" ? "rgba(var(--trgb),.6)" : due.fg,
                      borderRadius: 99,
                      padding: "2px 7px",
                    }}
                  >
                    <Clock size={9} />
                    {due.label}
                  </span>
                </div>
              );
            })}
            {projectNotes.length === 0 && (
              <div style={{ ...empty, borderTop: "1px solid rgba(var(--wrgb),.06)", padding: "9px 0 2px" }}>
                {t.noNotes}
              </div>
            )}
          </Card>

          <Card title={t.quick} pad="15px 16px">
            {p.commands.length === 0 && <div style={empty}>{t.emptyCmds}</div>}
            {p.commands.slice(0, 4).map((c) => {
              const on = app.running.has(cmdKey(p.name, c));
              return (
                <div
                  key={cmdKey(p.name, c)}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 9,
                    padding: "7px 0",
                    borderTop: "1px solid rgba(var(--wrgb),.06)",
                  }}
                >
                  <span
                    style={{
                      fontSize: 10,
                      fontWeight: 500,
                      border: "1px solid rgba(var(--wrgb),.09)",
                      background: "rgba(var(--wrgb),.04)",
                      borderRadius: 99,
                      padding: "2px 7px",
                      color: "rgba(var(--trgb),.6)",
                    }}
                  >
                    {c.kind}
                  </span>
                  <span
                    style={{
                      fontFamily: "'JetBrains Mono',monospace",
                      fontSize: 11,
                      flex: 1,
                      whiteSpace: "nowrap",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      color: "rgba(var(--trgb),.8)",
                    }}
                    title={c.cwd ? `${c.cwd}: ${c.cmd}` : c.cmd}
                  >
                    {c.cwd ? `${c.cwd}/ ` : ""}
                    {c.cmd}
                  </span>
                  <button
                    type="button"
                    onClick={() => void app.toggleCommand(p, c)}
                    title={on ? t.stop : t.run}
                    style={{
                      border: `1px solid ${on ? "rgba(var(--accrgb),.5)" : "rgba(var(--wrgb),.12)"}`,
                      borderRadius: 8,
                      background: on ? "rgba(var(--accrgb),.16)" : "rgba(var(--wrgb),.03)",
                      color: on ? "var(--accTx)" : "rgba(var(--trgb),.75)",
                      width: 26,
                      height: 24,
                      cursor: "pointer",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                    }}
                  >
                    {on ? <Stop size={8} /> : <Play size={9} />}
                  </button>
                </div>
              );
            })}
          </Card>
        </div>
      </div>
    </div>
  );
}
