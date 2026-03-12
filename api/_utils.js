import { createClient } from "@supabase/supabase-js";

function createAdminClient() {
  return createClient(process.env.VITE_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE);
}

// Returns the user object if token belongs to a superuser, else null
export async function verifyAdmin(token) {
  const admin = createAdminClient();
  const { data: { user }, error } = await admin.auth.getUser(token);
  if (error || !user) return null;
  const { data: profile } = await admin.from("profiles").select("is_superuser").eq("id", user.id).single();
  return profile?.is_superuser ? user : null;
}

// Returns { user, admin } for a valid user token, else null
export async function verifyUser(req) {
  const token = req.headers.authorization?.split(" ")[1];
  if (!token) return null;
  const admin = createAdminClient();
  const { data: { user }, error } = await admin.auth.getUser(token);
  if (error || !user) return null;
  return { user, admin };
}
