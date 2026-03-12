import { verifyUser } from "../_utils.js";

export default async function handler(req, res) {
  const result = await verifyUser(req);
  if (!result) return res.status(401).json({ error: "Unauthorized" });
  const { user, admin } = result;

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
