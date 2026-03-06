import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { EmptyState, ErrorState, ListSkeleton } from "@/components/ui/data-state";
import { PageHeader } from "@/components/ui/page-header";
import { StreamCard } from "@/features/streaming/stream-card";
import { ROUTES } from "@/lib/constants";
import { toAppError } from "@/services/error.service";
import { getStreams, subscribeStreams } from "@/services/streaming.service";

export default function StreamingPage() {
  const queryClient = useQueryClient();
  const { data = [], isLoading, error } = useQuery({ queryKey: ["streams"], queryFn: getStreams });

  useEffect(() => subscribeStreams(() => void queryClient.invalidateQueries({ queryKey: ["streams"] })), [queryClient]);

  const liveStreams = data.filter((stream) => stream.is_live);

  return (
    <section className="space-y-4">
      <PageHeader
        title="Streaming en vivo"
        subtitle="Explora solo transmisiones activas en este momento."
        actions={
          <Link to={ROUTES.streamingStudio}>
            <Button type="button" className="bg-zinc-700 text-xs hover:bg-zinc-600">
              Gestionar canal
            </Button>
          </Link>
        }
      />

      {isLoading && <ListSkeleton rows={3} />}
      {error && <ErrorState title="No se pudieron cargar streams" description={toAppError(error)} />}

      {!isLoading && !error && !liveStreams.length && (
        <EmptyState title="No hay streams en vivo" description="Cuando alguien empiece a transmitir aparecera aqui." />
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        {liveStreams.map((stream) => (
          <StreamCard key={stream.id} stream={stream} />
        ))}
      </div>
    </section>
  );
}
