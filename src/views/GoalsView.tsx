import { useMemo, useState } from "react";

import { FavouriteButton, RailHeader } from "../components/GroupHeader";
import { SearchField } from "../components/SearchField";
import { Check, Close, Plus } from "../components/Icons";
import { groupWithFavourites } from "../grouping";
import type { App } from "../useApp";

const inputStyle = {
  flex: 1,
  minWidth: 0,
  border: "1px solid rgba(var(--accrgb),.4)",
  borderRadius: 9,
  background: "rgba(var(--wrgb),.04)",
  padding: "7px 10px",
  fontSize: 12.5,
  outline: "none",
} as const;

export function GoalsView({ app }: { app: App }) {
  const { t, projects, goalSel } = app;

  const [goalDraft, setGoalDraft] = useState<string | null>(null);
  const [featureDraft, setFeatureDraft] = useState<{ goalId: string; value: string } | null>(null);
  const [query, setQuery] = useState("");

  // Resolved against every project, not the filtered rail: narrowing the list
  // should not change which project's goals are on screen.
  const selected = projects.find((p) => p.id === goalSel) ?? projects[0];
  const goals = selected ? app.goalsFor(selected.id) : [];

  const listed = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return projects;
    return projects.filter((p) => `${p.name} ${p.path}`.toLowerCase().includes(needle));
  }, [projects, query]);

  // Folders with the most unfinished features first - that is where the work is.
  const groups = useMemo(
    () =>
      groupWithFavourites(
        listed,
        app.favourites,
        (items) =>
          items.reduce((open, p) => {
            const r = app.goalRatio(p.id);
            return open + (r.all - r.done);
          }, 0),
        t.favourites,
      ),
    [listed, app, t.favourites],
  );
  const showHeaders = groups.length > 1;

  const submitGoal = () => {
    if (goalDraft?.trim() && selected) app.addGoal(selected.id, goalDraft);
    setGoalDraft(null);
  };

  const submitFeature = () => {
    if (featureDraft?.value.trim()) app.addFeature(featureDraft.goalId, featureDraft.value);
    setFeatureDraft(null);
  };

  return (
    // Two independent scroll panes: running down the project rail must not drag
    // the goal cards along with it.
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "258px 1fr",
        gap: 16,
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

        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 2,
            overflow: "auto",
            minHeight: 0,
            paddingBottom: 8,
          }}
        >
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
          const r = app.goalRatio(p.id);
          const on = p.id === selected?.id;
          return (
            // A div, not a button: it carries the favourite toggle, and a
            // button may not be nested inside another button.
            <div
              key={p.id}
              role="button"
              tabIndex={0}
              aria-pressed={on}
              className="h-soft"
              onClick={() => app.setGoalSel(p.id)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  app.setGoalSel(p.id);
                }
              }}
              style={{
                width: "100%",
                display: "block",
                textAlign: "left",
                border: `1px solid ${on ? "rgba(var(--wrgb),.12)" : "transparent"}`,
                borderRadius: 11,
                background: on ? "rgba(var(--wrgb),.06)" : "transparent",
                padding: "9px 11px",
                cursor: "pointer",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span
                  style={{
                    fontSize: 12.5,
                    fontWeight: 500,
                    flex: 1,
                    whiteSpace: "nowrap",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    color: on ? "var(--t0)" : "rgba(var(--trgb),.65)",
                  }}
                >
                  {p.name}
                </span>
                <FavouriteButton
                  on={app.favourites.has(p.id)}
                  onClick={() => app.toggleFavourite(p.id)}
                  title={app.favourites.has(p.id) ? t.removeFav : t.addFav}
                />
                <span
                  style={{
                    fontFamily: "'JetBrains Mono',monospace",
                    fontSize: 10,
                    color: "rgba(var(--trgb),.56)",
                  }}
                >
                  {r.all ? `${r.done}/${r.all}` : "—"}
                </span>
              </div>
              <div
                style={{
                  height: 3,
                  borderRadius: 99,
                  background: "rgba(var(--wrgb),.08)",
                  marginTop: 7,
                  overflow: "hidden",
                }}
              >
                <div
                  style={{
                    height: 3,
                    borderRadius: 99,
                    background: r.pct === 100 ? "rgba(var(--trgb),.5)" : "var(--acc)",
                    width: `${r.pct}%`,
                  }}
                />
              </div>
            </div>
          );
              })}
            </div>
          ))}
        </div>
      </div>

      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 14,
          overflow: "auto",
          minHeight: 0,
          paddingBottom: 8,
        }}
      >
        {goals.length === 0 && (
          <div style={{ fontSize: 12.5, color: "rgba(var(--trgb),.5)", padding: "4px 2px" }}>
            {t.emptyGoals}
          </div>
        )}

        {goals.map((g) => {
          const done = g.features.filter((f) => f.done).length;
          const pct = g.features.length ? Math.round((done / g.features.length) * 100) : 0;

          return (
            <div
              key={g.id}
              style={{
                border: "1px solid rgba(var(--wrgb),.08)",
                borderRadius: 14,
                background: "rgba(var(--wrgb),.022)",
                overflow: "hidden",
                // `overflow: hidden` switches off the automatic minimum size of
                // a flex item, so without this the cards compress to fit the
                // pane and clip their features instead of scrolling.
                flexShrink: 0,
              }}
            >
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 14,
                  padding: "14px 16px",
                  borderBottom: "1px solid rgba(var(--wrgb),.06)",
                }}
              >
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 15.5, fontWeight: 600, letterSpacing: "-.015em" }}>
                    {g.title}
                  </div>
                  {g.sub && (
                    <div style={{ fontSize: 11.5, color: "rgba(var(--trgb),.42)", marginTop: 2 }}>
                      {g.sub}
                    </div>
                  )}
                </div>
                <div
                  style={{
                    fontFamily: "'JetBrains Mono',monospace",
                    fontSize: 11,
                    color: "rgba(var(--trgb),.55)",
                  }}
                >
                  {done}/{g.features.length}
                </div>
                <div
                  style={{
                    width: 84,
                    height: 5,
                    borderRadius: 99,
                    background: "rgba(var(--wrgb),.08)",
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
                <button
                  type="button"
                  className="h-rule-x"
                  onClick={() => app.removeGoal(g.id)}
                  title={t.removeL}
                  style={{
                    border: 0,
                    background: "transparent",
                    color: "rgba(var(--trgb),.4)",
                    cursor: "pointer",
                    padding: 3,
                    borderRadius: 6,
                    display: "flex",
                  }}
                >
                  <Close size={12} strokeWidth={2} />
                </button>
              </div>

              {g.features.map((f) => (
                <div
                  key={f.id}
                  className="h-row"
                  onClick={() => app.toggleFeature(g.id, f.id)}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 11,
                    padding: "9px 16px",
                    cursor: "pointer",
                  }}
                >
                  <div
                    style={{
                      width: 16,
                      height: 16,
                      borderRadius: 5,
                      border: `1px solid ${f.done ? "var(--acc)" : "rgba(var(--wrgb),.2)"}`,
                      background: f.done ? "var(--acc)" : "transparent",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      flex: "0 0 16px",
                    }}
                  >
                    {f.done && <Check size={10} />}
                  </div>
                  <span
                    style={{
                      fontSize: 13,
                      flex: 1,
                      color: f.done ? "rgba(var(--trgb),.58)" : "var(--t0)",
                      textDecoration: f.done ? "line-through" : "none",
                    }}
                  >
                    {f.title}
                  </span>
                  {f.est && (
                    <span
                      style={{
                        fontFamily: "'JetBrains Mono',monospace",
                        fontSize: 10,
                        color: "rgba(var(--trgb),.52)",
                      }}
                    >
                      {f.est}
                    </span>
                  )}
                  <button
                    type="button"
                    className="h-fade-4"
                    onClick={(e) => {
                      e.stopPropagation();
                      app.removeFeature(g.id, f.id);
                    }}
                    title={t.removeL}
                    style={{
                      border: 0,
                      background: "transparent",
                      color: "rgba(var(--trgb),.6)",
                      cursor: "pointer",
                      padding: 2,
                      display: "flex",
                    }}
                  >
                    <Close size={11} strokeWidth={2} />
                  </button>
                </div>
              ))}

              {featureDraft?.goalId === g.id ? (
                <div
                  style={{
                    display: "flex",
                    gap: 8,
                    padding: "10px 16px",
                    borderTop: "1px solid rgba(var(--wrgb),.06)",
                  }}
                >
                  <input
                    autoFocus
                    value={featureDraft.value}
                    onChange={(e) => setFeatureDraft({ goalId: g.id, value: e.target.value })}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") submitFeature();
                      if (e.key === "Escape") setFeatureDraft(null);
                    }}
                    onBlur={submitFeature}
                    placeholder={t.featTitlePh}
                    style={inputStyle}
                  />
                </div>
              ) : (
                <button
                  type="button"
                  className="h-addfeat"
                  onClick={() => setFeatureDraft({ goalId: g.id, value: "" })}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    width: "100%",
                    border: 0,
                    borderTop: "1px solid rgba(var(--wrgb),.06)",
                    background: "transparent",
                    padding: "10px 16px",
                    cursor: "pointer",
                    textAlign: "left",
                    fontSize: 11.5,
                    fontWeight: 500,
                    color: "rgba(var(--trgb),.42)",
                  }}
                >
                  <Plus size={13} />
                  {t.addFeat}
                </button>
              )}
            </div>
          );
        })}

        {goalDraft !== null ? (
          <div style={{ display: "flex", gap: 8 }}>
            <input
              autoFocus
              value={goalDraft}
              onChange={(e) => setGoalDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") submitGoal();
                if (e.key === "Escape") setGoalDraft(null);
              }}
              onBlur={submitGoal}
              placeholder={t.goalTitlePh}
              style={{ ...inputStyle, padding: "13px 16px", borderRadius: 13 }}
            />
          </div>
        ) : (
          <button
            type="button"
            className="h-addgoal"
            onClick={() => setGoalDraft("")}
            disabled={!selected}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 9,
              border: "1px dashed rgba(var(--wrgb),.16)",
              borderRadius: 13,
              background: "transparent",
              padding: "13px 16px",
              cursor: "pointer",
              textAlign: "left",
              fontSize: 12.5,
              fontWeight: 500,
              color: "rgba(var(--trgb),.5)",
              flexShrink: 0,
            }}
          >
            <Plus size={14} />
            {t.addGoal}
          </button>
        )}
      </div>
    </div>
  );
}
