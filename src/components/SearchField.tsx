import { Close, Search } from "./Icons";

/**
 * The search box used by the project lists. Styled like the one in the
 * projects toolbar so the three lists read as the same control.
 */
export function SearchField({
  value,
  onChange,
  placeholder,
  clearTitle,
  compact = false,
}: {
  value: string;
  onChange: (next: string) => void;
  placeholder: string;
  clearTitle: string;
  compact?: boolean;
}) {
  return (
    <div
      className="field"
      style={{
        display: "flex",
        alignItems: "center",
        gap: 7,
        border: "1px solid rgba(var(--wrgb),.09)",
        background: "rgba(var(--wrgb),.035)",
        borderRadius: 10,
        padding: compact ? "6px 9px" : "7px 11px",
        flex: "0 0 auto",
      }}
    >
      <Search
        size={compact ? 13 : 14}
        style={{ flex: `0 0 ${compact ? 13 : 14}px`, color: "rgba(var(--trgb),.56)" }}
      />
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        style={{
          border: 0,
          background: "transparent",
          outline: "none",
          width: "100%",
          minWidth: 0,
          fontSize: compact ? 12 : 12.5,
        }}
      />
      {value && (
        <button
          type="button"
          className="h-fade-4"
          title={clearTitle}
          onClick={() => onChange("")}
          style={{
            border: 0,
            background: "transparent",
            color: "rgba(var(--trgb),.6)",
            padding: 0,
            cursor: "pointer",
            display: "flex",
            flex: "0 0 auto",
          }}
        >
          <Close size={11} strokeWidth={2.2} />
        </button>
      )}
    </div>
  );
}
