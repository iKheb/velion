const createTicketSingleMock = vi.fn();
const insertMessageSingleMock = vi.fn();
const touchTicketEqRequesterMock = vi.fn();
const requireAuthUserMock = vi.fn();

vi.mock("@/services/supabase-helpers", () => ({
  requireAuthUser: requireAuthUserMock,
  requireNonEmptyText: (value: string, message: string) => {
    const normalized = (value ?? "").trim();
    if (!normalized) throw new Error(message);
    return normalized;
  },
}));

vi.mock("@/services/supabase", () => ({
  supabase: {
    from: vi.fn((table: string) => {
      if (table === "support_tickets") {
        return {
          insert: () => ({
            select: () => ({
              single: createTicketSingleMock,
            }),
          }),
          update: () => ({
            eq: () => ({
              eq: touchTicketEqRequesterMock,
            }),
          }),
        };
      }

      if (table === "support_ticket_messages") {
        return {
          insert: () => ({
            select: () => ({
              single: insertMessageSingleMock,
            }),
          }),
        };
      }

      throw new Error(`Unexpected table ${table}`);
    }),
  },
}));

describe("support.service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireAuthUserMock.mockResolvedValue({ id: "user-1", email: "demo@velion.app" });
    createTicketSingleMock.mockResolvedValue({
      data: {
        id: "ticket-1",
        requester_id: "user-1",
        subject: "Ayuda",
        description: "No puedo entrar",
        category: "other",
        priority: "normal",
      },
      error: null,
    });
    insertMessageSingleMock.mockResolvedValue({
      data: {
        id: "msg-1",
        ticket_id: "ticket-1",
        sender_id: "user-1",
        sender_role: "user",
        message: "detalle",
        created_at: new Date().toISOString(),
        sender: null,
      },
      error: null,
    });
    touchTicketEqRequesterMock.mockResolvedValue({ error: null });
  });

  it("creates support ticket with defaults", async () => {
    const { createSupportTicket } = await import("@/services/support.service");

    const created = await createSupportTicket({
      subject: "  Ayuda  ",
      description: "  No puedo entrar  ",
    });

    expect(created.id).toBe("ticket-1");
    expect(createTicketSingleMock).toHaveBeenCalledTimes(1);
  });

  it("adds message and touches ticket timestamp", async () => {
    const { addSupportTicketMessage } = await import("@/services/support.service");

    const response = await addSupportTicketMessage("ticket-1", " detalle ");

    expect(response.id).toBe("msg-1");
    expect(insertMessageSingleMock).toHaveBeenCalledTimes(1);
    expect(touchTicketEqRequesterMock).toHaveBeenCalled();
  });
});
