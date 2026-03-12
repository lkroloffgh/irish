import { createClient } from "@supabase/supabase-js";
import { verifyAdmin } from "../_utils.js";

const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE;

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const token = req.headers.authorization?.split(" ")[1];
  if (!await verifyAdmin(token)) return res.status(403).json({ error: "Forbidden" });

  const { marketId } = req.body;
  if (!marketId) return res.status(400).json({ error: "marketId required" });

  const admin = createClient(SUPABASE_URL, SERVICE_KEY);

  // Cascade delete related records then the market
  await admin.from("trades").delete().eq("market_id", marketId);
  await admin.from("orders").delete().eq("market_id", marketId);
  await admin.from("price_history").delete().eq("market_id", marketId);
  const { error } = await admin.from("markets").delete().eq("id", marketId);
  if (error) return res.status(500).json({ error: error.message });

  return res.status(200).json({ success: true });
}
