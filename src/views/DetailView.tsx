import { useCallback, useLayoutEffect, useRef, useState, type ReactNode } from "react";

import * as api from "../api";
import { Collapsible } from "../components/Collapsible";
import { Markdown } from "../components/Markdown";
import { DockerBody, DockerChip, RefreshAction, RequirementsBody } from "../components/Requirements";
import { ChevronDown, ChevronLeft, ChevronRight, Clock, Play, StickyNote, Stop, Tag, Target, Terminal } from "../components/Icons";
import { ago, cmdKey, dueInfo, num, size } from "../format";
import type { App } from "../useApp";
import type { CommandDef } from "../types";

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
        // The side column is height-bounded; without this its cards would
        // compress to fit instead of letting the column scroll.
        flexShrink: 0,
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

/** How many changelog versions the card shows before asking. */
const VERSION_PAGE = 5;

/** Pinned first, then the headline operations, then everything else. */
function rank(c: CommandDef, projectId: string, app: App): number {
  if (app.cmdFavourites.has(cmdKey(projectId, c))) return 0;
  return c.primary ? 1 : 2;
}

const verStyle = {
  fontFamily: "'JetBrains Mono',monospace",
  fontSize: 12,
  fontWeight: 500,
  color: "var(--accTx)",
} as const;

const dateStyle = {
  fontFamily: "'JetBrains Mono',monospace",
  fontSize: 10,
  color: "rgba(var(--trgb),.52)",
} as const;

