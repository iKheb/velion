import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { discoverStreams } from "@/services/streaming.service";
import { StreamCard } from "@/features/streaming/stream-card";

const categories = ["", "Gaming", "FPS", "MOBA", "IRL", "Just Chatting", "Music"];

export function StreamDiscovery() {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("");
  const [liveOnly, setLiveOnly] = useState(true);

  const filters = useMemo(
    () => ({ query, category: category || undefined, liveOnly, sort: "viewers" as const }),
    [query, category, liveOnly],
  );

  const { data = [], isFetching, refetch } = useQuery({
    queryKey: ["discover-streams", filters],
    queryFn: () => discoverStreams(filters),
  });

  return (
    <Card className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar por titulo" className="min-w-56 flex-1" />
        <Select
          value={category}
          onChange={(event) => setCategory(event.target.value)}
        >
          {categories.map((item) => (
            <option key={item || "all"} value={item}>
              {item || "Todas"}
            </option>
          ))}
        </Select>
        <Button type="button" className={liveOnly ? "bg-emerald-600 hover:bg-emerald-500" : "bg-zinc-700 hover:bg-zinc-600"} onClick={() => setLiveOnly((value) => !value)}>
          {liveOnly ? "Solo en vivo" : "Todos"}
        </Button>
        <Button type="button" onClick={() => void refetch()} disabled={isFetching}>
          {isFetching ? "Actualizando..." : "Buscar"}
        </Button>
      </div>

      {!data.length && <p className="text-sm text-zinc-400">No hay streams con esos filtros.</p>}
      <div className="grid gap-4 lg:grid-cols-2">
        {data.map((stream) => (
          <StreamCard key={stream.id} stream={stream} />
        ))}
      </div>
    </Card>
  );
}
