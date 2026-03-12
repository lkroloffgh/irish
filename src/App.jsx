import { useState, useEffect } from "react";
import { supabase, ADMIN_API } from "./lib/supabase.js";
import { C, mono } from "./lib/constants.js";
import { parseNum, urlBase64ToUint8Array, generatePriceHistory } from "./lib/helpers.js";
import { AuthScreen, ResetPassword } from "./components/Auth.jsx";
import { Header } from "./components/Header.jsx";
import { Feed } from "./components/Feed.jsx";
import { MarketDetail } from "./components/MarketDetail.jsx";
import { CreateMarket } from "./components/CreateMarket.jsx";
import { DebtsView } from "./components/DebtsView.jsx";
import { AdminPanel } from "./components/AdminPanel.jsx";
import { NotificationSettings } from "./components/NotificationSettings.jsx";

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
  useEffect(() => { window.scrollTo(0, 0); }, [view]);
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
    await supabase.from("markets").insert({
      id: m.id, title: m.title, description: m.description, resolution: m.resolution,
      creator_id: m.creator, creator_name: m.creatorName,
      status: "open", resolved_as: null, resolved_note: null,
      hidden_from: m.hiddenFrom || [],
    });
    if (m.orders.length > 0) {
      await supabase.from("orders").insert(m.orders.map((o) => ({
        id: o.id, market_id: m.id, side: o.side, price: o.price,
        size: o.size, user_id: o.userId, name: o.name,
      })));
    }
    if (m.priceHistory.length > 0) {
      await supabase.from("price_history").insert(m.priceHistory.map((p) => ({
        market_id: m.id, ts: p.ts, yes: p.yes,
      })));
    }
    setView("feed");
    sendNotif("new_market", { marketTitle: m.title, creatorName: m.creatorName, marketId: m.id, excludeUserIds: [m.creator] });
  };

  const updateMarket = async (updated) => {
    await supabase.from("markets").update({
      status: updated.status, resolved_as: updated.resolvedAs, resolved_note: updated.resolvedNote,
      resolved_at: updated.resolvedAt ? new Date(updated.resolvedAt).toISOString() : null,
    }).eq("id", updated.id);
    await supabase.from("orders").delete().eq("market_id", updated.id);
    if (updated.orders.length > 0) {
      await supabase.from("orders").insert(updated.orders.map((o) => ({
        id: o.id, market_id: updated.id, side: o.side, price: o.price,
        size: o.size, user_id: o.userId, name: o.name,
      })));
    }
    const { data: existing } = await supabase
      .from("price_history").select("ts").eq("market_id", updated.id);
    const existingTs = new Set((existing || []).map((p) => p.ts));
    const newPoints = updated.priceHistory.filter((p) => !existingTs.has(p.ts));
    if (newPoints.length > 0) {
      await supabase.from("price_history").insert(newPoints.map((p) => ({
        market_id: updated.id, ts: p.ts, yes: p.yes,
      })));
    }
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
