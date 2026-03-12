import { useState, useEffect } from "react";
import { supabase } from "../lib/supabase.js";
import { C, mono, inputStyle, labelStyle } from "../lib/constants.js";
import { cents, pct, uid, parseNum, generatePriceHistory, FILL_EPSILON } from "../lib/helpers.js";

/* ─── HIDE USERS MODAL ───────────────────────────────────────────── */
function HideUsersModal({ currentUserId, hiddenFrom, onChange, onClose }) {
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    supabase
      .from("profiles")
      .select("id, display_name")
      .neq("id", currentUserId)
      .then(({ data }) => {
        setUsers(data || []);
        setLoading(false);
      });
  }, [currentUserId]);

  const toggle = (id) => {
    onChange(hiddenFrom.includes(id) ? hiddenFrom.filter((x) => x !== id) : [...hiddenFrom, id]);
  };

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.75)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000, padding: 16 }}>
      <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 12, width: "100%", maxWidth: 340, maxHeight: "70vh", display: "flex", flexDirection: "column" }}>
        {/* Fixed header */}
        <div style={{ padding: "14px 16px 10px", borderBottom: `1px solid ${C.border}` }}>
          <h3 style={{ color: C.gold, fontFamily: mono, fontSize: 13, fontWeight: 800, margin: 0 }}>🙈 Hide from users</h3>
          <p style={{ color: C.muted, fontSize: 10, margin: "3px 0 0" }}>Selected users won't see this market.</p>
        </div>

        {/* Scrollable list */}
        <div style={{ overflowY: "auto", flex: 1, padding: "8px 12px" }}>
          {loading ? (
            <p style={{ color: C.muted, fontSize: 12, padding: "8px 0" }}>Loading users…</p>
          ) : users.length === 0 ? (
            <p style={{ color: C.muted, fontSize: 12, padding: "8px 0" }}>No other users found.</p>
          ) : (
            users.map((u) => {
              const checked = hiddenFrom.includes(u.id);
              return (
                <div
                  key={u.id}
                  onClick={() => toggle(u.id)}
                  style={{ display: "flex", alignItems: "center", gap: 10, padding: "7px 8px", marginBottom: 4, background: checked ? C.dim : "transparent", border: `1px solid ${checked ? C.borderBright : C.border}`, borderRadius: 7, cursor: "pointer" }}
                >
                  <div style={{ width: 14, height: 14, borderRadius: 3, border: `2px solid ${checked ? C.gold : C.muted}`, background: checked ? C.gold : "transparent", flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center" }}>
                    {checked && <span style={{ color: "#000", fontSize: 9, fontWeight: 900, lineHeight: 1 }}>✓</span>}
                  </div>
                  <span style={{ color: C.text, fontSize: 12, fontFamily: mono }}>{u.display_name}</span>
                </div>
              );
            })
          )}
        </div>

        {/* Fixed footer */}
        <div style={{ padding: "10px 12px", borderTop: `1px solid ${C.border}` }}>
          <button
            onClick={onClose}
            style={{ width: "100%", background: C.gold, color: "#000", border: "none", borderRadius: 7, padding: "9px 0", fontWeight: 800, fontSize: 12, cursor: "pointer", fontFamily: mono }}>
            Done
          </button>
        </div>
      </div>
    </div>
  );
}