export function DetailView({ app }: { app: App }) {
  const { t, current: p, lang } = app;

  // The side cards pin below the toolbar. Both the toolbar height and the room
  // available are measured rather than assumed - a hard-coded offset is what
  // left a gap under the projects list header.
  const toolbarRef = useRef<HTMLDivElement | null>(null);
  const [pin, setPin] = useState({ top: 0, maxHeight: 0 });
  const [allVersions, setAllVersions] = useState(false);

  const measure = useCallback(() => {
    const toolbar = toolbarRef.current;
    if (!toolbar) return;
    const scroller = toolbar.closest("[data-scroll-root]");
    const top = Math.round(toolbar.getBoundingClientRect().height);
    const room = scroller?.clientHeight ?? 0;
    // Zero means the layout has no size yet - leave the column unconstrained
    // rather than pinning it to a guess.
    const maxHeight = room > 0 ? Math.max(200, room - top - 8) : 0;

    setPin((prev) => (prev.top === top && prev.maxHeight === maxHeight ? prev : { top, maxHeight }));
  }, []);

  // No dependency list: re-measuring after every render is what keeps this
  // correct when the toolbar wraps, the sidebar collapses, or the layout only
  // gains a size later. The state guard above stops it looping.
  useLayoutEffect(measure);

  useLayoutEffect(() => {
    const toolbar = toolbarRef.current;
    if (!toolbar) return;
    const scroller = toolbar.closest("[data-scroll-root]");
    const observer = new ResizeObserver(measure);
    observer.observe(toolbar);
    if (scroller) observer.observe(scroller);
    window.addEventListener("resize", measure);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [measure]);

  if (!p) return null;

  const ratio = app.goalRatio(p.id);
  const projectNotes = app.notes.filter((n) => n.project === p.id);
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

  // Four slots, spent on what the user pinned first and the headline operations
  // second, rather than on whichever commands happened to be detected first.
  const quickCommands = [...p.commands]
    .sort((a, b) => rank(a, p.id, app) - rank(b, p.id, app))
    .slice(0, 4);

  // A changelog runs to dozens of versions. The recent ones are what anybody
  // looks at, so the rest are behind one more click rather than pushing the
  // commit history off the page.
  const shownChangelog = allVersions ? p.changelog : p.changelog.slice(0, VERSION_PAGE);
  const shownReleases = allVersions ? p.git.releases : p.git.releases.slice(0, VERSION_PAGE);
  const listed = p.changelog.length > 0 ? p.changelog.length : p.git.releases.length;
  const hiddenVersions = Math.max(0, listed - VERSION_PAGE);

  // The Docker card would be noise on a project that never mentions it.
  const needsDocker =
    p.parts.some((part) => part.manifests.some((m) => m.startsWith("docker-compose"))) ||
    p.commands.some((c) => c.kind === "docker") ||
    (app.requirements ?? []).some((r) => r.id === "docker");

  return (
    <div style={{ padding: "0 20px 26px" }}>
      <div
        ref={toolbarRef}
        style={{
          display: "flex",
          alignItems: "center",
          // Every other toolbar in the app wraps, and the measurement above
          // already expects this one to: without it a narrow window pushed the
          // right-hand buttons off the edge and scrolled the page sideways.
          flexWrap: "wrap",
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
            app.setGoalSel(p.id);
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
            app.setBoardFilter(p.id);
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

        {/* Commands was the one view with no way through from here. */}
        <button
          type="button"
          className="h-accent"
          onClick={() => {
            app.setCmdSel(p.id);
            app.setView("cmd");
          }}
          style={toolButton}
        >
          <Terminal size={13} />
          {t.navCmd}
          <span style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 10, color: "rgba(var(--trgb),.52)" }}>
            {p.commands.length}
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

      {/* minmax(0,1fr) rather than a bare 1fr: an auto-sized track never shrinks
          below its content's min-content width, so a long commit subject or a
          README code block widened the column past the window and put a
          horizontal scrollbar under the whole page. */}
      <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) 328px", gap: 16, alignItems: "start" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 14, minWidth: 0 }}>
          <Card
            title={t.desc}
            action={
              p.readme ? (
                <span
                  style={{
                    fontFamily: "'JetBrains Mono',monospace",
                    fontSize: 10,
                    color: "rgba(var(--trgb),.4)",
                  }}
                >
                  {t.readmeFrom}
                </span>
              ) : undefined
            }
          >
            <div
              style={{
                fontSize: 14.5,
                lineHeight: 1.55,
                maxWidth: "62ch",
                textWrap: "pretty",
                color: p.desc || p.readme ? "rgba(var(--trgb),.92)" : "rgba(var(--trgb),.44)",
              }}
            >
              {/* The whole README, rendered, but clamped to roughly the height
                  the one-line summary used to take. Nothing on this card is
                  taller than it was; the difference is that the rest is now
                  reachable. */}
              {p.readme ? (
                <Collapsible
                  collapsedHeight={96}
                  moreLabel={t.showMore}
                  lessLabel={t.showLess}
                  key={p.id}
                >
                  <Markdown source={p.readme} />
                </Collapsible>
              ) : (
                p.desc || t.noDesc
              )}
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

          {/* A CHANGELOG.md is the author's own account of what changed, so it
              wins over the tag list the git reader assembles. Tags are the
              fallback for a project that keeps no changelog file. */}
          <Card
            title={t.changelog}
            action={
              <span
                style={{
                  fontFamily: "'JetBrains Mono',monospace",
                  fontSize: 10,
                  color: "rgba(var(--trgb),.4)",
                }}
              >
                {p.changelog.length > 0 ? t.changelogFrom : p.git.releases.length > 0 ? t.fromTags : ""}
              </span>
            }
          >
            {p.changelog.length === 0 && p.git.releases.length === 0 && (
              <div style={empty}>{t.noChangelog}</div>
            )}

            {/* Keyed by position as well as version: a hand-written changelog
                can carry the same heading twice, `Unreleased` most obviously. */}
            {shownChangelog.map((entry, i) => (
              <div
                key={`${entry.ver}-${i}`}
                style={{
                  display: "grid",
                  gridTemplateColumns: "96px 1fr",
                  gap: 14,
                  padding: "11px 0",
                  borderTop: "1px solid rgba(var(--wrgb),.06)",
                }}
              >
                <div>
                  <div style={verStyle}>{entry.ver}</div>
                  <div style={dateStyle}>{entry.date}</div>
                </div>
                <div style={{ fontSize: 12.5, color: "rgba(var(--trgb),.82)", minWidth: 0 }}>
                  {/* Every version starts collapsed. A changelog is a long file
                      by design, and dumping all of it here would bury the
                      commit history under it. */}
                  <Collapsible
                    collapsedHeight={72}
                    moreLabel={t.showMore}
                    lessLabel={t.showLess}
                    key={`${p.id}-${entry.ver}-${i}`}
                  >
                    <Markdown source={entry.body} />
                  </Collapsible>
                </div>
              </div>
            ))}

            {p.changelog.length === 0 &&
              shownReleases.map((r) => (
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
                    <div style={verStyle}>{r.ver}</div>
                    <div style={dateStyle}>{r.date}</div>
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

            {hiddenVersions > 0 && (
              <button
                type="button"
                className="h-link"
                onClick={() => setAllVersions((v) => !v)}
                aria-expanded={allVersions}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 5,
                  marginTop: 11,
                  border: 0,
                  background: "transparent",
                  padding: 0,
                  cursor: "pointer",
                  fontSize: 11.5,
                  fontWeight: 500,
                  color: "rgba(var(--trgb),.6)",
                }}
              >
                {allVersions ? t.showLess : `${hiddenVersions} ${t.moreVersions}`}
                <ChevronDown
                  size={12}
                  strokeWidth={2}
                  style={{
                    transform: allVersions ? "rotate(180deg)" : undefined,
                    transition: "transform 160ms",
                  }}
                />
              </button>
            )}
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
                  app.setGoalSel(p.id);
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
            {app.goalsFor(p.id).length === 0 && <div style={empty}>{t.emptyGoals}</div>}
            {app.goalsFor(p.id).map((g) => {
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

        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 14,
            // Stays put while the left column scrolls; once the cards no
            // longer fit the room available, the column scrolls on its own so
            // the bottom stays reachable.
            position: "sticky",
            top: pin.top,
            alignSelf: "start",
            maxHeight: pin.maxHeight || undefined,
            overflowY: "auto",
          }}
        >
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

          {/* What the project needs installed. Above tags and notes on
              purpose: a missing toolchain is why nothing runs. */}
          <Card
            title={t.requirements}
            pad="15px 16px"
            action={<RefreshAction onClick={() => void app.refreshProjectEnv()} title={t.recheck} />}
          >
            <RequirementsBody app={app} />
          </Card>

          {needsDocker && (
            <Card
              title={t.dockerTitle}
              pad="15px 16px"
              action={
                <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <DockerChip status={app.docker} t={t} />
                  <RefreshAction onClick={() => void app.refreshDocker()} title={t.recheck} />
                </span>
              }
            >
              <DockerBody app={app} />
            </Card>
          )}

          {/* A tag opens its page on the hosting service. Only linked when
              there is a remote to link to, so it never looks clickable and
              then does nothing. */}
          <Card
            title={t.tags}
            pad="15px 16px"
            action={
              p.git.remote ? (
                <span
                  style={{
                    fontFamily: "'JetBrains Mono',monospace",
                    fontSize: 10,
                    color: "rgba(var(--trgb),.4)",
                    maxWidth: 150,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                  title={p.git.remote}
                >
                  {p.git.remote.replace(/^https:\/\//, "")}
                </span>
              ) : undefined
            }
          >
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
              {tags.map((tag) => {
                const linked = !!p.git.remote && tag !== t.noTags;
                return (
                  <button
                    key={tag}
                    type="button"
                    disabled={!linked}
                    className={linked ? "h-accent" : undefined}
                    onClick={() => linked && void app.openTag(p.id, tag)}
                    title={linked ? `${t.openTag} ${tag}` : undefined}
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
                      cursor: linked ? "pointer" : "default",
                    }}
                  >
                    <Tag size={10} style={{ color: "rgba(var(--accrgb),.7)" }} />
                    {tag}
                  </button>
                );
              })}
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
                  app.setBoardFilter(p.id);
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
                    app.setBoardFilter(p.id);
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
            {quickCommands.map((c) => {
              const on = app.running.has(cmdKey(p.id, c));
              return (
                <div
                  key={cmdKey(p.id, c)}
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
                    className={on ? "h-danger" : "h-ghost"}
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
