import { mockProfile } from "@/lib/mock";
import { enforceRateLimit } from "@/lib/rate-limit";
import { isProfileSearchableByViewer, canViewProfileField, validateMentionsAllowed } from "@/services/account-settings.service";
import { trackEventFireAndForget } from "@/services/analytics.service";
import { requireAuthUser } from "@/services/supabase-helpers";
import { hasSupabaseConfig, supabase } from "@/services/supabase";
import type { Profile } from "@/types/models";

interface EmailAuthPayload {
  email: string;
  password: string;
}

export interface RegisterWithEmailPayload extends EmailAuthPayload {
  first_name: string;
  last_name: string;
  phone?: string;
  birth_date: string;
  country: string;
  city: string;
}

export interface MentionUser {
  id: string;
  username: string;
  full_name: string;
  avatar_url: string | null;
}

const getViewerId = async (): Promise<string | null> => (await supabase.auth.getUser()).data.user?.id ?? null;

const applyProfileFieldVisibility = async (profile: Profile, viewerId: string | null): Promise<Profile> => {
  const [birthDateVisible, cityVisible, countryVisible, relationshipVisible] = await Promise.all([
    canViewProfileField(profile.id, viewerId, "birth_date"),
    canViewProfileField(profile.id, viewerId, "city"),
    canViewProfileField(profile.id, viewerId, "country"),
    canViewProfileField(profile.id, viewerId, "relationship_status"),
  ]);

  return {
    ...profile,
    birth_date: birthDateVisible ? profile.birth_date : null,
    city: cityVisible ? profile.city : null,
    country: countryVisible ? profile.country : null,
    relationship_status: relationshipVisible ? profile.relationship_status : null,
  };
};

export const signUpWithEmail = async ({ email, password }: EmailAuthPayload): Promise<void> => {
  if (!hasSupabaseConfig) return;
  enforceRateLimit({
    key: `auth:signup:${email.toLowerCase()}`,
    maxRequests: 3,
    windowMs: 60_000,
    message: "Demasiados intentos de registro. Intenta de nuevo en un minuto.",
  });

  const { error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      emailRedirectTo: window.location.origin,
    },
  });

  if (error) throw error;
  trackEventFireAndForget("auth_signup", { method: "email" });
};

export const signUpWithEmailExtended = async (payload: RegisterWithEmailPayload): Promise<void> => {
  if (!hasSupabaseConfig) return;
  enforceRateLimit({
    key: `auth:signup_extended:${payload.email.toLowerCase()}`,
    maxRequests: 3,
    windowMs: 60_000,
    message: "Demasiados intentos de registro. Intenta de nuevo en un minuto.",
  });

  const fullName = `${payload.first_name.trim()} ${payload.last_name.trim()}`.trim();
  const cleanPhone = payload.phone?.trim() || null;

  const { error } = await supabase.auth.signUp({
    email: payload.email,
    password: payload.password,
    options: {
      emailRedirectTo: window.location.origin,
      data: {
        full_name: fullName || "Velion User",
        first_name: payload.first_name.trim(),
        last_name: payload.last_name.trim(),
        birth_date: payload.birth_date,
        country: payload.country.trim(),
        city: payload.city.trim(),
      },
    },
  });

  if (error) throw error;

  if (cleanPhone) {
    const { error: phoneError } = await supabase.auth.updateUser({ phone: cleanPhone });
    if (phoneError) throw phoneError;
  }

  trackEventFireAndForget("auth_signup", { method: "email" });
};

export const signInWithEmail = async ({ email, password }: EmailAuthPayload): Promise<void> => {
  if (!hasSupabaseConfig) return;
  enforceRateLimit({
    key: `auth:signin:${email.toLowerCase()}`,
    maxRequests: 5,
    windowMs: 60_000,
    message: "Demasiados intentos de inicio de sesion. Espera un minuto.",
  });

  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw error;
  trackEventFireAndForget("auth_signin", { method: "email" });
};

export const signOut = async (): Promise<void> => {
  if (!hasSupabaseConfig) return;
  const { error } = await supabase.auth.signOut();
  if (error) throw error;
  trackEventFireAndForget("auth_signout");
};

export const getSession = async () => {
  const { data, error } = await supabase.auth.getSession();
  if (error) throw error;
  return data.session;
};

export const upsertProfile = async (payload: Partial<Profile>): Promise<Profile> => {
  if (!hasSupabaseConfig) return { ...mockProfile, ...payload } as Profile;
  const user = await requireAuthUser();
  const relationshipStatus = payload.relationship_status;

  if (typeof relationshipStatus === "string" && relationshipStatus.trim()) {
    await validateMentionsAllowed(relationshipStatus, "relationship", user.id);
  }

  const { data, error } = await supabase
    .from("profiles")
    .upsert({
      id: user.id,
      username: payload.username,
      full_name: payload.full_name,
      avatar_url: payload.avatar_url,
      banner_url: payload.banner_url,
      bio: payload.bio,
      country: payload.country,
      city: payload.city,
      birth_date: payload.birth_date,
      relationship_status: payload.relationship_status,
      external_links: payload.external_links,
    })
    .select()
    .single();

  if (error) throw error;
  return data as Profile;
};

