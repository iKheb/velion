import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "react-router-dom";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { acceptFriendRequest, followUser, listSuggestedProfiles, sendFriendRequest } from "@/services/relations.service";
import { createOrGetDirectConversationByPeerId } from "@/services/chat.service";
import { toAppError } from "@/services/error.service";
import { getProfileRoute, ROUTES } from "@/lib/constants";
import { invalidateMany } from "@/lib/query-utils";

export function SuggestedPeople() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const suggestionsQuery = useQuery({
    queryKey: ["suggested-people"],
    queryFn: () => listSuggestedProfiles(6),
  });

  const followMutation = useMutation({
    mutationFn: followUser,
    onSuccess: async () => {
      await invalidateMany(queryClient, [["suggested-people"], ["feed"]]);
    },
  });

  const sendFriendRequestMutation = useMutation({
    mutationFn: sendFriendRequest,
    onSuccess: async () => {
      await invalidateMany(queryClient, [["suggested-people"]]);
    },
  });

  const acceptFriendRequestMutation = useMutation({
    mutationFn: acceptFriendRequest,
    onSuccess: async () => {
      await invalidateMany(queryClient, [["suggested-people"], ["profile-stats"]]);
    },
  });

  const messageMutation = useMutation({
    mutationFn: createOrGetDirectConversationByPeerId,
    onSuccess: (conversationId) => {
      navigate(`${ROUTES.messages}?conversation=${encodeURIComponent(conversationId)}`);
    },
  });

  return (
    <Card className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold">Personas sugeridas</h2>
        <Button className="bg-zinc-700 px-3 py-1 text-xs" onClick={() => suggestionsQuery.refetch()} disabled={suggestionsQuery.isFetching}>
          Actualizar
        </Button>
      </div>

      {suggestionsQuery.isLoading && <p className="text-xs text-zinc-400">Cargando sugerencias...</p>}
      {suggestionsQuery.error && <p className="text-xs text-red-400">{toAppError(suggestionsQuery.error)}</p>}
      {(suggestionsQuery.data ?? []).length === 0 && (
        <p className="text-xs text-zinc-400">No hay sugerencias disponibles por ahora.</p>
      )}

      {(suggestionsQuery.data ?? []).map((person) => (
        <article key={person.id} className="flex items-center justify-between gap-3 rounded-lg bg-velion-black/40 p-2">
          <div className="flex min-w-0 items-center gap-2">
            <img src={person.avatar_url ?? "https://placehold.co/64"} alt="avatar" className="h-9 w-9 rounded-full object-cover" />
            <div className="min-w-0">
              <Link to={getProfileRoute(person.username)} className="truncate text-sm font-medium hover:text-velion-fuchsia">
                {person.full_name}
              </Link>
              <Link to={getProfileRoute(person.username)} className="truncate text-xs text-zinc-400 hover:text-white">
                @{person.username}
              </Link>
              <p className="truncate text-[11px] text-zinc-500">
                {person.mutual_friends_count > 0
                  ? `${person.mutual_friends_count} amigo${person.mutual_friends_count === 1 ? "" : "s"} en comun`
                  : "Sin amigos en comun"}
              </p>
              {person.follows_you && <p className="truncate text-[11px] text-emerald-400">Te sigue</p>}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button
              className="bg-zinc-700 px-3 py-1 text-xs"
              disabled={messageMutation.isPending}
              onClick={() => messageMutation.mutate(person.id)}
            >
              Mensaje
            </Button>
            <Button
              className="px-3 py-1 text-xs"
              disabled={followMutation.isPending}
              onClick={() => followMutation.mutate(person.id)}
            >
              Seguir
            </Button>
            {person.friendship_state === "none" && (
              <Button
                className="bg-zinc-700 px-3 py-1 text-xs"
                disabled={sendFriendRequestMutation.isPending}
                onClick={() => sendFriendRequestMutation.mutate(person.id)}
              >
                Agregar
              </Button>
            )}
            {person.friendship_state === "pending_outgoing" && (
              <Button className="bg-zinc-800 px-3 py-1 text-xs" disabled>
                Solicitud enviada
              </Button>
            )}
            {person.friendship_state === "pending_incoming" && (
              <Button
                className="bg-emerald-700 px-3 py-1 text-xs"
                disabled={acceptFriendRequestMutation.isPending || !person.incoming_friendship_id}
                onClick={() => {
                  if (!person.incoming_friendship_id) return;
                  acceptFriendRequestMutation.mutate(person.incoming_friendship_id);
                }}
              >
                Aceptar
              </Button>
            )}
            {person.friendship_state === "friends" && (
              <Button className="bg-zinc-800 px-3 py-1 text-xs" disabled>
                Amigos
              </Button>
            )}
          </div>
        </article>
      ))}
    </Card>
  );
}
