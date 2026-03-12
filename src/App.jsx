import { useState, useEffect } from "react";
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, ReferenceLine } from "recharts";
import { createClient } from "@supabase/supabase-js";

/* ─── SUPABASE ───────────────────────────────────────────────────── */
const SUPABASE_URL  = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_ANON = import.meta.env.VITE_SUPABASE_ANON;
const ADMIN_API     = "/api";

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON);

/* ─── HELPERS ────────────────────────────────────────────────────── */
const cents = (n) => `${Math.round(n)}¢`;
const pct = (n) => `${Math.round(n)}%`;
const uid = () => Math.random().toString(36).slice(2, 9);
const parseNum = (v) => {
  const n = Number(String(v).trim().replace(",", "."));
  return isNaN(n) ? NaN : n;
};

function urlBase64ToUint8Array(base64String) {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
}

const DAY = 86400000;

function generatePriceHistory(seed = 50, length = 20, startTs = Date.now() - length * 3600 * 1000) {
  const pts = [];
  let p = seed;
  // Space data points evenly between startTs and now
  const span = Date.now() - startTs;
  for (let i = 0; i < length; i++) {
    p = Math.max(5, Math.min(95, p + (Math.random() - 0.49) * 6));
    pts.push({ ts: Math.round(startTs + (span * i) / Math.max(length - 1, 1)), yes: Math.round(p) });
  }
  return pts;
}

// Helpers for formatting chart timestamps
const PT_OPTS = { timeZone: "America/Los_Angeles" };

function fmtChartTs(ts, marketStartTs) {
  const age = ts - marketStartTs;
  const d = new Date(ts);
  // Short markets (< 3 days): show weekday + 12h time
  if (age < 3 * DAY) {
    const day  = d.toLocaleDateString("en-US", { ...PT_OPTS, weekday: "short" });
    const time = d.toLocaleTimeString("en-US", { ...PT_OPTS, hour: "numeric", minute: "2-digit", hour12: true });
    return `${day} ${time}`;
  }
  // Longer markets: just show date
  return d.toLocaleDateString("en-US", { ...PT_OPTS, month: "short", day: "numeric" });
}

function fmtTooltipTs(ts) {
  const d = new Date(ts);
  const date = d.toLocaleDateString("en-US", { ...PT_OPTS, month: "short", day: "numeric" });
  const time = d.toLocaleTimeString("en-US", { ...PT_OPTS, hour: "numeric", minute: "2-digit", hour12: true });
  return `${date}, ${time} PT`;
}

/* ─── INITIAL DATA ───────────────────────────────────── */
const INIT_MARKETS = [];

