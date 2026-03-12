import { LineChart, Line, ResponsiveContainer } from "recharts";
import { C, mono } from "../lib/constants.js";
import { cents, pct, computeMid } from "../lib/helpers.js";

/* ─── FEED ───────────────────────────────────────────────────────── */
export function Feed({ markets, onOpen }) {
  const open     = markets.filter((m) => m.status === "open");
  const resolved = markets.filter((m) => m.status === "resolved");
  return (
    <div>
      <div style={{ color: C.muted, fontSize: 10, letterSpacing: 1.5, textTransform: "uppercase", padding: "10px 16px 5px", borderBottom: `1px solid ${C.border}` }}>
        Open Markets
      </div>
      {open.map((m) => <MarketCard key={m.id} m={m} onOpen={onOpen} />)}
      {open.length === 0 && (
        <div style={{ textAlign: 'center', padding: '60px 24px' }}>
          <div style={{ fontSize: 40, marginBottom: 14 }}>☘️</div>
          <p style={{ color: C.text, fontSize: 14, fontWeight: 700, margin: '0 0 8px' }}>No markets yet</p>
          <p style={{ color: C.muted, fontSize: 12, lineHeight: 1.6, margin: '0 0 24px' }}>
            Create the first market and start trading with the group.
          </p>
        </div>
      )}

      {resolved.length > 0 && (
        <>
          <div style={{ color: C.muted, fontSize: 10, letterSpacing: 1.5, textTransform: "uppercase", padding: "20px 16px 5px", borderBottom: `1px solid ${C.border}` }}>
            Resolved
          </div>
          {resolved.map((m) => <MarketCard key={m.id} m={m} onOpen={onOpen} />)}
        </>
      )}
    </div>
  );
}

function MarketCard({ m, onOpen }) {
  const isResolved = m.status === "resolved";
  const buys  = m.orders.filter((o) => o.side === "buy").sort((a, b) => b.price - a.price);
  const sells = m.orders.filter((o) => o.side === "sell").sort((a, b) => a.price - b.price);
  const bestBid = buys[0]?.price ?? 0;
  const bestAsk = sells[0]?.price ?? 100;
  const mid = computeMid(m.orders);
  const last  = m.priceHistory[m.priceHistory.length - 1]?.yes ?? mid;
  const prev  = m.priceHistory[m.priceHistory.length - 5]?.yes ?? last;
  const delta = last - prev;

  const resolvedColor = m.resolvedAs === "YES" ? C.yes : C.no;
  const displayPrice  = isResolved ? (m.resolvedAs === "YES" ? 100 : 0) : mid;
  const displayColor  = isResolved ? resolvedColor : (mid >= 50 ? C.yes : C.no);

  return (
    <div
      style={{ background: C.surface, border: `1px solid ${isResolved ? C.border : C.border}`, borderRadius: 10, margin: "12px 14px", overflow: "hidden", cursor: "pointer", transition: "border-color 0.15s", opacity: isResolved ? 0.8 : 1 }}
      onClick={() => onOpen(m)}
      onMouseEnter={(e) => e.currentTarget.style.borderColor = C.borderBright}
      onMouseLeave={(e) => e.currentTarget.style.borderColor = C.border}>
      <div style={{ padding: "14px 16px 12px" }}>
        {/* Title row */}
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12 }}>
          <div style={{ flex: 1 }}>
            <p style={{ margin: 0, fontSize: 14, fontWeight: 600, lineHeight: 1.4 }}>{m.title}</p>
            {/* Byline */}
            <p style={{ margin: "4px 0 0", fontSize: 11, color: C.muted }}>by {m.creatorName}</p>
          </div>
          <div style={{ textAlign: "right", flexShrink: 0 }}>
            {isResolved ? (
              <div style={{ background: resolvedColor + "22", border: `1px solid ${resolvedColor}55`, borderRadius: 6, padding: "4px 10px", display: "inline-block" }}>
                <span style={{ color: resolvedColor, fontWeight: 800, fontSize: 14 }}>{m.resolvedAs}</span>
              </div>
            ) : (
              <>
                <div style={{ fontSize: 22, fontWeight: 800, color: displayColor, lineHeight: 1 }}>{pct(mid)}</div>
                <div style={{ fontSize: 11, color: delta > 0 ? C.yes : delta < 0 ? C.no : C.muted, marginTop: 2 }}>{delta > 0 ? "▲" : delta < 0 ? "▼" : "–"} {Math.abs(delta)}pp</div>
              </>
            )}
          </div>
        </div>

        {/* Sparkline */}
        <div style={{ marginTop: 10, height: 36, opacity: isResolved ? 0.4 : 1 }}>
          <ResponsiveContainer width="100%" height={36}>
            <LineChart data={m.priceHistory}>
              <Line type="monotone" dataKey="yes" stroke={displayColor} dot={false} strokeWidth={1.5} />
            </LineChart>
          </ResponsiveContainer>
        </div>

        {/* Buy buttons or resolved note */}
        {isResolved ? (
          <p style={{ margin: "10px 0 0", fontSize: 11, color: C.muted, fontStyle: "italic" }}>
            {m.resolvedNote || "Market resolved."}
          </p>
        ) : (
          <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
            <button style={{ flex: 1, background: C.yesDim, color: C.yes, border: `1px solid ${C.yes}40`, borderRadius: 6, padding: "7px 0", fontSize: 12, fontWeight: 700, cursor: "pointer", fontFamily: mono }}
              onClick={(e) => e.stopPropagation()}>YES {cents(bestAsk)}</button>
            <button style={{ flex: 1, background: C.noDim, color: C.no, border: `1px solid ${C.no}40`, borderRadius: 6, padding: "7px 0", fontSize: 12, fontWeight: 700, cursor: "pointer", fontFamily: mono }}
              onClick={(e) => e.stopPropagation()}>NO {cents(100 - bestBid)}</button>
          </div>
        )}
      </div>
    </div>
  );
}
