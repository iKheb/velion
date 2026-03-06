import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

type CreateStripeCheckoutBody = {
  package_credits?: number;
  idempotency_key?: string;
  success_url?: string;
  cancel_url?: string;
};

type StripeSessionResponse = {
  id: string;
  url: string;
  status: string;
  payment_status: string;
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
  const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const supabaseServiceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const stripeSecretKey = Deno.env.get("STRIPE_SECRET_KEY");

  if (!supabaseUrl || !supabaseAnonKey || !supabaseServiceRoleKey || !stripeSecretKey) {
    return jsonResponse(500, { error: "Missing required environment variables" });
  }

  const authHeader = req.headers.get("Authorization") ?? "";
  const jwt = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
  if (!jwt) return jsonResponse(401, { error: "Unauthorized" });

  const userClient = createClient(supabaseUrl, supabaseAnonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${jwt}` } },
  });

  const serviceClient = createClient(supabaseUrl, supabaseServiceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const userResult = await serviceClient.auth.getUser(jwt);
  const user = userResult.data.user;
  if (!user) return jsonResponse(401, { error: "Unauthorized" });

  const body = (await req.json().catch(() => ({}))) as CreateStripeCheckoutBody;
  const packageCredits = Math.floor(Number(body.package_credits ?? 0));
  const idempotencyKey = (body.idempotency_key ?? "").trim() || crypto.randomUUID();

  if (![1, 5, 10, 20, 50, 100, 500].includes(packageCredits)) {
    return jsonResponse(400, { error: "Invalid package_credits" });
  }

  const successUrl =
    (body.success_url ?? "").trim() ||
    `${new URL(req.url).origin}/?topup_status=success`;
  const cancelUrl =
    (body.cancel_url ?? "").trim() ||
    `${new URL(req.url).origin}/?topup_status=cancel`;

  const { data: intentData, error: intentError } = await userClient.rpc("create_credit_topup_intent", {
    p_provider: "stripe",
    p_package_credits: packageCredits,
    p_idempotency_key: idempotencyKey,
    p_metadata: {
      flow: "stripe_checkout",
      requested_by: "client",
    },
  });

  if (intentError) return jsonResponse(400, { error: intentError.message });

  const intent = intentData as {
    intent_id: string;
    status: string;
    amount_minor: number;
    currency: string;
    package_credits: number;
    reused: boolean;
  };

  const { data: intentRow, error: intentRowError } = await serviceClient
    .from("payment_intents")
    .select("id,status,provider_checkout_id,metadata,amount_minor,currency,package_credits")
    .eq("id", intent.intent_id)
    .eq("user_id", user.id)
    .maybeSingle();

  if (intentRowError || !intentRow) {
    return jsonResponse(500, { error: "Unable to load payment intent" });
  }

  const existingCheckoutUrl =
    typeof intentRow.metadata?.checkout_url === "string" ? (intentRow.metadata.checkout_url as string) : "";

  if (intentRow.status === "succeeded") {
    return jsonResponse(200, {
      intent_id: intent.intent_id,
      status: "succeeded",
      reused: true,
      checkout_url: null,
    });
  }

  if (existingCheckoutUrl && ["created", "pending", "pending_webhook", "retrying", "requires_action"].includes(intentRow.status)) {
    return jsonResponse(200, {
      intent_id: intent.intent_id,
      status: intentRow.status,
      reused: true,
      checkout_url: existingCheckoutUrl,
    });
  }

  const stripeParams = new URLSearchParams();
  stripeParams.set("mode", "payment");
  stripeParams.set("success_url", successUrl);
  stripeParams.set("cancel_url", cancelUrl);
  if (user.email) stripeParams.set("customer_email", user.email);
  stripeParams.set("client_reference_id", intent.intent_id);
  stripeParams.set("metadata[payment_intent_id]", intent.intent_id);
  stripeParams.set("line_items[0][quantity]", "1");
  stripeParams.set("line_items[0][price_data][currency]", (intentRow.currency ?? "USD").toLowerCase());
  stripeParams.set("line_items[0][price_data][unit_amount]", String(intentRow.amount_minor));
  stripeParams.set("line_items[0][price_data][product_data][name]", `Velion Credits (${intentRow.package_credits})`);
  stripeParams.set("payment_intent_data[metadata][payment_intent_id]", intent.intent_id);
  stripeParams.set("payment_intent_data[metadata][user_id]", user.id);

  const stripeResponse = await fetch("https://api.stripe.com/v1/checkout/sessions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${stripeSecretKey}`,
      "Content-Type": "application/x-www-form-urlencoded",
      "Idempotency-Key": `velion:${intent.intent_id}:checkout`,
    },
    body: stripeParams,
  });

  const stripePayload = (await stripeResponse.json().catch(() => ({}))) as Record<string, unknown>;
  if (!stripeResponse.ok) {
    const message = String((stripePayload.error as Record<string, unknown> | undefined)?.message ?? "Stripe error");
    return jsonResponse(502, { error: message });
  }

  const session = stripePayload as unknown as StripeSessionResponse;
  if (!session.id || !session.url) {
    return jsonResponse(502, { error: "Invalid response from Stripe" });
  }

  const { error: updateError } = await serviceClient.rpc("update_payment_intent_after_provider_session", {
    p_intent_id: intent.intent_id,
    p_provider_intent_id: session.id,
    p_provider_checkout_id: session.id,
    p_status: "pending_webhook",
    p_metadata: {
      checkout_url: session.url,
      stripe_session_status: session.status,
      stripe_payment_status: session.payment_status,
    },
  });

  if (updateError) {
    return jsonResponse(500, { error: updateError.message });
  }

  return jsonResponse(200, {
    intent_id: intent.intent_id,
    status: "pending_webhook",
    reused: false,
    checkout_url: session.url,
  });
});
