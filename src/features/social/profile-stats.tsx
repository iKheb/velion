import { Card } from "@/components/ui/card";

interface ProfileStatsProps {
  friends: number;
  followers: number;
  following: number;
  subscribers: number;
  subscribed: number;
}

export function ProfileStats({ friends, followers, following, subscribers, subscribed }: ProfileStatsProps) {
  return (
    <Card className="grid grid-cols-5 gap-1 p-3">
      <div className="min-w-0 text-center"><p className="text-xl font-bold">{friends}</p><p className="whitespace-nowrap text-[11px] text-zinc-400">Amigos</p></div>
      <div className="min-w-0 text-center"><p className="text-xl font-bold">{followers}</p><p className="whitespace-nowrap text-[11px] text-zinc-400">Seguidores</p></div>
      <div className="min-w-0 text-center"><p className="text-xl font-bold">{following}</p><p className="whitespace-nowrap text-[11px] text-zinc-400">Siguiendo</p></div>
      <div className="min-w-0 text-center"><p className="text-xl font-bold">{subscribers}</p><p className="whitespace-nowrap text-[11px] text-zinc-400">Suscriptores</p></div>
      <div className="min-w-0 text-center"><p className="text-xl font-bold">{subscribed}</p><p className="whitespace-nowrap text-[11px] text-zinc-400">Suscritos</p></div>
    </Card>
  );
}

