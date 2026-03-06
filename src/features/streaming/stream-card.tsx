import { Radio } from "lucide-react";
import { Link } from "react-router-dom";
import { Card } from "@/components/ui/card";
import type { Stream } from "@/types/models";

interface StreamCardProps {
  stream: Stream;
  isOwner?: boolean;
  onStop?: (streamId: string) => void;
  isStopping?: boolean;
}

export function StreamCard({ stream, isOwner = false, onStop, isStopping = false }: StreamCardProps) {
  return (
    <Card className="space-y-2">
      <div className="relative h-40 overflow-hidden rounded-xl bg-black">
        <div className="grid h-full place-content-center text-zinc-400">Player listo para RTMP/OBS</div>
        {stream.is_live && (
          <span className="absolute left-2 top-2 inline-flex items-center gap-1 rounded bg-red-600 px-2 py-1 text-xs font-semibold">
            <Radio size={12} /> LIVE
          </span>
        )}
      </div>
      <h4 className="font-semibold">{stream.title}</h4>
      <p className="text-xs text-zinc-400">
        {stream.category} · {stream.viewer_count} viewers
      </p>
      <div className="flex items-center justify-between">
        <Link to={`/streaming/${stream.id}`} className="text-xs text-velion-fuchsia">
          Ir al Stream
        </Link>
        {isOwner && stream.is_live && onStop && (
          <button
            type="button"
            className="rounded bg-red-700 px-2 py-1 text-xs font-semibold text-white hover:bg-red-600 disabled:opacity-60"
            onClick={() => onStop(stream.id)}
            disabled={isStopping}
          >
            {isStopping ? "Finalizando..." : "Finalizar"}
          </button>
        )}
      </div>
    </Card>
  );
}
