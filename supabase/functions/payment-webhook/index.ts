import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

type WebhookBody = {
  provider?: string;
  event_id?: string;
  event_type?: string;
  payload?: Record<string, unknown>;
};

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-webhook-token",
};

const getInternalPaymentIntentId = (payload: Record<string, unknown> | undefined): string | null => {
  if (!payload) return null;
  const data = (payload.data as Record<string, unknown> | undefined) ?? {};
  const object = (data.object as Record<string, unknown> | undefined) ?? {};
  const metadata = (object.metadata as Record<string, unknown> | undefined) ?? {};
  const value = metadata.payment_intent_id;
  if (typeof value === "string" && value.trim() !== "") return value.trim();
  return null;
};

const parseProviderIntentId = (provider: string, payload: Record<string, unknown> | undefined): string | null => {
  if (!payload) return null;

  if (provider === "stripe") {
    const data = (payload.data as Record<string, unknown> | undefined) ?? {};
    const object = (data.object as Record<string, unknown> | undefined) ?? {};

    const fromPaymentIntent = object.payment_intent;
    if (typeof fromPaymentIntent === "string" && fromPaymentIntent.trim() !== "") {
      return fromPaymentIntent.trim();
    }

    const fromId = object.id;
    if (typeof fromId === "string" && fromId.trim() !== "") {
      return fromId.trim();
    }
  }

  if (provider === "mercado_pago") {
    const data = (payload.data as Record<string, unknown> | undefined) ?? {};
    const id = data.id;
    if (typeof id === "string" && id.trim() !== "") {
      return id.trim();
    }
  }

  return null;
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
  const webhookToken = Deno.env.get("PAYMENT_WEBHOOK_TOKEN");

  if (!url || !serviceRoleKey) {
    return new Response(JSON.stringify({ error: "Missing Supabase env vars" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  if (webhookToken) {
    const incomingToken = req.headers.get("x-webhook-token") ?? "";
    if (incomingToken !== webhookToken) {
      return new Response(JSON.stringify({ error: "Forbidden" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
  }

  const body = await req.json().catch(() => ({})) as WebhookBody;
  const provider = (body.provider ?? "").trim().toLowerCase();
  const eventId = (body.event_id ?? "").trim();
  const eventType = (body.event_type ?? "").trim();
  const payload = (body.payload ?? {}) as Record<string, unknown>;

  if (!provider || !eventId || !eventType) {
    return new Response(JSON.stringify({ error: "provider, event_id and event_type are required" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const supabase = createClient(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: webhookEventId, error: eventError } = await supabase.rpc("record_payment_webhook_event", {
    p_provider: provider,
    p_provider_event_id: eventId,
    p_event_type: eventType,
    p_payload: payload,
  });

  if (eventError) {
    return new Response(JSON.stringify({ error: eventError.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  let finalStatus: "processed" | "ignored" | "failed" = "ignored";
  let finalError: string | null = null;
  let settlementResult: Record<string, unknown> | null = null;

  try {
    const intentId = parseProviderIntentId(provider, payload);
    const internalIntentId = getInternalPaymentIntentId(payload);

    if (intentId && ["checkout.session.completed", "payment.succeeded"].includes(eventType)) {
      const { data: settleData, error: settleError } = await supabase.rpc("mark_payment_intent_succeeded", {
        p_provider: provider,
        p_provider_intent_id: intentId,
        p_provider_event_id: eventId,
        p_metadata: { webhook_event_type: eventType },
      });

      if (settleError) {
        finalStatus = "failed";
        finalError = settleError.message;
      } else {
        finalStatus = "processed";
        settlementResult = (settleData as Record<string, unknown>) ?? null;
      }
    }

    if (
      finalStatus !== "processed" &&
      internalIntentId &&
      ["payment_intent.succeeded", "checkout.session.completed"].includes(eventType)
    ) {
      const { data: settleByIdData, error: settleByIdError } = await supabase.rpc("mark_payment_intent_succeeded_by_intent_id", {
        p_intent_id: internalIntentId,
        p_provider_event_id: eventId,
        p_metadata: { webhook_event_type: eventType, source: "internal_intent_id" },
      });

      if (settleByIdError) {
        finalStatus = "failed";
        finalError = settleByIdError.message;
      } else {
        finalStatus = "processed";
        settlementResult = (settleByIdData as Record<string, unknown>) ?? null;
      }
    }

    if (intentId && ["payment_intent.payment_failed", "checkout.session.expired", "payment.failed"].includes(eventType)) {
      const { data: failedData, error: failedError } = await supabase.rpc("mark_payment_intent_failed", {
        p_provider: provider,
        p_provider_intent_id: intentId,
        p_provider_event_id: eventId,
        p_error_message: `Provider reported failure: ${eventType}`,
        p_metadata: { webhook_event_type: eventType },
      });

      if (failedError) {
        finalStatus = "failed";
        finalError = failedError.message;
      } else {
        finalStatus = "processed";
        settlementResult = (failedData as Record<string, unknown>) ?? null;
      }
    }
  } catch (error) {
    finalStatus = "failed";
    finalError = error instanceof Error ? error.message : "Unexpected webhook processing error";
  }

  const { error: finalizeError } = await supabase.rpc("finalize_payment_webhook_event", {
    p_event_id: webhookEventId,
    p_status: finalStatus,
    p_error_message: finalError,
  });

  if (finalizeError) {
    return new Response(JSON.stringify({ error: finalizeError.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  return new Response(
    JSON.stringify({
      ok: true,
      webhook_event_id: webhookEventId,
      status: finalStatus,
      settlement: settlementResult,
      error: finalError,
    }),
    {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: finalStatus === "failed" ? 500 : 200,
    },
  );
});
