import { chip } from "../format";

export interface ChipItem {
  key: string;
  label: string;
}

interface Props {
  items: ChipItem[];
  active: string;
  onPick: (key: string) => void;
  mono?: boolean;
  wrap?: boolean;
}

/** The segmented pill group used by every filter row in the design. */
export function ChipGroup({ items, active, onPick, mono = false, wrap = false }: Props) {
  return (
    <div
      style={{
        display: "flex",
        gap: 3,
        background: "rgba(var(--wrgb),.035)",
        border: "1px solid rgba(var(--wrgb),.07)",
        borderRadius: 10,
        padding: 3,
        flexWrap: wrap ? "wrap" : "nowrap",
        // Hug the chips rather than stretching, as the design does - matters
        // inside the Settings cards, which are plain blocks.
        width: "fit-content",
        maxWidth: "100%",
      }}
    >
      {items.map((item) => {
        const c = chip(item.key === active);
        return (
          <button
            key={item.key}
            type="button"
            className="h-seg"
            onClick={() => onPick(item.key)}
            style={{
              border: 0,
              borderRadius: 7,
              background: c.bg,
              color: c.fg,
              fontFamily: mono ? "'JetBrains Mono',monospace" : undefined,
              fontSize: mono ? 10.5 : 11,
              fontWeight: mono ? 400 : 500,
              padding: "5px 9px",
              cursor: "pointer",
              transition: "all 140ms",
              whiteSpace: "nowrap",
            }}
          >
            {item.label}
          </button>
        );
      })}
    </div>
  );
}
