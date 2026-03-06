import { Coins, CreditCard, Radio, TrendingUp, Upload, Video, Clapperboard, Camera, ImagePlus, X } from "lucide-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ErrorState, ListSkeleton } from "@/components/ui/data-state";
import { Input } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import { Select } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { ROUTES, getProfileRoute } from "@/lib/constants";
import { CREDIT_PACKAGES, MONETIZATION_COPY, PAYMENT_STATUS_LABEL, formatUsd, type PaymentUiStatus } from "@/lib/monetization";
import { toAppError } from "@/services/error.service";
import {
  getMyWalletBalance,
  getPaymentIntentById,
  reconcilePaymentIntent,
  startStripeCheckoutTopup,
} from "@/services/monetization.service";
import { createReel } from "@/services/reels.service";
import { getLiveStreamWidget, getTrendWidget } from "@/services/right-panel.service";
import { hasSupabaseConfig, supabase } from "@/services/supabase";
import { useAppStore } from "@/store/app.store";
import { toast } from "@/store/toast.store";

type RechargeStep = "method" | "card" | "success";

interface RechargeInvoice {
  id: string;
  createdAt: string;
  email: string;
  credits: number;
  unitUsd: number;
  totalUsd: number;
  paymentMethodLabel: string;
  maskedCard: string;
}

