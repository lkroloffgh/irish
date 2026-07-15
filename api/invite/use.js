import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_ROLE;

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const { code } = req.body;
  if (!code) return res.status(400).json({ error: "code required" });

  const admin = createClient(SUPABASE_URL, SERVICE_KEY);
  const now   = new Date().toISOString();

  // Atomically mark as used — only matches if unused AND not expired
  const { data, error } = await admin
    .from("invitations")
    .update({ used_at: now })
    .eq("code", code)
    .is("used_at", null)
    .gt("expires_at", now)
    .select("id")
    .single();

  if (error || !data) {
    return res.status(400).json({ error: "This invite link is invalid or has expired." });
  }

  return res.status(200).json({ ok: true });
}
