import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { getStreams, getStreamsByStreamer, startStream, stopStream, subscribeStreams } from "@/services/streaming.service";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import { StreamCard } from "@/features/streaming/stream-card";
import { useAppStore } from "@/store/app.store";
import { toAppError } from "@/services/error.service";

interface StreamingHubProps {
  scope?: "all" | "mine";
}

export function StreamingHub({ scope = "all" }: StreamingHubProps) {
  const queryClient = useQueryClient();
  const profile = useAppStore((state) => state.profile);
  const [title, setTitle] = useState("Mi stream en Velion");
  const [category, setCategory] = useState("Gaming");
  const [openStartModal, setOpenStartModal] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const streamsQueryKey = useMemo(() => (scope === "mine" ? ["streams", "mine", profile?.id] : ["streams"]), [scope, profile?.id]);

  const { data = [], refetch } = useQuery({
    queryKey: streamsQueryKey,
    queryFn: () => (scope === "mine" ? (profile?.id ? getStreamsByStreamer(profile.id) : Promise.resolve([])) : getStreams()),
  });

  useEffect(() => {
    return subscribeStreams(() => void queryClient.invalidateQueries({ queryKey: streamsQueryKey }));
  }, [queryClient, streamsQueryKey]);

  const stopMutation = useMutation({
    mutationFn: stopStream,
    onSuccess: async () => {
      setError(null);
      await queryClient.invalidateQueries({ queryKey: streamsQueryKey });
    },
    onError: (err) => setError(toAppError(err)),
  });

  const onStart = async () => {
    try {
      await startStream(title, category);
      setError(null);
      setOpenStartModal(false);
      await refetch();
    } catch (err) {
      setError(toAppError(err));
    }
  };

  return (
    <section className="space-y-4">
      <div className="flex items-center justify-between rounded-2xl border border-velion-steel/70 bg-velion-discord/50 p-4">
        <p className="text-sm text-zinc-300">
          Gestiona tus transmisiones desde un flujo limpio y enfocado.
        </p>
        <Button type="button" onClick={() => setOpenStartModal(true)}>
          Iniciar stream
        </Button>
      </div>

      {error && <p className="text-xs text-red-400">{error}</p>}

      <div className="grid gap-4 lg:grid-cols-2">
        {data.map((stream) => (
          <StreamCard
            key={stream.id}
            stream={stream}
            isOwner={stream.streamer_id === profile?.id}
            onStop={(streamId) => stopMutation.mutate(streamId)}
            isStopping={stopMutation.isPending}
          />
        ))}
      </div>

      <Modal open={openStartModal} onClose={() => setOpenStartModal(false)} title="Iniciar nuevo stream">
        <div className="grid gap-3">
          <Input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Titulo del stream" />
          <Input value={category} onChange={(event) => setCategory(event.target.value)} placeholder="Categoria" />
          <div className="flex justify-end gap-2">
            <Button type="button" className="bg-zinc-700 hover:bg-zinc-600" onClick={() => setOpenStartModal(false)}>
              Cancelar
            </Button>
            <Button type="button" onClick={() => void onStart()}>
              Confirmar
            </Button>
          </div>
        </div>
      </Modal>
    </section>
  );
}
