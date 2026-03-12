import { createClient } from "@supabase/supabase-js";

export const SUPABASE_URL  = import.meta.env.VITE_SUPABASE_URL;
export const SUPABASE_ANON = import.meta.env.VITE_SUPABASE_ANON;
export const ADMIN_API     = "/api";

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON);
