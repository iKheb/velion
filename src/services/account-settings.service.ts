import { supabase } from "@/services/supabase";
import { requireAuthUser } from "@/services/supabase-helpers";
import { ROUTES } from "@/lib/constants";
import type {
  AccountContentContext,
  AccountSettings,
  InteractionAction,
  MentionRestrictionMode,
  ProfileVisibilityField,
  VisibilityRule,
} from "@/types/models";

export const ACCOUNT_CONTEXTS: AccountContentContext[] = ["posts", "photos", "videos", "streams", "stories", "reels", "relationship"];
export const PROFILE_VISIBILITY_FIELDS: ProfileVisibilityField[] = ["birth_date", "city", "country", "relationship_status"];
export const INTERACTION_ACTIONS: InteractionAction[] = ["share", "comment", "save", "like"];

const defaultVisibilityRule = (): VisibilityRule => ({
  mode: "everyone",
  excluded_friend_ids: [],
});

const buildDefaultSettings = (userId: string): AccountSettings => ({
  user_id: userId,
  mention_permissions: {
    posts: "everyone",
    photos: "everyone",
    videos: "everyone",
    streams: "everyone",
    stories: "everyone",
    reels: "everyone",
    relationship: "everyone",
  },
  interaction_permissions: {
    posts: { share: true, comment: true, save: true, like: true },
    photos: { share: true, comment: true, save: true, like: true },
    videos: { share: true, comment: true, save: true, like: true },
    streams: { share: true, comment: true, save: true, like: true },
    stories: { share: true, comment: true, save: true, like: true },
    reels: { share: true, comment: true, save: true, like: true },
    relationship: { share: true, comment: true, save: true, like: true },
  },
  content_visibility: {
    posts: defaultVisibilityRule(),
    photos: defaultVisibilityRule(),
    videos: defaultVisibilityRule(),
    streams: defaultVisibilityRule(),
    stories: defaultVisibilityRule(),
    reels: defaultVisibilityRule(),
    relationship: defaultVisibilityRule(),
  },
  discoverability: {
    searchable_profile: true,
  },
  profile_field_visibility: {
    birth_date: defaultVisibilityRule(),
    city: defaultVisibilityRule(),
    country: defaultVisibilityRule(),
    relationship_status: defaultVisibilityRule(),
  },
  created_at: new Date(0).toISOString(),
  updated_at: new Date(0).toISOString(),
});

const mergeVisibilityRule = (source: unknown): VisibilityRule => {
  const value = source as Partial<VisibilityRule> | null | undefined;
  const mode = value?.mode;
  return {
    mode: mode === "friends" || mode === "friends_except" || mode === "everyone" ? mode : "everyone",
    excluded_friend_ids: Array.isArray(value?.excluded_friend_ids)
      ? value!.excluded_friend_ids.filter((item): item is string => typeof item === "string")
      : [],
  };
};

const mergeMentionPermissions = (source: unknown): Record<AccountContentContext, MentionRestrictionMode> => {
  const value = (source as Record<string, unknown>) ?? {};
  const defaults = buildDefaultSettings("00000000-0000-0000-0000-000000000000").mention_permissions;
  return ACCOUNT_CONTEXTS.reduce(
    (acc, context) => {
      const current = value[context];
      acc[context] = current === "friends" || current === "nobody" || current === "everyone" ? current : defaults[context];
      return acc;
    },
    { ...defaults },
  );
};

const mergeInteractionPermissions = (source: unknown): Record<AccountContentContext, Record<InteractionAction, boolean>> => {
  const value = (source as Record<string, unknown>) ?? {};
  const defaults = buildDefaultSettings("00000000-0000-0000-0000-000000000000").interaction_permissions;
  return ACCOUNT_CONTEXTS.reduce(
    (acc, context) => {
      const entry = (value[context] as Record<string, unknown> | undefined) ?? {};
      acc[context] = INTERACTION_ACTIONS.reduce(
        (actionAcc, action) => {
          const flag = entry[action];
          actionAcc[action] = typeof flag === "boolean" ? flag : defaults[context][action];
          return actionAcc;
        },
        { ...defaults[context] },
      );
      return acc;
    },
    { ...defaults },
  );
};

