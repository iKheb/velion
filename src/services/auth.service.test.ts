const signUpMock = vi.fn();
const updateUserMock = vi.fn();
const invokeMock = vi.fn();
const trackEventMock = vi.fn();

vi.mock("@/services/account-settings.service", () => ({
  isProfileSearchableByViewer: vi.fn(async () => true),
  canViewProfileField: vi.fn(async () => true),
  validateMentionsAllowed: vi.fn(async () => undefined),
}));

vi.mock("@/services/analytics.service", () => ({
  trackEventFireAndForget: trackEventMock,
}));

vi.mock("@/services/supabase", () => ({
  hasSupabaseConfig: true,
  supabase: {
    auth: {
      signUp: signUpMock,
      updateUser: updateUserMock,
      getUser: vi.fn(async () => ({ data: { user: null } })),
    },
    functions: {
      invoke: invokeMock,
    },
  },
}));

describe("auth.service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    signUpMock.mockResolvedValue({ error: null });
    updateUserMock.mockResolvedValue({ error: null });
    invokeMock.mockResolvedValue({ error: null });
  });

  it("registers extended user and updates phone", async () => {
    const { signUpWithEmailExtended } = await import("@/services/auth.service");

    await signUpWithEmailExtended({
      email: "demo@velion.app",
      password: "secret",
      first_name: "Nova",
      last_name: "Wolf",
      phone: " +123456789 ",
      birth_date: "1995-01-01",
      country: "US",
      city: "NY",
    });

    expect(signUpMock).toHaveBeenCalledTimes(1);
    expect(updateUserMock).toHaveBeenCalledWith({ phone: "+123456789" });
    expect(trackEventMock).toHaveBeenCalledWith("auth_signup", { method: "email" });
  });

  it("invokes password recovery function", async () => {
    const { requestPasswordRecovery } = await import("@/services/auth.service");

    await requestPasswordRecovery("nova_wolf");

    expect(invokeMock).toHaveBeenCalledWith(
      "password-recovery",
      expect.objectContaining({
        body: expect.objectContaining({
          identifier: "nova_wolf",
          redirectTo: expect.stringContaining("/reset-password"),
        }),
      }),
    );
  });
});
