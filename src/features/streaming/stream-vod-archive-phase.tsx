import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { invalidateMany } from "@/lib/query-utils";
import { Modal } from "@/components/ui/modal";
import { Select } from "@/components/ui/select";
import { toAppError } from "@/services/error.service";
import {
  createStreamVod,
  createStreamVodChapter,
  getMyStreamVods,
  getStreamVodChapters,
  getStreamsByStreamer,
  updateStreamVodVisibility,
} from "@/services/streaming.service";
import { useAppStore } from "@/store/app.store";

export function StreamVodArchivePhase() {
  const queryClient = useQueryClient();
  const profile = useAppStore((state) => state.profile);
  const [title, setTitle] = useState("Replay del directo");
  const [vodUrl, setVodUrl] = useState("");
  const [thumbnailUrl, setThumbnailUrl] = useState("");
  const [durationSeconds, setDurationSeconds] = useState("");
  const [streamId, setStreamId] = useState("");
  const [openCreateModal, setOpenCreateModal] = useState(false);
  const [selectedVodId, setSelectedVodId] = useState("");
  const [chapterTitle, setChapterTitle] = useState("Inicio");
  const [chapterStart, setChapterStart] = useState("0");
  const [error, setError] = useState<string | null>(null);

  const myStreamsQuery = useQuery({
    queryKey: ["streams", "mine", profile?.id],
    queryFn: () => (profile?.id ? getStreamsByStreamer(profile.id) : Promise.resolve([])),
  });
  const myStreams = myStreamsQuery.data ?? [];

  const vodsQuery = useQuery({ queryKey: ["stream-vods", "mine"], queryFn: getMyStreamVods });
  const vods = vodsQuery.data ?? [];

  const activeVodId = useMemo(() => selectedVodId || vods[0]?.id || "", [selectedVodId, vods]);

  const chaptersQuery = useQuery({
    queryKey: ["stream-vod-chapters", activeVodId],
    queryFn: () => getStreamVodChapters(activeVodId),
    enabled: Boolean(activeVodId),
  });
  const chapters = chaptersQuery.data ?? [];

  const createVodMutation = useMutation({
    mutationFn: async () =>
      createStreamVod({
        streamId: streamId || null,
        title,
        vodUrl,
        thumbnailUrl,
        durationSeconds: durationSeconds ? Number(durationSeconds) : null,
        visibility: "public",
      }),
    onMutate: () => setError(null),
    onSuccess: async () => {
      setVodUrl("");
      setThumbnailUrl("");
      setDurationSeconds("");
      setOpenCreateModal(false);
      await invalidateMany(queryClient, [["stream-vods", "mine"]]);
    },
    onError: (err) => setError(toAppError(err)),
  });

  const updateVisibilityMutation = useMutation({
    mutationFn: async (payload: { vodId: string; visibility: "public" | "unlisted" | "private" }) =>
      updateStreamVodVisibility(payload.vodId, payload.visibility),
    onMutate: () => setError(null),
    onSuccess: async () => {
      await invalidateMany(queryClient, [["stream-vods", "mine"]]);
    },
    onError: (err) => setError(toAppError(err)),
  });

  const createChapterMutation = useMutation({
    mutationFn: async () => createStreamVodChapter(activeVodId, chapterTitle, Number(chapterStart)),
    onMutate: () => setError(null),
    onSuccess: async () => {
      setChapterTitle("Momento destacado");
      await invalidateMany(queryClient, [["stream-vod-chapters", activeVodId]]);
    },
    onError: (err) => setError(toAppError(err)),
  });

  return (
    <section className="grid gap-4 lg:grid-cols-2">
      <Card className="space-y-3">
        <h3 className="font-semibold">Siguiente fase: VODs y archivo del canal</h3>
        <div className="space-y-2 text-sm text-zinc-300">
          <p>Centraliza tus replays, define visibilidad y organiza capítulos para que el contenido quede profesional.</p>
          <p>VODs creados: <span className="font-semibold text-zinc-100">{vods.length}</span></p>
          {vodsQuery.isLoading && <p className="text-xs text-zinc-400">Cargando VODs...</p>}
          {vodsQuery.error && <p className="text-xs text-red-400">{toAppError(vodsQuery.error)}</p>}
        </div>
        <div className="flex justify-end">
          <Button type="button" onClick={() => setOpenCreateModal(true)}>
            Nuevo VOD
          </Button>
        </div>
      </Card>

      <Card className="space-y-3">
        <h3 className="font-semibold">Gestion de visibilidad y capitulos</h3>

        <Select
          value={activeVodId}
          onChange={(event) => setSelectedVodId(event.target.value)}
        >
          {vods.map((vod) => (
            <option key={vod.id} value={vod.id}>
              {vod.title}
            </option>
          ))}
        </Select>

        {activeVodId ? (
          <div className="space-y-2">
            <div className="grid gap-2 sm:grid-cols-3">
              <Button type="button" className="bg-zinc-700 hover:bg-zinc-600" onClick={() => updateVisibilityMutation.mutate({ vodId: activeVodId, visibility: "public" })}>
                Publico
              </Button>
              <Button type="button" className="bg-zinc-700 hover:bg-zinc-600" onClick={() => updateVisibilityMutation.mutate({ vodId: activeVodId, visibility: "unlisted" })}>
                Oculto
              </Button>
              <Button type="button" className="bg-zinc-700 hover:bg-zinc-600" onClick={() => updateVisibilityMutation.mutate({ vodId: activeVodId, visibility: "private" })}>
                Privado
              </Button>
            </div>

            <div className="grid gap-2 md:grid-cols-[1fr_120px_auto]">
              <Input value={chapterTitle} onChange={(event) => setChapterTitle(event.target.value)} placeholder="Titulo capitulo" />
              <Input value={chapterStart} onChange={(event) => setChapterStart(event.target.value)} type="number" min="0" placeholder="Segundo" />
              <Button type="button" onClick={() => createChapterMutation.mutate()} disabled={createChapterMutation.isPending}>
                Agregar
              </Button>
            </div>

            <div className="space-y-1">
              {chaptersQuery.isLoading && <p className="text-xs text-zinc-400">Cargando capitulos...</p>}
              {chaptersQuery.error && <p className="text-xs text-red-400">{toAppError(chaptersQuery.error)}</p>}
              {chapters.map((chapter) => (
                <p key={chapter.id} className="rounded bg-velion-black/40 p-2 text-xs text-zinc-300">
                  {chapter.title} - {chapter.start_seconds}s
                </p>
              ))}
              {!chapters.length && <p className="text-sm text-zinc-400">Sin capitulos aun.</p>}
            </div>
          </div>
        ) : (
          <p className="text-sm text-zinc-400">No hay VODs creados.</p>
        )}
      </Card>

      {error && <p className="lg:col-span-2 text-xs text-red-400">{error}</p>}

      <Modal open={openCreateModal} onClose={() => setOpenCreateModal(false)} title="Publicar nuevo VOD">
        <div className="grid gap-3">
          <Select
            value={streamId}
            onChange={(event) => setStreamId(event.target.value)}
          >
            <option value="">Sin stream asociado</option>
            {myStreams.map((stream) => (
              <option key={stream.id} value={stream.id}>
                {stream.title}
              </option>
            ))}
          </Select>
          <Input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Titulo del VOD" />
          <Input value={vodUrl} onChange={(event) => setVodUrl(event.target.value)} placeholder="URL del VOD" />
          <Input value={thumbnailUrl} onChange={(event) => setThumbnailUrl(event.target.value)} placeholder="URL thumbnail (opcional)" />
          <Input
            value={durationSeconds}
            onChange={(event) => setDurationSeconds(event.target.value)}
            placeholder="Duracion en segundos (opcional)"
            type="number"
            min="0"
          />
          <div className="flex justify-end gap-2">
            <Button type="button" className="bg-zinc-700 hover:bg-zinc-600" onClick={() => setOpenCreateModal(false)}>
              Cancelar
            </Button>
            <Button type="button" onClick={() => createVodMutation.mutate()} disabled={!vodUrl || createVodMutation.isPending}>
              {createVodMutation.isPending ? "Guardando..." : "Publicar VOD"}
            </Button>
          </div>
        </div>
      </Modal>
    </section>
  );
}