const mergeContentVisibility = (source: unknown): Record<AccountContentContext, VisibilityRule> => {
  const value = (source as Record<string, unknown>) ?? {};
  return ACCOUNT_CONTEXTS.reduce(
    (acc, context) => {
      acc[context] = mergeVisibilityRule(value[context]);
      return acc;
    },
    {
      posts: defaultVisibilityRule(),
      photos: defaultVisibilityRule(),
      videos: defaultVisibilityRule(),
      streams: defaultVisibilityRule(),
      stories: defaultVisibilityRule(),
      reels: defaultVisibilityRule(),
      relationship: defaultVisibilityRule(),
    } as Record<AccountContentContext, VisibilityRule>,
  );
};

const mergeProfileFieldVisibility = (source: unknown): Record<ProfileVisibilityField, VisibilityRule> => {
  const value = (source as Record<string, unknown>) ?? {};
  return PROFILE_VISIBILITY_FIELDS.reduce(
    (acc, field) => {
      acc[field] = mergeVisibilityRule(value[field]);
      return acc;
    },
    {
      birth_date: defaultVisibilityRule(),
      city: defaultVisibilityRule(),
      country: defaultVisibilityRule(),
      relationship_status: defaultVisibilityRule(),
    } as Record<ProfileVisibilityField, VisibilityRule>,
  );
};

const normalizeSettings = (row: Partial<AccountSettings> & { user_id: string }): AccountSettings => {
  const defaults = buildDefaultSettings(row.user_id);
  return {
    ...defaults,
    ...row,
    mention_permissions: mergeMentionPermissions(row.mention_permissions),
    interaction_permissions: mergeInteractionPermissions(row.interaction_permissions),
    content_visibility: mergeContentVisibility(row.content_visibility),
    discoverability: {
      searchable_profile:
        typeof (row.discoverability as { searchable_profile?: unknown } | undefined)?.searchable_profile === "boolean"
          ? Boolean((row.discoverability as { searchable_profile?: boolean }).searchable_profile)
          : true,
    },
    profile_field_visibility: mergeProfileFieldVisibility(row.profile_field_visibility),
    created_at: row.created_at ?? defaults.created_at,
    updated_at: row.updated_at ?? defaults.updated_at,
  };
};

export const getMyAccountSettings = async (): Promise<AccountSettings> => {
  const user = await requireAuthUser();
  const { data, error } = await supabase.from("account_settings").select("*").eq("user_id", user.id).maybeSingle();
  if (error) throw error;
  if (!data) {
    const defaults = buildDefaultSettings(user.id);
    const { error: createError } = await supabase.from("account_settings").insert({
      user_id: user.id,
      mention_permissions: defaults.mention_permissions,
      interaction_permissions: defaults.interaction_permissions,
      content_visibility: defaults.content_visibility,
      discoverability: defaults.discoverability,
      profile_field_visibility: defaults.profile_field_visibility,
    });
    if (createError) throw createError;
    return defaults;
  }
  return normalizeSettings(data as Partial<AccountSettings> & { user_id: string });
};

export const getAccountSettingsByUserId = async (userId: string): Promise<AccountSettings> => {
  const { data, error } = await supabase.from("account_settings").select("*").eq("user_id", userId).maybeSingle();
  if (error) throw error;
  if (!data) return buildDefaultSettings(userId);
  return normalizeSettings(data as Partial<AccountSettings> & { user_id: string });
};

export const updateMyAccountSettings = async (
  patch: Partial<
    Pick<AccountSettings, "mention_permissions" | "interaction_permissions" | "content_visibility" | "discoverability" | "profile_field_visibility">
  >,
): Promise<AccountSettings> => {
  const user = await requireAuthUser();
  const current = await getMyAccountSettings();
  const payload = {
    user_id: user.id,
    mention_permissions: patch.mention_permissions ?? current.mention_permissions,
    interaction_permissions: patch.interaction_permissions ?? current.interaction_permissions,
    content_visibility: patch.content_visibility ?? current.content_visibility,
    discoverability: patch.discoverability ?? current.discoverability,
    profile_field_visibility: patch.profile_field_visibility ?? current.profile_field_visibility,
    updated_at: new Date().toISOString(),
  };

  const { data, error } = await supabase.from("account_settings").upsert(payload).select("*").single();
  if (error) throw error;
  return normalizeSettings(data as Partial<AccountSettings> & { user_id: string });
};

