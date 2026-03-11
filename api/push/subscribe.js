import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL  = process.env.VITE_SUPABASE_URL;
const SERVICE_KEY   = process.env.SUPABASE_SERVICE_ROLE;

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const token = req.headers.authorization?.split(" ")[1];
  if (!token) return res.status(401).json({ error: "Unauthorized" });

  const admin = createClient(SUPABASE_URL, SERVICE_KEY);
  const { data: { user }, error: authErr } = await admin.auth.getUser(token);
  if (authErr || !user) return res.status(401).json({ error: "Unauthorized" });

  const { subscription } = req.body;
  if (!subscription?.endpoint) return res.status(400).json({ error: "subscription required" });

  const { error } = await admin.from("push_subscriptions").upsert({
    user_id: user.id,
    subscription,
    updated_at: new Date().toISOString(),
  }, { onConflict: "user_id" });

  if (error) return res.status(500).json({ error: error.message });

  // Ensure a preferences row exists with defaults — ignoreDuplicates so we don't overwrite custom settings
  await admin.from("notification_preferences").upsert(
    { user_id: user.id },
    { onConflict: "user_id", ignoreDuplicates: true }
  );

  return res.status(200).json({ success: true });
}
