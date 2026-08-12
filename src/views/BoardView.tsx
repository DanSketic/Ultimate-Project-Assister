import { useCallback, useLayoutEffect, useMemo, useRef, useState } from "react";

import { ChipGroup } from "../components/Chips";
import { ProjectPicker } from "../components/ProjectPicker";
import { Clock, Close, Plus } from "../components/Icons";
import { dueInfo } from "../format";
import type { App } from "../useApp";
import type { NoteColor } from "../types";

const CANVAS = { width: 2080, height: 1120 };
const NOTE_WIDTH = 236;
const COLOR_ORDER: NoteColor[] = ["paper", "accent", "ink"];

function skin(color: NoteColor) {
  if (color === "accent") {
    return { bg: "rgba(var(--accrgb),.1)", bd: "rgba(var(--accrgb),.45)", fg: "var(--accTx)" };
  }
  if (color === "ink") {
    return { bg: "var(--t0)", bd: "var(--t0)", fg: "var(--bg)" };
  }
  return { bg: "var(--noteBg)", bd: "rgba(var(--wrgb),.12)", fg: "var(--t0)" };
}

/** True when the event started on something interactive inside the note. */
function isControl(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && !!target.closest("button, textarea, input");
}

/** A note grows with its text instead of clipping it. */
function NoteText({
  value,
  placeholder,
  onChange,
  onCommit,
}: {
  value: string;
  placeholder: string;
  onChange: (next: string) => void;
  onCommit: () => void;
}) {
  const ref = useRef<HTMLTextAreaElement | null>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "0px";
    el.style.height = `${el.scrollHeight}px`;
  }, [value]);

  return (
    <textarea
      ref={ref}
      className="note-text"
      value={value}
      rows={1}
      placeholder={placeholder}
      onChange={(e) => onChange(e.target.value)}
      onBlur={onCommit}
      style={{ fontSize: 12.5, lineHeight: 1.45 }}
    />
  );
}

