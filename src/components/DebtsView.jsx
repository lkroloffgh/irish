import { useState } from "react";
import { C, mono } from "../lib/constants.js";
import { FILL_EPSILON } from "../lib/helpers.js";

/* ─── DEBT COMPUTATION ───────────────────────────────────────────── */
/*
  Debt logic per resolved trade:
    trade = { buyer, seller, price (YES price in cents), size ($), side }
    If market resolved YES:
      - buyer wins: they paid `price/100 * size` and receive `size` → net gain `size * (1 - price/100)`
      - seller loses: they receive `price/100 * size` but must pay `size` → net loss `size * (1 - price/100)`
      - So seller owes buyer: size * (1 - price/100)
    If market resolved NO:
      - seller wins: they receive `price/100 * size` and keep it, buyer loses that
      - So buyer owes seller: size * (price/100)

  We accumulate net amounts between each pair, then net them off so only
  the person who owes more pays the difference.
*/
function computeDebts(markets) {
  // netOwed[A][B] = amount A owes B (before netting)
  const raw = {};
  const addDebt = (debtor, creditor, amount) => {
    if (debtor === creditor || amount <= 0) return;
    if (!raw[debtor]) raw[debtor] = {};
    raw[debtor][creditor] = (raw[debtor][creditor] || 0) + amount;
  };

  for (const m of markets) {
    if (m.status !== "resolved" || !m.resolvedAs) continue;
    for (const t of (m.trades || [])) {
      const { buyer, seller, price, size } = t;
      if (!buyer || !seller || buyer === seller) continue;
      const p = price / 100;
      if (m.resolvedAs === "YES") {
        // seller owes buyer: size * (1 - p)
        addDebt(seller, buyer, size * (1 - p));
      } else {
        // buyer owes seller: size * p
        addDebt(buyer, seller, size * p);
      }
    }
  }

  // Net off pairs: if A owes B $8 and B owes A $3 → A owes B $5 only
  const debts = []; // { debtor, creditor, amount, id }
  const seen = new Set();
  for (const debtor of Object.keys(raw)) {
    for (const creditor of Object.keys(raw[debtor] || {})) {
      const key = [debtor, creditor].sort().join("↔");
      if (seen.has(key)) continue;
      seen.add(key);
      const ab = raw[debtor]?.[creditor] || 0;
      const ba = raw[creditor]?.[debtor]  || 0;
      const net = ab - ba;
      if (Math.abs(net) < FILL_EPSILON) continue;
      debts.push({
        id: key,
        debtor: net > 0 ? debtor : creditor,
        creditor: net > 0 ? creditor : debtor,
        amount: Math.abs(net),
      });
    }
  }
  return debts;
}

