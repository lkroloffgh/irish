import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE;

async function verifyAdmin(token) {
  const admin = createClient(SUPABASE_URL, SERVICE_KEY);
  const { data: { user }, error } = await admin.auth.getUser(token);
  if (error || !user) return null;
  const { data: profile } = await admin.from("profiles").select("is_superuser").eq("id", user.id).single();
  return profile?.is_superuser ? user : null;
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const token = req.headers.authorization?.split(" ")[1];
  if (!await verifyAdmin(token)) return res.status(403).json({ error: "Forbidden" });

  const { userId } = req.body;
  if (!userId) return res.status(400).json({ error: "userId required" });

  const admin = createClient(SUPABASE_URL, SERVICE_KEY);
  const { data, error } = await admin.auth.admin.generateLink({
    type: "recovery",
    email: (await admin.auth.admin.getUserById(userId)).data.user.email,
  });
  if (error) return res.status(500).json({ error: error.message });

  return res.status(200).json({ link: data.properties.action_link });
}