export const getMyProfile = async (): Promise<Profile | null> => {
  if (!hasSupabaseConfig) return mockProfile;
  const user = (await supabase.auth.getUser()).data.user;
  if (!user) return null;

  const { data, error } = await supabase.from("profiles").select("*").eq("id", user.id).maybeSingle();
  if (error) throw error;
  return data as Profile | null;
};

export const getProfileByUsername = async (username: string): Promise<Profile | null> => {
  if (!hasSupabaseConfig) return mockProfile;
  const normalized = username.replace(/^@+/, "").trim().toLowerCase();
  if (!normalized) return null;

  const { data, error } = await supabase
    .from("profiles")
    .select("*")
    .ilike("username", normalized)
    .maybeSingle();

  if (error) throw error;
  if (!data) return null;

  const viewerId = await getViewerId();
  return applyProfileFieldVisibility(data as Profile, viewerId);
};

export const getProfileById = async (id: string): Promise<Profile | null> => {
  if (!hasSupabaseConfig) return mockProfile;
  if (!id) return null;

  const { data, error } = await supabase.from("profiles").select("*").eq("id", id).maybeSingle();
  if (error) throw error;
  if (!data) return null;

  const viewerId = await getViewerId();
  return applyProfileFieldVisibility(data as Profile, viewerId);
};

export const searchProfilesByUsernamePrefix = async (prefix: string, limit = 6): Promise<MentionUser[]> => {
  const normalized = prefix.replace(/^@+/, "").trim().toLowerCase();
  if (!normalized) return [];

  if (!hasSupabaseConfig) {
    return [
      {
        id: mockProfile.id,
        username: mockProfile.username,
        full_name: mockProfile.full_name,
        avatar_url: mockProfile.avatar_url,
      },
    ].filter((item) => item.username.toLowerCase().startsWith(normalized));
  }

  const safeLimit = Math.min(Math.max(limit, 1), 10);
  const { data, error } = await supabase
    .from("profiles")
    .select("id,username,full_name,avatar_url")
    .ilike("username", `${normalized}%`)
    .order("username", { ascending: true })
    .limit(safeLimit);

  if (error) throw error;

  const viewerId = await getViewerId();
  const rows = (data as MentionUser[] | null) ?? [];
  const visible = await Promise.all(
    rows.map(async (row) => (await isProfileSearchableByViewer(row.id, viewerId) ? row : null)),
  );
  return visible.filter((row): row is MentionUser => Boolean(row));
};

export const searchProfiles = async (query: string, limit = 10): Promise<MentionUser[]> => {
  const normalized = query.replace(/^@+/, "").trim().toLowerCase();
  if (!normalized) return [];

  if (!hasSupabaseConfig) {
    const profile = {
      id: mockProfile.id,
      username: mockProfile.username,
      full_name: mockProfile.full_name,
      avatar_url: mockProfile.avatar_url,
    };

    return [profile]
      .filter((item) => item.username.toLowerCase().includes(normalized) || item.full_name.toLowerCase().includes(normalized))
      .slice(0, Math.min(Math.max(limit, 1), 20));
  }

  const safeLimit = Math.min(Math.max(limit, 1), 20);
  const pattern = `%${normalized}%`;
  const { data, error } = await supabase
    .from("profiles")
    .select("id,username,full_name,avatar_url")
    .or(`username.ilike.${pattern},full_name.ilike.${pattern}`)
    .order("username", { ascending: true })
    .limit(safeLimit);

  if (error) throw error;

  const viewerId = await getViewerId();
  const rows = (data as MentionUser[] | null) ?? [];
  const visible = await Promise.all(
    rows.map(async (row) => (await isProfileSearchableByViewer(row.id, viewerId) ? row : null)),
  );
  return visible.filter((row): row is MentionUser => Boolean(row));
};

export const requestPasswordRecovery = async (identifier: string): Promise<void> => {
  const cleaned = identifier.trim();
  if (!cleaned) throw new Error("Ingresa usuario, correo o telefono.");
  enforceRateLimit({
    key: `auth:recovery:${cleaned.toLowerCase()}`,
    maxRequests: 3,
    windowMs: 60_000,
    message: "Demasiadas solicitudes de recuperacion. Espera un minuto.",
  });

  const { error } = await supabase.functions.invoke("password-recovery", {
    body: {
      identifier: cleaned,
      redirectTo: `${window.location.origin}/reset-password`,
    },
  });

  if (error) throw error;
};
