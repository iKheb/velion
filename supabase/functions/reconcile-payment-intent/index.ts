import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

type ReconcileBody = {
  intent_id?: string;
};

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const jsonResponse = (status: number, body: Record<string, unknown>) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return jsonResponse(405, { error: "Method not allowed" });

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const supabaseServiceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const stripeSecretKey = Deno.env.get("STRIPE_SECRET_KEY");

  if (!supabaseUrl || !supabaseServiceRoleKey || !stripeSecretKey) {
    return jsonResponse(500, { error: "Missing required environment variables" });
  }

  const authHeader = req.headers.get("Authorization") ?? "";
  const jwt = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
  if (!jwt) return jsonResponse(401, { error: "Unauthorized" });

  const serviceClient = createClient(supabaseUrl, supabaseServiceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const userResult = await serviceClient.auth.getUser(jwt);
  const user = userResult.data.user;
  if (!user) return jsonResponse(401, { error: "Unauthorized" });

  const body = (await req.json().catch(() => ({}))) as ReconcileBody;
  const intentId = (body.intent_id ?? "").trim();
  if (!intentId) return jsonResponse(400, { error: "intent_id is required" });

  const { data: intentRow, error: intentError } = await serviceClient
    .from("payment_intents")
    .select("id,user_id,provider,status,provider_intent_id,provider_checkout_id,amount_minor,currency,error_message,metadata")
    .eq("id", intentId)
    .eq("user_id", user.id)
    .maybeSingle();

  if (intentError || !intentRow) return jsonResponse(404, { error: "Payment intent not found" });

  if (intentRow.status === "succeeded") {
    return jsonResponse(200, { intent_id: intentRow.id, status: "succeeded", reconciled: false });
  }

  if (intentRow.provider !== "stripe") {
    return jsonResponse(400, { error: "Only stripe reconciliation is supported" });
  }

  const providerCheckoutId = (intentRow.provider_checkout_id ?? "").trim();
  if (!providerCheckoutId) {
    return jsonResponse(400, { error: "Missing provider checkout session id" });
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
    return jsonResponse(502, { error: message });
  }

  const status = String(stripePayload.status ?? "");
  const paymentStatus = String(stripePayload.payment_status ?? "");

  if (paymentStatus === "paid" || status === "complete") {
    const { data: settleData, error: settleError } = await serviceClient.rpc("mark_payment_intent_succeeded", {
      p_provider: "stripe",
      p_provider_intent_id: providerCheckoutId,
      p_provider_event_id: null,
      p_metadata: {
        source: "manual_reconciliation",
        stripe_session_status: status,
        stripe_payment_status: paymentStatus,
      },
    });

    if (settleError) {
      const { data: settleById, error: settleByIdError } = await serviceClient.rpc("mark_payment_intent_succeeded_by_intent_id", {
        p_intent_id: intentRow.id,
        p_provider_event_id: null,
        p_metadata: {
          source: "manual_reconciliation_fallback",
          stripe_session_status: status,
          stripe_payment_status: paymentStatus,
        },
      });

      if (settleByIdError) return jsonResponse(500, { error: settleByIdError.message });
      return jsonResponse(200, { intent_id: intentRow.id, status: "succeeded", reconciled: true, settlement: settleById });
    }

    return jsonResponse(200, { intent_id: intentRow.id, status: "succeeded", reconciled: true, settlement: settleData });
  }

  if (status === "expired") {
    const { data: failedData, error: failedError } = await serviceClient.rpc("mark_payment_intent_failed", {
      p_provider: "stripe",
      p_provider_intent_id: providerCheckoutId,
      p_provider_event_id: null,
      p_error_message: "Stripe checkout session expired",
      p_metadata: {
        source: "manual_reconciliation",
        stripe_session_status: status,
        stripe_payment_status: paymentStatus,
      },
    });

    if (failedError) return jsonResponse(500, { error: failedError.message });
    return jsonResponse(200, { intent_id: intentRow.id, status: "failed", reconciled: true, settlement: failedData });
  }

  const { error: pendingUpdateError } = await serviceClient.rpc("update_payment_intent_after_provider_session", {
    p_intent_id: intentRow.id,
    p_provider_intent_id: providerCheckoutId,
    p_provider_checkout_id: providerCheckoutId,
    p_status: "pending_webhook",
    p_metadata: {
      source: "manual_reconciliation",
      stripe_session_status: status,
      stripe_payment_status: paymentStatus,
    },
  });

  if (pendingUpdateError) return jsonResponse(500, { error: pendingUpdateError.message });

  return jsonResponse(200, {
    intent_id: intentRow.id,
    status: "pending_webhook",
    reconciled: true,
    stripe_session_status: status,
    stripe_payment_status: paymentStatus,
  });
});
