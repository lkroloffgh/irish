export const C = {
  bg: "#080a0c",
  surface: "#0f1214",
  raised: "#131618",
  border: "#1c2026",
  borderBright: "#2a3038",
  yes: "#22c55e",
  yesDim: "#22c55e18",
  no: "#ef4444",
  noDim: "#ef444418",
  gold: "#f5b731",
  text: "#e8eaed",
  muted: "#5a6270",
  dim: "#1e2530",
};

export const mono = "'IBM Plex Mono', 'Courier New', monospace";

export const inputStyle = {
  width: "100%",
  background: "#0c0e10",
  border: `1px solid ${C.border}`,
  borderRadius: 7,
  padding: "11px 13px",
  color: C.text,
  fontSize: 16,
  fontFamily: mono,
  boxSizing: "border-box",
  outline: "none",
  marginBottom: 10,
};

export const labelStyle = {
  color: C.muted,
  fontSize: 10,
  letterSpacing: 1.2,
  textTransform: "uppercase",
  marginBottom: 5,
  display: "block",
};
