// The design's icon set, transcribed one-for-one from its inline SVGs.

import type { CSSProperties, ReactNode } from "react";

export interface IconProps {
  size?: number;
  strokeWidth?: number;
  style?: CSSProperties;
}

function Svg({ size = 14, strokeWidth = 1.8, style, children }: IconProps & { children: ReactNode }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      style={style}
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

export const Chevron = (p: IconProps) => (
  <Svg {...p}>
    <path d="m4 17 6-6-6-6" />
  </Svg>
);

export const ChevronRight = (p: IconProps) => (
  <Svg strokeWidth={1.9} {...p}>
    <path d="m9 18 6-6-6-6" />
  </Svg>
);

export const ChevronLeft = (p: IconProps) => (
  <Svg strokeWidth={2} {...p}>
    <path d="m15 18-6-6 6-6" />
  </Svg>
);

export const ChevronDown = (p: IconProps) => (
  <Svg strokeWidth={1.9} {...p}>
    <path d="m6 9 6 6 6-6" />
  </Svg>
);

export const Monitor = (p: IconProps) => (
  <Svg strokeWidth={1.9} {...p}>
    <rect x="2.5" y="4" width="19" height="12.5" rx="2.5" />
    <path d="M9 20h6M12 16.5V20" />
  </Svg>
);

export const Sun = (p: IconProps) => (
  <Svg strokeWidth={1.9} {...p}>
    <circle cx="12" cy="12" r="4" />
    <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
  </Svg>
);

export const Moon = (p: IconProps) => (
  <Svg strokeWidth={1.9} {...p}>
    <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" />
  </Svg>
);

export const Minus = (p: IconProps) => (
  <Svg strokeWidth={2} {...p}>
    <path d="M5 12h14" />
  </Svg>
);

export const Square = (p: IconProps) => (
  <Svg strokeWidth={2} {...p}>
    <rect x="4.5" y="4.5" width="15" height="15" rx="3" />
  </Svg>
);

export const Close = (p: IconProps) => (
  <Svg strokeWidth={2.2} {...p}>
    <path d="M18 6 6 18M6 6l12 12" />
  </Svg>
);

export const PanelLeft = (p: IconProps) => (
  <Svg {...p}>
    <rect x="3" y="3" width="18" height="18" rx="4" />
    <path d="M9 3v18" />
  </Svg>
);

export const Folder = (p: IconProps) => (
  <Svg {...p}>
    <path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z" />
  </Svg>
);

export const Trash = (p: IconProps) => (
  <Svg {...p}>
    <path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M10 11v6M14 11v6" />
  </Svg>
);

export const Target = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="9" />
    <circle cx="12" cy="12" r="5" />
    <circle cx="12" cy="12" r="1.3" />
  </Svg>
);

export const StickyNote = (p: IconProps) => (
  <Svg {...p}>
    <path d="M16 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h11l5-5V5a2 2 0 0 0-2-2z" />
    <path d="M15 21v-5a1 1 0 0 1 1-1h5" />
  </Svg>
);

export const Terminal = (p: IconProps) => (
  <Svg {...p}>
    <path d="m4 17 6-6-6-6M12 19h8" />
  </Svg>
);

export const Sliders = (p: IconProps) => (
  <Svg {...p}>
    <path d="M21 4h-7M10 4H3M21 12h-9M8 12H3M21 20h-5M12 20H3" />
    <circle cx="12" cy="4" r="2" />
    <circle cx="10" cy="12" r="2" />
    <circle cx="14" cy="20" r="2" />
  </Svg>
);

export const Refresh = (p: IconProps) => (
  <Svg strokeWidth={1.9} {...p}>
    <path d="M3 12a9 9 0 0 1 9-9 9.7 9.7 0 0 1 6.7 2.7L21 8M21 3v5h-5M21 12a9 9 0 0 1-9 9 9.7 9.7 0 0 1-6.7-2.7L3 16M3 21v-5h5" />
  </Svg>
);

export const Search = (p: IconProps) => (
  <Svg strokeWidth={1.9} {...p}>
    <circle cx="11" cy="11" r="7.5" />
    <path d="m21 21-4.3-4.3" />
  </Svg>
);

export const GitBranch = (p: IconProps) => (
  <Svg {...p}>
    <path d="M6 3v12" />
    <circle cx="18" cy="6" r="3" />
    <circle cx="6" cy="18" r="3" />
    <path d="M18 9a9 9 0 0 1-9 9" />
  </Svg>
);

export const Check = ({ size = 10, strokeWidth = 3.5, style }: IconProps) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="#14180a"
    strokeWidth={strokeWidth}
    strokeLinecap="round"
    style={style}
    aria-hidden="true"
  >
    <path d="M20 6 9 17l-5-5" />
  </svg>
);

export const CheckThin = (p: IconProps) => (
  <Svg strokeWidth={2.6} {...p}>
    <path d="M20 6 9 17l-5-5" />
  </Svg>
);

export const Play = ({ size = 9, style }: IconProps) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" style={style} aria-hidden="true">
    <path d="M6 3.5 20 12 6 20.5z" />
  </svg>
);

export const Stop = ({ size = 8, style }: IconProps) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" style={style} aria-hidden="true">
    <rect x="5" y="5" width="14" height="14" rx="2" />
  </svg>
);

export const Plus = (p: IconProps) => (
  <Svg strokeWidth={2} {...p}>
    <path d="M5 12h14M12 5v14" />
  </Svg>
);

export const Clock = ({ size = 9, style }: IconProps) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={2.4}
    style={style}
    aria-hidden="true"
  >
    <circle cx="12" cy="12" r="9" />
    <path d="M12 7.5v5l3 2" />
  </svg>
);

export const Tag = ({ size = 10, style }: IconProps) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={2}
    style={style}
    aria-hidden="true"
  >
    <path d="M12.6 2.6A2 2 0 0 0 11.2 2H4a2 2 0 0 0-2 2v7.2a2 2 0 0 0 .6 1.4l8.7 8.7a2.4 2.4 0 0 0 3.4 0l6.6-6.6a2.4 2.4 0 0 0 0-3.4z" />
  </svg>
);

export const Star = ({ size = 13, strokeWidth = 1.8, style, filled = false }: IconProps & { filled?: boolean }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill={filled ? "currentColor" : "none"}
    stroke="currentColor"
    strokeWidth={strokeWidth}
    strokeLinecap="round"
    strokeLinejoin="round"
    style={style}
    aria-hidden="true"
  >
    <path d="m12 3.6 2.6 5.3 5.8.9-4.2 4.1 1 5.8-5.2-2.7-5.2 2.7 1-5.8L3.6 9.8l5.8-.9z" />
  </svg>
);

export const Info = (p: IconProps) => (
  <Svg strokeWidth={1.9} {...p}>
    <circle cx="12" cy="12" r="9.5" />
    <path d="M12 8.5v4M12 16h.01" />
  </Svg>
);
