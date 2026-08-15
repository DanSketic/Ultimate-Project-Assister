import { useEffect, useMemo, useRef, useState } from "react";

import { FavouriteButton, FavouritesFilter, RailHeader } from "../components/GroupHeader";

import { DockerChip } from "../components/Requirements";
import { SearchField } from "../components/SearchField";
import { Close, Play, Stop } from "../components/Icons";
import { cmdKey, manifestLabel } from "../format";
import { groupWithFavourites } from "../grouping";
import type { App } from "../useApp";
import type { CommandDef } from "../types";

export function CommandsView({ app }: { app: App }) {
  const { t, projects, cmdSel, running } = app;

  const [query, setQuery] = useState("");
  const logRef = useRef<HTMLDivElement | null>(null);

  const runnable = projects.filter((p) => p.commands.length > 0);
  // Resolved against every runnable project, not the filtered rail: narrowing
  // the list should not change which project's commands are on screen.
  const selected = runnable.find((p) => p.id === cmdSel) ?? runnable[0];

  const listed = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return runnable;
    return runnable.filter((p) =>
      `${p.name} ${p.path} ${p.manifests.join(" ")}`.toLowerCase().includes(needle),
    );
  }, [runnable, query]);


  // Applied after search, before grouping: the pinned block then holds every
  // row there is, and the folder blocks are empty rather than misleading.
  const shown = app.favouritesOnly ? listed.filter((p) => app.favourites.has(p.id)) : listed;

  // Folders with something running float to the top, then the busiest ones.
  const groups = useMemo(
    () =>
      groupWithFavourites(
        shown,
        app.favourites,
        (items) => {
          const active = items.filter((p) =>
            p.commands.some((c) => running.has(cmdKey(p.id, c))),
          ).length;
          return active * 1000 + items.length;
        },
        t.favourites,
      ),
    [shown, running, app.favourites, t.favourites],
  );
  const showHeaders = groups.length > 1;

  /**
   * The selected project's commands, gathered under the file each was read out
   * of, and inside a group with the headline operations first.
   *
   * Pinned commands are lifted into a block of their own above the rest, the
   * same shape the project rail uses for favourite projects. A pinned command
   * still appears under its own file: it is one command in two places, not a
   * command that has moved somewhere unexpected.
   */
  const cmdGroups = useMemo(() => {
    if (!selected) return [];

    const order = (c: CommandDef) => (c.primary ? 0 : 1);
    const sorted = (items: CommandDef[]) =>
      items.slice().sort((a, b) => order(a) - order(b));

    const groups: Array<{
      key: string;
      label: string;
      title: string;
      pinned: boolean;
      items: CommandDef[];
    }> = [];

    const pinned = selected.commands.filter((c) => app.cmdFavourites.has(cmdKey(selected.id, c)));
    if (pinned.length > 0) {
      groups.push({
        key: "__pinned__",
        label: t.favCmds,
        title: t.favCmds,
        pinned: true,
        items: sorted(pinned),
      });
    }

    // A monorepo has the same file name in several packages, so the directory
    // is part of the identity as well as of the label. `|` is the separator
    // because Windows forbids it in a path, so it can never appear in `cwd`.
    const byFile = new Map<string, CommandDef[]>();
    for (const c of selected.commands) {
      const key = `${c.cwd}|${c.source}`;
      const list = byFile.get(key);
      if (list) list.push(c);
      else byFile.set(key, [c]);
    }

    for (const [key, items] of byFile) {
      const [cwd = "", source = ""] = key.split("|");
      const label = cwd ? `${cwd}/${source || "—"}` : source || t.detected;
      groups.push({
        key,
        label,
        title: cwd ? `${selected.path}\\${cwd}\\${source}` : `${selected.path}\\${source}`,
        pinned: false,
        items: sorted(items),
      });
    }

    return groups;
  }, [selected, app.cmdFavourites, t.favCmds, t.detected]);

  const hasDockerCommands = selected?.commands.some((c) => c.kind === "docker") ?? false;

  /**
   * One tab per run of the open project. Scoped to the project on purpose:
   * switching projects should show that project's runs, not everything the
   * session has ever started.
   */
  const tabs = useMemo(() => {
    if (!selected) return [];
    return Object.keys(app.logs)
      .filter((key) => key.startsWith(`${selected.id}|`))
      .map((key) => {
        const [, cwd = "", cmd = ""] = key.split("|");
        return {
          key,
          label: cwd ? `${cwd}/ ${cmd}` : cmd,
          title: cwd ? `${cmd}  ·  ${selected.path}\\${cwd}` : `${cmd}  ·  ${selected.path}`,
          running: running.has(key),
        };
      });
  }, [selected, app.logs, running]);

  // A tab the user picked wins; otherwise follow whatever is running, and fall
  // back to the newest stream so the pane is never blank while output exists.
  const activeTab =
    tabs.find((t2) => t2.key === app.logTab)?.key ??
    tabs.find((t2) => t2.running)?.key ??
    tabs[tabs.length - 1]?.key ??
    "";

  const lines = app.logs[activeTab] ?? [];

  // Follow the tail of whichever stream is on screen, including after a tab
  // switch — landing mid-scroll in a log you just opened reads as frozen.
  useEffect(() => {
    const el = logRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [lines, activeTab]);

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
      {/* Search sits outside the scrolling list rather than sticking to its
          top, so it cannot drift out of place as the list changes height. */}
      <div style={{ display: "flex", flexDirection: "column", minHeight: 0, gap: 8 }}>
        <SearchField
          value={query}
          onChange={setQuery}
          placeholder={t.findProject}
          clearTitle={t.clearSearch}
          compact
        />
        <FavouritesFilter
          on={app.favouritesOnly}
          onClick={app.toggleFavouritesOnly}
          label={t.favourites}
          title={t.favouritesOnlyHint}
        />

        <div style={{ overflow: "auto", minHeight: 0, display: "flex", flexDirection: "column", gap: 2 }}>
          {groups.length === 0 && (
            <div style={{ fontSize: 11.5, color: "rgba(var(--trgb),.45)", padding: "10px 11px" }}>
              {t.noMatch}
            </div>
          )}
          {groups.map((group) => (
          <div key={group.key}>
            {showHeaders && (
              <RailHeader
                label={group.label}
                title={group.favourite ? t.favourites : group.key}
                pinned={group.favourite}
                collapsed={app.isCollapsed("cmd", group.key)}
                onToggle={() => app.toggleGroup("cmd", group.key)}
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
            {!(showHeaders && app.isCollapsed("cmd", group.key)) &&
              group.items.map((p) => {
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
            {/* The file names live on the group headings now, so this says how
                many commands there are rather than repeating the manifests. */}
            <span
              style={{
                fontFamily: "'JetBrains Mono',monospace",
                fontSize: 10.5,
                color: "rgba(var(--trgb),.5)",
              }}
            >
              {selected ? `${selected.commands.length} · ${t.navCmd.toLowerCase()}` : "—"}
            </span>
            {/* Starting a stack from here fails confusingly when the daemon is
                down, so its state belongs next to the commands. */}
            {hasDockerCommands && (
              <span style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 7 }}>
                <span
                  style={{
                    fontSize: 10,
                    letterSpacing: ".07em",
                    textTransform: "uppercase",
                    color: "rgba(var(--trgb),.4)",
                  }}
                >
                  {t.dockerTitle}
                </span>
                <DockerChip status={app.docker} t={t} />
              </span>
            )}
          </div>

          {!selected && (
            <div style={{ fontSize: 12.5, color: "rgba(var(--trgb),.5)", padding: "8px 0" }}>
              {t.emptyCmds}
            </div>
          )}

          {cmdGroups.map((group) => (
            <div key={group.key} style={{ marginTop: 10 }}>
              <RailHeader
                label={group.label}
                title={group.title}
                pinned={group.pinned}
                preserveCase={!group.pinned}
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
              {group.items.map((c) => {
                const key = cmdKey(selected!.id, c);
                const on = running.has(key);
                const pinned = app.cmdFavourites.has(key);

                return (
                  <div
                    key={key}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 11,
                      padding: c.primary ? "11px 10px" : "10px 10px",
                      borderTop: "1px solid rgba(var(--wrgb),.06)",
                      // A headline command is tinted and outlined; everything
                      // else stays flat, so the difference is visible at a
                      // glance rather than needing to be read.
                      borderRadius: c.primary ? 11 : 0,
                      border: c.primary ? "1px solid rgba(var(--accrgb),.22)" : undefined,
                      background: c.primary ? "rgba(var(--accrgb),.055)" : undefined,
                      marginBottom: c.primary ? 4 : 0,
                    }}
                  >
                    <span
                      style={{
                        fontSize: 10.5,
                        fontWeight: 500,
                        border: `1px solid ${c.primary ? "rgba(var(--accrgb),.35)" : "rgba(var(--wrgb),.1)"}`,
                        background: c.primary ? "rgba(var(--accrgb),.12)" : "rgba(var(--wrgb),.04)",
                        color: c.primary ? "var(--accTx)" : "rgba(var(--trgb),.6)",
                        borderRadius: 99,
                        padding: "2px 8px",
                        flex: "0 0 auto",
                      }}
                    >
                      {c.kind}
                    </span>

                    <span style={{ minWidth: 0, flex: 1 }}>
                      <span
                        style={{
                          display: "flex",
                          alignItems: "baseline",
                          gap: 7,
                          fontSize: 13,
                          fontWeight: c.primary ? 600 : 500,
                        }}
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

                    <FavouriteButton
                      on={pinned}
                      onClick={() => app.toggleCmdFavourite(key)}
                      title={pinned ? t.removeFavCmd : t.addFavCmd}
                    />

                    <button
                      type="button"
                      className={on ? "h-danger" : "h-ghost"}
                      onClick={() => void app.toggleCommand(selected!, c)}
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
          ))}
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
          {/* One tab per run. Two dev servers in the same project used to
              interleave into a single pane, which made both unreadable. */}
          <div
            style={{
              display: "flex",
              alignItems: "stretch",
              gap: 2,
              padding: "6px 8px 0",
              borderBottom: "1px solid rgba(var(--wrgb),.07)",
              overflowX: "auto",
            }}
          >
            <span
              style={{
                fontSize: 10.5,
                letterSpacing: ".09em",
                textTransform: "uppercase",
                color: "rgba(var(--trgb),.56)",
                alignSelf: "center",
                padding: "0 6px 6px",
                flex: "0 0 auto",
              }}
            >
              {t.logs}
            </span>

            {tabs.length === 0 && (
              <span
                style={{
                  alignSelf: "center",
                  padding: "0 4px 6px",
                  fontFamily: "'JetBrains Mono',monospace",
                  fontSize: 10,
                  color: "rgba(var(--trgb),.42)",
                }}
              >
                {t.idleL}
              </span>
            )}

            {tabs.map((tab) => {
              const on = tab.key === activeTab;
              return (
                <span
                  key={tab.key}
                  role="button"
                  tabIndex={0}
                  aria-pressed={on}
                  className="h-soft"
                  onClick={() => app.setLogTab(tab.key)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      app.setLogTab(tab.key);
                    }
                  }}
                  title={tab.title}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 6,
                    flex: "0 0 auto",
                    maxWidth: 220,
                    padding: "5px 9px",
                    borderRadius: "9px 9px 0 0",
                    border: "1px solid",
                    borderColor: on ? "rgba(var(--wrgb),.12)" : "transparent",
                    borderBottomColor: "transparent",
                    background: on ? "rgba(var(--wrgb),.06)" : "transparent",
                    cursor: "pointer",
                    marginBottom: -1,
                  }}
                >
                  <span
                    style={{
                      width: 6,
                      height: 6,
                      flex: "0 0 6px",
                      borderRadius: 99,
                      background: tab.running ? "var(--acc)" : "rgba(var(--trgb),.28)",
                      boxShadow: tab.running ? "0 0 8px rgba(var(--accrgb),.8)" : undefined,
                      animation: tab.running ? "upaPulse 1.8s infinite" : undefined,
                    }}
                  />
                  <span
                    style={{
                      fontFamily: "'JetBrains Mono',monospace",
                      fontSize: 10,
                      color: on ? "var(--t0)" : "rgba(var(--trgb),.6)",
                      whiteSpace: "nowrap",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                    }}
                  >
                    {tab.label}
                  </span>
                  <button
                    type="button"
                    className="h-fade-4"
                    title={t.closeTab}
                    onClick={(e) => {
                      e.stopPropagation();
                      app.closeLog(tab.key);
                    }}
                    style={{
                      border: 0,
                      background: "transparent",
                      padding: 1,
                      cursor: "pointer",
                      color: "rgba(var(--trgb),.6)",
                      display: "flex",
                      flex: "0 0 auto",
                    }}
                  >
                    <Close size={10} strokeWidth={2.2} />
                  </button>
                </span>
              );
            })}

            <button
              type="button"
              className="h-ghost"
              onClick={app.clearLog}
              style={{
                marginLeft: "auto",
                alignSelf: "center",
                border: "1px solid rgba(var(--wrgb),.1)",
                borderRadius: 8,
                background: "transparent",
                color: "rgba(var(--trgb),.55)",
                padding: "3px 9px",
                marginBottom: 6,
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
            {lines.length === 0 && (
              <div style={{ display: "flex", gap: 11 }}>
                <span style={{ color: "rgba(var(--trgb),.44)", flex: "0 0 52px" }}>--:--:--</span>
                <span style={{ color: "rgba(var(--trgb),.52)" }}>{t.logEmpty}</span>
              </div>
            )}
            {lines.map((line, i) => (
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
