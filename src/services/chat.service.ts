import { mockMessages, mockProfile } from "@/lib/mock";
import { enforceRateLimit } from "@/lib/rate-limit";
import { sanitizeInput } from "@/lib/sanitize";
import { trackEventFireAndForget } from "@/services/analytics.service";
import { createNotificationsBulk } from "@/services/notifications.service";
import { hasSupabaseConfig, supabase } from "@/services/supabase";
import type { ChatMessage, ConversationReadState, ConversationSummary } from "@/types/models";

const mockConversations: ConversationSummary[] = [
  {
    conversation_id: "conv-1",
    peer_id: "friend-1",
    peer_name: "Nova Wolf",
    peer_username: "nova_wolf",
    peer_avatar_url: mockProfile.avatar_url,
    last_message: mockMessages.at(-1)?.content ?? null,
    last_message_at: mockMessages.at(-1)?.created_at ?? null,
    unread_count: 0,
  },
];

const getMyUserId = async (): Promise<string | null> => {
  const user = (await supabase.auth.getUser()).data.user;
  return user?.id ?? null;
};

const isExternalUrl = (value: string | null | undefined): value is string =>
  Boolean(value && (value.startsWith("http://") || value.startsWith("https://")));

const getSignedChatUrl = async (path: string): Promise<string> => {
  const { data, error } = await supabase.storage.from("chat").createSignedUrl(path, 60 * 60 * 24 * 7);
  if (error || !data?.signedUrl) return path;
  return data.signedUrl;
};

const resolveChatAttachmentUrl = async (message: ChatMessage): Promise<ChatMessage> => {
  if (!message.attachment_url) return message;
  if (isExternalUrl(message.attachment_url)) return message;

  const signedUrl = await getSignedChatUrl(message.attachment_url);
  return { ...message, attachment_url: signedUrl };
};

const statusRank: Record<"sent" | "delivered" | "read", number> = {
  sent: 1,
  delivered: 2,
  read: 3,
};

const findExistingDirectConversation = async (me: string, peerId: string): Promise<string | null> => {
  const { data: myMemberships, error: myMembershipsError } = await supabase
    .from("conversation_members")
    .select("conversation_id")
    .eq("user_id", me);

  if (myMembershipsError) throw myMembershipsError;
  const myConversationIds = (myMemberships ?? []).map((item) => item.conversation_id as string);
  if (!myConversationIds.length) return null;

  const { data: peerMemberships, error: peerMembershipsError } = await supabase
    .from("conversation_members")
    .select("conversation_id")
    .eq("user_id", peerId)
    .in("conversation_id", myConversationIds);

  if (peerMembershipsError) throw peerMembershipsError;
  const sharedConversationIds = (peerMemberships ?? []).map((item) => item.conversation_id as string);
  if (!sharedConversationIds.length) return null;

  const { data: memberCounts, error: memberCountsError } = await supabase
    .from("conversation_members")
    .select("conversation_id,user_id")
    .in("conversation_id", sharedConversationIds);

  if (memberCountsError) throw memberCountsError;
  const membersByConversation = new Map<string, Set<string>>();
  for (const row of memberCounts ?? []) {
    const conversationId = row.conversation_id as string;
    const memberId = row.user_id as string;
    if (!membersByConversation.has(conversationId)) {
      membersByConversation.set(conversationId, new Set());
    }
    membersByConversation.get(conversationId)!.add(memberId);
  }

  for (const [conversationId, members] of membersByConversation.entries()) {
    if (members.size === 2 && members.has(me) && members.has(peerId)) {
      return conversationId;
    }
  }

  return null;
};