/* ─── CREATE MARKET ──────────────────────────────────────────────── */
export function CreateMarket({ user, onAdd, onCancel }) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [resolution, setResolution] = useState("");
  // mid is the midpoint (5–95). bid = mid-5, ask = mid+5 → always exactly 10¢ spread
  const [mid, setMid] = useState(50);
  const [size, setSize] = useState("5");
  const [err, setErr] = useState("");
  const [hiddenFrom, setHiddenFrom] = useState([]);
  const [showHideModal, setShowHideModal] = useState(false);

  const bid = mid - 5;   // Buy YES price
  const ask = mid + 5;   // Sell YES price

  const handleMidChange = (e) => {
    const v = Math.max(6, Math.min(94, Number(e.target.value)));
    setMid(v);
  };

  const handleCreate = () => {
    if (!title.trim()) { setErr("Title required."); return; }
    if (!description.trim()) { setErr("Description required."); return; }
    if (!resolution.trim()) { setErr("Resolution criteria required."); return; }
    const s = parseNum(size);
    if (isNaN(s) || s < 5) { setErr("Initial bet size must be at least $5 per side."); return; }

    setErr("");
    const now = Date.now();
    onAdd({
      id: uid(),
      title, description, resolution,
      creator: user.id, creatorName: user.name, status: "open", resolvedAs: null, resolvedNote: null,
      createdAt: now,
      hiddenFrom,
      priceHistory: generatePriceHistory(mid, 5),
      orders: [
        { id: uid(), side: "buy",  price: bid,  size: Math.round(s * 100) / 100, userId: user.id, name: user.name },
        { id: uid(), side: "sell", price: ask, size: Math.round(s * 100) / 100, userId: user.id, name: user.name },
      ],
      trades: [],
    });
  };

  // Maps a value in [6,94] to a CSS position on the slider track.
  // The 18px thumb means the thumb travels from 9px to (100%-9px), not 0%–100%.
  // This formula compensates so gradient stops align exactly with the thumb at all positions.
  const THUMB_R = 9; // half of the 18px thumb set in CSS
  const tp = (v) => {
    const frac = (v - 6) / 88;
    return `calc(${(frac * 100).toFixed(3)}% - ${(frac * THUMB_R * 2 - THUMB_R).toFixed(3)}px)`;
  };
  // Clamped version for floating labels — prevents them from drifting off either edge.
  const tpLabel = (v) => {
    const frac = (v - 6) / 88;
    const inner = `calc(${(frac * 100).toFixed(3)}% - ${(frac * THUMB_R * 2 - THUMB_R).toFixed(3)}px)`;
    return `clamp(18px, ${inner}, calc(100% - 18px))`;
  };
  // Green up to bid, gold band bid→ask (the spread), red from ask onward
  const sliderTrack = `linear-gradient(to right, ${C.yes} 0%, ${C.yes} ${tp(bid)}, ${C.gold} ${tp(bid)}, ${C.gold} ${tp(ask)}, ${C.no} ${tp(ask)}, ${C.no} 100%)`;

  return (
    <div style={{ padding: 16 }}>
      <button onClick={onCancel} style={{ background: "transparent", border: "none", color: C.muted, fontSize: 12, cursor: "pointer", fontFamily: mono, padding: 0, marginBottom: 16 }}>← Back</button>
      <h2 style={{ fontSize: 18, fontWeight: 800, marginBottom: 20, color: C.gold }}>New Market</h2>

      <label style={labelStyle}>Title *</label>
      <input style={inputStyle} placeholder="e.g. Will Doug finish Ulysses by June?" value={title} onChange={(e) => setTitle(e.target.value)} />

      <label style={labelStyle}>Description *</label>
      <textarea style={{ ...inputStyle, minHeight: 72, resize: "vertical" }} placeholder="Context and background…" value={description} onChange={(e) => setDescription(e.target.value)} />

      <label style={labelStyle}>Resolution Criteria *</label>
      <textarea style={{ ...inputStyle, minHeight: 72, resize: "vertical" }} placeholder="Exactly how will this resolve?" value={resolution} onChange={(e) => setResolution(e.target.value)} />

      {/* ── PRICE WIDGET ── */}
      <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 10, padding: 16, marginBottom: 14 }}>
        <p style={{ color: C.muted, fontSize: 10, letterSpacing: 1.2, textTransform: "uppercase", marginBottom: 14 }}>
          Initial Two-Sided Quote · fixed 10¢ spread
        </p>

        {/* Price display */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
          {/* Buy YES */}
          <div style={{ textAlign: "center", flex: 1 }}>
            <div style={{ color: C.muted, fontSize: 10, letterSpacing: 1, textTransform: "uppercase", marginBottom: 4 }}>Buy YES</div>
            <div style={{ fontSize: 26, fontWeight: 800, color: C.yes }}>{cents(bid)}</div>
          </div>

          {/* Spread indicator */}
          <div style={{ textAlign: "center", padding: "0 12px" }}>
            <div style={{ color: C.muted, fontSize: 10, letterSpacing: 0.5 }}>spread</div>
            <div style={{ color: C.gold, fontWeight: 700, fontSize: 14 }}>10¢</div>
          </div>

          {/* Sell YES */}
          <div style={{ textAlign: "center", flex: 1 }}>
            <div style={{ color: C.muted, fontSize: 10, letterSpacing: 1, textTransform: "uppercase", marginBottom: 4 }}>Sell YES</div>
            <div style={{ fontSize: 26, fontWeight: 800, color: C.no }}>{cents(ask)}</div>
          </div>
        </div>

        {/* Midpoint label */}
        <div style={{ textAlign: "center", marginBottom: 10 }}>
          <span style={{ color: C.muted, fontSize: 11 }}>midpoint </span>
          <span style={{ color: C.gold, fontWeight: 700, fontSize: 13 }}>{pct(mid)}</span>
          <span style={{ color: C.muted, fontSize: 11 }}> YES</span>
        </div>

        {/* Slider */}
        <div style={{ position: "relative", marginBottom: 6, paddingTop: 26 }}>
          {/* Floating bid label — tracks the buy YES price */}
          <div style={{ position: "absolute", top: 0, left: tpLabel(bid), transform: "translateX(-50%)", textAlign: "center", pointerEvents: "none", lineHeight: 1.2 }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: C.yes, fontFamily: mono }}>{cents(bid)}</div>
            <div style={{ fontSize: 8, color: C.yes, marginTop: 1 }}>▼</div>
          </div>
          {/* Floating ask label — tracks the sell YES price */}
          <div style={{ position: "absolute", top: 0, left: tpLabel(ask), transform: "translateX(-50%)", textAlign: "center", pointerEvents: "none", lineHeight: 1.2 }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: C.no, fontFamily: mono }}>{cents(ask)}</div>
            <div style={{ fontSize: 8, color: C.no, marginTop: 1 }}>▼</div>
          </div>
          <input
            type="range"
            min="6" max="94" step="1"
            value={mid}
            onChange={handleMidChange}
            style={{
              width: "100%",
              appearance: "none",
              WebkitAppearance: "none",
              height: 6,
              borderRadius: 3,
              background: sliderTrack,
              outline: "none",
              cursor: "pointer",
            }}
          />
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10, color: C.muted, marginBottom: 4 }}>
          <span>1¢</span>
          <span>99¢</span>
        </div>

        {/* Size input */}
        <div style={{ marginTop: 14, borderTop: `1px solid ${C.border}`, paddingTop: 14 }}>
          <label style={labelStyle}>Size per side (min $5)</label>
          <input
            style={inputStyle}
            type="number"
            inputMode="decimal"
            min="5"
            step="1"
            placeholder="5.00"
            value={size}
            onChange={(e) => setSize(e.target.value)}
          />
          <p style={{ color: C.muted, fontSize: 11, marginTop: -4 }}>
            You post ${parseNum(size) >= 5 ? Math.round(parseNum(size) * 100) / 100 : "—"} on Buy YES @ {cents(bid)} and ${parseNum(size) >= 5 ? Math.round(parseNum(size) * 100) / 100 : "—"} on Sell YES @ {cents(ask)}. Settlement off-platform. 🤝
          </p>
        </div>
      </div>

      <button
        onClick={() => setShowHideModal(true)}
        style={{ width: "100%", background: "transparent", color: hiddenFrom.length > 0 ? C.gold : C.muted, border: `1px solid ${hiddenFrom.length > 0 ? C.gold : C.border}`, borderRadius: 7, padding: "10px 0", fontSize: 12, fontWeight: 700, cursor: "pointer", fontFamily: mono, marginBottom: 10 }}>
        🙈 Hide from users{hiddenFrom.length > 0 ? ` (${hiddenFrom.length} hidden)` : ""}
      </button>

      {showHideModal && (
        <HideUsersModal
          currentUserId={user.id}
          hiddenFrom={hiddenFrom}
          onChange={setHiddenFrom}
          onClose={() => setShowHideModal(false)}
        />
      )}

      {err && <p style={{ color: C.no, fontSize: 12, marginBottom: 8 }}>{err}</p>}
      <button
        style={{ width: "100%", background: C.gold, color: "#000", border: "none", borderRadius: 7, padding: "12px 0", fontWeight: 800, fontSize: 13, cursor: "pointer", fontFamily: mono }}
        onClick={handleCreate}>
        Create Market ☘️
      </button>

      <style>{`
        input[type=range]::-webkit-slider-thumb {
          -webkit-appearance: none;
          width: 18px; height: 18px;
          border-radius: 50%;
          background: ${C.gold};
          border: 2px solid #000;
          cursor: pointer;
        }
        input[type=range]::-moz-range-thumb {
          width: 18px; height: 18px;
          border-radius: 50%;
          background: ${C.gold};
          border: 2px solid #000;
          cursor: pointer;
        }
      `}</style>
    </div>
  );
}
