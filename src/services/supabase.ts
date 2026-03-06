import { createClient } from "@supabase/supabase-js";
import { env, hasSupabaseConfig } from "@/lib/env";

const fallbackUrl = "http://localhost:54321";
const fallbackKey = "public-anon-key";

export const supabase = createClient(
  env.supabaseUrl ?? fallbackUrl,
  env.supabaseAnonKey ?? fallbackKey,
  {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
    },
    realtime: {
      params: {
        eventsPerSecond: 10,
      },
    },
  },
);

export { hasSupabaseConfig };

