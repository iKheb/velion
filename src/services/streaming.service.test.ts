const donationRpcMock = vi.fn();
const trackEventMock = vi.fn();

vi.mock("@/services/account-settings.service", () => ({
  assertCanInteractWithUserContent: vi.fn(async () => undefined),
  canViewUserContent: vi.fn(async () => true),
  validateMentionsAllowed: vi.fn(async () => undefined),
}));

vi.mock("@/services/analytics.service", () => ({
  trackEventFireAndForget: trackEventMock,
}));

vi.mock("@/services/notifications.service", () => ({
  createNotification: vi.fn(async () => undefined),
  createNotificationsBulk: vi.fn(async () => undefined),
}));

vi.mock("@/services/supabase", () => ({
  hasSupabaseConfig: true,
  supabase: {
    auth: {
      getUser: vi.fn(async () => ({ data: { user: { id: "user-1" } } })),
    },
    from: vi.fn((table: string) => {
      throw new Error(`Unexpected table ${table}`);
    }),
    rpc: donationRpcMock,
  },
}));

describe("streaming.service sendStreamDonation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    donationRpcMock.mockResolvedValue({ error: null });
  });

  it("throws when donation amount is invalid", async () => {
    const { sendStreamDonation } = await import("@/services/streaming.service");

    await expect(sendStreamDonation("stream-1", 0)).rejects.toThrow("Monto invalido");
    expect(donationRpcMock).not.toHaveBeenCalled();
  });

  it("sends donation with credits and tracks analytics", async () => {
    const { sendStreamDonation } = await import("@/services/streaming.service");

    await sendStreamDonation("stream-1", 2550, "Grande");

    expect(donationRpcMock).toHaveBeenCalledWith("send_stream_donation_with_credits", {
      stream_id_input: "stream-1",
      amount_credits_input: 2550,
      message_input: "Grande",
    });
    expect(trackEventMock).toHaveBeenCalledWith("stream_donation", { stream_id: "stream-1", amount_credits: 2550 });
  });
});
