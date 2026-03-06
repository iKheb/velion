import { supabase } from "@/services/supabase";
import { requireAuthUser, requireNonEmptyText } from "@/services/supabase-helpers";
import type { SupportTicket, SupportTicketMessage } from "@/types/models";

const toSingle = <T>(value: T | T[] | null | undefined): T | null => {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
};

export interface CreateSupportTicketPayload {
  subject: string;
  description: string;
  category?: SupportTicket["category"];
  priority?: SupportTicket["priority"];
  contact_email?: string | null;
}

export const createSupportTicket = async (payload: CreateSupportTicketPayload): Promise<SupportTicket> => {
  const user = await requireAuthUser();

  const subject = requireNonEmptyText(payload.subject, "Debes ingresar un asunto.");
  const description = requireNonEmptyText(payload.description, "Debes describir tu problema.");

  const { data, error } = await supabase
    .from("support_tickets")
    .insert({
      requester_id: user.id,
      subject,
      description,
      category: payload.category ?? "other",
      priority: payload.priority ?? "normal",
      contact_email: payload.contact_email?.trim() || user.email || null,
    })
    .select("*")
    .single();

  if (error) throw error;
  return data as SupportTicket;
};

export const listMySupportTickets = async (): Promise<SupportTicket[]> => {
  const user = await requireAuthUser();
  const { data, error } = await supabase
    .from("support_tickets")
    .select("*")
    .eq("requester_id", user.id)
    .order("updated_at", { ascending: false });

  if (error) throw error;
  return (data ?? []) as SupportTicket[];
};

export const listSupportTicketMessages = async (ticketId: string): Promise<SupportTicketMessage[]> => {
  if (!ticketId) return [];

  const { data, error } = await supabase
    .from("support_ticket_messages")
    .select("id,ticket_id,sender_id,sender_role,message,created_at,sender:profiles(id,username,full_name,avatar_url)")
    .eq("ticket_id", ticketId)
    .order("created_at", { ascending: true });

  if (error) throw error;
  return ((data ?? []) as Array<Record<string, unknown>>).map((item) => ({
    id: item.id as string,
    ticket_id: item.ticket_id as string,
    sender_id: (item.sender_id as string | null) ?? null,
    sender_role: item.sender_role as SupportTicketMessage["sender_role"],
    message: item.message as string,
    created_at: item.created_at as string,
    sender: (toSingle(item.sender as SupportTicketMessage["sender"] | SupportTicketMessage["sender"][]) ?? null) as SupportTicketMessage["sender"],
  }));
};

export const addSupportTicketMessage = async (ticketId: string, message: string): Promise<SupportTicketMessage> => {
  const user = await requireAuthUser();
  const normalizedMessage = requireNonEmptyText(message, "Debes escribir un mensaje.");

  const { data, error } = await supabase
    .from("support_ticket_messages")
    .insert({
      ticket_id: ticketId,
      sender_id: user.id,
      sender_role: "user",
      message: normalizedMessage,
    })
    .select("id,ticket_id,sender_id,sender_role,message,created_at,sender:profiles(id,username,full_name,avatar_url)")
    .single();

  if (error) throw error;

  const { error: touchError } = await supabase
    .from("support_tickets")
    .update({ updated_at: new Date().toISOString(), status: "open" })
    .eq("id", ticketId)
    .eq("requester_id", user.id);

  if (touchError) throw touchError;
  return {
    id: data.id as string,
    ticket_id: data.ticket_id as string,
    sender_id: (data.sender_id as string | null) ?? null,
    sender_role: data.sender_role as SupportTicketMessage["sender_role"],
    message: data.message as string,
    created_at: data.created_at as string,
    sender: (toSingle(data.sender as SupportTicketMessage["sender"] | SupportTicketMessage["sender"][]) ?? null) as SupportTicketMessage["sender"],
  };
};
