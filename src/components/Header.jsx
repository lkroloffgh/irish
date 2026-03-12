import { C, mono } from "../lib/constants.js";

export function Header({ user, onLogout, onHome, onNew, onDebts, onAdmin, onAlerts, activeView }) {
  return (
    <div style={{ borderBottom: `1px solid ${C.border}`, position: "sticky", top: 0, background: C.bg, zIndex: 20 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "13px 16px" }}>
        <span style={{ fontSize: 15, fontWeight: 700, color: C.gold, letterSpacing: -0.5, cursor: "pointer" }} onClick={onHome}>WillDougIrish ☘️</span>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <span style={{ color: C.muted, fontSize: 12 }}>{user.name}</span>
          <button onClick={onNew} style={{ background: C.gold, color: "#000", border: "none", borderRadius: 6, padding: "6px 12px", fontWeight: 700, fontSize: 12, cursor: "pointer", fontFamily: mono }}>+ Market</button>
          <button onClick={onLogout} style={{ background: "transparent", color: C.muted, border: `1px solid ${C.border}`, borderRadius: 6, padding: "5px 10px", fontSize: 12, cursor: "pointer", fontFamily: mono }}>out</button>
        </div>
      </div>
      <div style={{ display: "flex", borderTop: `1px solid ${C.border}` }}>
        {[
          { id: "feed",   label: "Markets",   action: onHome   },
          { id: "debts",  label: "Settle Up", action: onDebts  },
          { id: "alerts", label: "Alerts",    action: onAlerts },
          ...(user.isSuperuser ? [{ id: "admin", label: "Admin", action: onAdmin }] : []),
        ].map(({ id, label, action }) => (
          <button key={id} onClick={action}
            style={{ flex: 1, background: "transparent", border: "none", borderBottom: activeView === id ? `2px solid ${C.gold}` : "2px solid transparent", color: activeView === id ? C.gold : C.muted, padding: "9px 0", fontSize: 11, fontWeight: 700, cursor: "pointer", fontFamily: mono, letterSpacing: 0.8 }}>
            {label}
          </button>
        ))}
      </div>
    </div>
  );
}
