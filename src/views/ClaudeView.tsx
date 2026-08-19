// What Claude Code has been doing in these projects, and what it cost.
//
// Deliberately not a transcript browser: the sessions are summarised, and only
// the one you open is read line by line. The point of the view is the shape of
// the work - which projects, how much of it, how recently - with the
// conversation itself one click away when the summary is not enough.

import { useMemo } from "react";

import { ChipGroup } from "../components/Chips";
import { FolderHeader } from "../components/GroupHeader";
import { SearchField } from "../components/SearchField";
import { RefreshAction } from "../components/Requirements";
import { ChevronLeft, GitBranch, Info, Terminal } from "../components/Icons";
import { num, size, since, tokens, usd } from "../format";
import type { App } from "../useApp";
import type { ClaudeSession } from "../types";

const mono = "'JetBrains Mono',monospace";
const GRID = "minmax(220px,1fr) 118px 78px 78px 84px 72px";
/** Days of history the activity strip covers. */
const DAYS = 30;
/** Models and tools listed in the breakdown panels. */
const TOP = 6;

interface Totals {
  sessions: number;
  messages: number;
  toolCalls: number;
  tokens: number;
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  cost: number;
}

function totalsOf(sessions: ClaudeSession[]): Totals {
  return sessions.reduce<Totals>(
    (a, s) => ({
      sessions: a.sessions + 1,
      messages: a.messages + s.messages,
      toolCalls: a.toolCalls + s.toolCalls,
      tokens:
        a.tokens + s.tokens.input + s.tokens.output + s.tokens.cacheRead + s.tokens.cacheWrite,
      input: a.input + s.tokens.input,
      output: a.output + s.tokens.output,
      cacheRead: a.cacheRead + s.tokens.cacheRead,
      cacheWrite: a.cacheWrite + s.tokens.cacheWrite,
      cost: a.cost + s.costUsd,
    }),
    {
      sessions: 0,
      messages: 0,
      toolCalls: 0,
      tokens: 0,
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      cost: 0,
    },
  );
}

