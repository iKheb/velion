import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const normalizePhone = (raw: string): string => {
  const trimmed = raw.trim();
  if (!trimmed) return "";
  const hasPlus = trimmed.startsWith("+");
  const digits = trimmed.replace(/\D/g, "");
  if (!digits) return "";
  return hasPlus ? `+${digits}` : digits;
};

const findEmailByIdentifier = async (
  supabase: ReturnType<typeof createClient>,
  identifier: string,
): Promise<string | null> => {
  const value = identifier.trim();
  if (!value) return null;

  if (value.includes("@")) {
    return value.toLowerCase();
  }

  const phone = normalizePhone(value);
  if (phone) {
    const candidates = Array.from(new Set([phone, phone.startsWith("+") ? phone.slice(1) : `+${phone}`]));
    for (const candidate of candidates) {
      const { data, error } = await supabase
        .schema("auth")
        .from("users")
        .select("email")
        .eq("phone", candidate)
        .maybeSingle();
      if (error) throw error;
      if (data?.email) return String(data.email).toLowerCase();
    }
  }

  const username = value.replace(/^@+/, "").toLowerCase();
  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("id")
    .ilike("username", username)
    .maybeSingle();
  if (profileError) throw profileError;
  if (!profile?.id) return null;

  const { data: user, error: userError } = await supabase
    .schema("auth")
    .from("users")
    .select("email")
    .eq("id", String(profile.id))
    .maybeSingle();
  if (userError) throw userError;
  if (!user?.email) return null;

  return String(user.email).toLowerCase();
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const url = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !serviceRoleKey) {
    return new Response(JSON.stringify({ error: "Missing Supabase env vars" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const body = await req.json().catch(() => ({}));
  const identifier = String((body as { identifier?: unknown }).identifier ?? "").trim();
  const redirectTo = String((body as { redirectTo?: unknown }).redirectTo ?? "").trim();
  if (!identifier) {
    return new Response(JSON.stringify({ error: "Missing identifier" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const supabase = createClient(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  try {
    const email = await findEmailByIdentifier(supabase, identifier);
    if (email) {
      const { error } = await supabase.auth.resetPasswordForEmail(email, redirectTo ? { redirectTo } : undefined);
      if (error) throw error;
    }

    return new Response(JSON.stringify({ ok: true }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : "Unexpected error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
