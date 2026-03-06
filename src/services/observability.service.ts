import { env } from "@/lib/env";
import { trackEventFireAndForget } from "@/services/analytics.service";

interface ErrorContext {
  source: "global" | "boundary" | "route" | "manual";
  metadata?: Record<string, unknown>;
}

let handlersRegistered = false;

const asErrorPayload = (error: unknown): { message: string; stack?: string } => {
  if (error instanceof Error) {
    return {
      message: error.message,
      stack: error.stack,
    };
  }

  if (typeof error === "string") {
    return { message: error };
  }

  return { message: "Unknown error" };
};

const sendClientLog = (payload: Record<string, unknown>): void => {
  if (!env.clientLogEndpoint) return;

  const body = JSON.stringify(payload);

  if (typeof navigator !== "undefined" && typeof navigator.sendBeacon === "function") {
    const blob = new Blob([body], { type: "application/json" });
    navigator.sendBeacon(env.clientLogEndpoint, blob);
    return;
  }

  void fetch(env.clientLogEndpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body,
    keepalive: true,
  }).catch(() => undefined);
};

export const captureAppError = (error: unknown, context: ErrorContext): void => {
  const normalized = asErrorPayload(error);
  const payload = {
    source: context.source,
    message: normalized.message,
    stack: normalized.stack,
    metadata: context.metadata ?? {},
    at: new Date().toISOString(),
  };

  console.error("Velion error", payload);
  trackEventFireAndForget("client_error", payload);
  sendClientLog(payload);
};

export const setupGlobalErrorHandlers = (): void => {
  if (handlersRegistered || typeof window === "undefined") return;
  handlersRegistered = true;

  window.addEventListener("error", (event) => {
    captureAppError(event.error ?? event.message, {
      source: "global",
      metadata: { kind: "window.error" },
    });
  });

  window.addEventListener("unhandledrejection", (event) => {
    captureAppError(event.reason, {
      source: "global",
      metadata: { kind: "window.unhandledrejection" },
    });
  });
};

