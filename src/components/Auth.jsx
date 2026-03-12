import { useState } from "react";
import { supabase } from "../lib/supabase.js";
import { C, mono, inputStyle, labelStyle } from "../lib/constants.js";

/* ─── AUTH SCREEN (login + signup) ───────────────────────────────── */
export function AuthScreen() {
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
export function ResetPassword() {
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
