import type { CSSProperties, ReactNode } from "react";

import { Folder, Star } from "./Icons";

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
  children,
}: {
  label: string;
  title: string;
  pinned?: boolean;
  children?: ReactNode;
}) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 9,
        padding: "9px 12px 7px",
        marginTop: 6,
        borderBottom: "1px solid rgba(var(--wrgb),.07)",
      }}
      title={title}
    >
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

/** Compact folder heading for the narrow rails in Goals and Commands. */
export function RailHeader({
  label,
  title,
  meta,
  pinned = false,
}: {
  label: string;
  title: string;
  meta?: ReactNode;
  pinned?: boolean;
}) {
  return (
    <div
      title={title}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 7,
        padding: "10px 11px 5px",
      }}
    >
      {pinned && <Star size={10} filled style={{ flex: "0 0 10px", color: "var(--acc)" }} />}
      <span
        style={{
          fontFamily: "'JetBrains Mono',monospace",
          fontSize: 9.5,
          letterSpacing: ".06em",
          textTransform: "uppercase",
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
