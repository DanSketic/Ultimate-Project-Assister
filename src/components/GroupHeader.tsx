import type { CSSProperties, ReactNode } from "react";

import { ChevronRight, Folder, Star } from "./Icons";

/**
 * Narrows a list to pinned projects only. One setting behind all three lists,
 * so the answer is the same wherever it is asked - and remembered, because it
 * is a way of working rather than a momentary filter.
 */
export function FavouritesFilter({
  on,
  onClick,
  label,
  title,
}: {
  on: boolean;
  onClick: () => void;
  label: string;
  title: string;
}) {
  return (
    <button
      type="button"
      aria-pressed={on}
      title={title}
      onClick={onClick}
      className={on ? "h-accent" : "h-ghost"}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 6,
        border: `1px solid ${on ? "rgba(var(--accrgb),.45)" : "rgba(var(--wrgb),.1)"}`,
        borderRadius: 9,
        background: on ? "rgba(var(--accrgb),.12)" : "rgba(var(--wrgb),.03)",
        color: on ? "var(--accTx)" : "rgba(var(--trgb),.6)",
        padding: "5px 10px",
        cursor: "pointer",
        fontSize: 11,
        fontWeight: 500,
        whiteSpace: "nowrap",
        flex: "0 0 auto",
      }}
    >
      <Star size={12} filled={on} />
      {label}
    </button>
  );
}

/** Toggles a project in and out of the pinned block. */
export function FavouriteButton({
  on,
  onClick,
  title,
  style,
}: {
  on: boolean;
  onClick: () => void;
  title: string;
  style?: CSSProperties;
}) {
  return (
    <button
      type="button"
      aria-pressed={on}
      title={title}
      onClick={(e) => {
        // The whole row is clickable; pinning must not also open the project.
        e.stopPropagation();
        onClick();
      }}
      className={on ? undefined : "h-fade-4"}
      style={{
        border: 0,
        background: "transparent",
        padding: 2,
        cursor: "pointer",
        display: "flex",
        alignItems: "center",
        color: on ? "var(--acc)" : "rgba(var(--trgb),.55)",
        ...style,
      }}
    >
      <Star size={13} filled={on} />
    </button>
  );
}

/**
 * Folder heading above a block of projects in the projects list. Mirrors the
 * project headings in the cleanup view: name on the left, totals on the right.
 */
export function FolderHeader({
  label,
  title,
  pinned = false,
  collapsed,
  onToggle,
  children,
}: {
  label: string;
  title: string;
  pinned?: boolean;
  /** Omit both of these for a heading that does not fold. */
  collapsed?: boolean;
  onToggle?: () => void;
  children?: ReactNode;
}) {
  const foldable = onToggle !== undefined;
  return (
    <div
      role={foldable ? "button" : undefined}
      tabIndex={foldable ? 0 : undefined}
      aria-expanded={foldable ? !collapsed : undefined}
      className={foldable ? "h-soft-3" : undefined}
      onClick={onToggle}
      onKeyDown={(e) => {
        if (foldable && (e.key === "Enter" || e.key === " ")) {
          e.preventDefault();
          onToggle?.();
        }
      }}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 9,
        padding: "9px 12px 7px",
        marginTop: 6,
        borderBottom: "1px solid rgba(var(--wrgb),.07)",
        borderRadius: foldable ? "9px 9px 0 0" : undefined,
        cursor: foldable ? "pointer" : undefined,
      }}
      title={title}
    >
      {foldable && (
        <ChevronRight
          size={12}
          style={{
            flex: "0 0 12px",
            color: "rgba(var(--trgb),.4)",
            transform: collapsed ? undefined : "rotate(90deg)",
            transition: "transform 150ms",
          }}
        />
      )}
      {pinned ? (
        <Star size={13} filled style={{ flex: "0 0 13px", color: "var(--acc)" }} />
      ) : (
        <Folder size={13} style={{ flex: "0 0 13px", color: "rgba(var(--trgb),.4)" }} />
      )}
      <span
        style={{
          fontFamily: "'JetBrains Mono',monospace",
          fontSize: 11,
          fontWeight: 500,
          color: "rgba(var(--trgb),.72)",
          whiteSpace: "nowrap",
          overflow: "hidden",
          textOverflow: "ellipsis",
        }}
      >
        {label}
      </span>
      <span style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 12 }}>
        {children}
      </span>
    </div>
  );
}

/**
 * Compact folder heading for the narrow rails in Goals and Commands.
 *
 * `preserveCase` is for headings that are file names: `package.json` is not
 * spelled `PACKAGE.JSON`, and shouting it makes it harder to recognise.
 */
export function RailHeader({
  label,
  title,
  meta,
  pinned = false,
  preserveCase = false,
  collapsed,
  onToggle,
}: {
  label: string;
  title: string;
  meta?: ReactNode;
  pinned?: boolean;
  preserveCase?: boolean;
  /** Omit both of these for a heading that does not fold. */
  collapsed?: boolean;
  onToggle?: () => void;
}) {
  const foldable = onToggle !== undefined;
  return (
    <div
      title={title}
      role={foldable ? "button" : undefined}
      tabIndex={foldable ? 0 : undefined}
      aria-expanded={foldable ? !collapsed : undefined}
      className={foldable ? "h-soft-3" : undefined}
      onClick={onToggle}
      onKeyDown={(e) => {
        if (foldable && (e.key === "Enter" || e.key === " ")) {
          e.preventDefault();
          onToggle?.();
        }
      }}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 7,
        padding: "10px 11px 5px",
        borderRadius: 8,
        cursor: foldable ? "pointer" : undefined,
      }}
    >
      {foldable && (
        <ChevronRight
          size={10}
          style={{
            flex: "0 0 10px",
            color: "rgba(var(--trgb),.38)",
            transform: collapsed ? undefined : "rotate(90deg)",
            transition: "transform 150ms",
          }}
        />
      )}
      {pinned && <Star size={10} filled style={{ flex: "0 0 10px", color: "var(--acc)" }} />}
      <span
        style={{
          fontFamily: "'JetBrains Mono',monospace",
          fontSize: preserveCase ? 10 : 9.5,
          letterSpacing: preserveCase ? "0" : ".06em",
          textTransform: preserveCase ? "none" : "uppercase",
          color: pinned ? "var(--accTx)" : "rgba(var(--trgb),.42)",
          whiteSpace: "nowrap",
          overflow: "hidden",
          textOverflow: "ellipsis",
        }}
      >
        {label}
      </span>
      <span
        style={{
          flex: 1,
          height: 1,
          background: "rgba(var(--wrgb),.08)",
          minWidth: 8,
        }}
      />
      {meta}
    </div>
  );
}
