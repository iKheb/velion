import { useQuery } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { getStreamDashboardSummary } from "@/services/streaming.service";

const metricStyles = "rounded-xl border border-velion-steel/70 bg-velion-black/40 p-3";

export function StreamerDashboard() {
  const { data, isLoading } = useQuery({
    queryKey: ["stream-dashboard-summary"],
    queryFn: getStreamDashboardSummary,
  });

  return (
    <Card className="space-y-3">
      <h3 className="font-semibold">Dashboard del streamer</h3>

      {isLoading && <p className="text-sm text-zinc-400">Cargando metricas...</p>}
      {data && (
        <div className="grid gap-3 md:grid-cols-3">
          <div className={metricStyles}>
            <p className="text-xs text-zinc-400">Streams totales</p>
            <p className="text-2xl font-bold">{data.streams_total}</p>
          </div>
          <div className={metricStyles}>
            <p className="text-xs text-zinc-400">Live ahora</p>
            <p className="text-2xl font-bold">{data.live_now}</p>
          </div>
          <div className={metricStyles}>
            <p className="text-xs text-zinc-400">Mensajes en vivo</p>
            <p className="text-2xl font-bold">{data.total_messages}</p>
          </div>
          <div className={metricStyles}>
            <p className="text-xs text-zinc-400">Clips generados</p>
            <p className="text-2xl font-bold">{data.total_clips}</p>
          </div>
          <div className={metricStyles}>
            <p className="text-xs text-zinc-400">Donaciones</p>
            <p className="text-2xl font-bold">${(data.total_donations_cents / 100).toFixed(2)}</p>
          </div>
          <div className={metricStyles}>
            <p className="text-xs text-zinc-400">Subs activas</p>
            <p className="text-2xl font-bold">{data.total_subscribers}</p>
          </div>
        </div>
      )}
    </Card>
  );
}
