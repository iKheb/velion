const supportTicketsEqMock = vi.fn();
const supportTicketsLimitMock = vi.fn();
const supportTicketsUpdateEqMock = vi.fn();
const supportMessagesSingleMock = vi.fn();

vi.mock("@/services/supabase", () => ({
  hasSupabaseConfig: true,
  supabase: {
    auth: {
      getUser: vi.fn(async () => ({ data: { user: { id: "admin-1" } } })),
    },
    from: vi.fn((table: string) => {
      if (table === "support_tickets") {
        return {
          select: () => ({
            order: () => ({
              limit: supportTicketsLimitMock,
              eq: supportTicketsEqMock,
            }),
          }),
          update: () => ({
            eq: supportTicketsUpdateEqMock,
          }),
        };
      }

      if (table === "support_ticket_messages") {
        return {
          insert: () => ({
            select: () => ({
              single: supportMessagesSingleMock,
            }),
          }),
        };
      }

      throw new Error(`Unexpected table ${table}`);
    }),
  },
}));

describe("admin.service support features", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    supportTicketsLimitMock.mockReturnValue({
      eq: supportTicketsEqMock,
    });

    supportTicketsEqMock.mockResolvedValue({
      data: [
        {
          id: "ticket-2",
          requester_id: "user-2",
          subject: "Filtered",
          category: "billing",
          priority: "normal",
          status: "open",
          description: "billing",
          contact_email: null,
          created_at: "2026-01-02T00:00:00.000Z",
          updated_at: "2026-01-02T00:00:00.000Z",
          closed_at: null,
          requester: null,
        },
      ],
      error: null,
    });

    supportMessagesSingleMock.mockResolvedValue({
      data: {
        id: "msg-1",
        ticket_id: "ticket-1",
        sender_id: "admin-1",
        sender_role: "agent",
        message: "reply",
        created_at: "2026-01-03T00:00:00.000Z",
        sender: null,
      },
      error: null,
    });

    supportTicketsUpdateEqMock.mockResolvedValue({ error: null });
  });

  it("lists support tickets with status filter", async () => {
    const { listSupportTicketsAdmin } = await import("@/services/admin.service");
    const rows = await listSupportTicketsAdmin("open");

    expect(rows).toHaveLength(1);
    expect(rows[0]?.id).toBe("ticket-2");
    expect(supportTicketsEqMock).toHaveBeenCalledWith("status", "open");
  });

  it("adds admin support message and touches ticket", async () => {
    const { addSupportTicketMessageAsAdmin } = await import("@/services/admin.service");
    const row = await addSupportTicketMessageAsAdmin("ticket-1", " reply ");

    expect(row.id).toBe("msg-1");
    expect(supportMessagesSingleMock).toHaveBeenCalledTimes(1);
    expect(supportTicketsUpdateEqMock).toHaveBeenCalledWith("id", "ticket-1");
  });
});