/* ─── DEBTS VIEW ─────────────────────────────────────────────────── */
export function DebtsView({ markets, user, settled, onSettle }) {
  const allDebts    = computeDebts(markets);
  const unsettled   = allDebts.filter((d) => !settled.has(d.id));
  const settledList = allDebts.filter((d) =>  settled.has(d.id));

  const myUnsettled = unsettled.filter((d) => d.debtor === user.name || d.creditor === user.name);
  const otherDebts  = unsettled.filter((d) => d.debtor !== user.name && d.creditor !== user.name);

  const totalIOwe   = myUnsettled.filter((d) => d.debtor === user.name).reduce((s, d) => s + d.amount, 0);
  const totalOwedMe = myUnsettled.filter((d) => d.creditor === user.name).reduce((s, d) => s + d.amount, 0);

  const [confirmSettle, setConfirmSettle] = useState(null); // debt object pending confirmation

  const DebtCard = ({ d, isSettled }) => {
    const iOwe    = d.debtor === user.name;
    const owedMe  = d.creditor === user.name;
    const canSettle = owedMe && !isSettled;

    return (
      <div style={{ background: C.surface, border: `1px solid ${isSettled ? C.border : (iOwe ? C.no + "44" : owedMe ? C.yes + "44" : C.border)}`, borderRadius: 10, padding: "14px 16px", marginBottom: 10, opacity: isSettled ? 0.5 : 1 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
          <div style={{ flex: 1 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
              <span style={{ fontWeight: 700, color: iOwe ? C.no : C.text }}>{d.debtor}</span>
              <span style={{ color: C.muted, fontSize: 11 }}>owes</span>
              <span style={{ fontWeight: 700, color: owedMe ? C.yes : C.text }}>{d.creditor}</span>
            </div>
            <div style={{ marginTop: 6, fontSize: 22, fontWeight: 800, color: isSettled ? C.muted : (iOwe ? C.no : owedMe ? C.yes : C.gold) }}>
              ${d.amount.toFixed(2)}
            </div>
            {isSettled && (
              <div style={{ marginTop: 4, fontSize: 11, color: C.yes }}>✓ Settled</div>
            )}
          </div>
          {canSettle && (
            <button
              onClick={() => setConfirmSettle(d)}
              style={{ flexShrink: 0, background: C.yes, color: "#000", border: "none", borderRadius: 7, padding: "9px 14px", fontWeight: 700, fontSize: 12, cursor: "pointer", fontFamily: mono }}>
              Mark Settled
            </button>
          )}
        </div>
      </div>
    );
  };

  return (
    <div>
      {/* Settle confirmation modal */}
      {confirmSettle && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.8)", zIndex: 100, display: "flex", alignItems: "flex-end", justifyContent: "center" }}>
          <div style={{ background: C.surface, border: `1px solid ${C.borderBright}`, borderRadius: "16px 16px 0 0", width: "100%", maxWidth: 520, padding: 24, paddingBottom: 40, fontFamily: mono }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: C.gold, marginBottom: 14 }}>Confirm Settlement</div>
            <div style={{ background: C.yesDim, border: `1px solid ${C.yes}44`, borderRadius: 10, padding: "14px 16px", marginBottom: 20 }}>
              <div style={{ fontSize: 22, fontWeight: 800, color: C.yes, marginBottom: 6 }}>${confirmSettle.amount.toFixed(2)}</div>
              <div style={{ fontSize: 13, color: C.text }}>
                <span style={{ fontWeight: 700 }}>{confirmSettle.debtor}</span>
                <span style={{ color: C.muted }}> has paid </span>
                <span style={{ fontWeight: 700 }}>{confirmSettle.creditor}</span>
              </div>
              <div style={{ fontSize: 11, color: C.muted, marginTop: 6 }}>This confirms the debt has been settled off-platform.</div>
            </div>
            <div style={{ display: "flex", gap: 10 }}>
              <button
                onClick={() => setConfirmSettle(null)}
                style={{ flex: 1, background: "transparent", color: C.muted, border: `1px solid ${C.border}`, borderRadius: 7, padding: "12px 0", fontWeight: 700, fontSize: 13, cursor: "pointer", fontFamily: mono }}>
                Cancel
              </button>
              <button
                onClick={() => { onSettle(confirmSettle.id); setConfirmSettle(null); }}
                style={{ flex: 2, background: C.yes, color: "#000", border: "none", borderRadius: 7, padding: "12px 0", fontWeight: 800, fontSize: 13, cursor: "pointer", fontFamily: mono }}>
                Confirm Settled ✓
              </button>
            </div>
          </div>
        </div>
      )}
      <div style={{ color: C.muted, fontSize: 10, letterSpacing: 1.5, textTransform: "uppercase", padding: "10px 16px 5px", borderBottom: `1px solid ${C.border}` }}>
        Settle Up
      </div>

      {/* My summary */}
      {(totalIOwe > 0 || totalOwedMe > 0) && (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, padding: "14px 14px 4px" }}>
          <div style={{ background: C.noDim, border: `1px solid ${C.no}33`, borderRadius: 9, padding: "12px 14px" }}>
            <div style={{ color: C.muted, fontSize: 10, letterSpacing: 1, textTransform: "uppercase", marginBottom: 6 }}>You owe</div>
            <div style={{ fontSize: 24, fontWeight: 800, color: totalIOwe > 0 ? C.no : C.muted }}>${totalIOwe.toFixed(2)}</div>
          </div>
          <div style={{ background: C.yesDim, border: `1px solid ${C.yes}33`, borderRadius: 9, padding: "12px 14px" }}>
            <div style={{ color: C.muted, fontSize: 10, letterSpacing: 1, textTransform: "uppercase", marginBottom: 6 }}>Owed to you</div>
            <div style={{ fontSize: 24, fontWeight: 800, color: totalOwedMe > 0 ? C.yes : C.muted }}>${totalOwedMe.toFixed(2)}</div>
          </div>
        </div>
      )}

      <div style={{ padding: "4px 14px 0" }}>
        {/* My debts */}
        {myUnsettled.length > 0 && (
          <>
            <div style={{ color: C.muted, fontSize: 10, letterSpacing: 1.2, textTransform: "uppercase", padding: "14px 0 8px" }}>Your Debts</div>
            {myUnsettled.map((d) => <DebtCard key={d.id} d={d} isSettled={false} />)}
          </>
        )}

        {/* Everyone else */}
        {otherDebts.length > 0 && (
          <>
            <div style={{ color: C.muted, fontSize: 10, letterSpacing: 1.2, textTransform: "uppercase", padding: "14px 0 8px" }}>Everyone Else</div>
            {otherDebts.map((d) => <DebtCard key={d.id} d={d} isSettled={false} />)}
          </>
        )}

        {/* All clear */}
        {unsettled.length === 0 && (
          <div style={{ textAlign: "center", padding: "48px 0" }}>
            <div style={{ fontSize: 36, marginBottom: 10 }}>🍺</div>
            <p style={{ color: C.muted, fontSize: 13 }}>All square. Everyone's paid up.</p>
          </div>
        )}

        {/* Settled history */}
        {settledList.length > 0 && (
          <>
            <div style={{ color: C.muted, fontSize: 10, letterSpacing: 1.2, textTransform: "uppercase", padding: "14px 0 8px", borderTop: `1px solid ${C.border}`, marginTop: 8 }}>
              Settled
            </div>
            {settledList.map((d) => <DebtCard key={d.id} d={d} isSettled={true} />)}
          </>
        )}
      </div>
    </div>
  );
}
