import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/components/ui/page-header";
import { Select } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { toAppError } from "@/services/error.service";
import {
  addSupportTicketMessage,
  createSupportTicket,
  listMySupportTickets,
  listSupportTicketMessages,
} from "@/services/support.service";
import type { SupportTicket } from "@/types/models";

const statusLabel: Record<SupportTicket["status"], string> = {
  open: "Abierto",
  in_progress: "En revision",
  waiting_user: "Esperando tu respuesta",
  resolved: "Resuelto",
  closed: "Cerrado",
};

export default function SupportPage() {
  const [subject, setSubject] = useState("");
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState<SupportTicket["category"]>("other");
  const [priority, setPriority] = useState<SupportTicket["priority"]>("normal");
  const [contactEmail, setContactEmail] = useState("");
  const [selectedTicketId, setSelectedTicketId] = useState<string | null>(null);
  const [replyMessage, setReplyMessage] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const ticketsQuery = useQuery({
    queryKey: ["support-tickets", "mine"],
    queryFn: listMySupportTickets,
  });

  useEffect(() => {
    if (!selectedTicketId && (ticketsQuery.data ?? []).length > 0) {
      setSelectedTicketId((ticketsQuery.data ?? [])[0].id);
    }
  }, [selectedTicketId, ticketsQuery.data]);

  const selectedTicket = useMemo(
    () => (ticketsQuery.data ?? []).find((ticket) => ticket.id === selectedTicketId) ?? null,
    [selectedTicketId, ticketsQuery.data],
  );

  const messagesQuery = useQuery({
    queryKey: ["support-ticket-messages", selectedTicketId],
    queryFn: () => listSupportTicketMessages(selectedTicketId ?? ""),
    enabled: Boolean(selectedTicketId),
  });

  const createTicketMutation = useMutation({
    mutationFn: createSupportTicket,
    onSuccess: async (ticket) => {
      setSubject("");
      setDescription("");
      setCategory("other");
      setPriority("normal");
      setReplyMessage("");
      setSelectedTicketId(ticket.id);
      setError(null);
      setSuccess("Ticket creado correctamente.");
      await ticketsQuery.refetch();
    },
    onError: (mutationError) => setError(toAppError(mutationError)),
  });

  const replyMutation = useMutation({
    mutationFn: async () => addSupportTicketMessage(selectedTicketId ?? "", replyMessage),
    onSuccess: async () => {
      setReplyMessage("");
      setError(null);
      setSuccess("Respuesta enviada.");
      await messagesQuery.refetch();
      await ticketsQuery.refetch();
    },
    onError: (mutationError) => setError(toAppError(mutationError)),
  });

  return (
    <section className="space-y-4">
      <PageHeader title="Centro de soporte" subtitle="Abre tickets y da seguimiento a tus casos con el equipo de Velion." />

      {error && <p className="text-xs text-red-400">{error}</p>}
      {success && <p className="text-xs text-emerald-400">{success}</p>}

      <Card className="space-y-3">
        <h2 className="font-semibold">Nuevo ticket</h2>
        <Input value={subject} onChange={(event) => setSubject(event.target.value)} placeholder="Asunto" />
        <textarea
          value={description}
          onChange={(event) => setDescription(event.target.value)}
          rows={4}
          placeholder="Describe tu problema"
          className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 outline-none placeholder:text-zinc-500 focus:border-velion-fuchsia"
        />
        <div className="grid gap-2 sm:grid-cols-3">
          <Select value={category} onChange={(event) => setCategory(event.target.value as SupportTicket["category"])}>
            <option value="account_access">Acceso a cuenta</option>
            <option value="technical_issue">Problema tecnico</option>
            <option value="billing">Facturacion</option>
            <option value="safety_report">Seguridad / reporte</option>
            <option value="other">Otro</option>
          </Select>
          <Select value={priority} onChange={(event) => setPriority(event.target.value as SupportTicket["priority"])}>
            <option value="low">Baja</option>
            <option value="normal">Normal</option>
            <option value="high">Alta</option>
            <option value="urgent">Urgente</option>
          </Select>
          <Input value={contactEmail} onChange={(event) => setContactEmail(event.target.value)} type="email" placeholder="Correo de contacto (opcional)" />
        </div>
        <Button
          type="button"
          className="justify-self-start"
          disabled={!subject.trim() || !description.trim() || createTicketMutation.isPending}
          onClick={() =>
            createTicketMutation.mutate({
              subject,
              description,
              category,
              priority,
              contact_email: contactEmail || null,
            })
          }
        >
          {createTicketMutation.isPending ? "Creando..." : "Crear ticket"}
        </Button>
      </Card>

      <div className="grid gap-4 lg:grid-cols-[320px_1fr]">
        <Card className="space-y-3">
          <h2 className="font-semibold">Mis tickets</h2>
          {ticketsQuery.isLoading && (
            <div className="space-y-2">
              <Skeleton className="h-16 w-full rounded-lg" />
              <Skeleton className="h-16 w-full rounded-lg" />
              <Skeleton className="h-16 w-full rounded-lg" />
            </div>
          )}
          {(ticketsQuery.data ?? []).length === 0 && !ticketsQuery.isLoading && <p className="text-sm text-zinc-400">Aun no has creado tickets.</p>}
          <div className="space-y-2">
            {(ticketsQuery.data ?? []).map((ticket) => (
              <button
                key={ticket.id}
                type="button"
                onClick={() => setSelectedTicketId(ticket.id)}
                className={`w-full rounded-lg border p-3 text-left transition ${
                  selectedTicketId === ticket.id
                    ? "border-velion-fuchsia bg-velion-fuchsia/10"
                    : "border-zinc-700 bg-velion-black/40 hover:border-zinc-500"
                }`}
              >
                <p className="text-sm font-medium text-zinc-100">{ticket.subject}</p>
                <p className="mt-1 text-xs text-zinc-400">{statusLabel[ticket.status]} - {new Date(ticket.updated_at).toLocaleString()}</p>
              </button>
            ))}
          </div>
        </Card>

        <Card className="space-y-3">
          <h2 className="font-semibold">Conversacion del ticket</h2>
          {!selectedTicket && <p className="text-sm text-zinc-400">Selecciona un ticket para ver detalles.</p>}
          {selectedTicket && (
            <>
              <div className="rounded-lg bg-velion-black/40 p-3">
                <p className="text-sm font-medium text-zinc-100">{selectedTicket.subject}</p>
                <p className="mt-1 text-xs text-zinc-400">
                  Estado: {statusLabel[selectedTicket.status]} - Prioridad: {selectedTicket.priority}
                </p>
                <p className="mt-3 whitespace-pre-wrap text-sm text-zinc-200">{selectedTicket.description}</p>
              </div>

              <div className="max-h-80 space-y-2 overflow-y-auto pr-1">
                {messagesQuery.isLoading && (
                  <div className="space-y-2">
                    <Skeleton className="h-14 w-[88%] rounded-lg" />
                    <Skeleton className="h-14 w-[80%] rounded-lg" />
                    <Skeleton className="h-14 w-[92%] rounded-lg" />
                  </div>
                )}
                {(messagesQuery.data ?? []).length === 0 && !messagesQuery.isLoading && (
                  <p className="text-sm text-zinc-400">Aun no hay respuestas en este ticket.</p>
                )}
                {(messagesQuery.data ?? []).map((item) => (
                  <div key={item.id} className={`rounded-lg p-3 text-sm ${item.sender_role === "user" ? "bg-zinc-800 text-zinc-100" : "bg-velion-fuchsia/15 text-zinc-100"}`}>
                    <p className="text-xs text-zinc-400">
                      {item.sender_role === "user" ? "Tu" : item.sender_role === "agent" ? "Soporte Velion" : "Sistema"} - {new Date(item.created_at).toLocaleString()}
                    </p>
                    <p className="mt-1 whitespace-pre-wrap">{item.message}</p>
                  </div>
                ))}
              </div>

              <textarea
                value={replyMessage}
                onChange={(event) => setReplyMessage(event.target.value)}
                rows={3}
                placeholder="Escribe una respuesta para soporte"
                className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 outline-none placeholder:text-zinc-500 focus:border-velion-fuchsia"
              />
              <Button
                type="button"
                className="justify-self-start"
                disabled={!replyMessage.trim() || replyMutation.isPending}
                onClick={() => replyMutation.mutate()}
              >
                {replyMutation.isPending ? "Enviando..." : "Enviar respuesta"}
              </Button>
            </>
          )}
        </Card>
      </div>
    </section>
  );
}
