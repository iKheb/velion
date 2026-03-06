import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState, ErrorState, ListSkeleton } from "@/components/ui/data-state";
import { Input } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import { ModuleErrorBoundary } from "@/components/module-error-boundary";
import { PageHeader } from "@/components/ui/page-header";
import { getProfileRoute, ROUTES } from "@/lib/constants";
import { ChatWindow } from "@/features/chat/chat-window";
import { createDirectConversationByUsername, deleteConversationForMe, listConversations } from "@/services/chat.service";
import { toAppError } from "@/services/error.service";
import { toast } from "@/store/toast.store";

export default function MessagesPage() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [query, setQuery] = useState("");
  const [selectedConversationId, setSelectedConversationId] = useState("");
  const [openCreateConversationModal, setOpenCreateConversationModal] = useState(false);
  const [username, setUsername] = useState("");
  const [deleteCandidateId, setDeleteCandidateId] = useState<string | null>(null);

  const conversationsQuery = useQuery({ queryKey: ["conversations"], queryFn: listConversations });

  const createConversation = useMutation({
    mutationFn: createDirectConversationByUsername,
    onSuccess: async (conversationId) => {
      setUsername("");
      setOpenCreateConversationModal(false);
      await queryClient.invalidateQueries({ queryKey: ["conversations"] });
      setSelectedConversationId(conversationId);
      toast.success("Conversacion creada", "Ya puedes enviar mensajes.");
    },
    onError: (error) => toast.error("No se pudo crear la conversacion", toAppError(error)),
  });

  const deleteConversation = useMutation({
    mutationFn: deleteConversationForMe,
    onSuccess: async (_, deletedConversationId) => {
      await queryClient.invalidateQueries({ queryKey: ["conversations"] });
      if (selectedConversationId === deletedConversationId) setSelectedConversationId("");
      toast.success("Conversacion eliminada");
    },
    onError: (error) => toast.error("No se pudo eliminar", toAppError(error)),
  });

  const conversations = conversationsQuery.data ?? [];

  useEffect(() => {
    const fromQuery = searchParams.get("conversation") ?? "";
    if (fromQuery) {
      setSelectedConversationId(fromQuery);
      return;
    }

    if (!selectedConversationId && conversations.length) {
      setSelectedConversationId(conversations[0].conversation_id);
    }
  }, [conversations, searchParams, selectedConversationId]);

  useEffect(() => {
    if (!selectedConversationId) return;
    navigate({ pathname: ROUTES.messages, search: `?conversation=${encodeURIComponent(selectedConversationId)}` }, { replace: true });
  }, [navigate, selectedConversationId]);

  const filtered = useMemo(() => {
    const term = query.trim().toLowerCase();
    if (!term) return conversations;

    return conversations.filter((item) => {
      const candidate = `${item.peer_name} ${item.peer_username} ${item.last_message ?? ""}`.toLowerCase();
      return candidate.includes(term);
    });
  }, [conversations, query]);

  const selectedConversation = conversations.find((item) => item.conversation_id === selectedConversationId) ?? null;

  return (
    <section className="space-y-4">
      <PageHeader title="Mensajes" subtitle="Organiza conversaciones con enfoque y control total." />

      <div className="grid gap-4 lg:grid-cols-[300px_1fr]">
        <Card className="space-y-3">
          <div className="flex items-center justify-between gap-2">
            <Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar conversación..." />
            <Button type="button" className="bg-zinc-700 hover:bg-zinc-600" onClick={() => setOpenCreateConversationModal(true)}>
              Crear
            </Button>
          </div>

          {conversationsQuery.isLoading && <ListSkeleton rows={4} />}
          {conversationsQuery.error && <ErrorState title="No se pudieron cargar conversaciones" description={toAppError(conversationsQuery.error)} />}

          {!conversationsQuery.isLoading && !conversationsQuery.error && !conversations.length && (
            <EmptyState title="No tienes conversaciones" description="Inicia una nueva conversación para comenzar." />
          )}

          {!conversationsQuery.isLoading && !conversationsQuery.error && conversations.length > 0 && filtered.length === 0 && (
            <EmptyState title="Sin resultados" description="Prueba otro término de búsqueda." />
          )}

          <div className="space-y-2">
            {filtered.map((conversation) => (
              <button
                key={conversation.conversation_id}
                type="button"
                className={`w-full rounded-xl p-3 text-left transition ${
                  selectedConversationId === conversation.conversation_id
                    ? "bg-velion-fuchsia/20"
                    : "bg-velion-black/40 hover:bg-velion-black/70"
                }`}
                onClick={() => setSelectedConversationId(conversation.conversation_id)}
              >
                <div className="flex items-center justify-between gap-2">
                  <p className="truncate text-sm font-semibold text-zinc-100">{conversation.peer_name}</p>
                  <button
                    type="button"
                    className="rounded-md p-1 text-zinc-400 hover:text-rose-300"
                    onClick={(event) => {
                      event.stopPropagation();
                      setDeleteCandidateId(conversation.conversation_id);
                    }}
                    aria-label="Eliminar conversación"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
                <Link
                  to={getProfileRoute(conversation.peer_username)}
                  className="text-xs text-zinc-400 hover:text-white"
                  onClick={(event) => event.stopPropagation()}
                >
                  @{conversation.peer_username}
                </Link>
                <p className="mt-1 line-clamp-1 text-xs text-zinc-400">{conversation.last_message ?? "Sin mensajes"}</p>
              </button>
            ))}
          </div>
        </Card>

        <div className="space-y-2">
          {selectedConversation ? (
            <p className="text-sm text-zinc-300">
              Conversando con <span className="text-zinc-100 font-semibold">@{selectedConversation.peer_username}</span>
            </p>
          ) : null}

          {selectedConversationId ? (
            <ModuleErrorBoundary moduleName="chat">
              <ChatWindow
                conversationId={selectedConversationId}
                peerUsername={selectedConversation?.peer_username}
                peerAvatarUrl={selectedConversation?.peer_avatar_url}
                peerIsPremium={selectedConversation?.peer_is_premium}
                peerIsVerified={selectedConversation?.peer_is_verified}
              />
            </ModuleErrorBoundary>
          ) : (
            <EmptyState title="Selecciona una conversación" description="Elige una conversación de la lista para abrir el chat." />
          )}
        </div>
      </div>

      <Modal open={Boolean(deleteCandidateId)} onClose={() => setDeleteCandidateId(null)} title="Eliminar conversación">
        <div className="space-y-4">
          <p className="text-sm text-zinc-300">Esta acción eliminará la conversación de tu lista personal.</p>
          <div className="flex justify-end gap-2">
            <Button type="button" className="bg-zinc-700 hover:bg-zinc-600" onClick={() => setDeleteCandidateId(null)}>
              Cancelar
            </Button>
            <Button
              type="button"
              className="bg-red-700 hover:bg-red-600"
              onClick={() => {
                if (!deleteCandidateId) return;
                deleteConversation.mutate(deleteCandidateId);
                setDeleteCandidateId(null);
              }}
            >
              Eliminar
            </Button>
          </div>
        </div>
      </Modal>

      <Modal open={openCreateConversationModal} onClose={() => setOpenCreateConversationModal(false)} title="Iniciar conversación">
        <div className="space-y-3">
          <Input
            value={username}
            onChange={(event) => setUsername(event.target.value)}
            placeholder="@usuario"
            onKeyDown={(event) => {
              if (event.key !== "Enter") return;
              if (!username.trim() || createConversation.isPending) return;
              event.preventDefault();
              createConversation.mutate(username);
            }}
          />
          <div className="flex justify-end gap-2">
            <Button type="button" className="bg-zinc-700 hover:bg-zinc-600" onClick={() => setOpenCreateConversationModal(false)}>
              Cancelar
            </Button>
            <Button type="button" onClick={() => createConversation.mutate(username)} disabled={!username.trim() || createConversation.isPending}>
              Crear
            </Button>
          </div>
        </div>
      </Modal>
    </section>
  );
}