export function BoardView({ app }: { app: App }) {
  const { t, notes, boardFilter } = app;

  const scrollRef = useRef<HTMLDivElement | null>(null);
  const [drag, setDrag] = useState<{ id: string; x: number; y: number } | null>(null);
  const [editingDue, setEditingDue] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);
  const [reassigning, setReassigning] = useState<string | null>(null);

  // Notes are filed by project id; the chip shows that project's name.
  const nameOf = useCallback(
    (projectId: string) => app.projects.find((p) => p.id === projectId)?.name ?? projectId,
    [app.projects],
  );

  const chips = useMemo(() => {
    const ids = [...new Set(notes.map((n) => n.project))].filter(Boolean);
    return [
      { key: "all", label: t.all },
      ...ids.map((id) => {
        const label = nameOf(id);
        return { key: id, label: label.length > 16 ? `${label.slice(0, 15)}…` : label };
      }),
    ];
  }, [notes, t.all, nameOf]);

  const startPan = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (e.target !== e.currentTarget || e.button !== 0) return;
    const el = scrollRef.current;
    if (!el) return;
    e.preventDefault();

    const canvas = e.currentTarget;
    const sx = e.clientX;
    const sy = e.clientY;
    const left = el.scrollLeft;
    const top = el.scrollTop;
    canvas.style.cursor = "grabbing";

    const move = (ev: PointerEvent) => {
      el.scrollLeft = left - (ev.clientX - sx);
      el.scrollTop = top - (ev.clientY - sy);
    };
    const up = () => {
      canvas.style.cursor = "grab";
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  }, []);

  const startDrag = useCallback(
    (id: string, e: React.PointerEvent<HTMLDivElement>) => {
      if (e.button !== 0 || isControl(e.target)) return;
      const note = notes.find((n) => n.id === id);
      if (!note) return;
      e.preventDefault();

      app.raiseNote(id);
      const sx = e.clientX;
      const sy = e.clientY;
      const ox = note.x;
      const oy = note.y;
      let last = { x: ox, y: oy };

      const move = (ev: PointerEvent) => {
        last = {
          x: Math.max(0, Math.min(CANVAS.width - NOTE_WIDTH, ox + ev.clientX - sx)),
          y: Math.max(0, Math.min(CANVAS.height - 60, oy + ev.clientY - sy)),
        };
        setDrag({ id, ...last });
      };
      const up = () => {
        window.removeEventListener("pointermove", move);
        window.removeEventListener("pointerup", up);
        setDrag(null);
        // Only one write to disk per drag, at the end.
        app.patchNote(id, last, true);
      };
      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", up);
    },
    [notes, app],
  );

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100%",
        minHeight: 0,
        padding: "0 20px 20px",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 9, padding: "0 0 12px", flexWrap: "wrap" }}>
        <div style={{ position: "relative" }}>
        <button
          type="button"
          className="h-accent-strong"
          onClick={() => {
            // Arriving from a project pins the board to it, so a new note has
            // an obvious owner. With no filter there is nothing to infer from
            // and the project is asked for instead of guessed.
            if (boardFilter !== "all") app.addNote(boardFilter);
            else setPicking(true);
          }}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 7,
            border: "1px solid rgba(var(--accrgb),.5)",
            borderRadius: 10,
            background: "rgba(var(--accrgb),.15)",
            color: "var(--accTx)",
            padding: "7px 12px",
            cursor: "pointer",
            fontSize: 11.5,
            fontWeight: 600,
          }}
        >
          <Plus size={13} />
          {t.newNote}
        </button>
        {picking && (
          <ProjectPicker
            projects={app.projects}
            favourites={app.favourites}
            title={t.pickProject}
            searchPlaceholder={t.search}
            onPick={(id) => app.addNote(id)}
            onClose={() => setPicking(false)}
          />
        )}
        </div>

        <ChipGroup items={chips} active={boardFilter} onPick={app.setBoardFilter} mono wrap />

        <div style={{ marginLeft: "auto", fontSize: 11, color: "rgba(var(--trgb),.52)" }}>
          {t.dragHint}
        </div>
      </div>

      <div
        ref={scrollRef}
        style={{
          flex: 1,
          minHeight: 0,
          overflow: "auto",
          border: "1px solid rgba(var(--wrgb),.07)",
          borderRadius: 14,
          background:
            "radial-gradient(circle,rgba(var(--wrgb),.055) 1px,transparent 1px) 0 0/26px 26px,rgba(var(--wrgb),.015)",
        }}
      >
        <div
          onPointerDown={startPan}
          style={{ position: "relative", width: CANVAS.width, height: CANVAS.height, cursor: "grab" }}
        >
          {notes.map((n) => {
            const dim = boardFilter !== "all" && n.project !== boardFilter;
            const s = skin(n.color);
            const due = dueInfo(n.due, t);
            const pos = drag?.id === n.id ? drag : n;

            return (
              <div
                key={n.id}
                onPointerDown={(e) => startDrag(n.id, e)}
                style={{
                  position: "absolute",
                  left: pos.x,
                  top: pos.y,
                  width: NOTE_WIDTH,
                  zIndex: dim ? 1 : n.z + 1,
                  border: `1px solid ${dim ? "rgba(var(--wrgb),.07)" : s.bd}`,
                  borderRadius: 13,
                  background: s.bg,
                  color: dim ? "rgba(var(--trgb),.46)" : s.fg,
                  boxShadow: dim ? "none" : "var(--shNote)",
                  cursor: "grab",
                  userSelect: "none",
                  display: "flex",
                  flexDirection: "column",
                  backdropFilter: "blur(6px)",
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 7, padding: "8px 10px 6px" }}>
                  <span
                    style={{
                      width: 6,
                      height: 6,
                      borderRadius: 99,
                      background: "currentColor",
                      opacity: 0.45,
                    }}
                  />
                  <span style={{ flex: 1, minWidth: 0, position: "relative" }}>
                    <button
                      type="button"
                      onClick={() => setReassigning(reassigning === n.id ? null : n.id)}
                      title={t.changeProject}
                      style={{
                        border: 0,
                        background: "transparent",
                        color: "inherit",
                        padding: 0,
                        cursor: "pointer",
                        fontFamily: "'JetBrains Mono',monospace",
                        fontSize: 9.5,
                        opacity: 0.62,
                        maxWidth: "100%",
                        whiteSpace: "nowrap",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        display: "block",
                        textAlign: "left",
                      }}
                    >
                      {n.project ? nameOf(n.project) : t.noProject}
                    </button>
                    {reassigning === n.id && (
                      <ProjectPicker
                        projects={app.projects}
                        favourites={app.favourites}
                        title={t.changeProject}
                        searchPlaceholder={t.search}
                        onPick={(id) => app.patchNote(n.id, { project: id }, true)}
                        onClose={() => setReassigning(null)}
                      />
                    )}
                  </span>
                  <button
                    type="button"
                    className="h-fade"
                    onClick={() => app.removeNote(n.id)}
                    title={t.removeL}
                    style={{
                      border: 0,
                      background: "transparent",
                      color: "inherit",
                      cursor: "pointer",
                      padding: 1,
                      display: "flex",
                      borderRadius: 5,
                    }}
                  >
                    <Close size={11} strokeWidth={2.2} />
                  </button>
                </div>

                <div style={{ padding: "2px 11px 10px" }}>
                  <NoteText
                    value={n.text}
                    placeholder={t.newNote}
                    onChange={(text) => app.patchNote(n.id, { text })}
                    onCommit={() => app.patchNote(n.id, {}, true)}
                  />
                </div>

                <div style={{ display: "flex", alignItems: "center", gap: 7, padding: "0 11px 11px" }}>
                  {editingDue === n.id ? (
                    <input
                      type="date"
                      autoFocus
                      value={n.due}
                      onChange={(e) => app.patchNote(n.id, { due: e.target.value }, true)}
                      onBlur={() => setEditingDue(null)}
                      style={{
                        border: `1px solid ${due.bd}`,
                        background: "transparent",
                        color: "inherit",
                        borderRadius: 99,
                        padding: "1px 6px",
                        fontFamily: "'JetBrains Mono',monospace",
                        fontSize: 9.5,
                        outline: "none",
                      }}
                    />
                  ) : (
                    <button
                      type="button"
                      onClick={() => setEditingDue(n.id)}
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        gap: 5,
                        fontFamily: "'JetBrains Mono',monospace",
                        fontSize: 9.5,
                        fontWeight: 500,
                        border: `1px solid ${dim ? "rgba(var(--wrgb),.1)" : due.bd}`,
                        background: dim ? "transparent" : due.bg,
                        color: dim ? "rgba(var(--trgb),.46)" : due.fg,
                        borderRadius: 99,
                        padding: "2px 7px",
                        cursor: "pointer",
                      }}
                    >
                      <Clock size={9} />
                      {due.label}
                    </button>
                  )}
                  <button
                    type="button"
                    className="h-fade-4"
                    title="color"
                    onClick={() =>
                      app.patchNote(
                        n.id,
                        { color: COLOR_ORDER[(COLOR_ORDER.indexOf(n.color) + 1) % 3]! },
                        true,
                      )
                    }
                    style={{
                      marginLeft: "auto",
                      border: "1px solid currentColor",
                      borderRadius: 99,
                      background: "transparent",
                      color: "inherit",
                      width: 14,
                      height: 14,
                      cursor: "pointer",
                      padding: 0,
                    }}
                  />
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
