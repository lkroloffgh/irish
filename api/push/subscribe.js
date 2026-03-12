import { verifyUser } from "../_utils.js";

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const result = await verifyUser(req);
  if (!result) return res.status(401).json({ error: "Unauthorized" });
  const { user, admin } = result;

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