/* ─── THEME ──────────────────────────────────────────────────────── */
const C = {
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

const mono = "'IBM Plex Mono', 'Courier New', monospace";

const inputStyle = {
  width: "100%",
  background: "#0c0e10",
  border: `1px solid ${C.border}`,
  borderRadius: 7,
  padding: "11px 13px",
  color: C.text,
  fontSize: 13,
  fontFamily: mono,
  boxSizing: "border-box",
  outline: "none",
  marginBottom: 10,
};

const labelStyle = {
  color: C.muted,
  fontSize: 10,
  letterSpacing: 1.2,
  textTransform: "uppercase",
  marginBottom: 5,
  display: "block",
};

/* ══════════════════════════════════════════════════════════════════
   ROOT
══════════════════════════════════════════════════════════════════ */
export default function App() {
  const [session, setSession]   = useState(undefined); // undefined = loading
  const [profile, setProfile]   = useState(null);
  const [markets, setMarkets]   = useState([]);
  const [marketsLoading, setMarketsLoading] = useState(true);
  const [view, setView]         = useState("feed");
  const [selectedId, setSelectedId] = useState(null);
  const [settled, setSettled]   = useState(new Set());
  const [isResetFlow, setIsResetFlow] = useState(false);

  const DEFAULT_NOTIF_PREFS = { new_signup: false, new_market: true, any_fill: false, your_market_order: true, market_resolved: true, any_market_resolved: false, own_fill: true };
  const [notifStatus, setNotifStatus] = useState(() => (typeof Notification !== "undefined" ? Notification.permission : "default"));
  const [notifPrefs, setNotifPrefs] = useState(DEFAULT_NOTIF_PREFS);

  useEffect(() => {
    // Get initial session
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      if (session) fetchProfile(session.user.id);
    });

    // Listen for auth changes (including password reset)
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === "PASSWORD_RECOVERY") {
        setIsResetFlow(true);
        setSession(session);
        return;
      }
      setSession(session);
      if (session) {
        fetchProfile(session.user.id);
        // Detect new signup: created_at ≈ last_sign_in_at (within 10s)
        if (event === "SIGNED_IN" && session.user.created_at && session.user.last_sign_in_at) {
          const diff = Math.abs(new Date(session.user.last_sign_in_at) - new Date(session.user.created_at));
          if (diff < 10000) {
            setTimeout(() => sendNotif("new_signup", { userName: session.user.user_metadata?.display_name || "Someone", excludeUserIds: [session.user.id] }), 3000);
          }
        }
      } else {
        setProfile(null);
      }
    });

    return () => subscription.unsubscribe();
  }, []);

  const fetchProfile = async (userId) => {
    const { data } = await supabase
      .from("profiles")
      .select("id, display_name, is_superuser")
      .eq("id", userId)
      .single();
    setProfile(data);
  };

  const handleLogout = async () => {
    await supabase.auth.signOut();
    setView("feed");
    setSelectedId(null);
  };

  const getAuthHeader = async () => {
    const { data: { session: s } } = await supabase.auth.getSession();
    return s ? { Authorization: `Bearer ${s.access_token}` } : {};
  };

  const sendNotif = async (event, payload) => {
    try {
      const headers = await getAuthHeader();
      if (!headers.Authorization) { console.log("[notif] no auth header"); return; }
      const res = await fetch(`${ADMIN_API}/push/send`, {
        method: "POST",
        headers: { ...headers, "Content-Type": "application/json" },
        body: JSON.stringify({ event, payload }),
      });
      const data = await res.json();
      console.log("[notif]", event, res.status, data);
    } catch (e) { console.error("[notif] error", e); }
  };

  const loadNotifPrefs = async () => {
    try {
      const headers = await getAuthHeader();
      if (!headers.Authorization) return;
      const res = await fetch(`${ADMIN_API}/push/preferences`, { headers });
      if (!res.ok) return;
      const data = await res.json();
      if (data.preferences) setNotifPrefs(data.preferences);
    } catch {}
  };

  const initNotifications = async () => {
    if (!("serviceWorker" in navigator) || !("PushManager" in window)) { console.log("[notif] push not supported"); return; }
    const permission = await Notification.requestPermission();
    console.log("[notif] permission:", permission);
    setNotifStatus(permission);
    if (permission !== "granted") return;
    const reg = await navigator.serviceWorker.register("/sw.js");
    console.log("[notif] sw registered:", reg);
    await navigator.serviceWorker.ready;
    let sub = await reg.pushManager.getSubscription();
    console.log("[notif] existing sub:", sub);
    if (!sub) {
      sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(import.meta.env.VITE_VAPID_PUBLIC_KEY),
      });
      console.log("[notif] new sub:", sub);
    }
    const headers = await getAuthHeader();
    const res = await fetch(`${ADMIN_API}/push/subscribe`, {
      method: "POST",
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify({ subscription: sub.toJSON() }),
    });
    const data = await res.json();
    console.log("[notif] subscribe result:", res.status, data);
  };

  // ── Load all markets from Supabase ──
  const loadMarkets = async () => {
    setMarketsLoading(true);
    const [
      { data: mData },
      { data: oData },
      { data: phData },
      { data: tData },
      { data: sdData },
    ] = await Promise.all([
      supabase.from("markets").select("*").order("created_at", { ascending: false }),
      supabase.from("orders").select("*"),
      supabase.from("price_history").select("*").order("ts", { ascending: true }),
      supabase.from("trades").select("*").order("ts", { ascending: false }),
      supabase.from("settled_debts").select("id"),
    ]);
    const assembled = (mData || []).map((m) => ({
      id: m.id, title: m.title, description: m.description, resolution: m.resolution,
      creator: m.creator_id, creatorName: m.creator_name,
      status: m.status, resolvedAs: m.resolved_as, resolvedNote: m.resolved_note,
      resolvedAt: m.resolved_at ? new Date(m.resolved_at).getTime() : null,
      createdAt: new Date(m.created_at).getTime(),
      hiddenFrom: m.hidden_from || [],
      orders: (oData || []).filter((o) => o.market_id === m.id).map((o) => ({
        id: o.id, side: o.side, price: o.price, size: parseFloat(o.size),
        userId: o.user_id, name: o.name,
      })),
      priceHistory: (phData || []).filter((p) => p.market_id === m.id).map((p) => ({ ts: p.ts, yes: p.yes })),
      trades: (tData || []).filter((t) => t.market_id === m.id).map((t) => ({
        price: t.price, side: t.side, buyer: t.buyer, seller: t.seller,
        size: parseFloat(t.size), ts: t.ts,
      })),
    }));
    const currentUserId = session?.user?.id;
    const visible = assembled.filter((m) =>
      !currentUserId || m.creator === currentUserId || !(m.hiddenFrom.includes(currentUserId))
    );
    setMarkets(visible);
    setSettled(new Set((sdData || []).map((s) => s.id)));
    setMarketsLoading(false);
  };

  useEffect(() => {
    if (!session) return;
    loadMarkets();
    loadNotifPrefs();
    // Re-register push subscription on every load if permission already granted
    if (typeof Notification !== "undefined" && Notification.permission === "granted") {
      initNotifications();
    }

    // Real-time subscriptions — reload on any change
    const channel = supabase
      .channel("market-changes")
      .on("postgres_changes", { event: "*", schema: "public", table: "markets" }, loadMarkets)
      .on("postgres_changes", { event: "*", schema: "public", table: "orders" }, loadMarkets)
      .on("postgres_changes", { event: "*", schema: "public", table: "price_history" }, loadMarkets)
      .on("postgres_changes", { event: "*", schema: "public", table: "trades" }, loadMarkets)
      .on("postgres_changes", { event: "*", schema: "public", table: "settled_debts" }, loadMarkets)
      .subscribe();

    return () => supabase.removeChannel(channel);
  }, [session]);

  const addMarket = async (m) => {
    // Insert market
    await supabase.from("markets").insert({
      id: m.id, title: m.title, description: m.description, resolution: m.resolution,
      creator_id: m.creator, creator_name: m.creatorName,
      status: "open", resolved_as: null, resolved_note: null,
      hidden_from: m.hiddenFrom || [],
    });
    // Insert initial orders
    if (m.orders.length > 0) {
      await supabase.from("orders").insert(m.orders.map((o) => ({
        id: o.id, market_id: m.id, side: o.side, price: o.price,
        size: o.size, user_id: o.userId, name: o.name,
      })));
    }
    // Insert initial price history
    if (m.priceHistory.length > 0) {
      await supabase.from("price_history").insert(m.priceHistory.map((p) => ({
        market_id: m.id, ts: p.ts, yes: p.yes,
      })));
    }
    setView("feed");
    sendNotif("new_market", { marketTitle: m.title, creatorName: m.creatorName, marketId: m.id, excludeUserIds: [m.creator] });
  };

  const updateMarket = async (updated) => {
    // Update market status/resolution
    await supabase.from("markets").update({
      status: updated.status, resolved_as: updated.resolvedAs, resolved_note: updated.resolvedNote,
      resolved_at: updated.resolvedAt ? new Date(updated.resolvedAt).toISOString() : null,
    }).eq("id", updated.id);
    // Sync orders: delete all, re-insert current set
    await supabase.from("orders").delete().eq("market_id", updated.id);
    if (updated.orders.length > 0) {
      await supabase.from("orders").insert(updated.orders.map((o) => ({
        id: o.id, market_id: updated.id, side: o.side, price: o.price,
        size: o.size, user_id: o.userId, name: o.name,
      })));
    }
    // Append new price history points (only ones not already in DB)
    const { data: existing } = await supabase
      .from("price_history").select("ts").eq("market_id", updated.id);
    const existingTs = new Set((existing || []).map((p) => p.ts));
    const newPoints = updated.priceHistory.filter((p) => !existingTs.has(p.ts));
    if (newPoints.length > 0) {
      await supabase.from("price_history").insert(newPoints.map((p) => ({
        market_id: updated.id, ts: p.ts, yes: p.yes,
      })));
    }
    // Append new trades
    const { data: existingTrades } = await supabase
      .from("trades").select("ts, buyer, seller").eq("market_id", updated.id);
    const existingTradeKeys = new Set((existingTrades || []).map((t) => `${t.ts}-${t.buyer}-${t.seller}`));
    const newTrades = updated.trades.filter((t) => !existingTradeKeys.has(`${t.ts}-${t.buyer}-${t.seller}`));
    if (newTrades.length > 0) {
      await supabase.from("trades").insert(newTrades.map((t) => ({
        market_id: updated.id, price: t.price, side: t.side,
        buyer: t.buyer, seller: t.seller, size: t.size, ts: t.ts,
      })));
    }
  };

  const markSettled = async (key) => {
    await supabase.from("settled_debts").insert({ id: key, settled_by: session.user.id });
  };

  const currentMarket = markets.find((m) => m.id === selectedId);

  // Build a user object compatible with the rest of the app
  const user = session && profile
    ? { id: session.user.id, name: profile.display_name, isSuperuser: profile.is_superuser }
    : null;

  // Loading state
  if (session === undefined) {
    return (
      <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: C.bg }}>
        <span style={{ color: C.muted, fontFamily: mono, fontSize: 13 }}>Loading…</span>
      </div>
    );
  }

  // Password reset flow — user clicked the link from admin
  if (isResetFlow) return <ResetPassword />;

  // Not logged in
  if (!session) return <AuthScreen />;

  // Logged in but profile still loading
  if (!profile) return (
    <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: C.bg }}>
      <span style={{ color: C.muted, fontFamily: mono, fontSize: 13 }}>Loading profile…</span>
    </div>
  );

  return (
    <div style={{ minHeight: "100vh", background: C.bg, fontFamily: mono, fontSize: 13, color: C.text, maxWidth: 520, margin: "0 auto" }}>
      <Header user={user} onLogout={handleLogout}
        onHome={() => setView("feed")} onNew={() => setView("create")}
        onDebts={() => setView("debts")} onAdmin={() => setView("admin")}
        onAlerts={() => setView("alerts")}
        activeView={view} />
      <div style={{ paddingBottom: 80 }}>
        {view === "feed" && (
          marketsLoading
            ? (<div style={{ textAlign: "center", padding: "60px 24px", color: C.muted, fontFamily: mono, fontSize: 13 }}>Loading markets…</div>)
            : (<Feed markets={markets} onOpen={(m) => { setSelectedId(m.id); setView("detail"); }} />)
        )}
        {view === "create" && (
          <CreateMarket user={user} onAdd={addMarket} onCancel={() => setView("feed")} />
        )}
        {view === "detail" && currentMarket && (
          <MarketDetail market={currentMarket} user={user}
            onUpdate={updateMarket} onBack={() => setView("feed")} onNotify={sendNotif} />
        )}
        {view === "debts" && (
          <DebtsView markets={markets} user={user} settled={settled} onSettle={markSettled} />
        )}
        {view === "admin" && user.isSuperuser && (
          <AdminPanel session={session} />
        )}
        {view === "alerts" && (
          <NotificationSettings
            notifStatus={notifStatus}
            notifPrefs={notifPrefs}
            onInitNotifications={initNotifications}
            onPrefsChange={setNotifPrefs}
            getAuthHeader={getAuthHeader}
          />
        )}
      </div>
    </div>
  );
}

