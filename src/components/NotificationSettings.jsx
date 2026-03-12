import { useState, useEffect } from "react";
import { ADMIN_API } from "../lib/supabase.js";
import { C, mono } from "../lib/constants.js";

const PREF_LABELS = {
  new_signup:          "New user signs up",
  new_market:          "New market created",
  any_fill:            "Any trade executed",
  your_market_order:   "Order placed in your markets",
  market_resolved:     "Your market is resolved",
  any_market_resolved: "Any market is resolved",
  own_fill:            "Your resting order is filled",
};

/* ─── NOTIFICATION SETTINGS ──────────────────────────────────────── */
export function NotificationSettings({ notifStatus, notifPrefs, onInitNotifications, onPrefsChange, getAuthHeader }) {
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
  // Also read Notification.permission live — React state can be stale if permission changed outside React
  const livePermission = typeof Notification !== "undefined" ? Notification.permission : "default";
  const isGranted   = notifStatus === "granted" || livePermission === "granted";
  const isDenied    = !isGranted && (notifStatus === "denied" || livePermission === "denied");

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
