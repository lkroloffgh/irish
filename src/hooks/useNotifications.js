import { useState } from "react";
import { supabase, ADMIN_API } from "../lib/supabase.js";
import { urlBase64ToUint8Array } from "../lib/helpers.js";

/* ─── useNotifications ───────────────────────────────────────────── */
export function useNotifications() {
  const [notifStatus, setNotifStatus] = useState(
    () => (typeof Notification !== "undefined" ? Notification.permission : "default")
  );
  const [notifPrefs, setNotifPrefs] = useState({
    new_signup: false, new_market: true, any_fill: false,
    your_market_order: true, market_resolved: true, any_market_resolved: false, own_fill: true,
  });

  const getAuthHeader = async () => {
    const { data: { session } } = await supabase.auth.getSession();
    return session ? { Authorization: `Bearer ${session.access_token}` } : {};
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

  return { notifStatus, notifPrefs, setNotifPrefs, getAuthHeader, sendNotif, loadNotifPrefs, initNotifications };
}