export function RightPanel() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const profile = useAppStore((state) => state.profile);
  const [openCreateReelModal, setOpenCreateReelModal] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [newDescription, setNewDescription] = useState("");
  const [newVideoFile, setNewVideoFile] = useState<File | null>(null);
  const [newThumbnailFile, setNewThumbnailFile] = useState<File | null>(null);
  const [openRechargeModal, setOpenRechargeModal] = useState(false);
  const [selectedPackageCredits, setSelectedPackageCredits] = useState<number>(10);
  const [rechargeStep, setRechargeStep] = useState<RechargeStep>("method");
  const [invoice, setInvoice] = useState<RechargeInvoice | null>(null);
  const [paymentEmail, setPaymentEmail] = useState<string>("");
  const [walletError, setWalletError] = useState<string | null>(null);
  const [paymentStatus, setPaymentStatus] = useState<PaymentUiStatus>("idle");
  const [currentTopupIntentId, setCurrentTopupIntentId] = useState<string | null>(null);
  const videoInputRef = useRef<HTMLInputElement | null>(null);
  const thumbnailInputRef = useRef<HTMLInputElement | null>(null);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [actionError, setActionError] = useState<string | null>(null);
  const [fileInputResetKey, setFileInputResetKey] = useState(0);
  const videoPreviewUrl = useMemo(() => (newVideoFile ? URL.createObjectURL(newVideoFile) : null), [newVideoFile]);

  useEffect(() => {
    return () => {
      if (videoPreviewUrl) URL.revokeObjectURL(videoPreviewUrl);
    };
  }, [videoPreviewUrl]);

  const liveStreamsQuery = useQuery({
    queryKey: ["right-panel", "live-streams"],
    queryFn: getLiveStreamWidget,
    staleTime: 30_000,
    refetchInterval: 60_000,
  });

  const walletQuery = useQuery({
    queryKey: ["wallet-balance"],
    queryFn: getMyWalletBalance,
  });

  const trendsQuery = useQuery({
    queryKey: ["right-panel", "trends"],
    queryFn: getTrendWidget,
    staleTime: 120_000,
    refetchInterval: 180_000,
  });

  const createReelMutation = useMutation({
    mutationFn: async () =>
      createReel(
        {
          title: newTitle,
          description: newDescription,
          videoFile: newVideoFile as File,
          thumbnailFile: newThumbnailFile,
        },
        setUploadProgress,
      ),
    onSuccess: async () => {
      setOpenCreateReelModal(false);
      setNewTitle("");
      setNewDescription("");
      setNewVideoFile(null);
      setNewThumbnailFile(null);
      setUploadProgress(0);
      setActionError(null);
      setFileInputResetKey((prev) => prev + 1);
      await queryClient.invalidateQueries({ queryKey: ["reels-feed"] });
      await queryClient.invalidateQueries({ queryKey: ["profile-reels"] });
    },
    onError: (error) => setActionError(toAppError(error)),
  });

  const stripeCheckoutMutation = useMutation({
    mutationFn: async () => {
      const baseUrl = window.location.origin;
      const packageCredits = selectedPackageCredits;
      const intentHint = crypto.randomUUID();
      const successUrl = `${baseUrl}${ROUTES.store}?topup_status=success`;
      const cancelUrl = `${baseUrl}${ROUTES.store}?topup_status=cancel`;

      return startStripeCheckoutTopup({
        packageCredits,
        idempotencyKey: intentHint,
        successUrl,
        cancelUrl,
      });
    },
    onMutate: () => {
      setWalletError(null);
      setPaymentStatus(stripeCheckoutMutation.failureCount > 0 ? "retrying" : "processing");
    },
    onSuccess: async (result) => {
      setCurrentTopupIntentId(result.intent_id);
      localStorage.setItem("velion_topup_intent_id", result.intent_id);
      if (!result.checkout_url) {
        setPaymentStatus(result.status === "succeeded" ? "success" : "pending_webhook");
        return;
      }
      setPaymentStatus("pending_webhook");
      window.location.assign(result.checkout_url);
    },
    onError: (error) => {
      setPaymentStatus("failure");
      const message = toAppError(error);
      setWalletError(message);
      toast.error("No se pudo iniciar el pago", message);
    },
  });

  const selectedPackage = useMemo(
    () => CREDIT_PACKAGES.find((item) => item.credits === selectedPackageCredits) ?? CREDIT_PACKAGES[0],
    [selectedPackageCredits],
  );

  const resetRechargeFlow = () => {
    setOpenRechargeModal(false);
    setRechargeStep("method");
    setInvoice(null);
    setWalletError(null);
    setPaymentStatus("idle");
    setCurrentTopupIntentId(null);
    localStorage.removeItem("velion_topup_intent_id");
  };

  const resolvePaymentEmail = async () => {
    if (!hasSupabaseConfig) {
      setPaymentEmail(`${profile?.username ?? "usuario"}@velion.app`);
      return;
    }
    const { data } = await supabase.auth.getUser();
    setPaymentEmail(data.user?.email ?? "");
  };

  const refreshTopupIntentState = useCallback(async (intentId: string) => {
    const intent = await getPaymentIntentById(intentId);
    if (!intent) {
      setPaymentStatus("failure");
      setWalletError("No se encontro la transaccion de recarga.");
      return;
    }

    if (intent.status === "succeeded") {
      const pkg = CREDIT_PACKAGES.find((item) => item.credits === intent.package_credits) ?? CREDIT_PACKAGES[0];
      const nowIso = new Date().toISOString();
      setInvoice({
        id: `VEL-${intent.id.slice(0, 8).toUpperCase()}`,
        createdAt: intent.settled_at ?? nowIso,
        email: paymentEmail || "correo-no-disponible@velion.app",
        credits: intent.package_credits,
        unitUsd: pkg.priceUsd / pkg.credits,
        totalUsd: pkg.priceUsd,
        paymentMethodLabel: "Stripe Checkout",
        maskedCard: "Procesado por Stripe",
      });
      setPaymentStatus("success");
      setRechargeStep("success");
      setWalletError(null);
      await walletQuery.refetch();
      return;
    }

    if (intent.status === "failed" || intent.status === "canceled") {
      setPaymentStatus("failure");
      setWalletError(intent.error_message ?? "El pago no pudo confirmarse.");
      return;
    }

    setPaymentStatus("pending_webhook");
    setWalletError("Pago en proceso de confirmacion. Puedes reintentar la conciliacion.");
  }, [paymentEmail, walletQuery.refetch]);

  const retryTopupReconciliation = useCallback(async () => {
    if (!currentTopupIntentId) return;
    setPaymentStatus("retrying");
    setWalletError(null);
    try {
      await reconcilePaymentIntent(currentTopupIntentId);
      await refreshTopupIntentState(currentTopupIntentId);
    } catch (error) {
      setPaymentStatus("failure");
      setWalletError(toAppError(error));
    }
  }, [currentTopupIntentId, refreshTopupIntentState]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const intentId = params.get("topup_intent") ?? localStorage.getItem("velion_topup_intent_id");
    const topupStatus = params.get("topup_status");
    if (!intentId || !topupStatus) return;
    params.delete("topup_intent");
    params.delete("topup_status");
    const newQuery = params.toString();
    const newUrl = `${window.location.pathname}${newQuery ? `?${newQuery}` : ""}`;
    window.history.replaceState({}, "", newUrl);

    setCurrentTopupIntentId(intentId);
    setOpenRechargeModal(true);
    setRechargeStep("card");
    setPaymentStatus(topupStatus === "cancel" ? "failure" : "pending_webhook");
    if (topupStatus === "cancel") {
      setWalletError("Pago cancelado por el usuario. Puedes reintentar de forma segura.");
      return;
    }

    const run = async () => {
      await refreshTopupIntentState(intentId);
    };
    void run();
  }, [refreshTopupIntentState]);

  const downloadInvoice = () => {
    if (!invoice) return;
    const issuedAt = new Date(invoice.createdAt).toLocaleString();
    const body = [
      "VELION - FACTURA DE RECARGA DE CREDITOS",
      "=======================================",
      `Factura: ${invoice.id}`,
      `Fecha: ${issuedAt}`,
      `Correo: ${invoice.email}`,
      `Metodo de pago: ${invoice.paymentMethodLabel}`,
      `Tarjeta: ${invoice.maskedCard}`,
      "",
      `Creditos: ${invoice.credits}`,
      `Precio por credito: USD ${invoice.unitUsd.toFixed(2)}`,
      `Total pagado: USD ${invoice.totalUsd.toFixed(2)}`,
      "",
      "Gracias por tu compra.",
    ].join("\n");

    const blob = new Blob([body], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `factura-${invoice.id}.txt`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  return (
    <aside className="fixed inset-y-0 right-0 z-30 hidden w-72 overflow-y-auto border-l border-velion-steel/70 bg-velion-discord/50 p-4 xl:block">
      <div className="space-y-3">
        <Card className="space-y-3">
          <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold"><Coins size={16} /> {MONETIZATION_COPY.walletTitle}</h3>
          <p className="text-xs text-zinc-400">{MONETIZATION_COPY.walletSubtitle}</p>
          <div className="space-y-2">
            <div className="flex items-center gap-2 rounded-lg bg-velion-black/40 p-3">
              <Select
                value={String(selectedPackageCredits)}
                onChange={(event) => setSelectedPackageCredits(Number(event.target.value))}
                className="h-10"
              >
                {CREDIT_PACKAGES.map((item) => (
                  <option key={item.credits} value={item.credits}>
                    {item.credits} creditos - {formatUsd(item.priceUsd)}
                  </option>
                ))}
              </Select>
              <Button
                type="button"
                className="shrink-0"
                onClick={() => {
                  void resolvePaymentEmail();
                  setWalletError(null);
                  setRechargeStep("method");
                  setOpenRechargeModal(true);
                }}
              >
                Recargar
              </Button>
            </div>
            <p className="text-xs text-zinc-400" aria-live="polite">
              Estado: {PAYMENT_STATUS_LABEL[paymentStatus]}
            </p>
            {walletError && <p className="text-xs text-red-400">{walletError}</p>}
          </div>
        </Card>

        <Card className="space-y-3">
          <div className="grid gap-2">
            <button
              type="button"
              onClick={() => {
                const profilePath = getProfileRoute(profile?.username ?? "me");
                const qs = new URLSearchParams({
                  tab: "canal",
                  open_upload_video: String(Date.now()),
                });
                void navigate(`${profilePath}?${qs.toString()}`);
              }}
              className="inline-flex items-center justify-center gap-2 rounded-lg bg-velion-fuchsia/25 px-3 py-2 text-xs text-zinc-100 hover:bg-velion-fuchsia/35"
            >
              <Upload size={14} /> Subir video
            </button>
            <Link to={ROUTES.streamingStudio} className="inline-flex items-center justify-center gap-2 rounded-lg bg-zinc-700 px-3 py-2 text-xs text-white hover:bg-zinc-600">
              <Video size={14} /> Iniciar stream
            </Link>
            <button
              type="button"
              onClick={() => setOpenCreateReelModal(true)}
              className="inline-flex items-center justify-center gap-2 rounded-lg bg-zinc-700 px-3 py-2 text-xs text-white hover:bg-zinc-600"
            >
              <Clapperboard size={14} /> Crear Reel
            </button>
          </div>
        </Card>

        <Card className="space-y-3">
          <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold"><Radio size={16} /> Streams en vivo</h3>
          <div className="space-y-2 text-sm text-zinc-300">
            {liveStreamsQuery.isLoading && (
              <ListSkeleton rows={3} />
            )}
            {liveStreamsQuery.error && (
              <ErrorState title="No se pudieron cargar streams" description={toAppError(liveStreamsQuery.error)} />
            )}
            {(liveStreamsQuery.data ?? []).map((item) => (
              <Link key={item.id} to={`${ROUTES.streaming}/${encodeURIComponent(item.id)}`} className="block hover:text-velion-fuchsia">
                {item.title} - {item.viewerCount} viewers
              </Link>
            ))}
            {!liveStreamsQuery.isLoading && (liveStreamsQuery.data ?? []).length === 0 && (
              <p className="text-zinc-500">No hay streams en vivo ahora.</p>
            )}
          </div>
        </Card>

        <Card className="space-y-3">
          <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold"><TrendingUp size={16} /> Tendencias</h3>
          <div className="space-y-2 text-sm text-zinc-300">
            {trendsQuery.isLoading && (
              <>
                <Skeleton className="h-4 w-3/4" />
                <Skeleton className="h-4 w-2/3" />
                <Skeleton className="h-4 w-1/2" />
              </>
            )}
            {trendsQuery.error && <ErrorState title="No se pudieron cargar tendencias" description={toAppError(trendsQuery.error)} />}
            {(trendsQuery.data ?? []).map((item) => (
              <p key={item.hashtag}>{item.hashtag}</p>
            ))}
            {!trendsQuery.isLoading && (trendsQuery.data ?? []).length === 0 && (
              <p className="text-zinc-500">Sin tendencias recientes.</p>
            )}
          </div>
        </Card>
      </div>

      <Modal open={openCreateReelModal} title="Crear Reel" onClose={() => setOpenCreateReelModal(false)} className="max-w-2xl">
        <div className="space-y-3">
          <Input value={newTitle} onChange={(event) => setNewTitle(event.target.value)} placeholder="Titulo del reel" />
          <textarea
            value={newDescription}
            onChange={(event) => setNewDescription(event.target.value)}
            rows={4}
            placeholder="Descripcion (opcional)"
            className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 outline-none placeholder:text-zinc-500 focus:border-velion-fuchsia"
          />
          <div className="flex items-center justify-between rounded-xl border border-velion-steel/60 bg-velion-black/40 p-2">
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => videoInputRef.current?.click()}
                className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-velion-fuchsia/25 text-zinc-100 hover:bg-velion-fuchsia/35"
                aria-label="Subir video"
              >
                <Camera size={18} />
              </button>
              <button
                type="button"
                onClick={() => thumbnailInputRef.current?.click()}
                className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-velion-fuchsia/25 text-zinc-100 hover:bg-velion-fuchsia/35"
                aria-label="Subir miniatura"
              >
                <ImagePlus size={18} />
              </button>
              <p className="text-xs text-zinc-300">{newVideoFile ? "Video seleccionado" : "Sube tu video con el icono de camara"}</p>
            </div>
            {(newVideoFile || newThumbnailFile) && (
              <button
                type="button"
                onClick={() => {
                  setNewVideoFile(null);
                  setNewThumbnailFile(null);
                  if (videoInputRef.current) videoInputRef.current.value = "";
                  if (thumbnailInputRef.current) thumbnailInputRef.current.value = "";
                }}
                className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-zinc-700/70 text-zinc-100 hover:bg-zinc-600"
                aria-label="Quitar archivos"
              >
                <X size={14} />
              </button>
            )}
          </div>
          <input
            key={`reel-video-${fileInputResetKey}`}
            ref={videoInputRef}
            type="file"
            accept="video/*"
            onChange={(event) => setNewVideoFile(event.target.files?.[0] ?? null)}
            className="hidden"
          />
          <input
            key={`reel-thumb-${fileInputResetKey}`}
            ref={thumbnailInputRef}
            type="file"
            accept="image/*"
            onChange={(event) => setNewThumbnailFile(event.target.files?.[0] ?? null)}
            className="hidden"
          />
          {newVideoFile && videoPreviewUrl && (
            <div className="w-fit rounded-xl border border-velion-steel/60 bg-velion-black/40 p-2">
              <video src={videoPreviewUrl} className="h-28 w-28 rounded-lg object-cover" muted playsInline controls />
            </div>
          )}
          {createReelMutation.isPending && (
            <div className="space-y-1">
              <div className="h-2 w-full overflow-hidden rounded-full bg-zinc-800">
                <div
                  className="h-full rounded-full bg-velion-fuchsia transition-all duration-200"
                  style={{ width: `${Math.max(0, Math.min(uploadProgress, 100))}%` }}
                />
              </div>
              <p className="text-right text-[11px] text-zinc-400">{Math.round(uploadProgress)}%</p>
            </div>
          )}
          {actionError && <p className="text-xs text-red-400">{actionError}</p>}
          <div className="flex justify-end gap-2">
            <Button type="button" className="bg-zinc-700 hover:bg-zinc-600" onClick={() => setOpenCreateReelModal(false)}>
              Cancelar
            </Button>
            <Button type="button" disabled={!newTitle.trim() || !newVideoFile || createReelMutation.isPending} onClick={() => createReelMutation.mutate()}>
              {createReelMutation.isPending ? "Publicando..." : "Publicar reel"}
            </Button>
          </div>
        </div>
      </Modal>

      <Modal open={openRechargeModal} title="Recargar creditos" onClose={resetRechargeFlow} className="max-w-lg">
        {rechargeStep === "method" && (
          <div className="space-y-3">
            <div className="rounded-lg bg-velion-black/40 p-3 text-sm">
              <p className="font-semibold text-zinc-100">Paquete seleccionado</p>
              <p className="text-zinc-300">{selectedPackage.credits} creditos</p>
              <p className="text-zinc-400">Total: USD {selectedPackage.priceUsd.toFixed(2)}</p>
            </div>
            <p className="text-sm text-zinc-300">Selecciona un metodo de pago.</p>
            <button
              type="button"
              onClick={() => setRechargeStep("card")}
              className="flex w-full items-center justify-between rounded-lg border border-velion-steel/60 bg-velion-black/40 px-3 py-3 text-left text-sm text-zinc-200 hover:bg-velion-black/60"
            >
              <span className="inline-flex items-center gap-2">
                <CreditCard size={16} />
                Tarjeta de credito o debito
              </span>
              <span className="text-xs text-zinc-400">Disponible</span>
            </button>
          </div>
        )}

        {rechargeStep === "card" && (
          <div className="space-y-3">
            <div className="rounded-lg bg-velion-black/40 p-3 text-sm">
              <p className="font-semibold text-zinc-100">Resumen</p>
              <p className="text-zinc-300">{selectedPackage.credits} creditos</p>
              <p className="text-zinc-400">Total: {formatUsd(selectedPackage.priceUsd)}</p>
            </div>
            <p className="text-sm text-zinc-300">Seras redirigido a Stripe Checkout para completar el pago de forma segura.</p>
            {paymentEmail && <p className="text-xs text-zinc-400">La factura se enviara a: {paymentEmail}</p>}
            <p className="text-xs text-zinc-400" aria-live="polite">Estado: {PAYMENT_STATUS_LABEL[paymentStatus]}</p>
            {walletError && <p className="text-xs text-red-400">{walletError}</p>}

            <div className="flex justify-end gap-2">
              <Button type="button" className="bg-zinc-700 hover:bg-zinc-600" onClick={() => setRechargeStep("method")} disabled={stripeCheckoutMutation.isPending}>
                Volver
              </Button>
              <Button type="button" onClick={() => stripeCheckoutMutation.mutate()} disabled={stripeCheckoutMutation.isPending}>
                {stripeCheckoutMutation.isPending ? "Procesando..." : "Pagar con Stripe"}
              </Button>
              <Button type="button" className="bg-zinc-700 hover:bg-zinc-600" onClick={() => void retryTopupReconciliation()} disabled={!currentTopupIntentId}>
                Reintentar confirmacion
              </Button>
            </div>
          </div>
        )}

        {rechargeStep === "success" && invoice && (
          <div className="space-y-3">
            <div className="rounded-lg border border-emerald-700/40 bg-emerald-900/20 p-3 text-sm text-emerald-200">
              Pago realizado correctamente.
            </div>
            <div className="space-y-1 rounded-lg bg-velion-black/40 p-3 text-sm text-zinc-300">
              <p><span className="text-zinc-500">Factura:</span> {invoice.id}</p>
              <p><span className="text-zinc-500">Creditos:</span> {invoice.credits}</p>
              <p><span className="text-zinc-500">Total:</span> USD {invoice.totalUsd.toFixed(2)}</p>
              <p><span className="text-zinc-500">Correo:</span> {invoice.email}</p>
              <p><span className="text-zinc-500">Metodo:</span> {invoice.paymentMethodLabel}</p>
              <p><span className="text-zinc-500">Tarjeta:</span> {invoice.maskedCard}</p>
            </div>
            <p className="text-xs text-zinc-400">La factura fue enviada al correo de tu cuenta y tambien puedes descargarla aqui.</p>
            <div className="flex justify-end gap-2">
              <Button type="button" className="bg-zinc-700 hover:bg-zinc-600" onClick={downloadInvoice}>
                Descargar factura
              </Button>
              <Button type="button" onClick={resetRechargeFlow}>
                Cerrar
              </Button>
            </div>
          </div>
        )}
      </Modal>
    </aside>
  );
}