export const listConversations = async (): Promise<ConversationSummary[]> => {
  if (!hasSupabaseConfig) return mockConversations;

  const me = await getMyUserId();
  if (!me) return [];

  const { data: memberships, error: membershipsError } = await supabase
    .from("conversation_members")
    .select("conversation_id,last_read_at")
    .eq("user_id", me);

  if (membershipsError) throw membershipsError;

  const typedMemberships = (memberships ?? []) as Array<{ conversation_id: string; last_read_at: string | null }>;
  const conversationIds = typedMemberships.map((item) => item.conversation_id);
  if (!conversationIds.length) return [];
  const membershipByConversation = new Map(typedMemberships.map((item) => [item.conversation_id, item]));

  const { data: allMembers, error: allMembersError } = await supabase
    .from("conversation_members")
    .select("conversation_id,user_id")
    .in("conversation_id", conversationIds);

  if (allMembersError) throw allMembersError;

  const peerIds = (allMembers ?? []).filter((item) => item.user_id !== me).map((item) => item.user_id as string);

  const [{ data: profiles, error: profilesError }, { data: lastMessages, error: lastMessagesError }] = await Promise.all([
    supabase.from("profiles").select("id,full_name,username,avatar_url,is_premium,is_verified").in("id", peerIds),
    supabase
      .from("messages")
      .select("conversation_id,sender_id,content,created_at")
      .in("conversation_id", conversationIds)
      .order("created_at", { ascending: false }),
  ]);

  if (profilesError) throw profilesError;
  if (lastMessagesError) throw lastMessagesError;

  const profileMap = new Map((profiles ?? []).map((item) => [item.id as string, item]));
  const latestByConversation = new Map<string, { content: string; created_at: string }>();
  const unreadByConversation = new Map<string, number>();

  for (const message of lastMessages ?? []) {
    const conversationId = message.conversation_id as string;
    if (!latestByConversation.has(conversationId)) {
      latestByConversation.set(conversationId, {
        content: message.content as string,
        created_at: message.created_at as string,
      });
    }

    const membership = membershipByConversation.get(conversationId);
    const lastReadAt = membership?.last_read_at ? new Date(membership.last_read_at).getTime() : null;
    const messageCreatedAt = new Date(message.created_at as string).getTime();
    const isFromOtherUser = (message.sender_id as string) !== me;
    const isUnread = isFromOtherUser && (lastReadAt === null || messageCreatedAt > lastReadAt);

    if (isUnread) {
      unreadByConversation.set(conversationId, (unreadByConversation.get(conversationId) ?? 0) + 1);
    }
  }

  const conversations = conversationIds
    .map((conversationId) => {
      const peerMember = (allMembers ?? []).find(
        (item) => item.conversation_id === conversationId && item.user_id !== me,
      );
      const peer = peerMember ? profileMap.get(peerMember.user_id as string) : null;

      const latest = latestByConversation.get(conversationId);

      return {
        conversation_id: conversationId,
        peer_id: (peer?.id as string) ?? "",
        peer_name: (peer?.full_name as string) ?? "Usuario",
        peer_username: (peer?.username as string) ?? "unknown",
        peer_avatar_url: (peer?.avatar_url as string | null) ?? null,
        peer_is_premium: Boolean(peer?.is_premium),
        peer_is_verified: Boolean(peer?.is_verified),
        last_message: latest?.content ?? null,
        last_message_at: latest?.created_at ?? null,
        unread_count: unreadByConversation.get(conversationId) ?? 0,
      } satisfies ConversationSummary;
    });

  conversations.sort((a, b) => {
    const aDate = a.last_message_at ? new Date(a.last_message_at).getTime() : 0;
    const bDate = b.last_message_at ? new Date(b.last_message_at).getTime() : 0;
    return bDate - aDate;
  });

  return conversations;
};

export const createDirectConversationByUsername = async (username: string): Promise<string> => {
  const normalized = sanitizeInput(username).replace(/^@+/, "").toLowerCase();
  if (!normalized) throw new Error("Ingresa un usuario valido");

  if (!hasSupabaseConfig) return "conv-1";

  const me = await getMyUserId();
  if (!me) throw new Error("No autenticado");

  const { data: peer, error: peerError } = await supabase
    .from("profiles")
    .select("id")
    .ilike("username", normalized)
    .maybeSingle();

  if (peerError) throw peerError;
  if (!peer?.id) throw new Error("Usuario no encontrado");

  return createOrGetDirectConversationByPeerId(peer.id as string);
};

export const createOrGetDirectConversationByPeerId = async (peerId: string): Promise<string> => {
  if (!peerId) throw new Error("Usuario invalido");
  if (!hasSupabaseConfig) return "conv-1";

  const me = await getMyUserId();
  if (!me) throw new Error("No autenticado");
  if (me === peerId) throw new Error("No puedes abrir chat contigo");

  const existingConversationId = await findExistingDirectConversation(me, peerId);
  if (existingConversationId) {
    return existingConversationId;
  }

  const { data: conversationId, error: createError } = await supabase.rpc("create_dm_conversation", {
    peer_id: peerId,
  });

  if (createError) throw createError;
  trackEventFireAndForget("conversation_create", { peer_id: peerId });
  return conversationId as string;
};

