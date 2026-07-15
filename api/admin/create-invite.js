import { createClient } from "@supabase/supabase-js";
import { verifyAdmin } from "../_utils.js";

const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_ROLE;
const APP_URL      = process.env.APP_URL || "https://willdoug.irish";

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const token = req.headers.authorization?.split(" ")[1];
  const adminUser = await verifyAdmin(token);
  if (!adminUser) return res.status(403).json({ error: "Forbidden" });

  const admin      = createClient(SUPABASE_URL, SERVICE_KEY);
  const code       = crypto.randomUUID();
  const expires_at = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

  const { error } = await admin.from("invitations").insert({
    code,
    expires_at,
    created_by: adminUser.id,
  });

  if (error) return res.status(500).json({ error: error.message });

  return res.status(200).json({ link: `${APP_URL}/?invite=${code}`, expires_at });
}