const areFriends = async (viewerId: string, ownerId: string): Promise<boolean> => {
  const { data, error } = await supabase
    .from("friendships")
    .select("id")
    .eq("status", "accepted")
    .or(`and(requester_id.eq.${viewerId},addressee_id.eq.${ownerId}),and(requester_id.eq.${ownerId},addressee_id.eq.${viewerId})`)
    .maybeSingle();
  if (error) throw error;
  return Boolean(data);
};

export const hasProfileBlockBetween = async (
  userAId: string | null | undefined,
  userBId: string | null | undefined,
): Promise<boolean> => {
  if (!userAId || !userBId || userAId === userBId) return false;

  const { data, error } = await supabase
    .from("profile_blocks")
    .select("id")
    .or(`and(blocker_id.eq.${userAId},blocked_id.eq.${userBId}),and(blocker_id.eq.${userBId},blocked_id.eq.${userAId})`)
    .maybeSingle();

  if (error) {
    const message = String((error as { message?: string })?.message ?? "");
    const code = String((error as { code?: string })?.code ?? "");
    if (code === "PGRST205" || /profile_blocks/i.test(message)) return false;
    throw error;
  }

  return Boolean(data);
};

const canPassRule = async (rule: VisibilityRule, ownerId: string, viewerId: string | null | undefined): Promise<boolean> => {
  if (viewerId === ownerId) return true;
  if (rule.mode === "everyone") return true;
  if (!viewerId) return false;

  const isFriend = await areFriends(viewerId, ownerId);
  if (!isFriend) return false;
  if (rule.mode === "friends") return true;
  return !rule.excluded_friend_ids.includes(viewerId);
};

export const canMentionUser = async (
  targetUserId: string,
  viewerId: string | null | undefined,
  context: AccountContentContext,
): Promise<boolean> => {
  if (viewerId === targetUserId) return true;
  if (!viewerId) return false;
  if (await hasProfileBlockBetween(viewerId, targetUserId)) return false;
  const settings = await getAccountSettingsByUserId(targetUserId);
  const mode = settings.mention_permissions[context];
  if (mode === "everyone") return true;
  if (mode === "nobody") return false;
  return areFriends(viewerId, targetUserId);
};

export const canInteractWithUserContent = async (
  ownerId: string,
  viewerId: string | null | undefined,
  context: AccountContentContext,
  action: InteractionAction,
): Promise<boolean> => {
  if (viewerId === ownerId) return true;
  if (!viewerId) return false;
  if (await hasProfileBlockBetween(viewerId, ownerId)) return false;
  const settings = await getAccountSettingsByUserId(ownerId);
  return settings.interaction_permissions[context][action];
};

export const assertCanInteractWithUserContent = async (
  ownerId: string,
  viewerId: string | null | undefined,
  context: AccountContentContext,
  action: InteractionAction,
): Promise<void> => {
  const allowed = await canInteractWithUserContent(ownerId, viewerId, context, action);
  if (!allowed) {
    throw new Error("El usuario restringio esta accion para este contenido.");
  }
};

export const canViewUserContent = async (
  ownerId: string,
  viewerId: string | null | undefined,
  context: AccountContentContext,
): Promise<boolean> => {
  if (!viewerId || viewerId === ownerId) return true;
  if (await hasProfileBlockBetween(viewerId, ownerId)) return false;
  const settings = await getAccountSettingsByUserId(ownerId);
  return canPassRule(settings.content_visibility[context], ownerId, viewerId);
};

export const canViewProfileField = async (
  ownerId: string,
  viewerId: string | null | undefined,
  field: ProfileVisibilityField,
): Promise<boolean> => {
  if (!viewerId || viewerId === ownerId) return true;
  if (await hasProfileBlockBetween(viewerId, ownerId)) return false;
  const settings = await getAccountSettingsByUserId(ownerId);
  return canPassRule(settings.profile_field_visibility[field], ownerId, viewerId);
};

