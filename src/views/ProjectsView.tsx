import { useMemo } from "react";

import { ChipGroup } from "../components/Chips";
import { FolderHeader } from "../components/GroupHeader";
import { ChevronRight, GitBranch, Search } from "../components/Icons";
import { projectCount, size } from "../format";
import { groupByFolder } from "../grouping";
import type { App } from "../useApp";
import type { Project } from "../types";

const GRID = "minmax(200px,1fr) 104px 116px 146px 108px 58px 22px";

type Sort = "recent" | "name" | "size" | "dirty";

const SORTERS: Record<Sort, (a: Project, b: Project) => number> = {
  name: (a, b) => a.name.localeCompare(b.name),
  size: (a, b) => b.sizeBytes - a.sizeBytes,
  dirty: (a, b) => b.git.dirty - a.git.dirty,
  recent: (a, b) => a.git.days - b.git.days,
};

/** A folder's weight for ordering, matching the active sort. Higher comes first. */
const GROUP_WEIGHT: Record<Sort, (items: Project[]) => number> = {
  // Fewest days since the last commit wins, so the sign is flipped.
  recent: (items) => -Math.min(...items.map((p) => p.git.days)),
  // Equal weight leaves the alphabetical tie-break to decide.
  name: () => 0,
  size: (items) => items.reduce((total, p) => total + p.sizeBytes, 0),
  dirty: (items) => items.reduce((total, p) => total + p.git.dirty, 0),
};

function badge(stack: string) {
  return stack === "Rust"
    ? {
        borderColor: "rgba(var(--accrgb),.35)",
        background: "rgba(var(--accrgb),.12)",
        color: "var(--accTx)",
      }
    : {
        borderColor: "rgba(var(--wrgb),.1)",
        background: "rgba(var(--wrgb),.04)",
        color: "rgba(var(--trgb),.65)",
      };
}

