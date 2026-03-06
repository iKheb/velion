import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
};

const parseRanges = (value: unknown): number[] => {
  if (!Array.isArray(value)) return [1, 7, 30];

  const normalized = value
    .map((item) => Number(item))
    .filter((item) => Number.isFinite(item) && [1, 7, 30].includes(item))
    .map((item) => item as 1 | 7 | 30);

  return normalized.length ? Array.from(new Set(normalized)) : [1, 7, 30];
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
  const cronSecret = Deno.env.get("SYNC_ALERTS_CRON_SECRET");

  if (!url || !serviceRoleKey) {
    return new Response(JSON.stringify({ error: "Missing Supabase env vars" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  if (cronSecret) {
    const incomingSecret = req.headers.get("x-cron-secret") ?? "";
    if (incomingSecret !== cronSecret) {
      return new Response(JSON.stringify({ error: "Forbidden" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
  }

  const body = await req.json().catch(() => ({}));
  const ranges = parseRanges((body as { ranges?: unknown }).ranges);

  const supabase = createClient(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const result: Array<{ range_days: number; alerts_detected: number; alerts_upserted: number; alerts_resolved: number }> = [];

  for (const rangeDays of ranges) {
    const { data, error } = await supabase.rpc("sync_admin_alerts", { range_days: rangeDays });
    if (error) {
      return new Response(JSON.stringify({ error: error.message, range_days: rangeDays }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    result.push({
      range_days: Number((data as Record<string, unknown>)?.range_days ?? rangeDays),
      alerts_detected: Number((data as Record<string, unknown>)?.alerts_detected ?? 0),
      alerts_upserted: Number((data as Record<string, unknown>)?.alerts_upserted ?? 0),
      alerts_resolved: Number((data as Record<string, unknown>)?.alerts_resolved ?? 0),
    });
  }

  return new Response(JSON.stringify({ ok: true, ranges: result }), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
