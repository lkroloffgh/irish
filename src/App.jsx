import { useState, useEffect } from "react";
import { supabase } from "./lib/supabase.js";
import { C, mono } from "./lib/constants.js";
import { useNotifications } from "./hooks/useNotifications.js";
import { useMarkets } from "./hooks/useMarkets.js";
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
  const [view, setView]         = useState("feed");
  const [selectedId, setSelectedId] = useState(null);
  const [isResetFlow, setIsResetFlow] = useState(false);
  useEffect(() => { window.scrollTo(0, 0); }, [view]);

  const {
    notifStatus, notifPrefs, setNotifPrefs,
    getAuthHeader, sendNotif, loadNotifPrefs, initNotifications,
  } = useNotifications();

  const { markets, marketsLoading, settled, addMarket, updateMarket, markSettled } =
    useMarkets(session, sendNotif);

  // ── Auth ──
  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      if (session) fetchProfile(session.user.id);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === "PASSWORD_RECOVERY") { setIsResetFlow(true); setSession(session); return; }
      setSession(session);
      if (session) {
        fetchProfile(session.user.id);
        // Detect new signup: created_at ≈ last_sign_in_at (within 10s).
        // Guard with localStorage so the notification fires at most once per user,
        // even if onAuthStateChange fires SIGNED_IN multiple times (token refresh,
        // page reload within the window, email-confirm redirect, etc.).
        if (event === "SIGNED_IN" && session.user.created_at && session.user.last_sign_in_at) {
          const diff = Math.abs(new Date(session.user.last_sign_in_at) - new Date(session.user.created_at));
          const key = `signup_notif_sent_${session.user.id}`;
          if (diff < 10000 && !localStorage.getItem(key)) {
            localStorage.setItem(key, "1");
            setTimeout(() => sendNotif("new_signup", { userName: session.user.user_metadata?.display_name || "Someone", excludeUserIds: [session.user.id] }), 3000);
          }
        }
      } else {
        setProfile(null);
      }
    });

    return () => subscription.unsubscribe();
  }, []);

  // ── Notification setup on login ──
  useEffect(() => {
    if (!session) return;
    loadNotifPrefs();
    if (typeof Notification !== "undefined" && Notification.permission === "granted") {
      initNotifications();
    }
  }, [session]);

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

  const currentMarket = markets.find((m) => m.id === selectedId);
  const user = session && profile
    ? { id: session.user.id, name: profile.display_name, isSuperuser: profile.is_superuser }
    : null;

  if (session === undefined) return (
    <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: C.bg }}>
      <span style={{ color: C.muted, fontFamily: mono, fontSize: 13 }}>Loading…</span>
    </div>
  );

  if (isResetFlow) return <ResetPassword />;
  if (!session) return <AuthScreen />;

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
            ? <div style={{ textAlign: "center", padding: "60px 24px", color: C.muted, fontFamily: mono, fontSize: 13 }}>Loading markets…</div>
            : <Feed markets={markets} onOpen={(m) => { setSelectedId(m.id); setView("detail"); }} />
        )}
        {view === "create" && (
          <CreateMarket user={user} onAdd={async (m) => { await addMarket(m); setView("feed"); }} onCancel={() => setView("feed")} />
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
