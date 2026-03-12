import { useState } from "react";
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, ReferenceLine } from "recharts";
import { C, mono, inputStyle, labelStyle } from "../lib/constants.js";
import { cents, pct, uid, parseNum, fmtChartTs, fmtTooltipTs } from "../lib/helpers.js";

/* ─── DETAIL ROW ─────────────────────────────────────────────────── */
function DetailRow({ label, value, color, bold, truncate }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", padding: "4px 0" }}>
      <span style={{ color: C.muted, fontSize: 11, flexShrink: 0 }}>{label}</span>
      <span style={{
        color: color || C.text, fontSize: 12, fontWeight: bold ? 700 : 400,
        maxWidth: truncate ? 220 : "none", overflow: "hidden",
        textOverflow: "ellipsis", whiteSpace: truncate ? "nowrap" : "normal", textAlign: "right",
      }}>
        {value}
      </span>
    </div>
  );
}

/* ─── ORDER CONFIRM MODAL ────────────────────────────────────────── */
function OrderConfirmModal({ order, market, onConfirm, onCancel }) {
  const isNo   = order.displaySide === "no";  // user initiated as a NO buy
  const isBuy  = order.side === "buy";        // actual book side
  const color  = isNo ? C.no : C.yes;

  // Display price: NO buyers see NO price, YES buyers see YES price
  const displayPrice = isNo ? 100 - order.price : order.price;

  // Sort matchable orders by best price first
  const matchPool = isBuy
    ? market.orders.filter((o) => o.side === "sell" && o.price <= order.price).sort((a, b) => a.price - b.price)
    : market.orders.filter((o) => o.side === "buy"  && o.price >= order.price).sort((a, b) => b.price - a.price);

  // Walk the book level by level
  let remaining = order.size;
  const fills = [];
  for (const o of matchPool) {
    if (remaining <= 0.005) break;
    const sz = parseFloat(Math.min(remaining, o.size).toFixed(2));
    // For NO buyers, fill price shown as NO price (100 - yesPrice)
    fills.push({ yesPrice: o.price, displayPrice: isNo ? 100 - o.price : o.price, size: sz, name: o.name });
    remaining = parseFloat((remaining - sz).toFixed(2));
  }
  const restSize   = remaining > 0.005 ? remaining : 0;
  const filledSize = parseFloat((order.size - restSize).toFixed(2));

  // Track YES-price VWAP separately (for avg display price calc), but show cost in display denomination
  const filledYesCost  = fills.reduce((sum, f) => sum + (f.yesPrice / 100) * f.size, 0);
  const filledCost     = isNo
    ? fills.reduce((sum, f) => sum + ((100 - f.yesPrice) / 100) * f.size, 0)
    : filledYesCost;
  const avgYesPrice    = filledSize > 0 ? (filledYesCost / filledSize) * 100 : null;
  const avgDisplayPrice = avgYesPrice !== null ? (isNo ? 100 - avgYesPrice : avgYesPrice) : null;

  // For NO buyers, cost is at NO price (displayPrice), not the underlying YES price
  const restPrice    = isNo ? 100 - order.price : order.price;
  const restCost     = restSize > 0 ? (restPrice / 100) * restSize : 0;
  const totalMaxCost = filledCost + restCost;
  const maxPayout    = order.size;

  const fillsFully  = restSize === 0 && filledSize > 0;
  const fillsPartly = filledSize > 0.005 && restSize > 0.005;
  const noFill      = filledSize <= 0.005;

  const outcomeLabel = isNo ? "NO" : "YES";
  const fillNote = fillsFully
    ? `⚡ This order fills in full immediately.`
    : fillsPartly
    ? `⚡ $${filledSize.toFixed(2)} fills immediately. $${restSize.toFixed(2)} rests at ${cents(displayPrice)} until matched.`
    : `📋 No matching orders — full size rests in the book at ${cents(displayPrice)}.`;

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.75)", zIndex: 100, display: "flex", alignItems: "flex-end", justifyContent: "center" }}>
      <div style={{ background: C.surface, border: `1px solid ${C.borderBright}`, borderRadius: "16px 16px 0 0", width: "100%", maxWidth: 520, padding: 24, paddingBottom: 36, fontFamily: mono }}>

        {/* Header */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 18 }}>
          <span style={{ fontSize: 14, fontWeight: 700, color: C.gold, letterSpacing: 0.5 }}>Review Order</span>
          <button onClick={onCancel} style={{ background: "transparent", border: "none", color: C.muted, fontSize: 20, cursor: "pointer", lineHeight: 1, padding: 0 }}>×</button>
        </div>

        {/* Order type callout */}
        <div style={{ background: isNo ? C.noDim : C.yesDim, border: `1px solid ${color}44`, borderRadius: 10, padding: "12px 16px", marginBottom: 14 }}>
          <div style={{ color, fontWeight: 800, fontSize: 16, marginBottom: 4 }}>
            BUY {outcomeLabel} @ limit {cents(displayPrice)}
            {fills.length > 1 && avgDisplayPrice !== null && (
              <span style={{ color: C.muted, fontWeight: 400, fontSize: 12, marginLeft: 8 }}>
                · avg fill {cents(avgDisplayPrice)}
              </span>
            )}
          </div>
          <div style={{ color: C.muted, fontSize: 12, lineHeight: 1.5 }}>
            Profit if the market resolves {outcomeLabel}.
          </div>
        </div>

        {/* Fill breakdown */}
        <div style={{ background: C.raised, border: `1px solid ${C.border}`, borderRadius: 9, padding: "12px 16px", marginBottom: 14 }}>
          <DetailRow label="Total contracts" value={`$${order.size.toFixed(2)}`} />

          {fills.length > 0 && (
            <>
              <div style={{ borderTop: `1px solid ${C.border}`, margin: "8px 0 6px" }} />
              <div style={{ color: C.muted, fontSize: 10, letterSpacing: 1, textTransform: "uppercase", marginBottom: 6 }}>Immediate fills</div>
              {fills.map((f, i) => (
                <div key={i} style={{ display: "flex", justifyContent: "space-between", padding: "3px 0", fontSize: 12 }}>
                  <span style={{ color: C.muted }}>${f.size.toFixed(2)} @ {cents(f.displayPrice)} <span style={{ fontSize: 10 }}>({f.name})</span></span>
                  <span style={{ color: C.text }}>${((f.yesPrice / 100) * f.size).toFixed(2)}</span>
                </div>
              ))}
              {fills.length > 1 && avgDisplayPrice !== null && (
                <div style={{ display: "flex", justifyContent: "space-between", padding: "5px 0 2px", borderTop: `1px solid ${C.border}20`, marginTop: 4, fontSize: 12 }}>
                  <span style={{ color: C.muted }}>Avg fill price</span>
                  <span style={{ color, fontWeight: 700 }}>{cents(avgDisplayPrice)}</span>
                </div>
              )}
              <DetailRow label="Immediate cost" value={`$${filledCost.toFixed(2)}`} />
            </>
          )}

          {restSize > 0 && (
            <>
              <div style={{ borderTop: `1px solid ${C.border}`, margin: "8px 0 6px" }} />
              <div style={{ color: C.muted, fontSize: 10, letterSpacing: 1, textTransform: "uppercase", marginBottom: 6 }}>Resting in book</div>
              <div style={{ display: "flex", justifyContent: "space-between", padding: "3px 0", fontSize: 12 }}>
                <span style={{ color: C.muted }}>${restSize.toFixed(2)} @ limit {cents(displayPrice)}</span>
                <span style={{ color: C.muted }}>${restCost.toFixed(2)} if filled</span>
              </div>
            </>
          )}

          <div style={{ borderTop: `1px solid ${C.border}`, margin: "10px 0 6px" }} />
          <DetailRow label={noFill ? "Cost if filled" : restSize > 0 ? "Max total outlay" : "Total cost"} value={`$${totalMaxCost.toFixed(2)}`} color={C.gold} bold />
          <DetailRow label={`Payout if ${outcomeLabel}`} value={`$${maxPayout.toFixed(2)}`} />
        </div>

        {/* Fill note */}
        <div style={{ background: C.dim, borderRadius: 8, padding: "10px 14px", marginBottom: 18, fontSize: 12, color: C.muted, lineHeight: 1.5 }}>
          {fillNote}{" "}Settlement off-platform. 🤝
        </div>

        {/* Action buttons */}
        <div style={{ display: "flex", gap: 10 }}>
          <button onClick={onCancel}
            style={{ flex: 1, background: "transparent", color: C.muted, border: `1px solid ${C.border}`, borderRadius: 7, padding: "12px 0", fontWeight: 700, fontSize: 13, cursor: "pointer", fontFamily: mono }}>
            Cancel
          </button>
          <button onClick={onConfirm}
            style={{ flex: 2, background: color, color: isNo ? "#fff" : "#000", border: "none", borderRadius: 7, padding: "12px 0", fontWeight: 800, fontSize: 13, cursor: "pointer", fontFamily: mono }}>
            Confirm Buy {outcomeLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ─── RESOLVE MODAL ──────────────────────────────────────────────── */
function ResolveModal({ market, onResolve, onCancel }) {
  const [pick, setPick] = useState(null);
  const [note, setNote] = useState("");
  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.8)", zIndex: 100, display: "flex", alignItems: "flex-end", justifyContent: "center" }}>
      <div style={{ background: C.surface, border: `1px solid ${C.borderBright}`, borderRadius: "16px 16px 0 0", width: "100%", maxWidth: 520, padding: 24, paddingBottom: 36, fontFamily: mono }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
          <span style={{ fontSize: 14, fontWeight: 700, color: C.gold }}>Resolve Market</span>
          <button onClick={onCancel} style={{ background: "transparent", border: "none", color: C.muted, fontSize: 20, cursor: "pointer", lineHeight: 1, padding: 0 }}>×</button>
        </div>
        <p style={{ color: C.muted, fontSize: 12, marginBottom: 20, lineHeight: 1.5 }}>
          Only you can resolve this market. This is permanent and visible to everyone.
        </p>

        <p style={{ color: C.muted, fontSize: 10, letterSpacing: 1.2, textTransform: "uppercase", marginBottom: 10 }}>How did it resolve?</p>
        <div style={{ display: "flex", gap: 10, marginBottom: 18 }}>
          <button
            onClick={() => setPick("YES")}
            style={{ flex: 1, background: pick === "YES" ? C.yes : C.yesDim, color: pick === "YES" ? "#000" : C.yes, border: `1px solid ${C.yes}`, borderRadius: 8, padding: "14px 0", fontWeight: 800, fontSize: 16, cursor: "pointer", fontFamily: mono, transition: "all 0.1s" }}>
            YES ✓
          </button>
          <button
            onClick={() => setPick("NO")}
            style={{ flex: 1, background: pick === "NO" ? C.no : C.noDim, color: pick === "NO" ? "#fff" : C.no, border: `1px solid ${C.no}`, borderRadius: 8, padding: "14px 0", fontWeight: 800, fontSize: 16, cursor: "pointer", fontFamily: mono, transition: "all 0.1s" }}>
            NO ✗
          </button>
        </div>

        <label style={labelStyle}>Resolution note (optional)</label>
        <input
          style={{ ...inputStyle, marginBottom: 18 }}
          placeholder="e.g. Confirmed by photo evidence."
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />

        <div style={{ display: "flex", gap: 10 }}>
          <button onClick={onCancel} style={{ flex: 1, background: "transparent", color: C.muted, border: `1px solid ${C.border}`, borderRadius: 7, padding: "12px 0", fontWeight: 700, fontSize: 13, cursor: "pointer", fontFamily: mono }}>Cancel</button>
          <button
            onClick={() => pick && onResolve(pick, note)}
            style={{ flex: 2, background: pick ? (pick === "YES" ? C.yes : C.no) : C.border, color: pick ? (pick === "YES" ? "#000" : "#fff") : C.muted, border: "none", borderRadius: 7, padding: "12px 0", fontWeight: 800, fontSize: 13, cursor: pick ? "pointer" : "default", fontFamily: mono, transition: "all 0.15s" }}>
            {pick ? `Resolve ${pick}` : "Select YES or NO"}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ─── QUICK BUY MODAL ────────────────────────────────────────────── */
function QuickBuyModal({ side, price, user, onReview, onCancel }) {
  // side: "buy" = buying YES, "sell" = buying NO
  // price: always the YES-denominated price (bestAsk for YES, bestBid for NO)
  const [amount, setAmount] = useState("5");
  const isNo    = side === "sell";
  const color   = isNo ? C.no : C.yes;
  const dimBg   = isNo ? C.noDim : C.yesDim;
  const label   = isNo ? "NO" : "YES";
  // Display price in the relevant denomination
  const displayPrice = isNo ? 100 - price : price;
  const amt     = parseNum(amount);
  const isValid = !isNaN(amt) && amt > 0;
  const cost    = isValid ? (displayPrice / 100 * amt).toFixed(2) : "—";
  const payout  = isValid ? amt.toFixed(2) : "—";

  const PRESETS = [5, 10, 25];

  const handleReview = () => {
    if (!isValid) return;
    onReview({
      id: uid(),
      side,           // "buy" or "sell" — keeps matching engine clean
      price,          // YES-denominated price
      displaySide: isNo ? "no" : "yes",  // presentation only
      size: parseFloat(parseFloat(amount).toFixed(2)),
      userId: user.id,
      name: user.name,
    });
  };

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.8)", zIndex: 100, display: "flex", alignItems: "flex-end", justifyContent: "center" }}>
      <div style={{ background: C.surface, border: `1px solid ${C.borderBright}`, borderRadius: "16px 16px 0 0", width: "100%", maxWidth: 520, padding: 24, paddingBottom: 40, fontFamily: mono }}>

        {/* Header */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20 }}>
          <div style={{ background: dimBg, border: `1px solid ${color}55`, borderRadius: 8, padding: "6px 14px" }}>
            <span style={{ color, fontWeight: 800, fontSize: 18 }}>{label}</span>
            <span style={{ color: C.muted, fontSize: 13, marginLeft: 6 }}>{cents(displayPrice)}</span>
          </div>
          <button onClick={onCancel} style={{ background: "transparent", border: "none", color: C.muted, fontSize: 20, cursor: "pointer", lineHeight: 1, padding: 0 }}>×</button>
        </div>

        {/* Amount input */}
        <label style={labelStyle}>Amount ($)</label>
        <input
          style={{ ...inputStyle, fontSize: 22, fontWeight: 700, textAlign: "center", padding: "14px", marginBottom: 12 }}
          type="number" inputMode="decimal" min="0.01" step="1"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          autoFocus
        />

        {/* Preset chips */}
        <div style={{ display: "flex", gap: 8, marginBottom: 20 }}>
          {PRESETS.map((p) => (
            <button key={p} onClick={() => setAmount(String(p))}
              style={{ flex: 1, background: parseFloat(amount) === p ? color : C.raised, color: parseFloat(amount) === p ? (isNo ? "#fff" : "#000") : C.muted, border: `1px solid ${parseFloat(amount) === p ? color : C.border}`, borderRadius: 7, padding: "8px 0", fontSize: 13, fontWeight: 700, cursor: "pointer", fontFamily: mono, transition: "all 0.1s" }}>
              ${p}
            </button>
          ))}
        </div>

        {/* Cost summary */}
        <div style={{ background: C.raised, border: `1px solid ${C.border}`, borderRadius: 9, padding: "12px 16px", marginBottom: 20 }}>
          <div style={{ display: "flex", justifyContent: "space-between", padding: "4px 0", fontSize: 12 }}>
            <span style={{ color: C.muted }}>You pay</span>
            <span style={{ color: C.gold, fontWeight: 700 }}>${cost}</span>
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", padding: "4px 0", fontSize: 12 }}>
            <span style={{ color: C.muted }}>Payout if {label}</span>
            <span style={{ color: C.text }}>${payout}</span>
          </div>
        </div>

        {/* CTA */}
        <button onClick={handleReview} disabled={!isValid}
          style={{ width: "100%", background: isValid ? color : C.border, color: isValid ? (isNo ? "#fff" : "#000") : C.muted, border: "none", borderRadius: 8, padding: "14px 0", fontWeight: 800, fontSize: 15, cursor: isValid ? "pointer" : "default", fontFamily: mono, transition: "background 0.15s" }}>
          Review {label} order →
        </button>
      </div>
    </div>
  );
}