export const getConversationMessages = async (conversationId: string): Promise<ChatMessage[]> => {
  if (!hasSupabaseConfig) return mockMessages;
  const me = await getMyUserId();
  if (!me) return [];

  const { data, error } = await supabase
    .from("messages")
    .select("*")
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: true })
    .limit(100);

  if (error) throw error;
  const messages = (data as ChatMessage[]) ?? [];
  if (!messages.length) return [];

  const messageIds = messages.map((message) => message.id);
  const { data: receipts, error: receiptsError } = await supabase
    .from("message_receipts")
    .select("message_id,status,delivered_at,read_at")
    .in("message_id", messageIds);

  if (receiptsError) throw receiptsError;

  const receiptByMessage = new Map<string, { status: "sent" | "delivered" | "read"; delivered_at: string | null; read_at: string | null }>();
  for (const row of receipts ?? []) {
    const messageId = row.message_id as string;
    const status = row.status as "sent" | "delivered" | "read";
    const existing = receiptByMessage.get(messageId);
    if (!existing || statusRank[status] > statusRank[existing.status]) {
      receiptByMessage.set(messageId, {
        status,
        delivered_at: (row.delivered_at as string | null) ?? null,
        read_at: (row.read_at as string | null) ?? null,
      });
    }
  }

  const enriched = messages.map((message) => {
    if (message.sender_id !== me) return message;
    const receipt = receiptByMessage.get(message.id);
    return {
      ...message,
      delivery_status: receipt?.status ?? "sent",
      delivered_at: receipt?.delivered_at ?? null,
      read_at: receipt?.read_at ?? null,
    };
  });

  return Promise.all(enriched.map((message) => resolveChatAttachmentUrl(message)));
};

export const markConversationAsDelivered = async (conversationId: string): Promise<void> => {
  if (!hasSupabaseConfig || !conversationId) return;

  const { error } = await supabase.rpc("mark_conversation_messages_delivered", {
    p_conversation_id: conversationId,
  });

  if (error) throw error;
};

export const markConversationAsRead = async (conversationId: string): Promise<void> => {
  if (!hasSupabaseConfig) return;

  const me = await getMyUserId();
  if (!me || !conversationId) return;

  const { error } = await supabase.rpc("mark_conversation_messages_read", {
    p_conversation_id: conversationId,
  });

  if (error) throw error;
};

export const getConversationReadState = async (conversationId: string): Promise<ConversationReadState[]> => {
  if (!hasSupabaseConfig || !conversationId) return [];

  const me = await getMyUserId();
  if (!me) return [];

  const { data, error } = await supabase
    .from("conversation_members")
    .select("user_id,last_read_at")
    .eq("conversation_id", conversationId);

  if (error) throw error;

  return ((data ?? []) as ConversationReadState[]).filter((item) => item.user_id !== me);
};

export const deleteConversationForMe = async (conversationId: string): Promise<void> => {
  if (!conversationId) return;
  if (!hasSupabaseConfig) return;

  const me = await getMyUserId();
  if (!me) throw new Error("No autenticado");

  const { error } = await supabase
    .from("conversation_members")
    .delete()
    .eq("conversation_id", conversationId)
    .eq("user_id", me);

  if (error) throw error;
};

export const sendMessage = async (conversationId: string, rawContent: string): Promise<void> => {
  const content = sanitizeInput(rawContent);
  if (!content) return;

  if (!hasSupabaseConfig) return;
  const user = (await supabase.auth.getUser()).data.user;
  if (!user) return;
  enforceRateLimit({
    key: `chat:message:${user.id}:${conversationId}`,
    maxRequests: 20,
    windowMs: 30_000,
    message: "Estas enviando mensajes muy rapido. Espera unos segundos.",
  });

  const { data: messageId, error } = await supabase.rpc("send_chat_message", {
    p_conversation_id: conversationId,
    p_message_type: "text",
    p_content: content,
    p_attachment_url: null,
    p_attachment_mime_type: null,
    p_attachment_size_bytes: null,
    p_attachment_duration_ms: null,
    p_client_idempotency_key: crypto.randomUUID(),
  });

  if (error) throw error;
  await markConversationAsDelivered(conversationId);
  await markConversationAsRead(conversationId);

  const { data: members, error: membersError } = await supabase
    .from("conversation_members")
    .select("user_id")
    .eq("conversation_id", conversationId);

  if (membersError) throw membersError;

  const recipientIds = (members ?? [])
    .map((item) => item.user_id as string)
    .filter((memberId) => memberId !== user.id);

  await createNotificationsBulk(recipientIds, "message", (messageId as string) ?? conversationId);
  trackEventFireAndForget("message_send", { conversation_id: conversationId, length: content.length });
};

