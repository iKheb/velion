import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { invalidateMany } from "@/lib/query-utils";
import { Select } from "@/components/ui/select";
import { toAppError } from "@/services/error.service";
import {
  createStreamRaid,
  createStreamSchedule,
  getMyScheduleReminderIds,
  getRecentRaids,
  getStreams,
  getStreamsByStreamer,
  getUpcomingSchedules,
  removeScheduleReminder,
  setScheduleReminder,
} from "@/services/streaming.service";
import { useAppStore } from "@/store/app.store";

interface StreamGrowthPhaseProps {
  scope?: "all" | "mine";
}

export function StreamGrowthPhase({ scope = "all" }: StreamGrowthPhaseProps) {
  const queryClient = useQueryClient();
  const profile = useAppStore((state) => state.profile);

  const [title, setTitle] = useState("Directo programado");
  const [category, setCategory] = useState("Gaming");
  const [description, setDescription] = useState("");
  const [scheduledFor, setScheduledFor] = useState("");
  const [raidMessage, setRaidMessage] = useState("Les mando a mi comunidad");
  const [raidFrom, setRaidFrom] = useState("");
  const [raidTo, setRaidTo] = useState("");
  const [error, setError] = useState<string | null>(null);

  const schedulesQuery = useQuery({ queryKey: ["stream-schedules"], queryFn: getUpcomingSchedules });
  const reminderIdsQuery = useQuery({ queryKey: ["my-stream-reminders"], queryFn: getMyScheduleReminderIds });
  const streamsQuery = useQuery({
    queryKey: scope === "mine" ? ["streams", "mine", profile?.id] : ["streams"],
    queryFn: () => (scope === "mine" ? (profile?.id ? getStreamsByStreamer(profile.id) : Promise.resolve([])) : getStreams()),
  });
  const raidsQuery = useQuery({
    queryKey: ["stream-raids", raidTo],
    queryFn: () => getRecentRaids(raidTo),
    enabled: Boolean(raidTo),
  });
  const schedules = schedulesQuery.data ?? [];
  const reminderIds = reminderIdsQuery.data ?? [];
  const streams = streamsQuery.data ?? [];
  const raids = raidsQuery.data ?? [];

  const myLiveStreams = useMemo(
    () => streams.filter((stream) => stream.streamer_id === profile?.id && stream.is_live),
    [profile?.id, streams],
  );
  const liveTargets = useMemo(() => streams.filter((stream) => stream.is_live), [streams]);

  const scheduleMutation = useMutation({
    mutationFn: async () => createStreamSchedule({ title, category, description, scheduledFor }),
    onMutate: () => setError(null),
    onSuccess: async () => {
      setDescription("");
      await invalidateMany(queryClient, [["stream-schedules"]]);
    },
    onError: (err) => setError(toAppError(err)),
  });

  const reminderMutation = useMutation({
    mutationFn: async ({ scheduleId, shouldEnable }: { scheduleId: string; shouldEnable: boolean }) => {
      if (shouldEnable) return setScheduleReminder(scheduleId);
      return removeScheduleReminder(scheduleId);
    },
    onMutate: () => setError(null),
    onSuccess: async () => {
      await invalidateMany(queryClient, [["my-stream-reminders"]]);
    },
    onError: (err) => setError(toAppError(err)),
  });

  const raidMutation = useMutation({
    mutationFn: async () => createStreamRaid(raidFrom, raidTo, raidMessage),
    onMutate: () => setError(null),
    onSuccess: async () => {
      await invalidateMany(queryClient, [["stream-raids", raidTo]]);
    },
    onError: (err) => setError(toAppError(err)),
  });

  return (
    <section className="grid gap-4 lg:grid-cols-2">
      <Card className="space-y-3">
        <h3 className="font-semibold">Fase siguiente: programacion y recordatorios</h3>
        <div className="grid gap-2">
          <Input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Titulo" />
          <Input value={category} onChange={(event) => setCategory(event.target.value)} placeholder="Categoria" />
          <Input value={description} onChange={(event) => setDescription(event.target.value)} placeholder="Descripcion" />
          <Input value={scheduledFor} onChange={(event) => setScheduledFor(event.target.value)} type="datetime-local" />
          <Button type="button" onClick={() => scheduleMutation.mutate()} disabled={!scheduledFor || scheduleMutation.isPending}>
            {scheduleMutation.isPending ? "Guardando..." : "Programar stream"}
          </Button>
        </div>

        <div className="space-y-2">
          {schedulesQuery.isLoading && <p className="text-sm text-zinc-400">Cargando streams programados...</p>}
          {schedulesQuery.error && <p className="text-xs text-red-400">{toAppError(schedulesQuery.error)}</p>}
          {schedules.slice(0, 6).map((schedule) => {
            const hasReminder = reminderIds.includes(schedule.id);
            return (
              <div key={schedule.id} className="rounded-lg bg-velion-black/40 p-2 text-sm">
                <p className="font-medium">{schedule.title}</p>
                <p className="text-xs text-zinc-400">{new Date(schedule.scheduled_for).toLocaleString()}</p>
                <Button
                  type="button"
                  className={hasReminder ? "mt-2 bg-zinc-700 hover:bg-zinc-600" : "mt-2"}
                  onClick={() => reminderMutation.mutate({ scheduleId: schedule.id, shouldEnable: !hasReminder })}
                  disabled={reminderMutation.isPending}
                >
                  {hasReminder ? "Quitar recordatorio" : "Recordarme"}
                </Button>
              </div>
            );
          })}
          {!schedules.length && <p className="text-sm text-zinc-400">No hay streams programados.</p>}
        </div>
      </Card>

      <Card className="space-y-3">
        <h3 className="font-semibold">Raids entre directos</h3>
        <div className="grid gap-2">
          <Select
            value={raidFrom}
            onChange={(event) => setRaidFrom(event.target.value)}
          >
            <option value="">Selecciona tu stream origen</option>
            {myLiveStreams.map((stream) => (
              <option key={stream.id} value={stream.id}>
                {stream.title}
              </option>
            ))}
          </Select>
          <Select
            value={raidTo}
            onChange={(event) => setRaidTo(event.target.value)}
          >
            <option value="">Selecciona stream destino</option>
            {liveTargets.map((stream) => (
              <option key={stream.id} value={stream.id}>
                {stream.title}
              </option>
            ))}
          </Select>
          <Input value={raidMessage} onChange={(event) => setRaidMessage(event.target.value)} placeholder="Mensaje de raid" />
          <Button type="button" onClick={() => raidMutation.mutate()} disabled={!raidFrom || !raidTo || raidMutation.isPending}>
            {raidMutation.isPending ? "Enviando..." : "Lanzar raid"}
          </Button>
        </div>

        <div className="space-y-1">
          {raidsQuery.isLoading && raidTo && <p className="text-sm text-zinc-400">Cargando raids...</p>}
          {raidsQuery.error && <p className="text-xs text-red-400">{toAppError(raidsQuery.error)}</p>}
          {raids.map((raid) => (
            <p key={raid.id} className="rounded bg-velion-black/40 p-2 text-xs text-zinc-300">
              Raid {new Date(raid.created_at).toLocaleString()} - {raid.message ?? "sin mensaje"}
            </p>
          ))}
          {!raids.length && <p className="text-sm text-zinc-400">Sin raids recientes en este stream.</p>}
        </div>
      </Card>

      {error && <p className="lg:col-span-2 text-xs text-red-400">{error}</p>}
    </section>
  );
}
