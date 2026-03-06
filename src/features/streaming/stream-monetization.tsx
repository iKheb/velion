import { useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ErrorState, ListSkeleton } from "@/components/ui/data-state";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { MONETIZATION_COPY, PAYMENT_STATUS_LABEL, type PaymentUiStatus } from "@/lib/monetization";
import { toAppError } from "@/services/error.service";
import {
  buyIdentityVerification,
  buyPremiumSubscription,
  getMyWalletBalance,
  listMyPromotions,
  promoteContentWithCredits,
} from "@/services/monetization.service";
import { getStreamDonations, getStreams, getStreamsByStreamer, sendStreamDonation } from "@/services/streaming.service";
import { useAppStore } from "@/store/app.store";
import { toast } from "@/store/toast.store";

interface StreamMonetizationProps {
  scope?: "all" | "mine";
}

export function StreamMonetization({ scope = "all" }: StreamMonetizationProps) {
  const profile = useAppStore((state) => state.profile);
  const [selectedStreamId, setSelectedStreamId] = useState("");
  const [amountCredits, setAmountCredits] = useState("500");
  const [message, setMessage] = useState("");
  const [promotionTargetType, setPromotionTargetType] = useState<"post" | "stream" | "stream_vod">("post");
  const [promotionTargetId, setPromotionTargetId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [paymentStatus, setPaymentStatus] = useState<PaymentUiStatus>("idle");

  const {
    data: streams = [],
    isLoading: streamsLoading,
    error: streamsError,
  } = useQuery({
    queryKey: scope === "mine" ? ["streams", "mine", profile?.id] : ["streams"],
    queryFn: () => (scope === "mine" ? (profile?.id ? getStreamsByStreamer(profile.id) : Promise.resolve([])) : getStreams()),
  });

  const walletQuery = useQuery({
    queryKey: ["wallet-balance"],
    queryFn: getMyWalletBalance,
  });

  const promotionsQuery = useQuery({
    queryKey: ["my-content-promotions"],
    queryFn: listMyPromotions,
  });

  const streamId = useMemo(() => selectedStreamId || streams[0]?.id || "", [selectedStreamId, streams]);

  const { data: donations = [], refetch } = useQuery({
    queryKey: ["stream-donations", streamId],
    queryFn: () => getStreamDonations(streamId),
    enabled: Boolean(streamId),
  });

  const donationMutation = useMutation({
    mutationFn: async () => sendStreamDonation(streamId, Math.max(1, Math.round(Number(amountCredits))), message),
    onSuccess: async () => {
      setError(null);
      setMessage("");
      setPaymentStatus("success");
      await Promise.all([refetch(), walletQuery.refetch()]);
      toast.success("Donacion enviada", "La donacion se registro correctamente.");
    },
    onError: (err) => {
      const messageText = toAppError(err);
      setError(messageText);
      setPaymentStatus("failure");
      toast.error("No se pudo donar", messageText);
    },
  });

  const buyPremiumMutation = useMutation({
    mutationFn: async () => buyPremiumSubscription(1),
    onSuccess: async () => {
      setError(null);
      setPaymentStatus("success");
      await walletQuery.refetch();
      toast.success("Premium activado", "Tu suscripcion premium se actualizo.");
    },
    onError: (err) => {
      const messageText = toAppError(err);
      setError(messageText);
      setPaymentStatus("failure");
      toast.error("Error al comprar premium", messageText);
    },
  });

  const buyVerificationMutation = useMutation({
    mutationFn: async () => buyIdentityVerification(),
    onSuccess: async () => {
      setError(null);
      setPaymentStatus("success");
      await walletQuery.refetch();
      toast.success("Verificacion aplicada", "Tu estado de verificacion se actualizo.");
    },
    onError: (err) => {
      const messageText = toAppError(err);
      setError(messageText);
      setPaymentStatus("failure");
      toast.error("Error en verificacion", messageText);
    },
  });

  const promoteMutation = useMutation({
    mutationFn: async () =>
      promoteContentWithCredits({
        targetType: promotionTargetType,
        targetId: promotionTargetId.trim(),
        credits: 5,
        days: 1,
      }),
    onSuccess: async () => {
      setError(null);
      setPromotionTargetId("");
      setPaymentStatus("success");
      await Promise.all([walletQuery.refetch(), promotionsQuery.refetch()]);
      toast.success("Promocion aplicada", "El contenido quedo promocionado por 24 horas.");
    },
    onError: (err) => {
      const messageText = toAppError(err);
      setError(messageText);
      setPaymentStatus("failure");
      toast.error("No se pudo promocionar", messageText);
    },
  });

  const totalUsd = donations.reduce((acc, item) => acc + item.amount_cents, 0);

  return (
    <Card className="space-y-4">
      <h3 className="font-semibold">Monetizacion del stream</h3>

      <div className="rounded-lg bg-velion-black/40 p-3 text-sm">
        <p className="text-zinc-300">
          Saldo actual: <span className="font-semibold text-zinc-100">{walletQuery.data?.balance_credits ?? 0} creditos</span>
        </p>
        <p className="text-xs text-zinc-500" aria-live="polite">
          Estado: {PAYMENT_STATUS_LABEL[paymentStatus]}
        </p>
      </div>

      {streamsLoading && <ListSkeleton rows={2} />}
      {streamsError && <ErrorState title="No se pudieron cargar streams" description={toAppError(streamsError)} />}

      <div className="grid gap-2 md:grid-cols-2">
        <Button
          type="button"
          onClick={() => {
            setPaymentStatus("processing");
            buyPremiumMutation.mutate();
          }}
          disabled={buyPremiumMutation.isPending}
        >
          {buyPremiumMutation.isPending ? "Procesando..." : `Comprar ${MONETIZATION_COPY.premiumLabel}`}
        </Button>
        <Button
          type="button"
          className="bg-zinc-700 hover:bg-zinc-600"
          onClick={() => {
            setPaymentStatus("processing");
            buyVerificationMutation.mutate();
          }}
          disabled={buyVerificationMutation.isPending}
        >
          {buyVerificationMutation.isPending ? "Procesando..." : `Comprar ${MONETIZATION_COPY.verificationLabel}`}
        </Button>
      </div>

      <div className="grid gap-2 md:grid-cols-[1fr_140px_1fr_auto]">
        <FormField id="donation-stream" label="Stream">
          <Select id="donation-stream" value={streamId} onChange={(event) => setSelectedStreamId(event.target.value)}>
            {streams.map((stream) => (
              <option key={stream.id} value={stream.id}>
                {stream.title}
              </option>
            ))}
          </Select>
        </FormField>
        <FormField id="donation-credits" label="Creditos">
          <Input
            id="donation-credits"
            value={amountCredits}
            onChange={(event) => setAmountCredits(event.target.value)}
            type="number"
            min="1"
            step="1"
            placeholder="Creditos"
          />
        </FormField>
        <FormField id="donation-message" label="Mensaje">
          <Input id="donation-message" value={message} onChange={(event) => setMessage(event.target.value)} placeholder="Mensaje opcional" />
        </FormField>
        <div className="md:pt-6">
          <Button
            type="button"
            onClick={() => {
              setPaymentStatus("processing");
              donationMutation.mutate();
            }}
            disabled={!streamId || donationMutation.isPending}
            className="w-full md:w-auto"
          >
            {donationMutation.isPending ? "Enviando..." : "Donar"}
          </Button>
        </div>
      </div>

      <div className="space-y-2 rounded-lg border border-velion-steel/60 p-3">
        <p className="text-sm font-semibold">Promocionar contenido con creditos</p>
        <p className="text-xs text-zinc-400">{MONETIZATION_COPY.promotionCostLabel}</p>
        <div className="grid gap-2 md:grid-cols-[140px_1fr_auto]">
          <Select value={promotionTargetType} onChange={(event) => setPromotionTargetType(event.target.value as "post" | "stream" | "stream_vod")}>
            <option value="post">Post</option>
            <option value="stream">Stream</option>
            <option value="stream_vod">Video canal</option>
          </Select>
          <Input value={promotionTargetId} onChange={(event) => setPromotionTargetId(event.target.value)} placeholder="ID del contenido" />
          <Button
            type="button"
            onClick={() => {
              setPaymentStatus("processing");
              promoteMutation.mutate();
            }}
            disabled={promoteMutation.isPending || !promotionTargetId.trim()}
            className="w-full md:w-auto"
          >
            {promoteMutation.isPending ? "Aplicando..." : "Promocionar"}
          </Button>
        </div>
        {promotionsQuery.isLoading && <ListSkeleton rows={2} />}
        {promotionsQuery.error && <ErrorState title="No se pudo cargar promociones" description={toAppError(promotionsQuery.error)} />}
        <div className="space-y-1">
          {(promotionsQuery.data ?? []).slice(0, 5).map((promotion) => (
            <p key={promotion.id} className="text-xs text-zinc-300">
              {promotion.target_type} · {promotion.target_id} · {promotion.credits_spent} creditos · hasta{" "}
              {new Date(promotion.ends_at).toLocaleDateString()}
            </p>
          ))}
        </div>
      </div>

      {error && <p className="text-xs text-red-400">{error}</p>}

      <p className="text-sm text-zinc-300">
        Total recaudado: <span className="font-semibold">${totalUsd.toFixed(2)}</span>
      </p>

      <div className="space-y-1">
        {donations.slice(0, 6).map((item) => (
          <div key={item.id} className="rounded-lg bg-velion-black/40 px-3 py-2 text-xs text-zinc-200">
            <span className="font-semibold">{item.amount_cents} creditos</span>
            {item.message ? <span className="ml-2 text-zinc-300">{item.message}</span> : null}
          </div>
        ))}
        {!donations.length && <p className="text-sm text-zinc-400">Sin donaciones registradas.</p>}
      </div>
    </Card>
  );
}