/* ─── MARKET DETAIL ──────────────────────────────────────────────── */
export function MarketDetail({ market, user, onUpdate, onBack, onNotify }) {
  const [tab, setTab] = useState("chart");
  const [orderSide, setOrderSide] = useState("buy");
  const [orderPrice, setOrderPrice] = useState("");
  const [orderSize, setOrderSize] = useState("");
  const [orderErr, setOrderErr] = useState("");
  const [pendingOrder, setPendingOrder] = useState(null);
  const [showResolve, setShowResolve] = useState(false);
  const [quickBuy, setQuickBuy] = useState(null); // { side, price }
  const [orderReceipt, setOrderReceipt] = useState(null); // post-confirm summary
  const [showAllTrades, setShowAllTrades] = useState(false);

  const isResolved = market.status === "resolved";
  const isCreator  = market.creator === user.id;

  const buys  = market.orders.filter((o) => o.side === "buy").sort((a, b) => b.price - a.price);
  const sells = market.orders.filter((o) => o.side === "sell").sort((a, b) => a.price - b.price);
  const bestBid = buys[0]?.price ?? 0;
  const bestAsk = sells[0]?.price ?? 100;
  const mid = bestBid && bestAsk ? Math.round((bestBid + bestAsk) / 2) : bestBid || bestAsk || 50;
  const spread = bestAsk - bestBid;

  const handleReview = () => {
    const p = parseNum(orderPrice);
    const s = parseNum(orderSize);
    if (isNaN(p) || p < 1 || p > 99) { setOrderErr("Price must be between 1 and 99"); return; }
    if (isNaN(s) || s <= 0) { setOrderErr("Size must be greater than 0"); return; }
    setOrderErr("");
    setPendingOrder({
      id: uid(),
      side: orderSide,
      price: Math.round(p),
      displaySide: orderSide === "sell" ? "no" : "yes",
      size: parseFloat(s.toFixed(2)),
      userId: user.id,
      name: user.name,
    });
  };

  const handleConfirm = () => {
    const o = { ...pendingOrder };
    let orders   = [...market.orders];
    let history  = [...market.priceHistory];
    let trades   = [...(market.trades || [])];
    let remaining = o.size;
    const now = Date.now();
    const filledUserIds = []; // track user IDs of matched resting orders

    if (o.side === "buy") {
      const matches = orders
        .map((ord, i) => ({ ord, i }))
        .filter(({ ord }) => ord.side === "sell" && ord.price <= o.price)
        .sort((a, b) => a.ord.price - b.ord.price);

      let totalFilledSize = 0;
      let totalFilledCost = 0;
      let fillIdx = 0;

      for (const { ord } of matches) {
        if (remaining <= 0.005) break;
        const fillSize = parseFloat(Math.min(remaining, ord.size).toFixed(2));
        remaining = parseFloat((remaining - fillSize).toFixed(2));
        // Stagger timestamps by 1ms so each fill shows as a distinct chart point
        history = [...history, { ts: now + fillIdx, yes: ord.price }];
        trades  = [{ price: ord.price, side: "YES bought", buyer: o.name, seller: ord.name, size: fillSize, ts: now + fillIdx }, ...trades];
        totalFilledSize += fillSize;
        totalFilledCost += (ord.price / 100) * fillSize;
        if (ord.userId) filledUserIds.push(ord.userId);
        fillIdx++;
        const newOrdSize = parseFloat((ord.size - fillSize).toFixed(2));
        orders = newOrdSize <= 0.005
          ? orders.filter((x) => x.id !== ord.id)
          : orders.map((x) => x.id === ord.id ? { ...x, size: newOrdSize } : x);
      }

      // If we swept multiple levels, add a VWAP summary point as the "last price"
      if (fillIdx > 1 && totalFilledSize > 0) {
        const vwap = Math.round((totalFilledCost / totalFilledSize) * 100);
        history = [...history, { ts: now + fillIdx, yes: vwap }];
      }

      if (remaining > 0.005) orders = [...orders, { ...o, size: remaining }];

    } else {
      const matches = orders
        .map((ord, i) => ({ ord, i }))
        .filter(({ ord }) => ord.side === "buy" && ord.price >= o.price)
        .sort((a, b) => b.ord.price - a.ord.price);

      let totalFilledSize = 0;
      let totalFilledCost = 0;
      let fillIdx = 0;

      for (const { ord } of matches) {
        if (remaining <= 0.005) break;
        const fillSize = parseFloat(Math.min(remaining, ord.size).toFixed(2));
        remaining = parseFloat((remaining - fillSize).toFixed(2));
        history = [...history, { ts: now + fillIdx, yes: ord.price }];
        trades  = [{ price: ord.price, side: "YES sold", buyer: ord.name, seller: o.name, size: fillSize, ts: now + fillIdx }, ...trades];
        totalFilledSize += fillSize;
        totalFilledCost += (ord.price / 100) * fillSize;
        if (ord.userId) filledUserIds.push(ord.userId);
        fillIdx++;
        const newOrdSize = parseFloat((ord.size - fillSize).toFixed(2));
        orders = newOrdSize <= 0.005
          ? orders.filter((x) => x.id !== ord.id)
          : orders.map((x) => x.id === ord.id ? { ...x, size: newOrdSize } : x);
      }

      if (fillIdx > 1 && totalFilledSize > 0) {
        const vwap = Math.round((totalFilledCost / totalFilledSize) * 100);
        history = [...history, { ts: now + fillIdx, yes: vwap }];
      }

      if (remaining > 0.005) orders = [...orders, { ...o, size: remaining }];
    }

    onUpdate({ ...market, orders, priceHistory: history, trades });

    // Fire single notification event — server applies priority dedup per user
    const filledSize = parseFloat((o.size - (remaining > 0.005 ? remaining : 0)).toFixed(2));
    const displayPrice = o.displaySide === "no" ? 100 - o.price : o.price;
    const participantUserIds = [...new Set([market.creator, ...market.orders.map((x) => x.userId)].filter(Boolean))];
    onNotify?.("order_confirmed", {
      marketId: market.id, marketTitle: market.title,
      orderName: o.name, side: o.displaySide === "no" ? "NO" : "YES",
      price: displayPrice, size: o.size,
      filledSize, filledUserIds, participantUserIds,
      excludeUserIds: [o.userId],
    });

    // Build receipt
    const isNo       = pendingOrder.displaySide === "no";
    const filledNow  = pendingOrder.size - (remaining > 0.005 ? remaining : 0);
    const restingNow = remaining > 0.005 ? remaining : 0;
    setOrderReceipt({
      outcomeLabel: isNo ? "NO" : "YES",
      isNo,
      size:        pendingOrder.size,
      filledSize:  parseFloat(filledNow.toFixed(2)),
      restingSize: parseFloat(restingNow.toFixed(2)),
      displayPrice: isNo ? 100 - pendingOrder.price : pendingOrder.price,
    });

    setPendingOrder(null);
    setOrderPrice("");
    setOrderSize("");
  };

  const handleResolve = (result, note) => {
    onUpdate({ ...market, status: "resolved", resolvedAs: result, resolvedNote: note || `Resolved ${result}.`, orders: [], resolvedAt: Date.now() });
    setShowResolve(false);
    const participantUserIds = [...new Set([market.creator, ...market.orders.map((x) => x.userId)].filter(Boolean))];
    onNotify?.("market_resolved", { marketId: market.id, marketTitle: market.title, resolvedAs: result, participantUserIds, excludeUserIds: [user.id] });
    // Note: send.js handles market_resolved vs any_market_resolved priority dedup
  };

  const TabBtn = ({ id, label }) => (
    <button onClick={() => setTab(id)} style={{
      flex: 1, background: "transparent", border: "none",
      borderBottom: tab === id ? `2px solid ${C.gold}` : `2px solid transparent`,
      color: tab === id ? C.gold : C.muted,
      padding: "11px 0", fontSize: 11, fontWeight: 700, cursor: "pointer", fontFamily: mono, letterSpacing: 0.8,
    }}>{label}</button>
  );

  return (
    <div>
      {pendingOrder && (
        <OrderConfirmModal
          order={pendingOrder}
          market={market}
          onConfirm={handleConfirm}
          onCancel={() => setPendingOrder(null)}
        />
      )}
      {quickBuy && (
        <QuickBuyModal
          side={quickBuy.side}
          price={quickBuy.price}
          user={user}
          onReview={(order) => { setQuickBuy(null); setPendingOrder(order); }}
          onCancel={() => setQuickBuy(null)}
        />
      )}
      {orderReceipt && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.85)", zIndex: 100, display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}>
          <div style={{ background: C.surface, border: `1px solid ${C.borderBright}`, borderRadius: 16, width: "100%", maxWidth: 400, padding: 32, fontFamily: mono, textAlign: "center" }}>
            {/* Checkmark */}
            <div style={{ width: 64, height: 64, borderRadius: "50%", background: orderReceipt.isNo ? C.noDim : C.yesDim, border: `2px solid ${orderReceipt.isNo ? C.no : C.yes}`, display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 20px", fontSize: 28 }}>
              ✓
            </div>

            <div style={{ fontSize: 13, color: C.muted, letterSpacing: 1, textTransform: "uppercase", marginBottom: 8 }}>Order placed</div>
            <div style={{ fontSize: 28, fontWeight: 800, color: orderReceipt.isNo ? C.no : C.yes, marginBottom: 4 }}>
              {orderReceipt.outcomeLabel} @ {cents(orderReceipt.displayPrice)}
            </div>
            <div style={{ fontSize: 15, color: C.text, marginBottom: 24 }}>
              ${orderReceipt.size.toFixed(2)} contracts
            </div>

            {/* Fill breakdown */}
            <div style={{ background: C.raised, borderRadius: 9, padding: "12px 16px", marginBottom: 24, textAlign: "left" }}>
              {orderReceipt.filledSize > 0 && (
                <div style={{ display: "flex", justifyContent: "space-between", padding: "4px 0", fontSize: 12 }}>
                  <span style={{ color: C.muted }}>Filled immediately</span>
                  <span style={{ color: C.text, fontWeight: 700 }}>${orderReceipt.filledSize.toFixed(2)}</span>
                </div>
              )}
              {orderReceipt.restingSize > 0 && (
                <div style={{ display: "flex", justifyContent: "space-between", padding: "4px 0", fontSize: 12 }}>
                  <span style={{ color: C.muted }}>Resting in book</span>
                  <span style={{ color: C.muted }}>${orderReceipt.restingSize.toFixed(2)}</span>
                </div>
              )}
            </div>

            <button
              onClick={() => setOrderReceipt(null)}
              style={{ width: "100%", background: orderReceipt.isNo ? C.no : C.yes, color: orderReceipt.isNo ? "#fff" : "#000", border: "none", borderRadius: 8, padding: "13px 0", fontWeight: 800, fontSize: 14, cursor: "pointer", fontFamily: mono }}>
              Done
            </button>
          </div>
        </div>
      )}
      {showResolve && (
        <ResolveModal
          market={market}
          onResolve={handleResolve}
          onCancel={() => setShowResolve(false)}
        />
      )}

      {/* Title + headline */}
      <div style={{ padding: "14px 16px 0" }}>
        <button onClick={onBack} style={{ background: "transparent", border: "none", color: C.muted, fontSize: 12, cursor: "pointer", fontFamily: mono, padding: 0, marginBottom: 10 }}>← Markets</button>
        <h2 style={{ margin: 0, fontSize: 16, fontWeight: 700, lineHeight: 1.4 }}>{market.title}</h2>
        {/* Byline */}
        <p style={{ margin: "5px 0 0", fontSize: 11, color: C.muted }}>Created by {market.creatorName}</p>

        {/* Resolved banner OR live price */}
        {isResolved ? (
          <div style={{ marginTop: 14, background: (market.resolvedAs === "YES" ? C.yes : C.no) + "18", border: `1px solid ${(market.resolvedAs === "YES" ? C.yes : C.no)}44`, borderRadius: 10, padding: "14px 16px", display: "flex", alignItems: "center", gap: 14 }}>
            <div style={{ fontSize: 36, fontWeight: 900, color: market.resolvedAs === "YES" ? C.yes : C.no, lineHeight: 1 }}>{market.resolvedAs}</div>
            <div>
              <div style={{ fontSize: 11, color: C.muted, letterSpacing: 0.5, textTransform: "uppercase", marginBottom: 3 }}>Resolved</div>
              <div style={{ fontSize: 12, color: C.text, lineHeight: 1.4 }}>{market.resolvedNote || `Market resolved ${market.resolvedAs}.`}</div>
            </div>
          </div>
        ) : (
          <>
            <div style={{ display: "flex", alignItems: "baseline", gap: 10, marginTop: 10 }}>
              <span style={{ fontSize: 36, fontWeight: 800, color: mid >= 50 ? C.yes : C.no }}>{pct(mid)}</span>
              <span style={{ color: C.muted, fontSize: 12 }}>YES · spread {spread}¢</span>
            </div>
            {/* Quick action buttons */}
            <div style={{ display: "flex", gap: 8, marginTop: 12, marginBottom: 4 }}>
              <button onClick={() => setQuickBuy({ side: "buy", price: bestAsk })}
                style={{ flex: 1, background: C.yesDim, color: C.yes, border: `1px solid ${C.yes}55`, borderRadius: 7, padding: "10px 0", fontSize: 13, fontWeight: 700, cursor: "pointer", fontFamily: mono }}>
                YES {cents(bestAsk)}
              </button>
              <button onClick={() => setQuickBuy({ side: "sell", price: bestBid })}
                style={{ flex: 1, background: C.noDim, color: C.no, border: `1px solid ${C.no}55`, borderRadius: 7, padding: "10px 0", fontSize: 13, fontWeight: 700, cursor: "pointer", fontFamily: mono }}>
                NO {cents(100 - bestBid)}
              </button>
            </div>
          </>
        )}

        {/* Resolve button — creator only, open markets only */}
        {isCreator && !isResolved && (
          <button
            onClick={() => setShowResolve(true)}
            style={{ width: "100%", marginTop: 10, background: "transparent", color: C.gold, border: `1px solid ${C.gold}55`, borderRadius: 7, padding: "9px 0", fontSize: 12, fontWeight: 700, cursor: "pointer", fontFamily: mono }}>
            Resolve Market
          </button>
        )}
      </div>

      {/* ── YOUR POSITION ── */}
      {(() => {
        const myTrades = (market.trades || []).filter((t) => t.buyer === user.name || t.seller === user.name);
        const myOrders = market.orders.filter((o) => o.name === user.name);

        // Filled YES contracts (bought YES)
        const yesContracts = myTrades
          .filter((t) => t.buyer === user.name)
          .reduce((s, t) => s + t.size, 0);
        const yesCost = myTrades
          .filter((t) => t.buyer === user.name)
          .reduce((s, t) => s + (t.price / 100) * t.size, 0);

        // Filled NO contracts (sold YES = bought NO)
        const noContracts = myTrades
          .filter((t) => t.seller === user.name)
          .reduce((s, t) => s + t.size, 0);
        const noCost = myTrades
          .filter((t) => t.seller === user.name)
          .reduce((s, t) => s + ((100 - t.price) / 100) * t.size, 0);

        const hasPosition = yesContracts > 0.005 || noContracts > 0.005 || myOrders.length > 0;
        if (!hasPosition) return null;

        const yesValue = (mid / 100) * yesContracts;
        const noValue  = ((100 - mid) / 100) * noContracts;

        return (
          <div style={{ margin: "10px 14px 0", background: C.raised, border: `1px solid ${C.borderBright}`, borderRadius: 10, padding: "12px 14px" }}>
            <div style={{ color: C.muted, fontSize: 10, letterSpacing: 1.2, textTransform: "uppercase", marginBottom: 10 }}>Your Position</div>

            {yesContracts > 0.005 && (
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={{ background: C.yesDim, color: C.yes, border: `1px solid ${C.yes}44`, borderRadius: 5, padding: "2px 8px", fontSize: 11, fontWeight: 700 }}>YES</span>
                  <span style={{ color: C.text, fontSize: 13, fontWeight: 600 }}>${yesContracts.toFixed(2)}</span>
                  <span style={{ color: C.muted, fontSize: 11 }}>paid ${yesCost.toFixed(2)}</span>
                </div>
                <div style={{ textAlign: "right" }}>
                  <span style={{ color: yesValue >= yesCost ? C.yes : C.no, fontSize: 12, fontWeight: 700 }}>~${yesValue.toFixed(2)}</span>
                  <span style={{ color: C.muted, fontSize: 10, marginLeft: 4 }}>now</span>
                </div>
              </div>
            )}

            {noContracts > 0.005 && (
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={{ background: C.noDim, color: C.no, border: `1px solid ${C.no}44`, borderRadius: 5, padding: "2px 8px", fontSize: 11, fontWeight: 700 }}>NO</span>
                  <span style={{ color: C.text, fontSize: 13, fontWeight: 600 }}>${noContracts.toFixed(2)}</span>
                  <span style={{ color: C.muted, fontSize: 11 }}>paid ${noCost.toFixed(2)}</span>
                </div>
                <div style={{ textAlign: "right" }}>
                  <span style={{ color: noValue >= noCost ? C.yes : C.no, fontSize: 12, fontWeight: 700 }}>~${noValue.toFixed(2)}</span>
                  <span style={{ color: C.muted, fontSize: 10, marginLeft: 4 }}>now</span>
                </div>
              </div>
            )}

            {myOrders.length > 0 && (
              <div style={{ borderTop: `1px solid ${C.border}`, marginTop: 8, paddingTop: 8 }}>
                <div style={{ color: C.muted, fontSize: 10, letterSpacing: 1, textTransform: "uppercase", marginBottom: 6 }}>Open Orders</div>
                {myOrders.map((o) => (
                  <div key={o.id} style={{ display: "flex", justifyContent: "space-between", fontSize: 11, padding: "2px 0" }}>
                    <span style={{ color: C.muted }}>
                      {o.side === "buy" ? <span style={{ color: C.yes }}>Buy YES</span> : <span style={{ color: C.no }}>Buy NO</span>}
                      {" "}@ {o.side === "buy" ? cents(o.price) : cents(100 - o.price)}
                    </span>
                    <span style={{ color: C.muted }}>${o.size.toFixed(2)}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })()}

      {/* Tabs — chart | info | order book */}
      <div style={{ display: "flex", borderBottom: `1px solid ${C.border}`, marginTop: 10 }}>
        <TabBtn id="chart" label="CHART" />
        <TabBtn id="info"  label="INFO" />
        <TabBtn id="book"  label="ORDER BOOK" />
      </div>

      {/* ── ORDER BOOK TAB ── */}
      {tab === "book" && (
        <div style={{ padding: "0 16px" }}>
          {isResolved ? (
            <div style={{ textAlign: "center", padding: "40px 0", color: C.muted }}>
              <div style={{ fontSize: 28, marginBottom: 8 }}>🔒</div>
              <p style={{ fontSize: 13 }}>This market is resolved. The order book is closed.</p>
            </div>
          ) : (
            <>

          {/* SELL YES section */}
          <div style={{ color: C.no, fontSize: 10, letterSpacing: 1.2, textTransform: "uppercase", padding: "12px 0 6px", fontWeight: 700 }}>
            Sell YES
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "80px 80px 1fr", gap: 4, color: C.muted, fontSize: 10, letterSpacing: 0.8, paddingBottom: 5, borderBottom: `1px solid ${C.border}` }}>
            <span>PRICE</span><span>SIZE</span><span style={{ textAlign: "right" }}>WHO</span>
          </div>
          {[...sells].reverse().map((o) => (
            <div key={o.id} style={{ display: "grid", gridTemplateColumns: "80px 80px 1fr", gap: 4, padding: "5px 0", borderBottom: `1px solid ${C.border}15` }}>
              <span style={{ color: C.no, fontWeight: 700 }}>{cents(o.price)}</span>
              <span style={{ color: C.muted }}>${o.size.toFixed(2)}</span>
              <span style={{ textAlign: "right", color: C.muted, fontSize: 11 }}>{o.name}</span>
            </div>
          ))}
          {sells.length === 0 && <p style={{ color: C.muted, fontSize: 11, padding: "6px 0", opacity: 0.5 }}>No sell orders</p>}

          {/* Spread bar */}
          <div style={{ textAlign: "center", padding: "7px 0", color: C.muted, fontSize: 11, background: "#0a0c0e", borderTop: `1px solid ${C.border}`, borderBottom: `1px solid ${C.border}`, margin: "4px -16px", paddingLeft: 16, paddingRight: 16 }}>
            spread {spread}¢ · mid {cents(mid)}
          </div>

          {/* BUY YES section */}
          <div style={{ color: C.yes, fontSize: 10, letterSpacing: 1.2, textTransform: "uppercase", padding: "12px 0 6px", fontWeight: 700 }}>
            Buy YES
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "80px 80px 1fr", gap: 4, color: C.muted, fontSize: 10, letterSpacing: 0.8, paddingBottom: 5, borderBottom: `1px solid ${C.border}` }}>
            <span>PRICE</span><span>SIZE</span><span style={{ textAlign: "right" }}>WHO</span>
          </div>
          {buys.map((o) => (
            <div key={o.id} style={{ display: "grid", gridTemplateColumns: "80px 80px 1fr", gap: 4, padding: "5px 0", borderBottom: `1px solid ${C.border}15` }}>
              <span style={{ color: C.yes, fontWeight: 700 }}>{cents(o.price)}</span>
              <span style={{ color: C.muted }}>${o.size.toFixed(2)}</span>
              <span style={{ textAlign: "right", color: C.muted, fontSize: 11 }}>{o.name}</span>
            </div>
          ))}
          {buys.length === 0 && <p style={{ color: C.muted, fontSize: 11, padding: "6px 0", opacity: 0.5 }}>No buy orders</p>}

          {/* ─── PLACE ORDER ─── */}
          <div style={{ borderTop: `1px solid ${C.border}`, marginTop: 20, paddingTop: 18 }}>
            <div style={{ color: C.muted, fontSize: 10, letterSpacing: 1.2, textTransform: "uppercase", marginBottom: 12 }}>Place Order</div>

            <div style={{ display: "flex", gap: 8, marginBottom: 14 }}>
              <button onClick={() => { setOrderSide("buy"); setOrderErr(""); }}
                style={{ flex: 1, background: orderSide === "buy" ? C.yes : "transparent", color: orderSide === "buy" ? "#000" : C.yes, border: `1px solid ${C.yes}`, borderRadius: 7, padding: "10px 0", fontWeight: 700, fontSize: 13, cursor: "pointer", fontFamily: mono }}>
                Buy YES
              </button>
              <button onClick={() => { setOrderSide("sell"); setOrderErr(""); }}
                style={{ flex: 1, background: orderSide === "sell" ? C.no : "transparent", color: orderSide === "sell" ? "#fff" : C.no, border: `1px solid ${C.no}`, borderRadius: 7, padding: "10px 0", fontWeight: 700, fontSize: 13, cursor: "pointer", fontFamily: mono }}>
                Sell YES
              </button>
            </div>

            <label style={labelStyle}>YES Price (¢)</label>
            <input
              style={inputStyle}
              type="number"
              inputMode="numeric"
              min="1" max="99" step="1"
              placeholder={orderSide === "buy" ? `e.g. ${bestAsk}` : `e.g. ${bestBid}`}
              value={orderPrice}
              onChange={(e) => { setOrderPrice(e.target.value); setOrderErr(""); }}
            />

            <label style={labelStyle}>Contracts ($)</label>
            <input
              style={inputStyle}
              type="number"
              inputMode="decimal"
              min="0.01" step="0.01"
              placeholder="e.g. 5.00"
              value={orderSize}
              onChange={(e) => { setOrderSize(e.target.value); setOrderErr(""); }}
            />

            {orderErr && <p style={{ color: C.no, fontSize: 12, marginBottom: 8 }}>{orderErr}</p>}

            <button
              style={{ width: "100%", background: orderSide === "buy" ? C.yes : C.no, color: orderSide === "buy" ? "#000" : "#fff", border: "none", borderRadius: 7, padding: "12px 0", fontWeight: 800, fontSize: 13, cursor: "pointer", fontFamily: mono }}
              onClick={handleReview}>
              Review Order →
            </button>
          </div>
          </>
          )}
        </div>
      )}

      {/* ── CHART TAB ── */}
      {tab === "chart" && (
        <div style={{ padding: 16 }}>
          {(() => {
            // For open markets, append a live point at current mid.
            // For resolved markets, end at resolution time (last real history point).
            const resolvedPrice = market.resolvedAs === "YES" ? 100 : 0;
            const rawHistory = isResolved
              ? market.priceHistory.filter((p) => p.yes !== (market.resolvedAs === "YES" ? 0 : 100))
              : market.priceHistory;
            const resolvedTs = market.resolvedAt || (rawHistory.length > 0 ? rawHistory[rawHistory.length - 1].ts : Date.now());
            const endPoint = isResolved
              ? { ts: resolvedTs, yes: resolvedPrice }
              : { ts: Date.now(), yes: mid };
            const chartData = isResolved
              ? [...rawHistory.filter((p) => p.ts <= resolvedTs - 1), endPoint]
              : [...rawHistory.filter((p) => p.ts < endPoint.ts), endPoint];

            const startTs = market.createdAt || (chartData[0]?.ts ?? Date.now());
            const ticks   = chartData
              .filter((_, i) => {
                // Show ~5 evenly spaced tick labels (all points plotted, only labels filtered)
                const n = chartData.length;
                if (n <= 5) return true;
                const step = Math.floor(n / 4);
                return i === 0 || i === n - 1 || i % step === 0;
              })
              .map((p) => p.ts);

            const CustomTooltip = ({ active, payload }) => {
              if (!active || !payload?.length) return null;
              const { ts, yes } = payload[0].payload;
              const probColor = yes >= 50 ? C.yes : C.no;
              return (
                <div style={{ background: C.raised, border: `1px solid ${C.borderBright}`, borderRadius: 6, padding: "7px 11px", fontFamily: mono, fontSize: 11 }}>
                  <div style={{ color: C.muted, marginBottom: 4 }}>{fmtTooltipTs(ts)}</div>
                  <div style={{ color: probColor, fontWeight: 800, fontSize: 18, lineHeight: 1 }}>{yes}%</div>
                  <div style={{ color: C.muted, fontSize: 10, marginTop: 2 }}>YES probability</div>
                </div>
              );
            };

            return (
              <>
                <p style={{ color: C.muted, fontSize: 10, letterSpacing: 1, textTransform: "uppercase", marginBottom: 12 }}>YES price history</p>
                <ResponsiveContainer width="100%" height={220}>
                  <LineChart data={chartData} margin={{ left: 0, right: 8, top: 4, bottom: 4 }}>
                    <XAxis
                      dataKey="ts"
                      type="number"
                      scale="time"
                      domain={["dataMin", "dataMax"]}
                      ticks={ticks}
                      tickFormatter={(ts) => fmtChartTs(ts, startTs)}
                      tick={{ fontSize: 9, fill: C.muted, fontFamily: mono }}
                      axisLine={{ stroke: C.border }}
                      tickLine={false}
                    />
                    <YAxis
                      domain={[0, 100]}
                      tickFormatter={(v) => `${v}¢`}
                      tick={{ fontSize: 10, fill: C.muted, fontFamily: mono }}
                      width={34}
                      axisLine={false}
                      tickLine={false}
                    />
                    <Tooltip content={<CustomTooltip />} />
                    <ReferenceLine y={50} stroke={C.border} strokeDasharray="4 4" />
                    <Line type="monotone" dataKey="yes" stroke={C.gold} dot={false} strokeWidth={2} activeDot={{ r: 4, fill: C.gold, stroke: C.bg }} />
                  </LineChart>
                </ResponsiveContainer>
              </>
            );
          })()}

          {market.trades && market.trades.length > 0 && (
            <div style={{ marginTop: 20 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                <p style={{ color: C.muted, fontSize: 10, letterSpacing: 1.5, textTransform: "uppercase", margin: 0 }}>Trades ({market.trades.length})</p>
                {market.trades.length > 10 && (
                  <button onClick={() => setShowAllTrades((v) => !v)}
                    style={{ background: "transparent", border: "none", color: C.gold, fontSize: 11, cursor: "pointer", fontFamily: mono, padding: 0 }}>
                    {showAllTrades ? "Show less" : `Show all ${market.trades.length}`}
                  </button>
                )}
              </div>
              {(showAllTrades ? market.trades : market.trades.slice(0, 10)).map((t, i) => {
                const isYesBuy = t.side === "YES bought";
                const tradeColor = isYesBuy ? C.yes : C.no;
                const yesName = t.buyer;
                const noName  = t.seller;
                const tradePrice = t.price; // always YES price
                return (
                  <div key={i} style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", padding: "5px 0", borderBottom: `1px solid ${C.border}`, fontSize: 11 }}>
                    <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                      <span style={{ color: C.yes, fontWeight: 700 }}>{yesName}</span>
                      <span style={{ color: C.yes, fontSize: 10 }}>YES</span>
                      <span style={{ color: C.muted }}> vs </span>
                      <span style={{ color: C.no, fontWeight: 700 }}>{noName}</span>
                      <span style={{ color: C.no, fontSize: 10 }}>NO</span>
                    </div>
                    <div style={{ display: "flex", gap: 12, flexShrink: 0 }}>
                      <span style={{ color: C.text, fontWeight: 700 }}>{cents(tradePrice)}</span><span style={{ color: C.muted, fontSize: 10, marginLeft: 3 }}>YES</span>
                      <span style={{ color: C.muted }}>${t.size?.toFixed(2)}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* ── INFO TAB ── */}
      {tab === "info" && (
        <div style={{ padding: 16 }}>
          <label style={labelStyle}>Description</label>
          <p style={{ fontSize: 13, lineHeight: 1.7, marginBottom: 20 }}>{market.description}</p>
          <label style={labelStyle}>Resolution Criteria</label>
          <p style={{ fontSize: 13, lineHeight: 1.7, marginBottom: 20 }}>{market.resolution}</p>
          <label style={labelStyle}>Created by</label>
          <p style={{ fontSize: 13 }}>{market.creatorName}</p>
          <p style={{ color: C.muted, fontSize: 11, marginTop: 28 }}>Settlement happens off-platform. 🤝</p>
        </div>
      )}
    </div>
  );
}
