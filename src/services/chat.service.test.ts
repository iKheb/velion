const sendChatMessageRpcMock = vi.fn();
const markReadRpcMock = vi.fn();
const markDeliveredRpcMock = vi.fn();
const createNotificationsBulkMock = vi.fn();
const trackEventMock = vi.fn();

vi.mock("@/lib/sanitize", () => ({
  sanitizeInput: (value: string) => value.trim(),
}));

vi.mock("@/services/analytics.service", () => ({
  trackEventFireAndForget: trackEventMock,
}));

vi.mock("@/services/notifications.service", () => ({
  createNotificationsBulk: createNotificationsBulkMock,
}));

vi.mock("@/services/supabase", () => ({
  hasSupabaseConfig: true,
  supabase: {
    rpc: vi.fn((fn: string, params: Record<string, unknown>) => {
      if (fn === "send_chat_message") return sendChatMessageRpcMock(params);
      if (fn === "mark_conversation_messages_read") return markReadRpcMock(params);
      if (fn === "mark_conversation_messages_delivered") return markDeliveredRpcMock(params);
      return Promise.resolve({ data: null, error: null });
    }),
    auth: {
      getUser: vi.fn(async () => ({ data: { user: { id: "user-1" } } })),
    },
    from: vi.fn((table: string) => {
      if (table === "conversation_members") {
        return {
          select: () => ({
            eq: () =>
              Promise.resolve({
                data: [{ user_id: "user-1" }, { user_id: "user-2" }],
                error: null,
              }),
          }),
        };
      }

      throw new Error(`Unexpected table ${table}`);
    }),
  },
}));

describe("chat.service sendMessage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sendChatMessageRpcMock.mockResolvedValue({ data: "msg-1", error: null });
    markReadRpcMock.mockResolvedValue({ data: 1, error: null });
    markDeliveredRpcMock.mockResolvedValue({ data: 1, error: null });
    createNotificationsBulkMock.mockResolvedValue(undefined);
  });

  it("does nothing for empty messages", async () => {
    const { sendMessage } = await import("@/services/chat.service");

    await sendMessage("conv-1", "   ");

    expect(sendChatMessageRpcMock).not.toHaveBeenCalled();
    expect(createNotificationsBulkMock).not.toHaveBeenCalled();
  });

  it("sends message, marks as read and notifies recipients", async () => {
    const { sendMessage } = await import("@/services/chat.service");

    await sendMessage("conv-1", "Hola mundo");

    expect(sendChatMessageRpcMock).toHaveBeenCalledWith(
      expect.objectContaining({
        p_conversation_id: "conv-1",
        p_message_type: "text",
        p_content: "Hola mundo",
      }),
    );
    expect(createNotificationsBulkMock).toHaveBeenCalledWith(["user-2"], "message", "msg-1");
    expect(trackEventMock).toHaveBeenCalledWith(
      "message_send",
      expect.objectContaining({ conversation_id: "conv-1", length: 10 }),
    );
  });
});
