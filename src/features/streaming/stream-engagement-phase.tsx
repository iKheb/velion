import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { invalidateMany } from "@/lib/query-utils";
import { Select } from "@/components/ui/select";
import { toAppError } from "@/services/error.service";
import {
  closeStreamPoll,
  contributeToStreamGoal,
  createStreamGoal,
  createStreamPoll,
  getPollVotes,
  getStreamGoals,
  getStreamPolls,
  getStreams,
  getStreamsByStreamer,
  voteStreamPoll,
} from "@/services/streaming.service";
import { useAppStore } from "@/store/app.store";

interface StreamEngagementPhaseProps {
  scope?: "all" | "mine";
}

export function StreamEngagementPhase({ scope = "all" }: StreamEngagementPhaseProps) {
  const queryClient = useQueryClient();
  const profile = useAppStore((state) => state.profile);

  const [streamId, setStreamId] = useState("");
  const [goalTitle, setGoalTitle] = useState("Meta de comunidad");
  const [goalTarget, setGoalTarget] = useState("100");
  const [pollQuestion, setPollQuestion] = useState("Que jugamos ahora?");
  const [pollOptionsRaw, setPollOptionsRaw] = useState("Ranked, Scrims, Custom");
  const [contributionValue, setContributionValue] = useState("10");
  const [error, setError] = useState<string | null>(null);

  const streamsQuery = useQuery({
    queryKey: scope === "mine" ? ["streams", "mine", profile?.id] : ["streams"],
    queryFn: () => (scope === "mine" ? (profile?.id ? getStreamsByStreamer(profile.id) : Promise.resolve([])) : getStreams()),
  });
  const streams = streamsQuery.data ?? [];
  const resolvedStreamId = useMemo(() => streamId || streams.find((stream) => stream.is_live)?.id || streams[0]?.id || "", [streamId, streams]);

  const goalsQuery = useQuery({
    queryKey: ["stream-goals", resolvedStreamId],
    queryFn: () => getStreamGoals(resolvedStreamId),
    enabled: Boolean(resolvedStreamId),
  });
  const goals = goalsQuery.data ?? [];

  const pollsQuery = useQuery({
    queryKey: ["stream-polls", resolvedStreamId],
    queryFn: () => getStreamPolls(resolvedStreamId),
    enabled: Boolean(resolvedStreamId),
  });
  const polls = pollsQuery.data ?? [];

  const latestPoll = polls[0];

  const votesQuery = useQuery({
    queryKey: ["stream-poll-votes", latestPoll?.id],
    queryFn: () => getPollVotes(latestPoll!.id),
    enabled: Boolean(latestPoll?.id),
  });
  const latestVotes = votesQuery.data ?? [];

  const createGoalMutation = useMutation({
    mutationFn: async () => createStreamGoal({ streamId: resolvedStreamId, title: goalTitle, targetValue: Number(goalTarget), metric: "custom" }),
    onMutate: () => setError(null),
    onSuccess: async () => {
      await invalidateMany(queryClient, [["stream-goals", resolvedStreamId]]);
    },
    onError: (err) => setError(toAppError(err)),
  });

  const contributeMutation = useMutation({
    mutationFn: async (goalId: string) => contributeToStreamGoal(goalId, Number(contributionValue)),
    onMutate: () => setError(null),
    onSuccess: async () => {
      await invalidateMany(queryClient, [["stream-goals", resolvedStreamId]]);
    },
    onError: (err) => setError(toAppError(err)),
  });

  const createPollMutation = useMutation({
    mutationFn: async () =>
      createStreamPoll({
        streamId: resolvedStreamId,
        question: pollQuestion,
        options: pollOptionsRaw
          .split(",")
          .map((item) => item.trim())
          .filter(Boolean),
      }),
    onMutate: () => setError(null),
    onSuccess: async () => {
      await invalidateMany(queryClient, [["stream-polls", resolvedStreamId]]);
    },
    onError: (err) => setError(toAppError(err)),
  });

  const closePollMutation = useMutation({
    mutationFn: async (pollId: string) => closeStreamPoll(pollId),
    onMutate: () => setError(null),
    onSuccess: async () => {
      await invalidateMany(queryClient, [["stream-polls", resolvedStreamId]]);
    },
    onError: (err) => setError(toAppError(err)),
  });

  const voteMutation = useMutation({
    mutationFn: async (payload: { pollId: string; optionIndex: number }) => voteStreamPoll(payload.pollId, payload.optionIndex),
    onMutate: () => setError(null),
    onSuccess: async () => {
      await invalidateMany(queryClient, [["stream-poll-votes", latestPoll?.id]]);
    },
    onError: (err) => setError(toAppError(err)),
  });

  const isModerator = profile?.id && streams.some((stream) => stream.id === resolvedStreamId && stream.streamer_id === profile.id);

  return (
    <section className="grid gap-4 lg:grid-cols-2">
      <Card className="space-y-3">
        <h3 className="font-semibold">Siguiente fase: engagement en vivo</h3>
        <Select
          value={resolvedStreamId}
          onChange={(event) => setStreamId(event.target.value)}
        >
          {streams.map((stream) => (
            <option key={stream.id} value={stream.id}>
              {stream.title}
            </option>
          ))}
        </Select>
        {streamsQuery.isLoading && <p className="text-sm text-zinc-400">Cargando streams...</p>}
        {streamsQuery.error && <p className="text-xs text-red-400">{toAppError(streamsQuery.error)}</p>}

        <div className="grid gap-2 md:grid-cols-[1fr_120px_auto]">
          <Input value={goalTitle} onChange={(event) => setGoalTitle(event.target.value)} placeholder="Meta" />
          <Input value={goalTarget} onChange={(event) => setGoalTarget(event.target.value)} type="number" min="1" placeholder="Objetivo" />
          <Button type="button" onClick={() => createGoalMutation.mutate()} disabled={!resolvedStreamId || createGoalMutation.isPending || !isModerator}>
            Crear meta
          </Button>
        </div>

        <div className="space-y-2">
          {goalsQuery.isLoading && <p className="text-sm text-zinc-400">Cargando metas...</p>}
          {goalsQuery.error && <p className="text-xs text-red-400">{toAppError(goalsQuery.error)}</p>}
          {goals.map((goal) => {
            const percent = Math.min(100, Math.round((goal.current_value / Math.max(1, goal.target_value)) * 100));
            return (
              <div key={goal.id} className="rounded-lg bg-velion-black/40 p-2 text-sm">
                <p className="font-medium">{goal.title}</p>
                <p className="text-xs text-zinc-400">
                  {goal.current_value} / {goal.target_value} ({percent}%)
                </p>
                <div className="mt-1 h-2 rounded bg-zinc-800">
                  <div className="h-2 rounded bg-emerald-500" style={{ width: `${percent}%` }} />
                </div>
                {goal.status === "active" && (
                  <div className="mt-2 flex gap-2">
                    <Input
                      value={contributionValue}
                      onChange={(event) => setContributionValue(event.target.value)}
                      type="number"
                      min="1"
                      className="h-8"
                    />
                    <Button type="button" className="h-8 px-3 py-1" onClick={() => contributeMutation.mutate(goal.id)} disabled={contributeMutation.isPending}>
                      Aportar
                    </Button>
                  </div>
                )}
              </div>
            );
          })}
          {!goals.length && <p className="text-sm text-zinc-400">No hay metas creadas.</p>}
        </div>
      </Card>

      <Card className="space-y-3">
        <h3 className="font-semibold">Encuestas en vivo</h3>
        <div className="grid gap-2">
          <Input value={pollQuestion} onChange={(event) => setPollQuestion(event.target.value)} placeholder="Pregunta" />
          <Input value={pollOptionsRaw} onChange={(event) => setPollOptionsRaw(event.target.value)} placeholder="Opciones separadas por coma" />
          <Button type="button" onClick={() => createPollMutation.mutate()} disabled={!resolvedStreamId || createPollMutation.isPending || !isModerator}>
            Crear encuesta
          </Button>
        </div>

        {latestPoll ? (
          <div className="space-y-2 rounded-lg bg-velion-black/40 p-3 text-sm">
            {votesQuery.isLoading && <p className="text-xs text-zinc-400">Cargando votos...</p>}
            {votesQuery.error && <p className="text-xs text-red-400">{toAppError(votesQuery.error)}</p>}
            <p className="font-semibold">{latestPoll.question}</p>
            {latestPoll.options.map((option, index) => {
              const totalVotes = latestVotes.length || 1;
              const votes = latestVotes.filter((vote) => vote.option_index === index).length;
              const pct = Math.round((votes / totalVotes) * 100);
              return (
                <div key={`${latestPoll.id}-${index}`}>
                  <div className="flex items-center justify-between gap-2">
                    <span>{option}</span>
                    <span className="text-xs text-zinc-400">{votes} votos - {pct}%</span>
                  </div>
                  <div className="mt-1 h-2 rounded bg-zinc-800">
                    <div className="h-2 rounded bg-sky-500" style={{ width: `${pct}%` }} />
                  </div>
                  {latestPoll.status === "open" && (
                    <Button
                      type="button"
                      className="mt-1 h-7 bg-zinc-700 px-2 py-1 text-xs hover:bg-zinc-600"
                      onClick={() => voteMutation.mutate({ pollId: latestPoll.id, optionIndex: index })}
                      disabled={voteMutation.isPending}
                    >
                      Votar
                    </Button>
                  )}
                </div>
              );
            })}

            {latestPoll.status === "open" && isModerator && (
              <Button
                type="button"
                className="bg-red-700 hover:bg-red-600"
                onClick={() => closePollMutation.mutate(latestPoll.id)}
                disabled={closePollMutation.isPending}
              >
                Cerrar encuesta
              </Button>
            )}
          </div>
        ) : (
          <p className="text-sm text-zinc-400">No hay encuestas activas.</p>
        )}
      </Card>

      {error && <p className="lg:col-span-2 text-xs text-red-400">{error}</p>}
    </section>
  );
}
