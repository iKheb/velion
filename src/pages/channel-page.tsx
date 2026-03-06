import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useParams } from "react-router-dom";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { PageHeader } from "@/components/ui/page-header";
import { invalidateMany } from "@/lib/query-utils";
import { LiveChat } from "@/features/streaming/live-chat";
import {
  createClip,
  getClipsByStream,
  getStreamById,
  getTrendingClips,
  incrementClipViews,
  stopStream,
  toggleClipLike,
} from "@/services/streaming.service";
import { toAppError } from "@/services/error.service";
import { useAppStore } from "@/store/app.store";

export default function ChannelPage() {
  const queryClient = useQueryClient();
  const profile = useAppStore((state) => state.profile);
  const { id } = useParams();
  const [clipUrl, setClipUrl] = useState("");
  const [clipTitle, setClipTitle] = useState("");
  const [clipStartSeconds, setClipStartSeconds] = useState("");
  const [clipEndSeconds, setClipEndSeconds] = useState("");
  const [openCreateClipModal, setOpenCreateClipModal] = useState(false);
  const [clipError, setClipError] = useState<string | null>(null);

  const streamQuery = useQuery({
    queryKey: ["stream", id],
    queryFn: () => getStreamById(id ?? ""),
    enabled: Boolean(id),
  });
  const stream = streamQuery.data;

  const clipsQuery = useQuery({
    queryKey: ["stream-clips", id],
    queryFn: () => getClipsByStream(id ?? ""),
    enabled: Boolean(id),
  });
  const clips = clipsQuery.data ?? [];

  const trendingClipsQuery = useQuery({
    queryKey: ["trending-clips"],
    queryFn: () => getTrendingClips(5),
  });
  const trendingClips = trendingClipsQuery.data ?? [];

  const createClipMutation = useMutation({
    mutationFn: async () =>
      createClip(id ?? "", clipUrl, clipTitle, {
        startSeconds: clipStartSeconds ? Number(clipStartSeconds) : null,
        endSeconds: clipEndSeconds ? Number(clipEndSeconds) : null,
      }),
    onMutate: () => setClipError(null),
    onSuccess: async () => {
      setClipUrl("");
      setClipTitle("");
      setClipStartSeconds("");
      setClipEndSeconds("");
      setOpenCreateClipModal(false);
      setClipError(null);
      await invalidateMany(queryClient, [["stream-clips", id], ["trending-clips"]]);
    },
    onError: (error) => setClipError(toAppError(error)),
  });

  const stopStreamMutation = useMutation({
    mutationFn: async () => stopStream(id ?? ""),
    onMutate: () => setClipError(null),
    onSuccess: async () => {
      await invalidateMany(queryClient, [["stream", id], ["streams"]]);
    },
    onError: (error) => setClipError(toAppError(error)),
  });

  const clipLikeMutation = useMutation({
    mutationFn: async (clipId: string) => toggleClipLike(clipId),
    onMutate: () => setClipError(null),
    onError: (error) => setClipError(toAppError(error)),
  });

  const onOpenClip = async (clipId: string) => {
    try {
      await incrementClipViews(clipId);
      await invalidateMany(queryClient, [["stream-clips", id], ["trending-clips"]]);
    } catch (error) {
      setClipError(toAppError(error));
    }
  };

  const canModerate = Boolean(stream?.streamer_id === profile?.id || profile?.role === "admin");

  return (
    <section className="space-y-4">
      <PageHeader
        title={stream?.title ?? "Stream"}
        subtitle={`${stream?.is_live ? "En vivo" : "Offline"} · ${stream?.category ?? "General"}`}
        actions={
          <Button type="button" onClick={() => setOpenCreateClipModal(true)}>
            Crear clip
          </Button>
        }
      />

      <div className="grid gap-4 xl:grid-cols-[1fr_320px]">
        <Card className="p-0">
          <div className="grid h-[62vh] place-content-center rounded-2xl bg-black text-zinc-300">
            <div className="space-y-2 text-center">
              <p className="text-sm">Stream {id}</p>
              <h2 className="text-xl font-bold">{stream?.title ?? "Stream"}</h2>
              <p className="text-xs text-zinc-400">{stream?.category ?? "General"}</p>
              <p className="text-xs text-zinc-400">{stream?.is_live ? "En vivo" : "Offline"} · Player listo para RTMP/OBS</p>
              {stream?.streamer_id === profile?.id && stream?.is_live && (
                <Button
                  type="button"
                  className="mx-auto mt-2 bg-red-700 px-3 py-1 text-xs hover:bg-red-600"
                  onClick={() => stopStreamMutation.mutate()}
                  disabled={stopStreamMutation.isPending}
                >
                  {stopStreamMutation.isPending ? "Finalizando..." : "Finalizar stream"}
                </Button>
              )}
            </div>
          </div>
        </Card>

        {id ? (
          <LiveChat streamId={id} canModerate={canModerate} currentUserId={profile?.id ?? null} />
        ) : (
          <Card className="grid h-[62vh] place-content-center">Sin stream</Card>
        )}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="space-y-2">
          <h3 className="font-semibold">Clips del Stream</h3>
          {clipsQuery.isLoading && <p className="text-sm text-zinc-400">Cargando clips...</p>}
          {clipsQuery.error && <p className="text-xs text-red-400">{toAppError(clipsQuery.error)}</p>}
          {!clips.length && <p className="text-sm text-zinc-400">Sin clips todavia.</p>}
          {clips.map((clip) => (
            <div key={clip.id} className="rounded-lg bg-velion-black/50 p-2 text-sm">
              <a
                href={clip.clip_url}
                target="_blank"
                rel="noreferrer"
                className="block hover:opacity-90"
                onClick={() => void onOpenClip(clip.id)}
              >
                <p className="font-medium">{clip.title ?? "Clip"}</p>
                <p className="truncate text-xs text-zinc-400">{clip.clip_url}</p>
              </a>
              <div className="mt-2 flex items-center gap-2 text-xs text-zinc-300">
                <span>Views: {clip.views_count ?? 0}</span>
                <button
                  type="button"
                  className="rounded bg-zinc-700 px-2 py-1 hover:bg-zinc-600"
                  onClick={() => clipLikeMutation.mutate(clip.id)}
                  disabled={clipLikeMutation.isPending}
                >
                  Like
                </button>
              </div>
            </div>
          ))}
        </Card>

        <Card className="space-y-2">
          <h3 className="font-semibold">Clips en tendencia</h3>
          {trendingClipsQuery.isLoading && <p className="text-sm text-zinc-400">Cargando tendencia...</p>}
          {trendingClipsQuery.error && <p className="text-xs text-red-400">{toAppError(trendingClipsQuery.error)}</p>}
          {!trendingClips.length && <p className="text-sm text-zinc-400">Sin clips en tendencia.</p>}
          {trendingClips.map((clip) => (
            <a key={clip.id} href={clip.clip_url} target="_blank" rel="noreferrer" className="block rounded-lg bg-velion-black/50 p-2 text-sm hover:bg-velion-black/70">
              <p className="font-medium">{clip.title ?? "Clip"}</p>
              <p className="text-xs text-zinc-400">Views: {clip.views_count ?? 0}</p>
            </a>
          ))}
        </Card>
      </div>

      {clipError && <p className="text-xs text-red-400">{clipError}</p>}

      <Modal open={openCreateClipModal} onClose={() => setOpenCreateClipModal(false)} title="Crear clip avanzado">
        <div className="grid gap-3">
          <Input value={clipTitle} onChange={(event) => setClipTitle(event.target.value)} placeholder="Titulo del clip" />
          <Input value={clipUrl} onChange={(event) => setClipUrl(event.target.value)} placeholder="URL del clip" />
          <div className="grid gap-2 sm:grid-cols-2">
            <Input
              value={clipStartSeconds}
              onChange={(event) => setClipStartSeconds(event.target.value)}
              placeholder="Inicio (s)"
              type="number"
              min="0"
            />
            <Input value={clipEndSeconds} onChange={(event) => setClipEndSeconds(event.target.value)} placeholder="Fin (s)" type="number" min="0" />
          </div>
          <div className="flex justify-end gap-2">
            <Button type="button" className="bg-zinc-700 hover:bg-zinc-600" onClick={() => setOpenCreateClipModal(false)}>
              Cancelar
            </Button>
            <Button type="button" onClick={() => createClipMutation.mutate()} disabled={!id || !clipUrl.trim()}>
              Guardar clip
            </Button>
          </div>
        </div>
      </Modal>
    </section>
  );
}