/** `YYYY-MM-DD` in local time, which is the day the user remembers working. */
function dayKey(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function ClaudeView({ app }: { app: App }) {
  const { t, lang, claude } = app;
  const sessions = useMemo(() => claude?.sessions ?? [], [claude]);

  /** Projects that have sessions, most recently worked in first. */
  const scopes = useMemo(() => {
    const seen = new Map<string, string>();
    for (const s of sessions) {
      const key = s.projectId || `path:${s.path}`;
      if (!seen.has(key)) seen.set(key, s.project || t.claudeUnbound);
    }
    return [
      { key: "", label: t.all },
      ...[...seen.entries()].map(([key, label]) => ({ key, label })),
    ];
  }, [sessions, t]);

  const shown = useMemo(() => {
    const needle = app.claudeQuery.trim().toLowerCase();
    return sessions.filter((s) => {
      if (app.claudeSel) {
        const key = s.projectId || `path:${s.path}`;
        if (key !== app.claudeSel) return false;
      }
      if (!needle) return true;
      return (
        s.title.toLowerCase().includes(needle) ||
        s.project.toLowerCase().includes(needle) ||
        s.branch.toLowerCase().includes(needle)
      );
    });
  }, [sessions, app.claudeSel, app.claudeQuery]);

  const totals = useMemo(() => totalsOf(shown), [shown]);

  /** One bucket per day, oldest first, filed by the day a session started. */
  const days = useMemo(() => {
    const buckets = new Map<string, { tokens: number; sessions: number; messages: number }>();
    const today = new Date();
    const keys: string[] = [];
    for (let back = DAYS - 1; back >= 0; back--) {
      const date = new Date(today.getTime() - back * 864e5);
      const key = dayKey(date);
      keys.push(key);
      buckets.set(key, { tokens: 0, sessions: 0, messages: 0 });
    }
    for (const s of shown) {
      const at = new Date(s.startedAt);
      if (Number.isNaN(at.getTime())) continue;
      const bucket = buckets.get(dayKey(at));
      if (!bucket) continue;
      bucket.sessions += 1;
      bucket.messages += s.messages;
      bucket.tokens +=
        s.tokens.input + s.tokens.output + s.tokens.cacheRead + s.tokens.cacheWrite;
    }
    return keys.map((key) => ({ key, ...buckets.get(key)! }));
  }, [shown]);

  /** Models and tools across the sessions on screen, busiest first. */
  const breakdown = useMemo(() => {
    const models = new Map<string, number>();
    const tools = new Map<string, number>();
    for (const s of shown) {
      for (const m of s.models) models.set(m.name, (models.get(m.name) ?? 0) + m.count);
      for (const tool of s.tools) tools.set(tool.name, (tools.get(tool.name) ?? 0) + tool.count);
    }
    const rank = (map: Map<string, number>) =>
      [...map.entries()]
        .map(([name, count]) => ({ name, count }))
        .sort((a, b) => b.count - a.count)
        .slice(0, TOP);
    return { models: rank(models), tools: rank(tools) };
  }, [shown]);

  /** Grouped by project, so a long list reads as projects rather than dates. */
  const groups = useMemo(() => {
    const byProject = new Map<string, ClaudeSession[]>();
    for (const s of shown) {
      const key = s.projectId || `path:${s.path}`;
      const list = byProject.get(key);
      if (list) list.push(s);
      else byProject.set(key, [s]);
    }
    return [...byProject.entries()]
      .map(([key, items]) => ({
        key,
        label: items[0]?.project || t.claudeUnbound,
        orphan: !items[0]?.projectId,
        items,
        cost: items.reduce((a, s) => a + s.costUsd, 0),
        // The list arrives newest first, so the head of each group is the
        // last time anybody worked in that project.
        last: items[0]?.endedAt ?? "",
      }))
      .sort((a, b) => b.last.localeCompare(a.last));
  }, [shown, t.claudeUnbound]);

  const open = useMemo(
    () => sessions.find((s) => s.id === app.claudeOpen) ?? null,
    [sessions, app.claudeOpen],
  );

  if (claude === null) return <Note text={t.checking} />;
  if (!claude.available) return <Note text={t.claudeMissing} />;
  if (open) return <Transcript app={app} session={open} />;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14, padding: "0 20px 20px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <ChipGroup items={scopes} active={app.claudeSel} onPick={app.setClaudeSel} wrap />
        <span style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 8 }}>
          <SearchField
            value={app.claudeQuery}
            onChange={app.setClaudeQuery}
            placeholder={t.claudeSearch}
            clearTitle={t.cancel}
            compact
          />
          <RefreshAction onClick={() => void app.refreshClaude()} title={t.recheck} />
        </span>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(5,1fr)", gap: 10 }}>
        <Stat label={t.claudeSessions} value={num(totals.sessions, lang)} />
        <Stat label={t.claudeMessages} value={num(totals.messages, lang)} />
        <Stat label={t.claudeToolCalls} value={num(totals.toolCalls, lang)} />
        <Stat
          label={t.claudeTokens}
          value={tokens(totals.tokens, lang)}
          note={`${t.claudeIn} ${tokens(totals.input + totals.cacheRead + totals.cacheWrite, lang)} · ${t.claudeOut} ${tokens(totals.output, lang)}`}
        />
        <Stat
          label={t.claudeCost}
          value={usd(totals.cost)}
          note={t.claudeCostHint}
          hint
          accent
        />
      </div>

      <Activity days={days} app={app} />

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
        <Bars title={t.claudeModels} rows={breakdown.models} lang={lang} />
        <Bars title={t.claudeTools} rows={breakdown.tools} lang={lang} />
      </div>

      {shown.length === 0 ? (
        <Note text={t.claudeNone} />
      ) : (
        <div>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: GRID,
              gap: 10,
              padding: "0 12px 6px",
              fontSize: 10,
              letterSpacing: ".07em",
              textTransform: "uppercase",
              color: "rgba(var(--trgb),.5)",
            }}
          >
            <div>{t.claudeTranscript}</div>
            <div>{t.claudeLastUsed}</div>
            <div style={{ textAlign: "right" }}>{t.claudeMessages}</div>
            <div style={{ textAlign: "right" }}>{t.claudeToolCalls}</div>
            <div style={{ textAlign: "right" }}>{t.claudeTokens}</div>
            <div style={{ textAlign: "right" }}>{t.claudeCostL}</div>
          </div>

          {groups.map((group) => (
            <div key={group.key}>
              <FolderHeader
                label={group.label}
                title={group.items[0]?.path ?? group.label}
                collapsed={app.isCollapsed("claude", group.key)}
                onToggle={() => app.toggleGroup("claude", group.key)}
              >
                <span style={{ fontFamily: mono, fontSize: 10, color: "rgba(var(--trgb),.45)" }}>
                  {group.items.length} {t.claudeSessionsL}
                </span>
                <span style={{ fontFamily: mono, fontSize: 11, fontWeight: 500 }}>
                  {usd(group.cost)}
                </span>
              </FolderHeader>

              {!app.isCollapsed("claude", group.key) &&
                group.items.map((s) => <Row key={s.id} session={s} app={app} />)}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function Stat({
  label,
  value,
  note,
  hint = false,
  accent = false,
}: {
  label: string;
  value: string;
  note?: string;
  hint?: boolean;
  accent?: boolean;
}) {
  return (
    <div
      style={{
        border: "1px solid rgba(var(--wrgb),.08)",
        background: "rgba(var(--wrgb),.03)",
        borderRadius: 12,
        padding: "11px 13px",
        minWidth: 0,
      }}
      title={note}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 5,
          fontSize: 10,
          letterSpacing: ".07em",
          textTransform: "uppercase",
          color: "rgba(var(--trgb),.5)",
        }}
      >
        {label}
        {hint && <Info size={11} style={{ color: "rgba(var(--trgb),.4)" }} />}
      </div>
      <div
        style={{
          fontFamily: mono,
          fontSize: 19,
          fontWeight: 600,
          marginTop: 4,
          letterSpacing: "-.02em",
          color: accent ? "var(--accTx)" : "var(--t0)",
        }}
      >
        {value}
      </div>
      {note && !hint && (
        <div
          style={{
            fontFamily: mono,
            fontSize: 9.5,
            color: "rgba(var(--trgb),.45)",
            marginTop: 2,
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
        >
          {note}
        </div>
      )}
    </div>
  );
}

/** A month of days as bars. Empty days are drawn too: the gaps are the point. */
function Activity({
  days,
  app,
}: {
  days: Array<{ key: string; tokens: number; sessions: number; messages: number }>;
  app: App;
}) {
  const { t, lang } = app;
  const peak = Math.max(1, ...days.map((d) => d.tokens));

  return (
    <div
      style={{
        border: "1px solid rgba(var(--wrgb),.08)",
        background: "rgba(var(--wrgb),.03)",
        borderRadius: 12,
        padding: "11px 13px 9px",
      }}
    >
      <div
        style={{
          fontSize: 10,
          letterSpacing: ".07em",
          textTransform: "uppercase",
          color: "rgba(var(--trgb),.5)",
          marginBottom: 9,
        }}
      >
        {t.claudeActivity}
      </div>
      <div style={{ display: "flex", alignItems: "flex-end", gap: 3, height: 64 }}>
        {days.map((day) => (
          <div
            key={day.key}
            title={`${day.key} · ${day.sessions} ${t.claudeSessionsL} · ${day.messages} ${t.claudeMessages.toLowerCase()} · ${tokens(day.tokens, lang)}`}
            style={{
              flex: 1,
              minWidth: 0,
              height: `${Math.max(day.tokens > 0 ? 6 : 2, (day.tokens / peak) * 100)}%`,
              borderRadius: 3,
              background: day.tokens
                ? "linear-gradient(180deg,var(--acc),rgba(var(--accrgb),.35))"
                : "rgba(var(--wrgb),.07)",
            }}
          />
        ))}
      </div>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          fontFamily: mono,
          fontSize: 9,
          color: "rgba(var(--trgb),.4)",
          marginTop: 5,
        }}
      >
        <span>{days[0]?.key}</span>
        <span>{days[days.length - 1]?.key}</span>
      </div>
    </div>
  );
}

function Bars({
  title,
  rows,
  lang,
}: {
  title: string;
  rows: Array<{ name: string; count: number }>;
  lang: App["lang"];
}) {
  const peak = Math.max(1, ...rows.map((r) => r.count));

  return (
    <div
      style={{
        border: "1px solid rgba(var(--wrgb),.08)",
        background: "rgba(var(--wrgb),.03)",
        borderRadius: 12,
        padding: "11px 13px",
        minWidth: 0,
      }}
    >
      <div
        style={{
          fontSize: 10,
          letterSpacing: ".07em",
          textTransform: "uppercase",
          color: "rgba(var(--trgb),.5)",
          marginBottom: 8,
        }}
      >
        {title}
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {rows.map((row) => (
          <div key={row.name} style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span
              style={{
                fontFamily: mono,
                fontSize: 10.5,
                width: 148,
                flex: "0 0 148px",
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
                color: "rgba(var(--trgb),.78)",
              }}
              title={row.name}
            >
              {row.name}
            </span>
            <span
              style={{
                flex: 1,
                height: 6,
                borderRadius: 99,
                background: "rgba(var(--wrgb),.07)",
                overflow: "hidden",
              }}
            >
              <span
                style={{
                  display: "block",
                  height: "100%",
                  width: `${(row.count / peak) * 100}%`,
                  borderRadius: 99,
                  background: "var(--acc)",
                }}
              />
            </span>
            <span
              style={{
                fontFamily: mono,
                fontSize: 10.5,
                fontWeight: 500,
                width: 54,
                textAlign: "right",
              }}
            >
              {num(row.count, lang)}
            </span>
          </div>
        ))}
        {rows.length === 0 && (
          <span style={{ fontSize: 11.5, color: "rgba(var(--trgb),.42)" }}>—</span>
        )}
      </div>
    </div>
  );
}

function Row({ session: s, app }: { session: ClaudeSession; app: App }) {
  const { t, lang } = app;
  const all = s.tokens.input + s.tokens.output + s.tokens.cacheRead + s.tokens.cacheWrite;
  const ended = new Date(s.endedAt);
  const when = Number.isNaN(ended.getTime())
    ? "—"
    : since(Math.round(ended.getTime() / 1000), lang);

  return (
    <button
      type="button"
      className="h-soft"
      onClick={() => void app.openClaudeSession(s.id)}
      title={t.claudeOpenSession}
      style={{
        display: "grid",
        gridTemplateColumns: GRID,
        gap: 10,
        alignItems: "center",
        width: "100%",
        padding: "8px 12px",
        border: 0,
        borderTop: "1px solid rgba(var(--wrgb),.05)",
        borderRadius: 10,
        background: "transparent",
        color: "inherit",
        textAlign: "left",
        cursor: "pointer",
      }}
    >
      <span style={{ minWidth: 0 }}>
        <span
          style={{
            display: "block",
            fontSize: 12.5,
            fontWeight: 500,
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
        >
          {s.title}
        </span>
        <span
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            fontFamily: mono,
            fontSize: 9.5,
            color: "rgba(var(--trgb),.44)",
            whiteSpace: "nowrap",
          }}
        >
          {s.branch && (
            <span style={{ display: "inline-flex", alignItems: "center", gap: 3 }}>
              <GitBranch size={10} />
              {s.branch}
            </span>
          )}
          <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>
            {s.models[0]?.name ?? ""}
          </span>
          {s.sidechains > 0 && <span>· {s.sidechains} {t.claudeSubagent}</span>}
        </span>
      </span>

      <span style={{ fontFamily: mono, fontSize: 10.5, color: "rgba(var(--trgb),.6)" }}>
        {when}
      </span>
      <span style={{ textAlign: "right", fontFamily: mono, fontSize: 11.5 }}>
        {num(s.messages, lang)}
      </span>
      <span
        style={{
          textAlign: "right",
          fontFamily: mono,
          fontSize: 11.5,
          color: "rgba(var(--trgb),.7)",
        }}
      >
        {num(s.toolCalls, lang)}
      </span>
      <span style={{ textAlign: "right", fontFamily: mono, fontSize: 11.5, fontWeight: 500 }}>
        {tokens(all, lang)}
      </span>
      <span
        style={{ textAlign: "right", fontFamily: mono, fontSize: 11.5, color: "var(--accTx)" }}
      >
        {usd(s.costUsd)}
      </span>
    </button>
  );
}

/** One session read back: the prompts, the answers and what was reached for. */
function Transcript({ app, session: s }: { app: App; session: ClaudeSession }) {
  const { t, lang } = app;
  const turns = app.claudeTurns;

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        minHeight: 0,
        height: "100%",
        padding: "0 20px 20px",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 10, paddingBottom: 10 }}>
        <button
          type="button"
          className="h-ghost"
          onClick={app.closeClaudeSession}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 5,
            border: "1px solid rgba(var(--wrgb),.1)",
            borderRadius: 9,
            background: "rgba(var(--wrgb),.03)",
            color: "rgba(var(--trgb),.7)",
            padding: "5px 10px",
            cursor: "pointer",
            fontSize: 11,
            fontWeight: 500,
          }}
        >
          <ChevronLeft size={12} />
          {t.back}
        </button>
        <span style={{ minWidth: 0, flex: 1 }}>
          <span
            style={{
              display: "block",
              fontSize: 13,
              fontWeight: 600,
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
            }}
          >
            {s.title}
          </span>
          <span style={{ fontFamily: mono, fontSize: 9.5, color: "rgba(var(--trgb),.45)" }}>
            {s.project} · {num(s.messages, lang)} {t.claudeMessages.toLowerCase()} ·{" "}
            {num(s.toolCalls, lang)} {t.claudeToolCalls.toLowerCase()} · {usd(s.costUsd)} ·{" "}
            {size(s.sizeBytes)}
          </span>
        </span>
        <span style={{ fontSize: 10.5, color: "rgba(var(--trgb),.4)", maxWidth: 320 }}>
          {t.claudeTranscriptHint}
        </span>
      </div>

      {turns === null ? (
        <Note text={t.checking} />
      ) : (
        <div
          style={{
            overflow: "auto",
            minHeight: 0,
            display: "flex",
            flexDirection: "column",
            gap: 8,
            paddingBottom: 10,
          }}
        >
          {turns.map((turn, i) => {
            const user = turn.role === "user";
            return (
              <div
                key={`${turn.time}-${i}`}
                style={{
                  border: "1px solid rgba(var(--wrgb),.07)",
                  borderLeft: `2px solid ${user ? "var(--acc)" : "rgba(var(--wrgb),.14)"}`,
                  background: user ? "rgba(var(--accrgb),.05)" : "rgba(var(--wrgb),.025)",
                  borderRadius: 10,
                  padding: "9px 12px",
                  opacity: turn.sidechain ? 0.72 : 1,
                }}
              >
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    fontFamily: mono,
                    fontSize: 9.5,
                    color: "rgba(var(--trgb),.45)",
                    marginBottom: turn.text || turn.tools.length ? 5 : 0,
                  }}
                >
                  <span style={{ color: user ? "var(--accTx)" : "rgba(var(--trgb),.6)" }}>
                    {user ? "user" : "assistant"}
                  </span>
                  <span>{turn.time.slice(11, 16)}</span>
                  {turn.thinking && <span>· {t.claudeThinking}</span>}
                  {turn.sidechain && <span>· {t.claudeSubagent}</span>}
                  {turn.error && <span style={{ color: "var(--danTx)" }}>· {t.claudeErrorTurn}</span>}
                </div>

                {turn.text && (
                  <div
                    style={{
                      fontSize: 12.5,
                      lineHeight: 1.55,
                      whiteSpace: "pre-wrap",
                      wordBreak: "break-word",
                    }}
                  >
                    {turn.text}
                  </div>
                )}

                {turn.tools.length > 0 && (
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 5, marginTop: 6 }}>
                    {turn.tools.map((tool, at) => (
                      <span
                        key={`${tool}-${at}`}
                        style={{
                          display: "inline-flex",
                          alignItems: "center",
                          gap: 4,
                          fontFamily: mono,
                          fontSize: 9.5,
                          border: "1px solid rgba(var(--coolrgb),.3)",
                          background: "rgba(var(--coolrgb),.1)",
                          color: "rgba(var(--trgb),.72)",
                          borderRadius: 99,
                          padding: "1px 7px",
                        }}
                      >
                        <Terminal size={9} />
                        {tool}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function Note({ text }: { text: string }) {
  return (
    <div style={{ padding: "24px 14px", fontSize: 12.5, color: "rgba(var(--trgb),.5)" }}>
      {text}
    </div>
  );
}