/* ─── AUTH SCREEN (login + signup) ───────────────────────────────── */
function AuthScreen() {
  const [mode, setMode]         = useState("login"); // "login" | "signup" | "forgot"
  const [name, setName]         = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm]   = useState("");
  const [msg, setMsg]           = useState({ text: "", isErr: false });
  const [loading, setLoading]   = useState(false);

  // Synthetic email — users never see this
  const syntheticEmail = (n) => `${n.trim().toLowerCase().replace(/\s+/g, ".")}@willdougirish.app`;

  const submit = async () => {
    if (!name.trim()) { setMsg({ text: "Name is required.", isErr: true }); return; }
    if (password.length < 6) { setMsg({ text: "Password must be at least 6 characters.", isErr: true }); return; }
    setLoading(true);
    setMsg({ text: "", isErr: false });

    const email = syntheticEmail(name);

    if (mode === "login") {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) setMsg({ text: "Wrong name or password.", isErr: true });

    } else if (mode === "signup") {
      if (password !== confirm) {
        setMsg({ text: "Passwords don't match.", isErr: true });
        setLoading(false);
        return;
      }
      const { error } = await supabase.auth.signUp({
        email, password,
        options: { data: { display_name: name.trim() } },
      });
      if (error) setMsg({ text: error.message, isErr: true });
      else setMsg({ text: "Account created! You can now sign in.", isErr: false });
    }

    setLoading(false);
  };

  return (
    <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: C.bg, padding: 24 }}>
      <div style={{ width: "100%", maxWidth: 340, fontFamily: mono }}>
        <div style={{ textAlign: "center", marginBottom: 32 }}>
          <div style={{ fontSize: 48, marginBottom: 8 }}>☘️</div>
          <h1 style={{ fontSize: 26, fontWeight: 800, color: C.gold, margin: 0, fontFamily: mono, letterSpacing: -1 }}>WillDougIrish</h1>
          <p style={{ color: C.muted, fontSize: 11, marginTop: 6, letterSpacing: 1 }}>PREDICTION MARKETS FOR SEATTLE DEGENS</p>
        </div>

        {mode === "forgot" ? (
          <>
            <p style={{ color: C.muted, fontSize: 13, lineHeight: 1.6, marginBottom: 20, textAlign: "center" }}>
              Password resets are handled by your group admin.<br />Ask them to generate a reset link for you.
            </p>
            <button onClick={() => setMode("login")}
              style={{ width: "100%", background: "transparent", color: C.muted, border: `1px solid ${C.border}`, borderRadius: 7, padding: "11px 0", fontWeight: 700, fontSize: 13, cursor: "pointer", fontFamily: mono }}>
              ← Back to sign in
            </button>
          </>
        ) : (
          <>
            <label style={labelStyle}>Name</label>
            <input style={inputStyle} placeholder="Will, Doug, Ciarán…"
              value={name} onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && submit()} autoFocus />
            <label style={labelStyle}>Password</label>
            <input style={inputStyle} type="password" placeholder="Min. 6 characters"
              value={password} onChange={(e) => setPassword(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && submit()} />
            {mode === "signup" && (
              <>
                <label style={labelStyle}>Confirm Password</label>
                <input style={inputStyle} type="password" placeholder="••••••••"
                  value={confirm} onChange={(e) => setConfirm(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && submit()} />
              </>
            )}

            {msg.text && <p style={{ color: msg.isErr ? C.no : C.yes, fontSize: 12, marginBottom: 12 }}>{msg.text}</p>}

            <button onClick={submit} disabled={loading}
              style={{ width: "100%", background: C.gold, color: "#000", border: "none", borderRadius: 7, padding: "12px 0", fontWeight: 800, fontSize: 13, cursor: loading ? "default" : "pointer", fontFamily: mono, opacity: loading ? 0.7 : 1, marginBottom: 12 }}>
              {loading ? "…" : mode === "login" ? "Enter ☘️" : "Create account"}
            </button>

            <div style={{ display: "flex", justifyContent: "space-between" }}>
              <button onClick={() => { setMode(mode === "login" ? "signup" : "login"); setMsg({ text: "", isErr: false }); setConfirm(""); }}
                style={{ background: "transparent", border: "none", color: C.muted, fontSize: 12, cursor: "pointer", fontFamily: mono, padding: 0 }}>
                {mode === "login" ? "Create account" : "Sign in instead"}
              </button>
              {mode === "login" && (
                <button onClick={() => setMode("forgot")}
                  style={{ background: "transparent", border: "none", color: C.muted, fontSize: 12, cursor: "pointer", fontFamily: mono, padding: 0 }}>
                  Forgot password?
                </button>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

/* ─── RESET PASSWORD PAGE ─────────────────────────────────────────── */
function ResetPassword() {
  const [password, setPassword]   = useState("");
  const [confirm, setConfirm]     = useState("");
  const [msg, setMsg]             = useState({ text: "", isErr: false });
  const [loading, setLoading]     = useState(false);
  const [done, setDone]           = useState(false);

  const submit = async () => {
    if (password.length < 8) {
      setMsg({ text: "Password must be at least 8 characters.", isErr: true }); return;
    }
    if (password !== confirm) {
      setMsg({ text: "Passwords don't match.", isErr: true }); return;
    }
    setLoading(true);
    const { error } = await supabase.auth.updateUser({ password });
    if (error) { setMsg({ text: error.message, isErr: true }); setLoading(false); return; }
    setDone(true);
    window.history.replaceState(null, "", window.location.pathname);
  };

  return (
    <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: C.bg, padding: 24 }}>
      <div style={{ width: "100%", maxWidth: 340, fontFamily: mono }}>
        <div style={{ textAlign: "center", marginBottom: 32 }}>
          <div style={{ fontSize: 48, marginBottom: 8 }}>☘️</div>
          <h1 style={{ fontSize: 22, fontWeight: 800, color: C.gold, margin: 0 }}>Set new password</h1>
        </div>
        {done ? (
          <div style={{ textAlign: "center" }}>
            <div style={{ fontSize: 36, marginBottom: 12 }}>✓</div>
            <p style={{ color: C.yes, fontSize: 13, marginBottom: 24 }}>Password updated.</p>
            <button onClick={async () => { await supabase.auth.signOut(); window.location.href = "/"; }}
              style={{ width: "100%", background: C.gold, color: "#000", border: "none", borderRadius: 7, padding: "12px 0", fontWeight: 800, fontSize: 13, cursor: "pointer", fontFamily: mono }}>
              Sign in ☘️
            </button>
          </div>
        ) : (
          <>
            <label style={labelStyle}>New password</label>
            <input style={inputStyle} type="password" placeholder="Min. 8 characters"
              value={password} onChange={(e) => setPassword(e.target.value)} />
            <label style={labelStyle}>Confirm password</label>
            <input style={inputStyle} type="password" placeholder="••••••••"
              value={confirm} onChange={(e) => setConfirm(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && submit()} />
            {msg.text && <p style={{ color: msg.isErr ? C.no : C.yes, fontSize: 12, marginBottom: 12 }}>{msg.text}</p>}
            <button onClick={submit} disabled={loading}
              style={{ width: "100%", background: C.gold, color: "#000", border: "none", borderRadius: 7, padding: "12px 0", fontWeight: 800, fontSize: 13, cursor: loading ? "default" : "pointer", fontFamily: mono }}>
              {loading ? "Saving…" : "Update password"}
            </button>
          </>
        )}
      </div>
    </div>
  );
}

/* ─── ADMIN PANEL ─────────────────────────────────────────────────── */
function AdminPanel({ session }) {
  const [users, setUsers]         = useState([]);
  const [loading, setLoading]     = useState(true);
  const [err, setErr]             = useState("");
  const [resetLinks, setResetLinks] = useState({}); // userId → link
  const [copied, setCopied]       = useState(null);
  const [confirmDelete, setConfirmDelete] = useState(null);
  const [adminTab, setAdminTab]           = useState("users"); // "users" | "markets"
  const [adminMarkets, setAdminMarkets]   = useState([]);
  const [marketsLoading, setMarketsLoading] = useState(false);
  const [confirmDeleteMarket, setConfirmDeleteMarket] = useState(null);

  const getAuthHeader = async () => { const { data: { session: fresh } } = await supabase.auth.getSession(); return { Authorization: `Bearer ${fresh?.access_token}` }; };

  useEffect(() => { loadUsers(); loadAdminMarkets(); }, []);

  const loadAdminMarkets = async () => {
    setMarketsLoading(true);
    try {
      const { data, error } = await supabase
        .from("markets")
        .select("id, title, creator_name, status, hidden_from")
        .order("created_at", { ascending: false });
      if (error) throw error;
      setAdminMarkets(data || []);
    } catch (e) {
      setErr(e.message);
    } finally {
      setMarketsLoading(false);
    }
  };

  const deleteMarket = async (marketId) => {
    try {
      const res  = await fetch(`${ADMIN_API}/admin/delete-market`, {
        method: "POST", headers: { ...(await getAuthHeader()), "Content-Type": "application/json" },
        body: JSON.stringify({ marketId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setAdminMarkets((m) => m.filter((x) => x.id !== marketId));
      setConfirmDeleteMarket(null);
    } catch (e) {
      setErr(e.message);
    }
  };

  const loadUsers = async () => {
    setLoading(true);
    try {
      const res  = await fetch(`${ADMIN_API}/admin/users`, { headers: await getAuthHeader() });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setUsers(data.users);
    } catch (e) {
      setErr(e.message);
    } finally {
      setLoading(false);
    }
  };

  const generateResetLink = async (userId) => {
    try {
      const res  = await fetch(`${ADMIN_API}/admin/reset-link`, {
        method: "POST", headers: { ...(await getAuthHeader()), "Content-Type": "application/json" },
        body: JSON.stringify({ userId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setResetLinks((r) => ({ ...r, [userId]: data.link }));
    } catch (e) {
      setErr(e.message);
    }
  };

  const copyLink = (userId) => {
    const text = resetLinks[userId];
    if (navigator.clipboard && window.isSecureContext) {
      navigator.clipboard.writeText(text);
    } else {
      // Fallback for HTTP
      const el = document.createElement('textarea');
      el.value = text;
      el.style.position = 'fixed';
      el.style.opacity = '0';
      document.body.appendChild(el);
      el.focus();
      el.select();
      document.execCommand('copy');
      document.body.removeChild(el);
    }
    setCopied(userId);
    setTimeout(() => setCopied(null), 2000);
  };

  const deleteUser = async (userId) => {
    try {
      const res  = await fetch(`${ADMIN_API}/admin/delete-user`, {
        method: "POST", headers: { ...(await getAuthHeader()), "Content-Type": "application/json" },
        body: JSON.stringify({ userId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setUsers((u) => u.filter((u) => u.id !== userId));
      setConfirmDelete(null);
    } catch (e) {
      setErr(e.message);
    }
  };

  const fmtDate = (d) => d ? new Date(d).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "—";

  return (
    <div style={{ padding: 16 }}>
      {/* Admin tabs */}
      <div style={{ display: "flex", gap: 8, marginBottom: 20 }}>
        {["users", "markets"].map((t) => (
          <button key={t} onClick={() => setAdminTab(t)}
            style={{ flex: 1, background: adminTab === t ? C.gold : "transparent", color: adminTab === t ? "#000" : C.muted, border: `1px solid ${adminTab === t ? C.gold : C.border}`, borderRadius: 7, padding: "8px 0", fontSize: 11, fontWeight: 700, cursor: "pointer", fontFamily: mono, letterSpacing: 0.8, textTransform: "uppercase" }}>
            {t}
          </button>
        ))}
      </div>

      {adminTab === "markets" && (
        <div>
          {marketsLoading && <p style={{ color: C.muted, fontSize: 13 }}>Loading markets…</p>}
          {adminMarkets.length === 0 && !marketsLoading && (
            <p style={{ color: C.muted, fontSize: 12, textAlign: "center", padding: "40px 0" }}>No markets yet.</p>
          )}
          {adminMarkets.map((m) => {
            const isHiddenFromMe = (m.hidden_from || []).includes(session.user.id);
            return (
            <div key={m.id} style={{ background: C.surface, border: `1px solid ${isHiddenFromMe ? C.border : C.border}`, borderRadius: 10, padding: "14px 16px", marginBottom: 10, opacity: isHiddenFromMe ? 0.7 : 1 }}>
              {confirmDeleteMarket === m.id && (
                <div style={{ background: C.noDim, border: `1px solid ${C.no}44`, borderRadius: 8, padding: "12px 14px", marginBottom: 12 }}>
                  <p style={{ color: C.text, fontSize: 13, margin: "0 0 10px" }}>
                    {isHiddenFromMe ? "Delete this hidden market? This removes all orders, trades and history." : <>Delete <strong>{m.title}</strong>? This removes all orders, trades and history.</>}
                  </p>
                  <div style={{ display: "flex", gap: 8 }}>
                    <button onClick={() => setConfirmDeleteMarket(null)}
                      style={{ flex: 1, background: "transparent", color: C.muted, border: `1px solid ${C.border}`, borderRadius: 6, padding: "7px 0", fontSize: 12, cursor: "pointer", fontFamily: mono }}>
                      Cancel
                    </button>
                    <button onClick={() => deleteMarket(m.id)}
                      style={{ flex: 1, background: C.no, color: "#fff", border: "none", borderRadius: 6, padding: "7px 0", fontSize: 12, fontWeight: 700, cursor: "pointer", fontFamily: mono }}>
                      Delete
                    </button>
                  </div>
                </div>
              )}
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  {isHiddenFromMe ? (
                    <>
                      <div style={{ fontWeight: 700, color: C.muted, fontSize: 13, marginBottom: 3, fontStyle: "italic" }}>🙈 Hidden Market</div>
                      <div style={{ color: C.muted, fontSize: 11 }}>details hidden from you</div>
                    </>
                  ) : (
                    <>
                      <div style={{ fontWeight: 700, color: C.text, fontSize: 13, marginBottom: 3 }}>{m.title}</div>
                      <div style={{ color: C.muted, fontSize: 11 }}>by {m.creator_name} · {m.status === "resolved" ? <span style={{ color: C.yes }}>resolved</span> : <span style={{ color: C.gold }}>open</span>}</div>
                    </>
                  )}
                </div>
                {confirmDeleteMarket !== m.id && (
                  <button onClick={() => setConfirmDeleteMarket(m.id)}
                    style={{ background: "transparent", color: C.muted, border: `1px solid ${C.border}`, borderRadius: 6, padding: "5px 10px", fontSize: 11, cursor: "pointer", fontFamily: mono, flexShrink: 0, marginLeft: 12 }}>
                    Delete
                  </button>
                )}
              </div>
            </div>
            );
          })}
        </div>
      )}

      {adminTab === "users" && (
        <>
        {err && (
        <div style={{ background: C.noDim, border: `1px solid ${C.no}44`, borderRadius: 8, padding: "10px 14px", marginBottom: 16, fontSize: 12, color: C.no }}>
          {err} — is the admin server running?
        </div>
      )}

      {loading ? (
        <p style={{ color: C.muted, fontSize: 13 }}>Loading users…</p>
      ) : (
        <div>
          {users.map((u) => (
            <div key={u.id} style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 10, padding: "14px 16px", marginBottom: 10 }}>

              {/* Confirm delete overlay */}
              {confirmDelete === u.id && (
                <div style={{ background: C.noDim, border: `1px solid ${C.no}44`, borderRadius: 8, padding: "12px 14px", marginBottom: 12 }}>
                  <p style={{ color: C.text, fontSize: 13, margin: "0 0 10px" }}>Remove <strong>{u.display_name}</strong>? This cannot be undone.</p>
                  <div style={{ display: "flex", gap: 8 }}>
                    <button onClick={() => setConfirmDelete(null)}
                      style={{ flex: 1, background: "transparent", color: C.muted, border: `1px solid ${C.border}`, borderRadius: 6, padding: "7px 0", fontSize: 12, cursor: "pointer", fontFamily: mono }}>
                      Cancel
                    </button>
                    <button onClick={() => deleteUser(u.id)}
                      style={{ flex: 1, background: C.no, color: "#fff", border: "none", borderRadius: 6, padding: "7px 0", fontSize: 12, fontWeight: 700, cursor: "pointer", fontFamily: mono }}>
                      Remove
                    </button>
                  </div>
                </div>
              )}

              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 3 }}>
                    <span style={{ fontWeight: 700, color: C.text, fontSize: 14 }}>{u.display_name}</span>
                    {u.is_superuser && (
                      <span style={{ background: C.gold + "22", color: C.gold, border: `1px solid ${C.gold}44`, borderRadius: 4, padding: "1px 6px", fontSize: 10, fontWeight: 700 }}>ADMIN</span>
                    )}
                  </div>
                  <div style={{ color: C.muted, fontSize: 11 }}>{u.email}</div>
                  <div style={{ color: C.muted, fontSize: 10, marginTop: 3 }}>
                    Joined {fmtDate(u.created_at)} · Last seen {fmtDate(u.last_sign_in)}
                  </div>
                </div>
                {!u.is_superuser && confirmDelete !== u.id && (
                  <button onClick={() => setConfirmDelete(u.id)}
                    style={{ background: "transparent", color: C.muted, border: `1px solid ${C.border}`, borderRadius: 6, padding: "5px 10px", fontSize: 11, cursor: "pointer", fontFamily: mono, flexShrink: 0 }}>
                    Remove
                  </button>
                )}
              </div>

              {/* Reset link section */}
              {!u.is_superuser && (
                <div style={{ marginTop: 12 }}>
                  {resetLinks[u.id] ? (
                    <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                      <input readOnly value={resetLinks[u.id]}
                        style={{ ...inputStyle, flex: 1, fontSize: 10, padding: "7px 10px", marginBottom: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: C.muted }} />
                      <button onClick={() => copyLink(u.id)}
                        style={{ background: copied === u.id ? C.yes : C.gold, color: "#000", border: "none", borderRadius: 6, padding: "7px 14px", fontWeight: 700, fontSize: 12, cursor: "pointer", fontFamily: mono, flexShrink: 0 }}>
                        {copied === u.id ? "Copied ✓" : "Copy"}
                      </button>
                    </div>
                  ) : (
                    <button onClick={() => generateResetLink(u.id)}
                      style={{ background: "transparent", color: C.gold, border: `1px solid ${C.gold}55`, borderRadius: 6, padding: "7px 14px", fontSize: 12, fontWeight: 700, cursor: "pointer", fontFamily: mono }}>
                      Generate reset link
                    </button>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
        </>
      )}
    </div>
  );
}

/* ─── HEADER ─────────────────────────────────────────────────────── */
function Header({ user, onLogout, onHome, onNew, onDebts, onAdmin, onAlerts, activeView }) {
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


/* ─── FEED ───────────────────────────────────────────────────────── */
function Feed({ markets, onOpen }) {
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
  const mid = bestBid && bestAsk ? Math.round((bestBid + bestAsk) / 2) : bestBid || bestAsk || 50;
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
                <div style={{ fontSize: 11, color: delta >= 0 ? C.yes : C.no, marginTop: 2 }}>{delta >= 0 ? "▲" : "▼"} {Math.abs(delta)}pp</div>
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
function MarketDetail({ market, user, onUpdate, onBack, onNotify }) {
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
            const spanMs  = Date.now() - startTs;
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

/* ─── DEBTS VIEW ─────────────────────────────────────────────────── */
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
      if (Math.abs(net) < 0.005) continue;
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

function DebtsView({ markets, user, settled, onSettle }) {
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

/* ─── CREATE MARKET ──────────────────────────────────────────────── */
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

/* ─── NOTIFICATION SETTINGS ──────────────────────────────────────── */
const PREF_LABELS = {
  new_signup:          "New user signs up",
  new_market:          "New market created",
  any_fill:            "Any trade executed",
  your_market_order:   "Order placed in your markets",
  market_resolved:     "Your market is resolved",
  any_market_resolved: "Any market is resolved",
  own_fill:            "Your resting order is filled",
};

function NotificationSettings({ notifStatus, notifPrefs, onInitNotifications, onPrefsChange, getAuthHeader }) {
  const [saving, setSaving]         = useState(false);
  const [installPrompt, setInstallPrompt] = useState(null);

  const isIOS        = /iPhone|iPad|iPod/.test(navigator.userAgent);
  const isStandalone = window.navigator.standalone === true || window.matchMedia("(display-mode: standalone)").matches;

  useEffect(() => {
    const handler = (e) => { e.preventDefault(); setInstallPrompt(e); };
    window.addEventListener("beforeinstallprompt", handler);
    return () => window.removeEventListener("beforeinstallprompt", handler);
  }, []);

  const isSupported = typeof window !== "undefined" && "serviceWorker" in navigator && "PushManager" in window;
  const isGranted   = notifStatus === "granted";
  const isDenied    = notifStatus === "denied";

  const toggle = async (key) => {
    const newPrefs = { ...notifPrefs, [key]: !notifPrefs[key] };
    onPrefsChange(newPrefs);
    setSaving(true);
    try {
      const headers = await getAuthHeader();
      await fetch(`${ADMIN_API}/push/preferences`, {
        method: "POST",
        headers: { ...headers, "Content-Type": "application/json" },
        body: JSON.stringify({ preferences: newPrefs }),
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div style={{ padding: 16 }}>
      <div style={{ color: C.muted, fontSize: 10, letterSpacing: 1.5, textTransform: "uppercase", paddingBottom: 12, borderBottom: `1px solid ${C.border}`, marginBottom: 20 }}>
        Notifications
      </div>

      {/* iOS: show install instructions if not already installed */}
      {isIOS && !isStandalone && (
        <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 10, padding: 16, marginBottom: 20 }}>
          <p style={{ color: C.text, fontSize: 13, fontWeight: 700, margin: "0 0 6px" }}>Install on your iPhone</p>
          <p style={{ color: C.muted, fontSize: 12, lineHeight: 1.7, margin: "0 0 10px" }}>
            Push notifications on iOS require the app to be installed. Open in Safari, then:
          </p>
          <div style={{ color: C.muted, fontSize: 12, lineHeight: 2 }}>
            <div>1. Tap the <strong style={{ color: C.text }}>Share</strong> button <span style={{ fontSize: 14 }}>⎋</span> at the bottom</div>
            <div>2. Tap <strong style={{ color: C.text }}>"Add to Home Screen"</strong></div>
            <div>3. Open the app from your home screen</div>
          </div>
        </div>
      )}

      {/* Chrome/Android/Desktop: native install prompt */}
      {!isIOS && !isStandalone && installPrompt && (
        <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 10, padding: 16, marginBottom: 20, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div>
            <p style={{ color: C.text, fontSize: 13, fontWeight: 700, margin: "0 0 2px" }}>Install app</p>
            <p style={{ color: C.muted, fontSize: 12, margin: 0 }}>Get notifications even when the tab is closed</p>
          </div>
          <button onClick={() => { installPrompt.prompt(); setInstallPrompt(null); }}
            style={{ background: C.gold, color: "#000", border: "none", borderRadius: 7, padding: "8px 14px", fontWeight: 800, fontSize: 12, cursor: "pointer", fontFamily: mono, flexShrink: 0, marginLeft: 12 }}>
            Install
          </button>
        </div>
      )}

      {!isSupported && (
        <div style={{ background: C.dim, border: `1px solid ${C.border}`, borderRadius: 8, padding: "12px 14px", fontSize: 12, color: C.muted }}>
          Push notifications aren't supported in this browser.
        </div>
      )}

      {isSupported && !isGranted && (
        <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 10, padding: 20, marginBottom: 20 }}>
          <p style={{ color: C.text, fontSize: 14, fontWeight: 700, margin: "0 0 6px" }}>Stay in the loop</p>
          <p style={{ color: C.muted, fontSize: 12, lineHeight: 1.6, margin: "0 0 16px" }}>
            Get notified when new markets open, orders fill, and more.
          </p>
          {isDenied ? (
            <>
              <div style={{ background: C.noDim, border: `1px solid ${C.no}44`, borderRadius: 7, padding: "10px 14px", fontSize: 12, color: C.muted }}>
                Notifications are blocked. Allow them in your browser settings for this site, then revisit this page.
              </div>
            </>
          ) : (
            <button onClick={onInitNotifications}
              style={{ background: C.gold, color: "#000", border: "none", borderRadius: 7, padding: "10px 18px", fontWeight: 800, fontSize: 13, cursor: "pointer", fontFamily: mono }}>
              Enable notifications
            </button>
          )}
        </div>
      )}

      {isGranted && (
        <>
          <p style={{ color: C.muted, fontSize: 12, marginBottom: 20 }}>
            Notifications are on.{saving && " Saving…"}
          </p>
          {Object.entries(PREF_LABELS).map(([key, label]) => {
            const on = notifPrefs?.[key] ?? false;
            return (
              <div key={key} onClick={() => toggle(key)}
                style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "13px 14px", background: C.surface, border: `1px solid ${C.border}`, borderRadius: 8, marginBottom: 8, cursor: "pointer" }}>
                <span style={{ fontSize: 13, color: C.text }}>{label}</span>
                <div style={{ width: 38, height: 22, borderRadius: 11, background: on ? C.yes : C.dim, position: "relative", transition: "background 0.2s", flexShrink: 0 }}>
                  <div style={{ position: "absolute", top: 4, left: on ? 20 : 4, width: 14, height: 14, borderRadius: "50%", background: "#fff", transition: "left 0.2s" }} />
                </div>
              </div>
            );
          })}
        </>
      )}
    </div>
  );
}

function CreateMarket({ user, onAdd, onCancel }) {
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
      priceHistory: generatePriceHistory(mid, 5, now),
      orders: [
        { id: uid(), side: "buy",  price: bid,  size: parseFloat(s.toFixed(2)), userId: user.id, name: user.name },
        { id: uid(), side: "sell", price: ask, size: parseFloat(s.toFixed(2)), userId: user.id, name: user.name },
      ],
      trades: [],
    });
  };

  // Slider range is 6–94 (span of 88). Convert a value to % position on track.
  const tp = (v) => `${((v - 6) / 88) * 100}%`;
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
        <div style={{ position: "relative", marginBottom: 6 }}>
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
          <span>50¢</span>
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
            You post ${parseNum(size) >= 5 ? parseFloat(parseNum(size).toFixed(2)) : "—"} on Buy YES @ {cents(bid)} and ${parseNum(size) >= 5 ? parseFloat(parseNum(size).toFixed(2)) : "—"} on Sell YES @ {cents(ask)}. Settlement off-platform. 🤝
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