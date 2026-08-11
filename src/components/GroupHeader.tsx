import type { ReactNode } from "react";

import { Folder } from "./Icons";

/**
 * Folder heading above a block of projects in the projects list. Mirrors the
 * project headings in the cleanup view: name on the left, totals on the right.
 */
export function FolderHeader({
  label,
  title,
  children,
}: {
  label: string;
  title: string;
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
      <Folder size={13} style={{ flex: "0 0 13px", color: "rgba(var(--trgb),.4)" }} />
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
export function RailHeader({ label, title, meta }: { label: string; title: string; meta?: ReactNode }) {
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
      <span
        style={{
          fontFamily: "'JetBrains Mono',monospace",
          fontSize: 9.5,
          letterSpacing: ".06em",
          textTransform: "uppercase",
          color: "rgba(var(--trgb),.42)",
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
