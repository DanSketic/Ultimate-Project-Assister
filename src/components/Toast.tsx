import { CheckThin } from "./Icons";

export function Toast({ message }: { message: string }) {
  if (!message) return null;

  return (
    <div
      role="status"
      style={{
        position: "absolute",
        right: 20,
        bottom: 44,
        zIndex: 50,
        border: "1px solid rgba(var(--accrgb),.35)",
        borderRadius: 12,
        background: "var(--toastBg)",
        backdropFilter: "blur(10px)",
        padding: "11px 15px",
        display: "flex",
        alignItems: "center",
        gap: 10,
        boxShadow: "var(--shToast)",
        maxWidth: "min(520px, 70%)",
      }}
    >
      <span style={{ color: "var(--acc)", display: "flex", flex: "0 0 14px" }}>
        <CheckThin size={14} />
      </span>
      <span style={{ fontSize: 12.5, fontWeight: 500 }}>{message}</span>
    </div>
  );
}