export const isProfileSearchableByViewer = async (
  ownerId: string,
  viewerId: string | null | undefined,
): Promise<boolean> => {
  if (viewerId === ownerId) return true;
  if (await hasProfileBlockBetween(viewerId, ownerId)) return false;
  const settings = await getAccountSettingsByUserId(ownerId);
  if (settings.discoverability.searchable_profile) return true;
  if (!viewerId) return false;
  return areFriends(viewerId, ownerId);
};

const verifyCurrentPasswordOrThrow = async (currentPassword: string): Promise<void> => {
  const user = await requireAuthUser();
  const email = user.email;
  const password = currentPassword.trim();

  if (!email) throw new Error("No se encontro correo en la cuenta.");
  if (!password) throw new Error("Debes ingresar tu contrasena actual.");

  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw new Error("Contrasena actual incorrecta.");
};

export const updateAccountEmail = async (payload: { email: string; currentPassword: string }): Promise<void> => {
  const email = payload.email.trim().toLowerCase();
  if (!email) throw new Error("Debes ingresar un correo.");

  await verifyCurrentPasswordOrThrow(payload.currentPassword);
  const { error } = await supabase.auth.updateUser({ email });
  if (error) throw error;
};

export const updateAccountPassword = async (payload: { newPassword: string; currentPassword: string }): Promise<void> => {
  const password = payload.newPassword.trim();
  if (!password) throw new Error("Debes ingresar una nueva contrasena.");

  await verifyCurrentPasswordOrThrow(payload.currentPassword);
  const { error } = await supabase.auth.updateUser({ password });
  if (error) throw error;
};

export const sendPasswordRecoveryToCurrentEmail = async (): Promise<void> => {
  const user = await requireAuthUser();
  const email = user.email;
  if (!email) throw new Error("No se encontro correo en la cuenta.");

  const redirectTo = `${window.location.origin}${ROUTES.resetPassword}`;
  const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo });
  if (error) throw error;
};

export const updatePasswordWithRecovery = async (newPassword: string): Promise<void> => {
  const password = newPassword.trim();
  if (!password) throw new Error("Debes ingresar una nueva contrasena.");

  const { error } = await supabase.auth.updateUser({ password });
  if (error) throw error;
};

export const updateAccountPhone = async (payload: { phone: string; currentPassword: string }): Promise<void> => {
  const normalized = payload.phone.trim();
  if (!normalized) throw new Error("Debes ingresar un telefono.");

  await verifyCurrentPasswordOrThrow(payload.currentPassword);
  const { error } = await supabase.auth.updateUser({ phone: normalized || undefined });
  if (error) throw error;
};

export const getMyAccountPhone = async (): Promise<string | null> => {
  const user = await requireAuthUser();
  return user.phone ?? null;
};

export const deleteMyAccount = async (password: string): Promise<void> => {
  const user = await requireAuthUser();
  const email = user.email;
  if (!email) throw new Error("No se encontro correo en la cuenta.");
  const trimmedPassword = password.trim();
  if (!trimmedPassword) throw new Error("Debes confirmar con tu contrasena.");

  const { error: verifyError } = await supabase.auth.signInWithPassword({ email, password: trimmedPassword });
  if (verifyError) throw new Error("Contrasena incorrecta.");

  const { error } = await supabase.rpc("delete_my_account");
  if (error) throw error;
};

export const validateMentionsAllowed = async (
  rawText: string,
  context: AccountContentContext,
  viewerId: string | null | undefined,
): Promise<void> => {
  if (!rawText.trim() || !viewerId) return;
  const usernames = Array.from(new Set([...rawText.matchAll(/(?:^|\s)@([a-z0-9_]+)/gi)].map((match) => match[1].toLowerCase())));
  if (!usernames.length) return;

  const { data, error } = await supabase.from("profiles").select("id,username").in("username", usernames);
  if (error) throw error;
  const targets = (data ?? []) as Array<{ id: string; username: string }>;

  for (const target of targets) {
    if (target.id === viewerId) continue;
    const allowed = await canMentionUser(target.id, viewerId, context);
    if (!allowed) throw new Error(`@${target.username} restringio menciones en este tipo de contenido.`);
  }
};