type MediaMessageType = "image" | "video" | "audio";

export const sendMediaMessage = async (conversationId: string, file: File, messageType: MediaMessageType): Promise<void> => {
  if (!conversationId || !file) return;
  if (!hasSupabaseConfig) return;

  const user = (await supabase.auth.getUser()).data.user;
  if (!user) return;
  enforceRateLimit({
    key: `chat:media:${user.id}:${conversationId}`,
    maxRequests: 6,
    windowMs: 60_000,
    message: "Demasiados envios de archivos. Espera un minuto.",
  });

  const ext = file.name.split(".").pop() ?? (messageType === "audio" ? "webm" : "bin");
  const storagePath = `${user.id}/${conversationId}/${Date.now()}-${crypto.randomUUID()}.${ext}`;
  const uploadResult = await supabase.storage.from("chat").upload(storagePath, file, { upsert: true });
  if (uploadResult.error) throw uploadResult.error;

  const contentByType: Record<MediaMessageType, string> = {
    image: "[Imagen]",
    video: "[Video]",
    audio: "[Nota de voz]",
  };

  const { data: messageId, error } = await supabase.rpc("send_chat_message", {
    p_conversation_id: conversationId,
    p_message_type: messageType,
    p_content: contentByType[messageType],
    p_attachment_url: storagePath,
    p_attachment_mime_type: file.type || null,
    p_attachment_size_bytes: file.size,
    p_attachment_duration_ms: null,
    p_client_idempotency_key: crypto.randomUUID(),
  });

  if (error) throw error;
  await markConversationAsDelivered(conversationId);
  await markConversationAsRead(conversationId);

  const { data: members, error: membersError } = await supabase
    .from("conversation_members")
    .select("user_id")
    .eq("conversation_id", conversationId);

  if (membersError) throw membersError;

  const recipientIds = (members ?? [])
    .map((item) => item.user_id as string)
    .filter((memberId) => memberId !== user.id);

  await createNotificationsBulk(recipientIds, "message", (messageId as string) ?? conversationId);
  trackEventFireAndForget("message_send_media", { conversation_id: conversationId, message_type: messageType, size: file.size });
};

export const subscribeMessages = (conversationId: string, onMessage: (message: ChatMessage) => void) => {
  const channel = supabase
    .channel(`messages:${conversationId}`)
    .on(
      "postgres_changes",
      { event: "INSERT", schema: "public", table: "messages", filter: `conversation_id=eq.${conversationId}` },
      async (payload) => {
        const rawMessage = payload.new as ChatMessage;
        const resolvedMessage = await resolveChatAttachmentUrl(rawMessage);
        onMessage(resolvedMessage);
      },
    )
    .subscribe();

  return () => {
    void supabase.removeChannel(channel);
  };
};

export const subscribeConversationReadState = (conversationId: string, onChange: () => void) => {
  const channel = supabase
    .channel(`conversation_reads:${conversationId}`)
    .on(
      "postgres_changes",
      { event: "UPDATE", schema: "public", table: "conversation_members", filter: `conversation_id=eq.${conversationId}` },
      () => onChange(),
    )
    .on(
      "postgres_changes",
      { event: "INSERT", schema: "public", table: "conversation_members", filter: `conversation_id=eq.${conversationId}` },
      () => onChange(),
    )
    .on(
      "postgres_changes",
      { event: "UPDATE", schema: "public", table: "message_receipts" },
      () => onChange(),
    )
    .subscribe();

  return () => {
    void supabase.removeChannel(channel);
  };
};

export const getUnreadMessagesCount = async (): Promise<number> => {
  const conversations = await listConversations();
  return conversations.reduce((acc, conversation) => acc + (conversation.unread_count ?? 0), 0);
};

export const subscribeUnreadMessagesChanges = (userId: string, onChange: () => void) => {
  const channel = supabase
    .channel(`messages_unread:${userId}`)
    .on(
      "postgres_changes",
      { event: "INSERT", schema: "public", table: "messages" },
      () => onChange(),
    )
    .on(
      "postgres_changes",
      { event: "UPDATE", schema: "public", table: "conversation_members", filter: `user_id=eq.${userId}` },
      () => onChange(),
    )
    .on(
      "postgres_changes",
      { event: "INSERT", schema: "public", table: "conversation_members", filter: `user_id=eq.${userId}` },
      () => onChange(),
    )
    .subscribe();

  return () => {
    void supabase.removeChannel(channel);
  };
};