export function ProjectsView({ app }: { app: App }) {
  const { t, projects, q, stack, sort, lang } = app;

  // Stack filters follow whatever is actually on disk, most common first.
  const stackChips = useMemo(() => {
    const counts = new Map<string, number>();
    for (const p of projects) {
      // Count each stack once per project, headline or inside a part.
      for (const s of new Set([p.stack, ...p.parts.map((part) => part.stack)])) {
        counts.set(s, (counts.get(s) ?? 0) + 1);
      }
    }
    const top = [...counts.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .slice(0, 5)
      .map(([name]) => ({ key: name, label: name }));
    return [{ key: "all", label: t.all }, ...top];
  }, [projects, t.all]);

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const filtered = projects.filter((p) => {
      // Part stacks are searchable too, so a monorepo turns up under the stack
      // of any package it contains, not just its headline one.
      const parts = p.parts.map((part) => `${part.name} ${part.stack}`).join(" ");
      const haystack = `${p.name} ${p.stack} ${p.git.branch} ${p.path} ${parts}`.toLowerCase();
      const stackOk =
        stack === "all" || p.stack === stack || p.parts.some((part) => part.stack === stack);
      return (!needle || haystack.includes(needle)) && stackOk;
    });

    return [...filtered].sort(SORTERS[sort]);
  }, [projects, q, stack, sort]);

  // Folders are ordered by the same measure the rows are sorted by, so the
  // chips still drive what comes first.
  const groups = useMemo(() => groupByFolder(rows, GROUP_WEIGHT[sort]), [rows, sort]);
  const showHeaders = groups.length > 1;

  return (
    <div style={{ display: "flex", flexDirection: "column", padding: "0 12px 16px" }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 9,
          padding: "2px 8px 12px",
          flexWrap: "wrap",
          position: "sticky",
          top: 0,
          background: "var(--bg)",
          zIndex: 5,
        }}
      >
        <div
          className="field"
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            border: "1px solid rgba(var(--wrgb),.09)",
            background: "rgba(var(--wrgb),.035)",
            borderRadius: 10,
            padding: "7px 11px",
            flex: "0 1 268px",
          }}
        >
          <Search size={14} style={{ flex: "0 0 14px", color: "rgba(var(--trgb),.56)" }} />
          <input
            value={q}
            onChange={(e) => app.setQ(e.target.value)}
            placeholder={t.search}
            style={{ border: 0, background: "transparent", outline: "none", width: "100%", fontSize: 12.5 }}
          />
        </div>

        <ChipGroup items={stackChips} active={stack} onPick={app.setStack} />

        <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 8 }}>
          <span
            style={{
              fontSize: 10.5,
              letterSpacing: ".08em",
              textTransform: "uppercase",
              color: "rgba(var(--trgb),.52)",
            }}
          >
            {t.sort}
          </span>
          <ChipGroup
            items={[
              { key: "recent", label: t.sRecent },
              { key: "name", label: t.sName },
              { key: "size", label: t.sSize },
              { key: "dirty", label: t.sDirty },
            ]}
            active={sort}
            onPick={(k) => app.setSort(k as typeof sort)}
          />
        </div>
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: GRID,
          gap: 12,
          padding: "0 12px 8px",
          fontSize: 10.5,
          letterSpacing: ".07em",
          textTransform: "uppercase",
          color: "rgba(var(--trgb),.52)",
          position: "sticky",
          top: 57,
          background: "var(--bg)",
          zIndex: 4,
        }}
      >
        <div>{t.colProject}</div>
        <div>{t.colStack}</div>
        <div>{t.colVer}</div>
        <div>{t.colGit}</div>
        <div style={{ textAlign: "right" }}>{t.colSize}</div>
        <div style={{ textAlign: "right" }}>{t.colGoals}</div>
        <div />
      </div>

      {rows.length === 0 && (
        <div style={{ padding: "28px 12px", color: "rgba(var(--trgb),.5)" }}>
          <div style={{ fontSize: 14, fontWeight: 500, color: "var(--t0)" }}>
            {app.settings?.folders.length ? t.noProjects : t.noFolders}
          </div>
          <div style={{ fontSize: 12, marginTop: 4 }}>
            {app.settings?.folders.length ? t.noProjectsHint : ""}
          </div>
        </div>
      )}

      {groups.map((group) => (
        <div key={group.key}>
          {showHeaders && (
            <FolderHeader label={group.label} title={group.key}>
              <span
                style={{
                  fontFamily: "'JetBrains Mono',monospace",
                  fontSize: 10.5,
                  color: "rgba(var(--trgb),.45)",
                }}
              >
                {projectCount(group.items.length, t)}
              </span>
              <span
                style={{
                  fontFamily: "'JetBrains Mono',monospace",
                  fontSize: 11,
                  fontWeight: 500,
                  color: "rgba(var(--trgb),.7)",
                }}
              >
                {size(group.items.reduce((total, p) => total + p.sizeBytes, 0))}
              </span>
              <span
                style={{
                  fontFamily: "'JetBrains Mono',monospace",
                  fontSize: 11,
                  fontWeight: 500,
                  color: "var(--danTx)",
                  minWidth: 62,
                  textAlign: "right",
                }}
              >
                −{size(group.items.reduce((total, p) => total + p.reclaimBytes, 0))}
              </span>
            </FolderHeader>
          )}

          {group.items.map((p) => {
        const ratio = app.goalRatio(p.name);
        const gitState = p.git.isRepo
          ? `${p.git.dirty ? `±${p.git.dirty} ` : `${lang === "hu" ? "tiszta" : "clean"} `}↑${p.git.ahead} ↓${p.git.behind}`
          : t.notARepo;

        return (
          <div
            key={p.id}
            className="h-row"
            onClick={() => app.openProject(p)}
            style={{
              display: "grid",
              gridTemplateColumns: GRID,
              gap: 12,
              padding: "10px 12px",
              borderRadius: 11,
              border: "1px solid transparent",
              cursor: "pointer",
              alignItems: "center",
            }}
          >
            <div style={{ minWidth: 0 }}>
              <div
                style={{
                  fontSize: 13.5,
                  fontWeight: 500,
                  letterSpacing: "-.01em",
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                }}
              >
                {p.name}
              </div>
              <div
                style={{
                  fontFamily: "'JetBrains Mono',monospace",
                  fontSize: 10,
                  color: "rgba(var(--trgb),.52)",
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  marginTop: 1,
                }}
                title={p.path}
              >
                {p.path}
              </div>
            </div>

            <div>
              <span
                style={{
                  display: "inline-block",
                  fontSize: 10.5,
                  fontWeight: 500,
                  padding: "3px 8px",
                  borderRadius: 99,
                  border: "1px solid",
                  ...badge(p.stack),
                }}
              >
                {p.stack}
              </span>
            </div>

            <div style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 11, lineHeight: 1.4 }}>
              <div style={{ fontWeight: 500 }}>{p.version}</div>
              <div style={{ color: "rgba(var(--trgb),.52)", fontSize: 10 }}>{p.git.tag || "—"}</div>
            </div>

            <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
              <GitBranch size={13} style={{ flex: "0 0 13px", color: "rgba(var(--trgb),.52)" }} />
              <div style={{ minWidth: 0 }}>
                <div
                  style={{
                    fontFamily: "'JetBrains Mono',monospace",
                    fontSize: 10.5,
                    whiteSpace: "nowrap",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    color: "rgba(var(--trgb),.8)",
                  }}
                >
                  {p.git.branch || "—"}
                </div>
                <div
                  style={{
                    fontFamily: "'JetBrains Mono',monospace",
                    fontSize: 10,
                    color: p.git.dirty > 5 ? "var(--danTx)" : "rgba(var(--trgb),.54)",
                    whiteSpace: "nowrap",
                  }}
                >
                  {gitState}
                </div>
              </div>
            </div>

            <div style={{ textAlign: "right", fontFamily: "'JetBrains Mono',monospace", fontSize: 11 }}>
              <div>{size(p.sizeBytes)}</div>
              <div style={{ fontSize: 10, color: "var(--danTx)" }}>−{size(p.reclaimBytes)}</div>
            </div>

            <div
              style={{
                textAlign: "right",
                fontFamily: "'JetBrains Mono',monospace",
                fontSize: 11,
                color: ratio.all ? "rgba(var(--trgb),.6)" : "rgba(var(--trgb),.44)",
              }}
            >
              {ratio.all ? `${ratio.done}/${ratio.all}` : "—"}
            </div>

            <div style={{ display: "flex", justifyContent: "flex-end", color: "rgba(var(--trgb),.25)" }}>
              <ChevronRight size={14} />
            </div>
          </div>
        );
          })}
        </div>
      ))}
    </div>
  );
}
