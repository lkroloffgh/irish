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
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

  const token = req.headers.authorization?.split(" ")[1];
  if (!await verifyAdmin(token)) return res.status(403).json({ error: "Forbidden" });

  const admin = createClient(SUPABASE_URL, SERVICE_KEY);
  const { data: { users }, error } = await admin.auth.admin.listUsers({ perPage: 1000 });
  if (error) return res.status(500).json({ error: error.message });

  const { data: profiles } = await admin.from("profiles").select("id, display_name, is_superuser");
  const profileMap = Object.fromEntries((profiles || []).map((p) => [p.id, p]));

  return res.status(200).json({
    users: users.map((u) => ({
      id: u.id,
      email: u.email,
      display_name: profileMap[u.id]?.display_name || u.email,
      is_superuser: profileMap[u.id]?.is_superuser || false,
      created_at: u.created_at,
      last_sign_in: u.last_sign_in_at,
    })),
  });
}
