/**
 * Browser-safe Supabase client (anon key). Used from Client Components and API routes in this app.
 * Throws at module load if public env vars are missing so misconfiguration fails fast.
 */
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error(
    "Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY."
  );
}

// Client-side Supabase client for Next.js (App Router or Pages Router).
export const supabase = createClient(supabaseUrl, supabaseAnonKey);
