import { useCallback, useLayoutEffect, useRef, useState, type ReactNode } from "react";

import { ChevronDown } from "./Icons";

/**
 * Content clamped to a few lines, with a toggle to see the rest.
 *
 * Whether the toggle appears at all is measured, not guessed from a character
 * count: a README of twelve short lines and one of three long paragraphs both
 * come through as "a string", and only the laid-out height says which one
 * actually overflows.
 */
export function Collapsible({
  collapsedHeight = 132,
  moreLabel,
  lessLabel,
  startOpen = false,
  children,
}: {
  collapsedHeight?: number;
  moreLabel: string;
  lessLabel: string;
  startOpen?: boolean;
  children: ReactNode;
}) {
  const bodyRef = useRef<HTMLDivElement | null>(null);
  const [open, setOpen] = useState(startOpen);
  const [overflows, setOverflows] = useState(false);

  const measure = useCallback(() => {
    const body = bodyRef.current;
    if (!body) return;
    // A few pixels of slack: clamping content that is barely taller than the
    // limit hides nothing and leaves a toggle that does nothing.
    const next = body.scrollHeight > collapsedHeight + 8;
    setOverflows((prev) => (prev === next ? prev : next));
  }, [collapsedHeight]);

  // No dependency list: the content can reflow at any time - the window
  // resizes, the sidebar collapses, a font finishes loading. The state guard
  // in `measure` is what stops this from looping.
  useLayoutEffect(measure);

  useLayoutEffect(() => {
    const body = bodyRef.current;
    if (!body) return;
    const observer = new ResizeObserver(measure);
    observer.observe(body);
    window.addEventListener("resize", measure);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [measure]);

  const clamped = overflows && !open;

  // Fades the cut edge so it reads as "there is more" rather than as a sentence
  // that happens to stop. A mask rather than a gradient overlay: the card sits
  // on a translucent background of its own, so any gradient painted in a fixed
  // colour shows up as a band. Fading the content itself is correct over
  // whatever is behind it, in either theme.
  const fade = clamped
    ? `linear-gradient(to bottom, #000 ${Math.max(0, collapsedHeight - 44)}px, transparent)`
    : undefined;

  return (
    <div>
      <div
        ref={bodyRef}
        style={{
          maxHeight: clamped ? collapsedHeight : undefined,
          overflow: clamped ? "hidden" : undefined,
          maskImage: fade,
          WebkitMaskImage: fade,
        }}
      >
        {children}
      </div>

      {overflows && (
        <button
          type="button"
          className="h-link"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 5,
            marginTop: 8,
            border: 0,
            background: "transparent",
            padding: 0,
            cursor: "pointer",
            fontSize: 11.5,
            fontWeight: 500,
            color: "rgba(var(--trgb),.6)",
          }}
        >
          {open ? lessLabel : moreLabel}
          <ChevronDown
            size={12}
            strokeWidth={2}
            style={{ transform: open ? "rotate(180deg)" : undefined, transition: "transform 160ms" }}
          />
        </button>
      )}
    </div>
  );
}
