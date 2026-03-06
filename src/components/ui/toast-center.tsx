import { useEffect } from "react";
import { CheckCircle2, Info, XCircle } from "lucide-react";
import { useToastStore } from "@/store/toast.store";

const TONE_STYLES = {
  info: "border-cyan-900/50 bg-cyan-950/50 text-cyan-100",
  success: "border-emerald-900/50 bg-emerald-950/50 text-emerald-100",
  error: "border-rose-900/50 bg-rose-950/50 text-rose-100",
} as const;

const ICONS = {
  info: Info,
  success: CheckCircle2,
  error: XCircle,
} as const;

export function ToastCenter() {
  const toasts = useToastStore((state) => state.toasts);
  const removeToast = useToastStore((state) => state.removeToast);

  useEffect(() => {
    if (!toasts.length) return;
    const timers = toasts.map((toast) =>
      window.setTimeout(() => {
        removeToast(toast.id);
      }, 4000),
    );

    return () => timers.forEach((timer) => window.clearTimeout(timer));
  }, [removeToast, toasts]);

  return (
    <div className="pointer-events-none fixed inset-x-0 top-4 z-[120] mx-auto flex w-full max-w-xl flex-col gap-2 px-4">
      {toasts.map((toast) => {
        const Icon = ICONS[toast.tone];
        return (
          <div key={toast.id} className={`pointer-events-auto rounded-xl border p-3 shadow-lg ${TONE_STYLES[toast.tone]}`} role="status" aria-live="polite">
            <div className="flex items-start gap-2">
              <Icon size={16} className="mt-0.5" />
              <div className="min-w-0">
                <p className="text-sm font-semibold">{toast.title}</p>
                {toast.description ? <p className="text-xs opacity-90">{toast.description}</p> : null}
              </div>
              <button
                type="button"
                className="ml-auto rounded px-1 py-0.5 text-xs opacity-80 hover:opacity-100"
                onClick={() => removeToast(toast.id)}
                aria-label="Cerrar notificación"
              >
                Cerrar
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}
