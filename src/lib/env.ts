export const env = {
  supabaseUrl: import.meta.env.VITE_SUPABASE_URL as string | undefined,
  supabaseAnonKey: import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined,
  sentryDsn: import.meta.env.VITE_SENTRY_DSN as string | undefined,
  clientLogEndpoint: import.meta.env.VITE_CLIENT_LOG_ENDPOINT as string | undefined,
};

export const hasSupabaseConfig = Boolean(env.supabaseUrl && env.supabaseAnonKey);

