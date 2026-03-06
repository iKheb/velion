export interface CreditPackage {
  credits: number;
  priceUsd: number;
}

export const CREDIT_PACKAGES: CreditPackage[] = [
  { credits: 1, priceUsd: 0.99 },
  { credits: 5, priceUsd: 4.99 },
  { credits: 10, priceUsd: 8.99 },
  { credits: 20, priceUsd: 18.99 },
  { credits: 50, priceUsd: 47.99 },
  { credits: 100, priceUsd: 89.99 },
  { credits: 500, priceUsd: 429.99 },
];

export const CURRENCY_CODE = "USD";
export const CURRENCY_SYMBOL = "$";

export type PaymentUiStatus =
  | "idle"
  | "processing"
  | "pending_webhook"
  | "success"
  | "failure"
  | "retrying";

export const PAYMENT_STATUS_LABEL: Record<PaymentUiStatus, string> = {
  idle: "Listo para pagar",
  processing: "Procesando pago",
  pending_webhook: "Pendiente de confirmacion del proveedor",
  success: "Pago confirmado",
  failure: "Pago fallido",
  retrying: "Reintentando pago",
};

export const MONETIZATION_COPY = {
  walletTitle: "Recargar creditos",
  walletSubtitle: "Selecciona paquete y completa el pago.",
  premiumLabel: "Premium (9 creditos / mes)",
  verificationLabel: "Verificacion (15 creditos)",
  promotionCostLabel: "Costo fijo: 5 creditos · Duracion: 24 horas",
};

export const formatUsd = (value: number): string => `${CURRENCY_SYMBOL} ${value.toFixed(2)}`;

export const getCreditPackage = (credits: number): CreditPackage | null =>
  CREDIT_PACKAGES.find((item) => item.credits === credits) ?? null;

