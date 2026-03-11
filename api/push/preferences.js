import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_ROLE;

export default async function handler(req, res) {
  const token = req.headers.authorization?.split(" ")[1];
  if (!token) return res.status(401).json({ error: "Unauthorized" });

  const admin = createClient(SUPABASE_URL, SERVICE_KEY);
  const { data: { user }, error: authErr } = await admin.auth.getUser(token);
  if (authErr || !user) return res.status(401).json({ error: "Unauthorized" });

  if (req.method === "GET") {
    const { data, error } = await admin
      .from("notification_preferences")
      .select("*")
      .eq("user_id", user.id)
      .single();
    if (error && error.code !== "PGRST116") return res.status(500).json({ error: error.message });
    return res.status(200).json({ preferences: data || null });
  }

  if (req.method === "POST") {
    const { preferences } = req.body;
    if (!preferences) return res.status(400).json({ error: "preferences required" });

    const allowed = ["new_signup", "new_market", "any_fill", "your_market_order", "market_resolved", "any_market_resolved", "own_fill"];
    const filtered = {};
    for (const key of allowed) {
      if (typeof preferences[key] === "boolean") filtered[key] = preferences[key];
    }

    const { error } = await admin.from("notification_preferences").upsert({
      user_id: user.id,
      ...filtered,
    }, { onConflict: "user_id" });

    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json({ success: true });
  }

  return res.status(405).json({ error: "Method not allowed" });
}
