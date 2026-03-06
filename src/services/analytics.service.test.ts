const insertMock = vi.fn();
const getUserMock = vi.fn();

vi.mock("@/services/supabase", () => ({
  hasSupabaseConfig: true,
  supabase: {
    auth: {
      getUser: getUserMock,
    },
    from: vi.fn(() => ({
      insert: insertMock,
    })),
  },
}));

describe("analytics.service", () => {
  beforeEach(() => {
    insertMock.mockReset();
    getUserMock.mockReset();
    getUserMock.mockResolvedValue({ data: { user: { id: "user-1" } } });
    insertMock.mockResolvedValue({ error: null });
  });

  it("writes analytics events", async () => {
    const { trackEvent } = await import("@/services/analytics.service");

    await trackEvent("test_event", { foo: "bar" });

    expect(insertMock).toHaveBeenCalledWith({
      user_id: "user-1",
      event_name: "test_event",
      payload: { foo: "bar" },
    });
  });

  it("deduplicates consecutive page views", async () => {
    const { trackPageView } = await import("@/services/analytics.service");

    trackPageView("/messages");
    trackPageView("/messages");

    await Promise.resolve();

    expect(insertMock).toHaveBeenCalledTimes(1);
  });
});
