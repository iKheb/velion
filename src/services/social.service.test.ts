const insertPostMock = vi.fn();
const uploadFileMock = vi.fn();
const requireAuthUserMock = vi.fn();
const validateMentionsAllowedMock = vi.fn();
const trackEventMock = vi.fn();

vi.mock("@/lib/social-text-rules", () => ({
  validateSocialTextRules: (value: string) => value.trim(),
}));

vi.mock("@/services/account-settings.service", () => ({
  assertCanInteractWithUserContent: vi.fn(async () => undefined),
  canViewUserContent: vi.fn(async () => true),
  validateMentionsAllowed: validateMentionsAllowedMock,
}));

vi.mock("@/services/analytics.service", () => ({
  trackEventFireAndForget: trackEventMock,
}));

vi.mock("@/services/notifications.service", () => ({
  createNotification: vi.fn(async () => undefined),
}));

vi.mock("@/services/storage.service", () => ({
  uploadFile: uploadFileMock,
}));

vi.mock("@/services/supabase-helpers", () => ({
  requireAuthUser: requireAuthUserMock,
  requireNonEmptyText: (value: string, message: string) => {
    const normalized = value.trim();
    if (!normalized) throw new Error(message);
    return normalized;
  },
}));

vi.mock("@/services/supabase", () => ({
  hasSupabaseConfig: true,
  supabase: {
    auth: { getUser: vi.fn(async () => ({ data: { user: { id: "user-1" } } })) },
    from: vi.fn((table: string) => {
      if (table === "posts") {
        return { insert: insertPostMock };
      }
      throw new Error(`Unexpected table ${table}`);
    }),
  },
}));

describe("social.service createPost", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireAuthUserMock.mockResolvedValue({ id: "user-1" });
    insertPostMock.mockResolvedValue({ error: null });
    uploadFileMock
      .mockResolvedValueOnce("https://cdn.velion/post-media.jpg")
      .mockResolvedValueOnce("https://cdn.velion/doc.pdf");
    validateMentionsAllowedMock.mockResolvedValue(undefined);
  });

  it("returns early when content and files are empty", async () => {
    const { createPost } = await import("@/services/social.service");

    await createPost("   ");

    expect(insertPostMock).not.toHaveBeenCalled();
    expect(uploadFileMock).not.toHaveBeenCalled();
  });

  it("creates post with media, document and progress", async () => {
    const { createPost } = await import("@/services/social.service");
    const progressValues: number[] = [];

    const mediaFile = new File(["img"], "photo.jpg", { type: "image/jpeg" });
    const documentFile = new File(["pdf"], "rules.pdf", { type: "application/pdf" });

    await createPost("Contenido principal", mediaFile, (value) => progressValues.push(value), { documentFile });

    expect(uploadFileMock).toHaveBeenCalledTimes(2);
    expect(insertPostMock).toHaveBeenCalledWith(
      expect.objectContaining({
        author_id: "user-1",
        media_url: "https://cdn.velion/post-media.jpg",
        media_type: "image",
      }),
    );
    expect(insertPostMock.mock.calls[0][0].content).toContain("Documento (rules.pdf): https://cdn.velion/doc.pdf");
    expect(progressValues.at(-1)).toBe(100);
    expect(trackEventMock).toHaveBeenCalledWith(
      "post_create",
      expect.objectContaining({ has_media: true, has_document: true }),
    );
  });
});
