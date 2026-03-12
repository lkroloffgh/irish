import { useState, useEffect } from "react";
import { supabase, ADMIN_API } from "../lib/supabase.js";
import { C, mono, inputStyle } from "../lib/constants.js";

/* ─── ADMIN PANEL ─────────────────────────────────────────────────── */
export function AdminPanel({ session }) {
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

      {err && (
        <div style={{ background: C.noDim, border: `1px solid ${C.no}44`, borderRadius: 8, padding: "10px 14px", marginBottom: 16, fontSize: 12, color: C.no }}>
          {err}
        </div>
      )}

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
