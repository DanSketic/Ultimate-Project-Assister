// The one place anything in the app says something to the user.
//
// Replaces a single-slot toast that could only ever show the newest message and
// gave every message the same weight. Notices stack, carry a kind, and the ones
// that report a failure stay until they are dismissed - an error that vanishes
// after three seconds is an error nobody read.

import { CheckThin, Close, Info } from "./Icons";
import type { Notice, NoticeKind } from "../useApp";

interface Look {
  border: string;
  background: string;
  colour: string;
  icon: "check" | "info" | "cross";
}

const LOOKS: Record<NoticeKind, Look> = {
  success: {
    border: "rgba(var(--accrgb),.4)",
    background: "rgba(var(--accrgb),.1)",
    colour: "var(--accTx)",
    icon: "check",
  },
  info: {
    border: "rgba(var(--wrgb),.14)",
    background: "rgba(var(--wrgb),.05)",
    colour: "rgba(var(--trgb),.8)",
    icon: "info",
  },
  warn: {
    border: "rgba(255,212,121,.4)",
    background: "rgba(255,212,121,.1)",
    colour: "var(--warnTx)",
    icon: "info",
  },
  error: {
    border: "rgba(var(--danrgb),.45)",
    background: "rgba(var(--danrgb),.12)",
    colour: "var(--danTx2)",
    icon: "cross",
  },
};

export function Notifications({
  notices,
  onDismiss,
}: {
  notices: Notice[];
  onDismiss: (id: string) => void;
}) {
  if (notices.length === 0) return null;

  return (
    <div
      // Newest nearest the corner the eye is already in.
      style={{
        position: "absolute",
        right: 20,
        bottom: 44,
        zIndex: 50,
        display: "flex",
        flexDirection: "column-reverse",
        gap: 8,
        maxWidth: "min(520px, 70%)",
        pointerEvents: "none",
      }}
    >
      {notices.map((notice) => (
        <Row key={notice.id} notice={notice} onDismiss={onDismiss} />
      ))}
    </div>
  );
}

function Row({ notice, onDismiss }: { notice: Notice; onDismiss: (id: string) => void }) {
  const look = LOOKS[notice.kind];

  return (
    <div
      role={notice.kind === "error" ? "alert" : "status"}
      style={{
        pointerEvents: "auto",
        border: `1px solid ${look.border}`,
        borderRadius: 12,
        background: "var(--toastBg)",
        backdropFilter: "blur(10px)",
        boxShadow: "var(--shToast)",
        padding: "11px 13px 11px 15px",
        display: "flex",
        alignItems: "flex-start",
        gap: 10,
      }}
    >
      <span style={{ color: look.colour, display: "flex", flex: "0 0 14px", paddingTop: 1 }}>
        {look.icon === "check" && <CheckThin size={14} />}
        {look.icon === "info" && <Info size={14} />}
        {look.icon === "cross" && <Close size={13} strokeWidth={2.4} />}
      </span>

      <span style={{ flex: 1, minWidth: 0 }}>
        <span style={{ display: "block", fontSize: 12.5, fontWeight: 500, wordBreak: "break-word" }}>
          {notice.title}
        </span>
        {notice.body && (
          <span
            style={{
              display: "block",
              fontSize: 11.5,
              color: "rgba(var(--trgb),.62)",
              marginTop: 2,
              wordBreak: "break-word",
            }}
          >
            {notice.body}
          </span>
        )}
      </span>

      <button
        type="button"
        className="h-fade-4"
        onClick={() => onDismiss(notice.id)}
        title="Dismiss"
        style={{
          border: 0,
          background: "transparent",
          padding: 2,
          cursor: "pointer",
          color: "rgba(var(--trgb),.6)",
          display: "flex",
          flex: "0 0 auto",
        }}
      >
        <Close size={11} strokeWidth={2.2} />
      </button>
    </div>
  );
}
