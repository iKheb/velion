import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

type ReconcileBody = {
  intent_id?: string;
  minutes?: number;
  limit?: number;
  max_retries?: number;
};

type PaymentIntentRow = {
  id: string;
  user_id: string;
  provider: "stripe" | "mercado_pago";
  status: string;
  provider_checkout_id: string | null;
  retry_count: number | null;
};

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
};

const jsonResponse = (status: number, body: Record<string, unknown>) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

const clamp = (value: unknown, fallback: number, min: number, max: number): number => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(numeric)));
};

const reconcileStripeIntent = async (
  serviceClient: ReturnType<typeof createClient>,
  stripeSecretKey: string,
  intent: PaymentIntentRow,
  maxRetries: number,
): Promise<{ status: string; reconciled: boolean }> => {
  if (intent.status === "succeeded" || intent.status === "failed" || intent.status === "canceled") {
    return { status: intent.status, reconciled: false };
  }

  const providerCheckoutId = (intent.provider_checkout_id ?? "").trim();
  if (!providerCheckoutId) {
    await serviceClient.rpc("mark_payment_intent_retrying", {
      p_intent_id: intent.id,
      p_error_message: "Missing provider checkout id",
      p_metadata: { source: "auto_reconciliation" },
      p_retry_delay_minutes: 5,
      p_max_retries: maxRetries,
    });
    return { status: "retrying", reconciled: true };
  }

  const stripeRes = await fetch(
    `https://api.stripe.com/v1/checkout/sessions/${encodeURIComponent(providerCheckoutId)}?expand[]=payment_intent`,
    {
      method: "GET",
      headers: { Authorization: `Bearer ${stripeSecretKey}` },
    },
  );

  const stripePayload = (await stripeRes.json().catch(() => ({}))) as Record<string, unknown>;
  if (!stripeRes.ok) {
    const message = String((stripePayload.error as Record<string, unknown> | undefined)?.message ?? "Stripe query failed");
    await serviceClient.rpc("mark_payment_intent_retrying", {
      p_intent_id: intent.id,
      p_error_message: message,
      p_metadata: { source: "auto_reconciliation", stripe_error: true },
      p_retry_delay_minutes: 5,
      p_max_retries: maxRetries,
    });
    return { status: "retrying", reconciled: true };
  }

  const sessionStatus = String(stripePayload.status ?? "");
  const paymentStatus = String(stripePayload.payment_status ?? "");

  if (paymentStatus === "paid" || sessionStatus === "complete") {
    await serviceClient.rpc("mark_payment_intent_succeeded_by_intent_id", {
      p_intent_id: intent.id,
      p_provider_event_id: null,
      p_metadata: {
        source: "auto_reconciliation",
        stripe_session_status: sessionStatus,
        stripe_payment_status: paymentStatus,
      },
    });
    return { status: "succeeded", reconciled: true };
  }

  if (sessionStatus === "expired") {
    await serviceClient.rpc("mark_payment_intent_failed", {
      p_provider: "stripe",
      p_provider_intent_id: providerCheckoutId,
      p_provider_event_id: null,
      p_error_message: "Stripe checkout session expired",
      p_metadata: {
        source: "auto_reconciliation",
        stripe_session_status: sessionStatus,
        stripe_payment_status: paymentStatus,
      },
    });
    return { status: "failed", reconciled: true };
  }

  await serviceClient.rpc("update_payment_intent_after_provider_session", {
    p_intent_id: intent.id,
    p_provider_intent_id: providerCheckoutId,
    p_provider_checkout_id: providerCheckoutId,
    p_status: "pending_webhook",
    p_metadata: {
      source: "auto_reconciliation",
      stripe_session_status: sessionStatus,
      stripe_payment_status: paymentStatus,
    },
  });

  return { status: "pending_webhook", reconciled: true };
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return jsonResponse(405, { error: "Method not allowed" });

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const supabaseServiceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const stripeSecretKey = Deno.env.get("STRIPE_SECRET_KEY");
  const cronSecret = Deno.env.get("PAYMENTS_RECONCILE_CRON_SECRET");

  if (!supabaseUrl || !supabaseServiceRoleKey || !stripeSecretKey) {
    return jsonResponse(500, { error: "Missing required environment variables" });
  }

  const serviceClient = createClient(supabaseUrl, supabaseServiceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const incomingCronSecret = req.headers.get("x-cron-secret") ?? "";
  const authorizedByCron = Boolean(cronSecret) && incomingCronSecret === cronSecret;

  let authorizedByAdmin = false;
  if (!authorizedByCron) {
    const authHeader = req.headers.get("Authorization") ?? "";
    const jwt = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
    if (!jwt) return jsonResponse(401, { error: "Unauthorized" });

    const userResult = await serviceClient.auth.getUser(jwt);
    const user = userResult.data.user;
    if (!user) return jsonResponse(401, { error: "Unauthorized" });

    const { data: profileRow, error: profileError } = await serviceClient
      .from("profiles")
      .select("role")
      .eq("id", user.id)
      .maybeSingle();

    if (profileError) return jsonResponse(500, { error: profileError.message });
    authorizedByAdmin = profileRow?.role === "admin";
    if (!authorizedByAdmin) return jsonResponse(403, { error: "Forbidden" });
  }

  const body = (await req.json().catch(() => ({}))) as ReconcileBody;
  const intentId = (body.intent_id ?? "").trim();
  const limit = clamp(body.limit, intentId ? 1 : 100, 1, 500);
  const minutes = clamp(body.minutes, 30, 5, 1440);
  const maxRetries = clamp(body.max_retries, 6, 1, 20);

  let candidates: PaymentIntentRow[] = [];
  if (intentId) {
    const { data, error } = await serviceClient
      .from("payment_intents")
      .select("id,user_id,provider,status,provider_checkout_id,retry_count")
      .eq("id", intentId)
      .maybeSingle();

    if (error || !data) return jsonResponse(404, { error: "Payment intent not found" });
    candidates = [data as PaymentIntentRow];
  } else {
    const { data, error } = await serviceClient
      .from("payment_intents")
      .select("id,user_id,provider,status,provider_checkout_id,retry_count")
      .in("status", ["pending_webhook", "retrying", "pending", "requires_action", "created"])
      .order("created_at", { ascending: true })
      .limit(limit);

    if (error) return jsonResponse(500, { error: error.message });
    candidates = (data ?? []) as PaymentIntentRow[];
  }

  let probed = 0;
  let reconciled = 0;
  let succeeded = 0;
  let failed = 0;
  let retrying = 0;
  const errors: Array<{ intent_id: string; error: string }> = [];

  for (const candidate of candidates) {
    if (candidate.provider !== "stripe") continue;
    try {
      probed += 1;
      const result = await reconcileStripeIntent(serviceClient, stripeSecretKey, candidate, maxRetries);
      if (result.reconciled) reconciled += 1;
      if (result.status === "succeeded") succeeded += 1;
      if (result.status === "failed") failed += 1;
      if (result.status === "retrying") retrying += 1;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unexpected reconciliation error";
      errors.push({ intent_id: candidate.id, error: message });
    }
  }

  const { data: staleData, error: staleError } = await serviceClient.rpc("reconcile_stale_payment_intents", {
    p_minutes: minutes,
    p_limit: limit,
    p_max_retries: maxRetries,
  });

  if (staleError) return jsonResponse(500, { error: staleError.message });

  return jsonResponse(200, {
    ok: true,
    authorized_by: authorizedByCron ? "cron" : authorizedByAdmin ? "admin" : "unknown",
    probed,
    reconciled,
    succeeded,
    failed,
    retrying,
    stale_reconciliation: staleData ?? null,
    errors,
  });
});

