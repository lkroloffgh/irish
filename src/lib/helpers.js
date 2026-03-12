export const cents = (n) => `${Math.round(n)}¢`;
export const pct   = (n) => `${Math.round(n)}%`;
export const uid   = () => Math.random().toString(36).slice(2, 9);

export const parseNum = (v) => {
  const n = Number(String(v).trim().replace(",", "."));
  return isNaN(n) ? NaN : n;
};

export function urlBase64ToUint8Array(base64String) {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
}

const DAY = 86400000;

export function generatePriceHistory(seed = 50, length = 20, startTs = Date.now() - length * 3600 * 1000) {
  const pts = [];
  let p = seed;
  const span = Date.now() - startTs;
  for (let i = 0; i < length; i++) {
    p = Math.max(5, Math.min(95, p + (Math.random() - 0.49) * 6));
    pts.push({ ts: Math.round(startTs + (span * i) / Math.max(length - 1, 1)), yes: Math.round(p) });
  }
  return pts;
}

const PT_OPTS = { timeZone: "America/Los_Angeles" };

export function fmtChartTs(ts, marketStartTs) {
  const age = ts - marketStartTs;
  const d = new Date(ts);
  if (age < 3 * DAY) {
    const day  = d.toLocaleDateString("en-US", { ...PT_OPTS, weekday: "short" });
    const time = d.toLocaleTimeString("en-US", { ...PT_OPTS, hour: "numeric", minute: "2-digit", hour12: true });
    return `${day} ${time}`;
  }
  return d.toLocaleDateString("en-US", { ...PT_OPTS, month: "short", day: "numeric" });
}

export function fmtTooltipTs(ts) {
  const d = new Date(ts);
  const date = d.toLocaleDateString("en-US", { ...PT_OPTS, month: "short", day: "numeric" });
  const time = d.toLocaleTimeString("en-US", { ...PT_OPTS, hour: "numeric", minute: "2-digit", hour12: true });
  return `${date}, ${time} PT`;
}
