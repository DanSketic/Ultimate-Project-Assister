import { useEffect, useMemo, useRef, useState } from "react";

import { Search } from "./Icons";
import { FAVOURITES_KEY, groupByFolder } from "../grouping";
import type { Project } from "../types";

/**
 * Small popover for choosing which project something belongs to.
 *
 * Grouped by folder like every other project list, and filterable, because a
 * board with thirty-odd projects behind it is not a list you want to scan.
 */
export function ProjectPicker({
  projects,
  favourites,
  title,
  searchPlaceholder,
  onPick,
  onClose,
}: {
  projects: Project[];
  favourites: Set<string>;
  title: string;
  searchPlaceholder: string;
  onPick: (projectId: string) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const boxRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    const onDown = (e: PointerEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) onClose();
    };
    window.addEventListener("keydown", onKey);
    // `capture` so the board's own pan handler does not swallow the click.
    window.addEventListener("pointerdown", onDown, true);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("pointerdown", onDown, true);
    };
  }, [onClose]);

  const groups = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const matching = needle
      ? projects.filter((p) => `${p.name} ${p.path}`.toLowerCase().includes(needle))
      : projects;
    // Favourites first, then folders by project count.
    const pinned = matching.filter((p) => favourites.has(p.id));
    const rest = matching.filter((p) => !favourites.has(p.id));
    const folders = groupByFolder(rest, (items) => items.length);
    return pinned.length
      ? [{ key: FAVOURITES_KEY, label: "★", items: pinned }, ...folders]
      : folders;
  }, [projects, favourites, query]);

  return (
    <div
      ref={boxRef}
      style={{
        position: "absolute",
        top: "calc(100% + 6px)",
        left: 0,
        zIndex: 30,
        width: 300,
        maxHeight: 360,
        display: "flex",
        flexDirection: "column",
        background: "var(--elev)",
        border: "1px solid rgba(var(--wrgb),.12)",
        borderRadius: 12,
        boxShadow: "var(--shDlg)",
        overflow: "hidden",
      }}
    >
      <div style={{ padding: "10px 12px 8px" }}>
        <div
          style={{
            fontSize: 10.5,
            letterSpacing: ".09em",
            textTransform: "uppercase",
            color: "rgba(var(--trgb),.5)",
            marginBottom: 8,
          }}
        >
          {title}
        </div>
        <div
          className="field"
          style={{
            display: "flex",
            alignItems: "center",
            gap: 7,
            border: "1px solid rgba(var(--wrgb),.1)",
            background: "rgba(var(--wrgb),.04)",
            borderRadius: 9,
            padding: "6px 9px",
          }}
        >
          <Search size={13} style={{ flex: "0 0 13px", color: "rgba(var(--trgb),.5)" }} />
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={searchPlaceholder}
            style={{
              border: 0,
              background: "transparent",
              outline: "none",
              width: "100%",
              fontSize: 12,
            }}
          />
        </div>
      </div>

      <div style={{ overflow: "auto", minHeight: 0, padding: "0 6px 8px" }}>
        {groups.map((group) => (
          <div key={group.key}>
            <div
              style={{
                fontFamily: "'JetBrains Mono',monospace",
                fontSize: 9,
                letterSpacing: ".06em",
                textTransform: "uppercase",
                color: "rgba(var(--trgb),.38)",
                padding: "7px 8px 3px",
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
              }}
              title={group.key}
            >
              {group.label}
            </div>
            {group.items.map((p) => (
              <button
                key={p.id}
                type="button"
                className="h-soft"
                onClick={() => {
                  onPick(p.id);
                  onClose();
                }}
                style={{
                  display: "block",
                  width: "100%",
                  textAlign: "left",
                  border: 0,
                  background: "transparent",
                  borderRadius: 8,
                  padding: "6px 8px",
                  cursor: "pointer",
                  fontSize: 12.5,
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                }}
                title={p.path}
              >
                {p.name}
              </button>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
