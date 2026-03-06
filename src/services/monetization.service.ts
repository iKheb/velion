import { hasSupabaseConfig, supabase } from "@/services/supabase";
import type {
  ContentPromotion,
  IdentityVerification,
  PaymentIntent,
  PaymentIntentRecord,
  PremiumSubscription,
  WalletBalance,
} from "@/types/models";

export const getMyWalletBalance = async (): Promise<WalletBalance | null> => {
  if (!hasSupabaseConfig) return { user_id: "demo-user", balance_credits: 5000, updated_at: new Date().toISOString() };

  const { data, error } = await supabase.from("wallet_balances").select("*").maybeSingle();
  if (error) throw error;
  return (data as WalletBalance | null) ?? null;
};

export const addCreditsToWallet = async (amountCredits: number): Promise<void> => {
  if (!hasSupabaseConfig) return;
  if (!Number.isFinite(amountCredits) || amountCredits <= 0) throw new Error("Monto invalido");

  const { error } = await supabase.rpc("wallet_add_credits", {
    amount_credits: Math.floor(amountCredits),
  });
  if (error) throw error;
};

export interface StripeCheckoutResult {
  intent_id: string;
  status: PaymentIntent["status"];
  reused: boolean;
  checkout_url: string | null;
}

export const createCreditTopupIntent = async (params: {
  provider: "stripe" | "mercado_pago";
  packageCredits: number;
  idempotencyKey?: string;
  metadata?: Record<string, unknown>;
}): Promise<PaymentIntent> => {
  if (!hasSupabaseConfig) {
    return {
      intent_id: crypto.randomUUID(),
      provider: params.provider,
      status: "created",
      amount_minor: 0,
      currency: "USD",
      package_credits: params.packageCredits,
      reused: false,
    };
  }

  const normalizedCredits = Math.floor(params.packageCredits);
  if (!Number.isFinite(normalizedCredits) || normalizedCredits <= 0) {
    throw new Error("Paquete de creditos invalido");
  }

  const { data, error } = await supabase.rpc("create_credit_topup_intent", {
    p_provider: params.provider,
    p_package_credits: normalizedCredits,
    p_idempotency_key: params.idempotencyKey ?? null,
    p_metadata: params.metadata ?? {},
  });

  if (error) throw error;
  return data as PaymentIntent;
};

export const startStripeCheckoutTopup = async (params: {
  packageCredits: number;
  idempotencyKey?: string;
  successUrl: string;
  cancelUrl: string;
}): Promise<StripeCheckoutResult> => {
  if (!hasSupabaseConfig) {
    return {
      intent_id: crypto.randomUUID(),
      status: "pending",
      reused: false,
      checkout_url: null,
    };
  }

  const { data, error } = await supabase.functions.invoke("create-stripe-checkout", {
    body: {
      package_credits: Math.floor(params.packageCredits),
      idempotency_key: params.idempotencyKey ?? crypto.randomUUID(),
      success_url: params.successUrl,
      cancel_url: params.cancelUrl,
    },
  });

  if (error) throw error;
  return data as StripeCheckoutResult;
};

export const getPaymentIntentById = async (intentId: string): Promise<PaymentIntentRecord | null> => {
  if (!hasSupabaseConfig) return null;
  if (!intentId) return null;

  const { data, error } = await supabase
    .from("payment_intents")
    .select("id,provider,status,amount_minor,currency,package_credits,error_message,created_at,settled_at,metadata")
    .eq("id", intentId)
    .maybeSingle();

  if (error) throw error;
  return (data as PaymentIntentRecord | null) ?? null;
};

export const reconcilePaymentIntent = async (intentId: string): Promise<{ intent_id: string; status: string }> => {
  if (!hasSupabaseConfig) return { intent_id: intentId, status: "pending" };
  if (!intentId) throw new Error("Intent invalido");

  const { data, error } = await supabase.functions.invoke("reconcile-payment-intent", {
    body: { intent_id: intentId },
  });
  if (error) throw error;
  return data as { intent_id: string; status: string };
};

export const buyPremiumSubscription = async (months = 1): Promise<void> => {
  if (!hasSupabaseConfig) return;

  const { error } = await supabase.rpc("purchase_premium_subscription", {
    months_count: Math.max(1, Math.floor(months)),
  });
  if (error) throw error;
};

export const buyIdentityVerification = async (): Promise<void> => {
  if (!hasSupabaseConfig) return;

  const { error } = await supabase.rpc("purchase_identity_verification");
  if (error) throw error;
};

export const promoteContentWithCredits = async (params: {
  targetType: "post" | "stream" | "stream_vod";
  targetId: string;
  credits: number;
  days: number;
}): Promise<void> => {
  if (!hasSupabaseConfig) return;
  if (!params.targetId) throw new Error("Selecciona contenido a promocionar.");
  if (!Number.isFinite(params.credits) || params.credits <= 0) throw new Error("Creditos invalidos.");
  if (!Number.isFinite(params.days) || params.days <= 0) throw new Error("Duracion invalida.");

  const { error } = await supabase.rpc("promote_content_with_credits", {
    target_type_input: params.targetType,
    target_id_input: params.targetId,
    credits_input: Math.floor(params.credits),
    duration_days_input: Math.floor(params.days),
  });
  if (error) throw error;
};

export const listMyPromotions = async (): Promise<ContentPromotion[]> => {
  if (!hasSupabaseConfig) return [];

  const { data, error } = await supabase
    .from("content_promotions")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(50);
  if (error) throw error;
  return (data as ContentPromotion[]) ?? [];
};

export const listMyPremiumSubscriptions = async (): Promise<PremiumSubscription[]> => {
  if (!hasSupabaseConfig) return [];
  const { data, error } = await supabase
    .from("premium_subscriptions")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(20);
  if (error) throw error;
  return (data as PremiumSubscription[]) ?? [];
};

export const listMyIdentityVerifications = async (): Promise<IdentityVerification[]> => {
  if (!hasSupabaseConfig) return [];
  const { data, error } = await supabase
    .from("identity_verifications")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(20);
  if (error) throw error;
  return (data as IdentityVerification[]) ?? [];
};
