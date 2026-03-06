import { useEffect, useMemo, useRef, useState } from "react";
import type { ChangeEvent } from "react";
import { Building2, Cake, Camera, Flag, Heart, MapPin, Pencil } from "lucide-react";
import { useNavigate, useParams } from "react-router-dom";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { ProfileBadges } from "@/components/ui/profile-badges";
import { useAppStore } from "@/store/app.store";
import { invalidateMany } from "@/lib/query-utils";
import { getProfileByUsername, searchProfilesByUsernamePrefix, upsertProfile } from "@/services/auth.service";
import { createOrGetDirectConversationByPeerId } from "@/services/chat.service";
import { getPresenceByUserId } from "@/services/presence.service";
import {
  acceptFriendRequest,
  followUser,
  getProfileStats,
  getRelationStatus,
  blockProfile,
  reportProfile,
  removeFriend,
  sendFriendRequest,
  subscribeToCreator,
  unfollowUser,
  unsubscribeFromCreator,
} from "@/services/relations.service";
import { removeFileByPublicUrl, uploadFile } from "@/services/storage.service";
import { toAppError } from "@/services/error.service";
import { ProfileStats } from "@/features/social/profile-stats";
import { ProfileTabs } from "@/features/social/profile-tabs";
import { SuggestedPeople } from "@/features/social/suggested-people";
import { getProfileRoute, ROUTES } from "@/lib/constants";
import { applyMentionSelection, getMentionMatch } from "@/lib/mentions";
import { buildExternalLinks, getExternalLinkLabel, getExternalLinks, isValidExternalLinkInput } from "@/lib/profile-links";

const linkFieldSchema = z
  .string()
  .optional()
  .refine((value) => isValidExternalLinkInput(value), "Ingresa una URL valida");

const profileSchema = z.object({
  full_name: z.string().min(2),
  username: z.string().min(2),
  bio: z.string().max(160).optional(),
  country: z.string().optional(),
  city: z.string().optional(),
  birth_date: z.string().optional(),
  relationship_status: z.string().max(60).optional(),
  website: linkFieldSchema,
  twitch: linkFieldSchema,
  youtube: linkFieldSchema,
  x: linkFieldSchema,
  instagram: linkFieldSchema,
});

type ProfileForm = z.infer<typeof profileSchema>;

const parseDateOnlyString = (value: string): Date | null => {
  const parts = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!parts) return null;

  const year = Number(parts[1]);
  const month = Number(parts[2]);
  const day = Number(parts[3]);
  const date = new Date(year, month - 1, day);
  if (Number.isNaN(date.getTime())) return null;
  return date;
};

export default function ProfilePage() {
  const SUBSCRIPTION_PRICE_CREDITS = 1;
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { username } = useParams();
  const myProfile = useAppStore((state) => state.profile);
  const setProfile = useAppStore((state) => state.setProfile);

  const [error, setError] = useState<string | null>(null);
  const [shareFeedback, setShareFeedback] = useState<string | null>(null);
  const [isSuggestedPeopleModalOpen, setIsSuggestedPeopleModalOpen] = useState(false);
  const [isEditProfileModalOpen, setIsEditProfileModalOpen] = useState(false);
  const [isSubscribeConfirmModalOpen, setIsSubscribeConfirmModalOpen] = useState(false);
  const [isUnsubscribeConfirmModalOpen, setIsUnsubscribeConfirmModalOpen] = useState(false);
  const [isUnfollowConfirmModalOpen, setIsUnfollowConfirmModalOpen] = useState(false);
  const [isUnfriendConfirmModalOpen, setIsUnfriendConfirmModalOpen] = useState(false);
  const [isProfileActionsModalOpen, setIsProfileActionsModalOpen] = useState(false);
  const [isBanProfileConfirmModalOpen, setIsBanProfileConfirmModalOpen] = useState(false);
  const [subscribeError, setSubscribeError] = useState<string | null>(null);
  const [isReportProfileModalOpen, setIsReportProfileModalOpen] = useState(false);
  const [reportProfileReason, setReportProfileReason] = useState("");
  const [reportProfileError, setReportProfileError] = useState<string | null>(null);
  const [relationshipMentionQuery, setRelationshipMentionQuery] = useState("");
  const [relationshipCursor, setRelationshipCursor] = useState(0);
  const avatarQuickInputRef = useRef<HTMLInputElement | null>(null);
  const bannerQuickInputRef = useRef<HTMLInputElement | null>(null);

  const { data: viewedProfile } = useQuery({
    queryKey: ["profile", username],
    queryFn: () => getProfileByUsername(username ?? ""),
    enabled: Boolean(username),
  });

  const profile = viewedProfile ?? myProfile;
  const isOwnProfile = Boolean(profile && myProfile && profile.id === myProfile.id);

  useEffect(() => {
    if (!username) return;

    if (username === "me" && myProfile?.username) {
      navigate(getProfileRoute(myProfile.username), { replace: true });
      return;
    }

    if (viewedProfile?.username && username !== viewedProfile.username) {
      navigate(getProfileRoute(viewedProfile.username), { replace: true });
    }
  }, [myProfile?.username, navigate, username, viewedProfile?.username]);

  const { data: stats } = useQuery({
    queryKey: ["profile-stats", profile?.id],
    queryFn: () => getProfileStats(profile!.id),
    enabled: Boolean(profile?.id),
  });

  const { data: relationStatus } = useQuery({
    queryKey: ["relation-status", profile?.id],
    queryFn: () => getRelationStatus(profile!.id),
    enabled: Boolean(profile?.id && myProfile?.id && profile.id !== myProfile.id),
  });

  const { data: profilePresence } = useQuery({
    queryKey: ["profile-presence", profile?.id],
    queryFn: () => getPresenceByUserId(profile!.id),
    enabled: Boolean(profile?.id),
    refetchInterval: 20000,
  });
  const relationshipMentionUsersQuery = useQuery({
    queryKey: ["profile-relationship-mention-users", relationshipMentionQuery],
    queryFn: () => searchProfilesByUsernamePrefix(relationshipMentionQuery, 6),
    enabled: isEditProfileModalOpen && relationshipMentionQuery.length > 0,
  });

  const profilePresenceLabel = profilePresence?.is_typing ? "Escribiendo..." : profilePresence?.is_online ? "En linea" : "Desconectado";

  const defaults = useMemo(() => {
    const links = profile ? getExternalLinks(profile) : {};

    return {
      full_name: profile?.full_name ?? "",
      username: profile?.username ?? username ?? "",
      bio: profile?.bio ?? "",
      country: profile?.country ?? "",
      city: profile?.city ?? "",
      birth_date: profile?.birth_date ?? "",
      relationship_status: profile?.relationship_status ?? "",
      website: links.website ?? "",
      twitch: links.twitch ?? "",
      youtube: links.youtube ?? "",
      x: links.x ?? "",
      instagram: links.instagram ?? "",
    };
  }, [profile, username]);

  const form = useForm<ProfileForm>({ resolver: zodResolver(profileSchema), defaultValues: defaults });

  useEffect(() => {
    form.reset(defaults);
  }, [defaults, form]);

  const refreshSocial = async () => {
    await invalidateMany(queryClient, [
      ["profile-stats", profile?.id],
      ["relation-status", profile?.id],
    ]);
  };

  const followMutation = useMutation({
    mutationFn: async () => {
      if (!profile?.id) return;
      await followUser(profile.id);
    },
    onSuccess: () => void refreshSocial(),
  });

  const unfollowMutation = useMutation({
    mutationFn: async () => {
      if (!profile?.id) return;
      await unfollowUser(profile.id);
    },
    onSuccess: async () => {
      setIsUnfollowConfirmModalOpen(false);
      await refreshSocial();
    },
  });

  const subscribeMutation = useMutation({
    mutationFn: async () => {
      if (!profile?.id) return;
      await subscribeToCreator(profile.id);
    },
    onSuccess: async () => {
      setSubscribeError(null);
      setIsSubscribeConfirmModalOpen(false);
      await refreshSocial();
      await invalidateMany(queryClient, [["wallet-balance"]]);
    },
    onError: (err) => {
      const message = toAppError(err);
      if (/insufficient credits/i.test(message)) {
        setSubscribeError("No tienes creditos suficientes para suscribirte a este perfil.");
        return;
      }
      if (/could not find.*subscribe_to_creator_with_credits|function.*subscribe_to_creator_with_credits/i.test(message)) {
        setSubscribeError("La funcion de suscripcion con creditos no esta desplegada en Supabase.");
        return;
      }
      setSubscribeError(message);
    },
  });

  const unsubscribeMutation = useMutation({
    mutationFn: async () => {
      if (!profile?.id) return;
      await unsubscribeFromCreator(profile.id);
    },
    onSuccess: async () => {
      setIsUnsubscribeConfirmModalOpen(false);
      await refreshSocial();
    },
    onError: (err) => setSubscribeError(toAppError(err)),
  });

  const friendMutation = useMutation({
    mutationFn: async () => {
      if (!profile?.id) return;
      if (relationStatus?.incomingFriendRequestId) {
        await acceptFriendRequest(relationStatus.incomingFriendRequestId);
      } else {
        await sendFriendRequest(profile.id);
      }
    },
    onSuccess: () => void refreshSocial(),
  });

  const unfriendMutation = useMutation({
    mutationFn: async () => {
      if (!profile?.id) return;
      await removeFriend(profile.id);
    },
    onSuccess: async () => {
      setIsUnfriendConfirmModalOpen(false);
      await refreshSocial();
    },
    onError: (err) => setError(toAppError(err)),
  });

  const messageMutation = useMutation({
    mutationFn: async () => {
      if (!profile?.id) return;
      return createOrGetDirectConversationByPeerId(profile.id);
    },
    onSuccess: (conversationId) => {
      if (!conversationId) return;
      const targetPath = profile?.username ? `${ROUTES.messages}/${encodeURIComponent(profile.username)}` : ROUTES.messages;
      navigate(`${targetPath}?conversation=${encodeURIComponent(conversationId)}`);
    },
    onError: (err) => setError(toAppError(err)),
  });

  const reportProfileMutation = useMutation({
    mutationFn: async () => {
      if (!profile?.id) return;
      await reportProfile(profile.id, reportProfileReason);
    },
    onSuccess: () => {
      setReportProfileReason("");
      setReportProfileError(null);
      setIsReportProfileModalOpen(false);
    },
    onError: (err) => setReportProfileError(toAppError(err)),
  });

  const blockProfileMutation = useMutation({
    mutationFn: async () => {
      if (!profile?.id) return;
      await blockProfile(profile.id);
    },
    onSuccess: async () => {
      setIsProfileActionsModalOpen(false);
      setIsBanProfileConfirmModalOpen(false);
      setIsReportProfileModalOpen(false);
      await invalidateMany(queryClient, [
        ["relation-status", profile?.id],
        ["profile-posts", profile?.id],
        ["profile-streams", profile?.id],
        ["profile-vods", profile?.id],
        ["profile-reels", profile?.id],
      ]);
    },
    onError: (err) => setError(toAppError(err)),
  });

  const onSubmit = form.handleSubmit(async (values) => {
    setError(null);

    try {
      const { website, twitch, youtube, x, instagram, ...profileValues } = values;
      const updated = await upsertProfile({
        ...profileValues,
        external_links: buildExternalLinks({
          website,
          twitch,
          youtube,
          x,
          instagram,
        }),
      });

      setProfile(updated);
      await invalidateMany(queryClient, [["profile", updated.username]]);
      setIsEditProfileModalOpen(false);

      if (username && updated.username && username !== updated.username) {
        navigate(getProfileRoute(updated.username), { replace: true });
      }
    } catch (err) {
      setError(toAppError(err));
    }
  });

  const profileLinks = profile ? getExternalLinks(profile) : {};
  const renderedLinks = Object.entries(profileLinks) as Array<[string, string]>;
  const relationshipValue = form.watch("relationship_status") ?? "";
  const relationshipMentionUsername = useMemo(() => {
    const match = relationshipValue.match(/(?:^|\s)@([a-z0-9_]+)/i);
    return match?.[1] ?? null;
  }, [relationshipValue]);
  const { errors, isSubmitting, isDirty } = form.formState;
  const parsedBirthDate = profile?.birth_date ? parseDateOnlyString(profile.birth_date) : null;
  const isLeapDayBirthday = profile?.birth_date?.slice(5) === "02-29";
  const formattedBirthDate = parsedBirthDate
    ? parsedBirthDate.toLocaleDateString("es-ES", { day: "2-digit", month: "long", year: "numeric" })
    : null;

  const handleShareProfile = async () => {
    const url = window.location.href;
    try {
      await navigator.clipboard.writeText(url);
      setShareFeedback("Enlace copiado");
    } catch {
      setShareFeedback("No se pudo copiar automaticamente");
    }
    window.setTimeout(() => setShareFeedback(null), 2500);
  };

  const handleRelationshipChange = (value: string, cursor: number) => {
    form.setValue("relationship_status", value, { shouldDirty: true, shouldTouch: true, shouldValidate: true });
    setRelationshipCursor(cursor);
    const mention = getMentionMatch(value, cursor);
    setRelationshipMentionQuery(mention?.query ?? "");
  };

  const applyRelationshipMention = (usernameToMention: string) => {
    const { nextValue, nextCursor } = applyMentionSelection(relationshipValue, relationshipCursor, usernameToMention);
    form.setValue("relationship_status", nextValue, { shouldDirty: true, shouldTouch: true, shouldValidate: true });
    setRelationshipCursor(nextCursor);
    setRelationshipMentionQuery("");
  };

  const uploadQuickProfileImage = async (type: "avatar" | "banner", selectedFile: File) => {
    if (!myProfile?.id || !myProfile.username || !myProfile.full_name) {
      setError("No se pudo actualizar la imagen del perfil.");
      return;
    }

    setError(null);
    const previousAvatarUrl = myProfile.avatar_url ?? null;
    const previousBannerUrl = myProfile.banner_url ?? null;
    const ext = selectedFile.name.split(".").pop() ?? "jpg";
    const bucket = type === "avatar" ? "avatars" : "banners";
    const prefix = type === "avatar" ? "avatar" : "banner";
    const path = `${myProfile.id}/${prefix}-${Date.now()}.${ext}`;

    try {
      const uploadedUrl = await uploadFile(bucket, path, selectedFile);
      const updated = await upsertProfile({
        username: myProfile.username,
        full_name: myProfile.full_name,
        avatar_url: type === "avatar" ? uploadedUrl : myProfile.avatar_url,
        banner_url: type === "banner" ? uploadedUrl : myProfile.banner_url,
      });

      setProfile(updated);
      await invalidateMany(queryClient, [["profile", updated.username]]);

      if (type === "avatar" && previousAvatarUrl && previousAvatarUrl !== uploadedUrl) {
        void removeFileByPublicUrl("avatars", previousAvatarUrl).catch(() => undefined);
      }
      if (type === "banner" && previousBannerUrl && previousBannerUrl !== uploadedUrl) {
        void removeFileByPublicUrl("banners", previousBannerUrl).catch(() => undefined);
      }
    } catch (err) {
      setError(toAppError(err));
    }
  };

  const handleQuickAvatarSelect = async (event: ChangeEvent<HTMLInputElement>) => {
    const selectedFile = event.target.files?.[0] ?? null;
    event.target.value = "";
    if (!selectedFile) return;
    await uploadQuickProfileImage("avatar", selectedFile);
  };

  const handleQuickBannerSelect = async (event: ChangeEvent<HTMLInputElement>) => {
    const selectedFile = event.target.files?.[0] ?? null;
    event.target.value = "";
    if (!selectedFile) return;
    await uploadQuickProfileImage("banner", selectedFile);
  };

  return (
    <section className="space-y-4">
      <input ref={avatarQuickInputRef} type="file" accept="image/*" className="hidden" onChange={(event) => void handleQuickAvatarSelect(event)} />
      <input ref={bannerQuickInputRef} type="file" accept="image/*" className="hidden" onChange={(event) => void handleQuickBannerSelect(event)} />

      <ProfileStats
        friends={stats?.friends ?? 0}
        followers={stats?.followers ?? 0}
        following={stats?.following ?? 0}
        subscribers={stats?.subscribers ?? 0}
        subscribed={stats?.subscribed ?? 0}
      />

      <Card className="overflow-hidden rounded-2xl border-0 bg-velion-discord/70 p-0 backdrop-blur-sm">
        <div className="relative">
          <img
            src={profile?.banner_url ?? "https://images.unsplash.com/photo-1511512578047-dfb367046420?w=1200&q=80"}
            alt="banner"
            className="block h-48 w-full rounded-t-2xl object-cover md:h-64"
          />
          {isOwnProfile && (
            <button
              type="button"
              onClick={() => bannerQuickInputRef.current?.click()}
              className="absolute bottom-3 right-3 inline-flex h-9 w-9 items-center justify-center rounded-full bg-velion-black/80 text-white hover:bg-velion-black"
              aria-label="Cambiar banner"
            >
              <Camera size={16} />
            </button>
          )}
        </div>
        <div className="p-4">
          <div className="relative -mt-16 h-20 w-20">
            <div className="h-20 w-20 overflow-hidden rounded-full border-4 border-velion-discord">
              <img
                src={profile?.avatar_url ?? "https://placehold.co/120"}
                alt="avatar"
                className="h-full w-full object-cover"
              />
            </div>
            {isOwnProfile && (
              <button
                type="button"
                onClick={() => avatarQuickInputRef.current?.click()}
                className="absolute bottom-0 right-0 inline-flex h-8 w-8 items-center justify-center rounded-full border border-velion-discord bg-velion-black/85 text-white hover:bg-velion-black"
                aria-label="Cambiar foto de perfil"
              >
                <Camera size={14} />
              </button>
            )}
          </div>
          <div className="mt-2 flex items-center gap-2">
            <h1 className="text-xl font-bold">{profile?.full_name ?? "Perfil"}</h1>
            <ProfileBadges isPremium={profile?.is_premium} isVerified={profile?.is_verified} />
            {isOwnProfile && (
              <button
                type="button"
                onClick={() => setIsEditProfileModalOpen(true)}
                className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-velion-black/70 text-zinc-200 hover:bg-velion-black"
                aria-label="Editar perfil"
              >
                <Pencil size={14} />
              </button>
            )}
          </div>
          <div className="flex items-center gap-2">
            <p className="text-sm text-zinc-300">@{profile?.username ?? username}</p>
          </div>
          <p className={`text-xs ${profilePresence?.is_online ? "text-emerald-300" : "text-zinc-500"}`}>{profilePresenceLabel}</p>
          <p className="mt-2 text-sm text-zinc-300">{profile?.bio}</p>
          <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-zinc-400">
            {relationshipMentionUsername ? (
              <p className="inline-flex items-center gap-1">
                <Heart size={13} className="text-rose-300" />
                <span>Comprometido con </span>
                <a href={getProfileRoute(relationshipMentionUsername)} className="text-rose-300 hover:underline">
                  @{relationshipMentionUsername}
                </a>
              </p>
            ) : profile?.relationship_status ? (
              <p className="inline-flex items-center gap-1">
                <Heart size={13} className="text-rose-300" />
                {profile.relationship_status}
              </p>
            ) : null}
            {profile?.country ? (
              <p className="inline-flex items-center gap-1">
                <MapPin size={13} />
                {profile.country}
              </p>
            ) : null}
            {profile?.city ? (
              <p className="inline-flex items-center gap-1">
                <Building2 size={13} />
                {profile.city}
              </p>
            ) : null}
            {formattedBirthDate ? (
              <p className="inline-flex items-center gap-1">
                <Cake size={13} className={isLeapDayBirthday ? "text-sky-300" : undefined} />
                {formattedBirthDate}
              </p>
            ) : null}
          </div>
          {renderedLinks.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-2">
              {renderedLinks.map(([key, href]) => (
                <a
                  key={key}
                  href={href}
                  target="_blank"
                  rel="noreferrer"
                  className="rounded-lg bg-velion-black/60 px-2 py-1 text-xs text-zinc-200 hover:bg-velion-black"
                >
                  {getExternalLinkLabel(key)}
                </a>
              ))}
            </div>
          )}

          {!isOwnProfile && profile?.id && (
            <div className="mt-3 flex flex-wrap items-center gap-2">
              {!relationStatus?.isBlockedByMe ? (
                <>
                  <Button
                    onClick={() => {
                      if (relationStatus?.isFollowing) {
                        setIsUnfollowConfirmModalOpen(true);
                        return;
                      }
                      followMutation.mutate();
                    }}
                    className="px-3 py-1 text-xs"
                  >
                    {relationStatus?.isFollowing ? "Seguido" : "Seguir"}
                  </Button>
                  <Button
                    onClick={() => {
                      if (relationStatus?.hasFriendship) {
                        setIsUnfriendConfirmModalOpen(true);
                        return;
                      }
                      if (relationStatus?.outgoingFriendRequestId) return;
                      friendMutation.mutate();
                    }}
                    className="bg-zinc-700 px-3 py-1 text-xs"
                    disabled={Boolean(relationStatus?.outgoingFriendRequestId)}
                  >
                    {relationStatus?.hasFriendship
                      ? "Amigo"
                      : relationStatus?.incomingFriendRequestId
                        ? "Aceptar amistad"
                        : relationStatus?.outgoingFriendRequestId
                          ? "Solicitud enviada"
                          : "Agregar amigo"}
                  </Button>
                  <Button
                    onClick={() => {
                      if (relationStatus?.isSubscribed) {
                        setIsUnsubscribeConfirmModalOpen(true);
                        return;
                      }
                      setSubscribeError(null);
                      setIsSubscribeConfirmModalOpen(true);
                    }}
                    className="bg-zinc-700 px-3 py-1 text-xs"
                  >
                    {relationStatus?.isSubscribed ? "Suscrito" : "Suscribirse"}
                  </Button>
                  <Button
                    onClick={() => messageMutation.mutate()}
                    className="bg-zinc-700 px-3 py-1 text-xs"
                    disabled={messageMutation.isPending}
                  >
                    Enviar mensaje
                  </Button>
                </>
              ) : (
                <p className="text-xs text-zinc-400">
                  Perfil baneado. Puedes desbanearlo desde Configuracion de cuenta.
                </p>
              )}
              <div className="ml-auto">
                <button
                  type="button"
                  onClick={() => {
                    setReportProfileError(null);
                    setIsProfileActionsModalOpen(true);
                  }}
                  className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-zinc-700 text-zinc-100 hover:bg-zinc-600"
                  aria-label="Acciones de perfil"
                >
                  <Flag size={14} />
                </button>
              </div>
            </div>
          )}
        </div>
      </Card>

      {isOwnProfile && (
        <div className="flex flex-wrap gap-2">
          <Button type="button" className="bg-zinc-700 px-3 py-1 text-xs" onClick={() => setIsSuggestedPeopleModalOpen(true)}>
            Personas sugeridas
          </Button>
          <div className="ml-auto flex items-center gap-2">
            {shareFeedback && <span className="text-xs text-zinc-400">{shareFeedback}</span>}
            <Button type="button" onClick={() => void handleShareProfile()} className="px-3 py-1 text-xs">
              Compartir perfil
            </Button>
          </div>
        </div>
      )}
      {profile && <ProfileTabs profile={profile} isOwnProfile={isOwnProfile} />}

      <Modal
        open={isOwnProfile && isSuggestedPeopleModalOpen}
        title="Personas sugeridas"
        onClose={() => setIsSuggestedPeopleModalOpen(false)}
        className="max-w-4xl"
      >
        <SuggestedPeople />
      </Modal>

      <Modal
        open={isOwnProfile && isEditProfileModalOpen}
        title="Editar perfil"
        onClose={() => setIsEditProfileModalOpen(false)}
        className="max-w-7xl"
      >
        <Card>
          <h2 className="mb-3 text-lg font-semibold">Editar perfil</h2>
          <form className="grid gap-2 md:grid-cols-2" onSubmit={onSubmit}>
            <Input placeholder="Nombre" {...form.register("full_name")} />
            <Input placeholder="Usuario" {...form.register("username")} />
            <Input placeholder="Pais" {...form.register("country")} />
            <Input placeholder="Ciudad" {...form.register("city")} />
            <Input type="date" {...form.register("birth_date")} />
            <div className="relative">
              <Input
                placeholder="Relacion sentimental (usa @usuario)"
                value={relationshipValue}
                onChange={(event) => handleRelationshipChange(event.target.value, event.target.selectionStart ?? event.target.value.length)}
                onClick={(event) => handleRelationshipChange(event.currentTarget.value, event.currentTarget.selectionStart ?? event.currentTarget.value.length)}
                onKeyUp={(event) => handleRelationshipChange(event.currentTarget.value, event.currentTarget.selectionStart ?? event.currentTarget.value.length)}
              />
              {relationshipMentionQuery.length > 0 && (relationshipMentionUsersQuery.data ?? []).length > 0 && (
                <div className="absolute left-0 right-0 top-11 z-20 rounded-xl border border-zinc-700 bg-velion-black/95 p-1 shadow-xl">
                  {(relationshipMentionUsersQuery.data ?? []).map((user) => (
                    <button
                      key={user.id}
                      type="button"
                      onClick={() => applyRelationshipMention(user.username)}
                      className="flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left hover:bg-velion-discord/70"
                    >
                      <img src={user.avatar_url ?? "https://placehold.co/32"} alt={user.username} className="h-8 w-8 rounded-full object-cover" />
                      <span className="min-w-0">
                        <p className="truncate text-sm text-zinc-100">{user.full_name}</p>
                        <p className="truncate text-[11px] text-zinc-400">@{user.username}</p>
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>
            <Input placeholder="Bio" {...form.register("bio")} className="md:col-span-2" />
            <Input placeholder="Sitio web" {...form.register("website")} />
            {errors.website && <p className="text-xs text-red-400">{errors.website.message}</p>}
            <Input placeholder="Twitch" {...form.register("twitch")} />
            {errors.twitch && <p className="text-xs text-red-400">{errors.twitch.message}</p>}
            <Input placeholder="YouTube" {...form.register("youtube")} />
            {errors.youtube && <p className="text-xs text-red-400">{errors.youtube.message}</p>}
            <Input placeholder="X / Twitter" {...form.register("x")} />
            {errors.x && <p className="text-xs text-red-400">{errors.x.message}</p>}
            <Input placeholder="Instagram" {...form.register("instagram")} className="md:col-span-2" />
            {errors.instagram && <p className="text-xs text-red-400 md:col-span-2">{errors.instagram.message}</p>}

            {error && <p className="text-xs text-red-400 md:col-span-2">{error}</p>}

            <Button type="submit" className="md:col-span-2" disabled={isSubmitting || !isDirty}>
              {isSubmitting ? "Guardando..." : "Guardar cambios"}
            </Button>
          </form>
        </Card>
      </Modal>

      <Modal
        open={!isOwnProfile && isSubscribeConfirmModalOpen}
        title="Confirmar suscripcion"
        onClose={() => {
          setIsSubscribeConfirmModalOpen(false);
          setSubscribeError(null);
        }}
        className="max-w-md"
      >
        <div className="space-y-3">
          <p className="text-sm text-zinc-300">
            Deseas gastar <span className="font-semibold text-zinc-100">{SUBSCRIPTION_PRICE_CREDITS} creditos</span> para suscribirte a este perfil?
          </p>
          {subscribeError && <p className="text-xs text-red-400">{subscribeError}</p>}
          <div className="flex justify-end gap-2">
            <Button
              type="button"
              className="bg-zinc-700 px-3 py-1 text-xs"
              onClick={() => {
                setIsSubscribeConfirmModalOpen(false);
                setSubscribeError(null);
              }}
            >
              Cancelar
            </Button>
            <Button
              type="button"
              onClick={() => subscribeMutation.mutate()}
              disabled={subscribeMutation.isPending}
            >
              {subscribeMutation.isPending ? "Procesando..." : "Confirmar"}
            </Button>
          </div>
        </div>
      </Modal>

      <Modal
        open={!isOwnProfile && isUnsubscribeConfirmModalOpen}
        title="Cancelar suscripcion"
        onClose={() => setIsUnsubscribeConfirmModalOpen(false)}
        className="max-w-md"
      >
        <div className="space-y-3">
          <p className="text-sm text-zinc-300">Deseas cancelar tu suscripcion a este perfil?</p>
          <div className="flex justify-end gap-2">
            <Button
              type="button"
              className="bg-zinc-700 px-3 py-1 text-xs"
              onClick={() => setIsUnsubscribeConfirmModalOpen(false)}
            >
              Volver
            </Button>
            <Button
              type="button"
              onClick={() => unsubscribeMutation.mutate()}
              disabled={unsubscribeMutation.isPending}
            >
              {unsubscribeMutation.isPending ? "Procesando..." : "Cancelar suscripcion"}
            </Button>
          </div>
        </div>
      </Modal>

      <Modal
        open={!isOwnProfile && isUnfollowConfirmModalOpen}
        title="Dejar de seguir"
        onClose={() => setIsUnfollowConfirmModalOpen(false)}
        className="max-w-md"
      >
        <div className="space-y-3">
          <p className="text-sm text-zinc-300">Deseas dejar de seguir este perfil?</p>
          <div className="flex justify-end gap-2">
            <Button
              type="button"
              className="bg-zinc-700 px-3 py-1 text-xs"
              onClick={() => setIsUnfollowConfirmModalOpen(false)}
            >
              Volver
            </Button>
            <Button
              type="button"
              onClick={() => unfollowMutation.mutate()}
              disabled={unfollowMutation.isPending}
            >
              {unfollowMutation.isPending ? "Procesando..." : "Dejar de seguir"}
            </Button>
          </div>
        </div>
      </Modal>

      <Modal
        open={!isOwnProfile && isUnfriendConfirmModalOpen}
        title="Eliminar amigo"
        onClose={() => setIsUnfriendConfirmModalOpen(false)}
        className="max-w-md"
      >
        <div className="space-y-3">
          <p className="text-sm text-zinc-300">Deseas eliminar este amigo?</p>
          <div className="flex justify-end gap-2">
            <Button
              type="button"
              className="bg-zinc-700 px-3 py-1 text-xs"
              onClick={() => setIsUnfriendConfirmModalOpen(false)}
            >
              Volver
            </Button>
            <Button
              type="button"
              onClick={() => unfriendMutation.mutate()}
              disabled={unfriendMutation.isPending}
            >
              {unfriendMutation.isPending ? "Procesando..." : "Eliminar amigo"}
            </Button>
          </div>
        </div>
      </Modal>

      <Modal
        open={!isOwnProfile && isProfileActionsModalOpen}
        title="Acciones de perfil"
        onClose={() => setIsProfileActionsModalOpen(false)}
        className="max-w-md"
      >
        <div className="space-y-2">
          <Button
            type="button"
            className="w-full justify-start bg-zinc-700 px-3 py-2 text-xs hover:bg-zinc-600"
            onClick={() => {
              setIsProfileActionsModalOpen(false);
              setReportProfileError(null);
              setIsReportProfileModalOpen(true);
            }}
          >
            Reportar perfil
          </Button>
          <Button
            type="button"
            className="w-full justify-start bg-rose-700 px-3 py-2 text-xs hover:bg-rose-600"
            onClick={() => {
              setIsProfileActionsModalOpen(false);
              setIsBanProfileConfirmModalOpen(true);
            }}
            disabled={Boolean(relationStatus?.isBlockedByMe)}
          >
            {relationStatus?.isBlockedByMe ? "Perfil baneado" : "Banear perfil"}
          </Button>
        </div>
      </Modal>

      <Modal
        open={!isOwnProfile && isBanProfileConfirmModalOpen}
        title="Banear perfil"
        onClose={() => setIsBanProfileConfirmModalOpen(false)}
        className="max-w-md"
      >
        <div className="space-y-3">
          <p className="text-sm text-zinc-300">
            Si baneas este perfil, dejaras de ver sus publicaciones, historias, reels, videos y streams. Podras desbanearlo desde Configuracion de cuenta.
          </p>
          <div className="flex justify-end gap-2">
            <Button
              type="button"
              className="bg-zinc-700 px-3 py-1 text-xs"
              onClick={() => setIsBanProfileConfirmModalOpen(false)}
            >
              Cancelar
            </Button>
            <Button
              type="button"
              className="bg-rose-700 px-3 py-1 text-xs hover:bg-rose-600"
              onClick={() => blockProfileMutation.mutate()}
              disabled={blockProfileMutation.isPending}
            >
              {blockProfileMutation.isPending ? "Procesando..." : "Banear perfil"}
            </Button>
          </div>
        </div>
      </Modal>

      <Modal
        open={!isOwnProfile && isReportProfileModalOpen}
        title="Reportar perfil"
        onClose={() => {
          setIsReportProfileModalOpen(false);
          setReportProfileError(null);
        }}
        className="max-w-md"
      >
        <div className="space-y-3">
          <p className="text-sm text-zinc-300">
            Cuéntanos por qué deseas reportar este perfil.
          </p>
          <textarea
            value={reportProfileReason}
            onChange={(event) => {
              setReportProfileReason(event.target.value.slice(0, 400));
              if (reportProfileError) setReportProfileError(null);
            }}
            maxLength={400}
            rows={4}
            className="w-full rounded-xl border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-zinc-500"
            placeholder="Describe el motivo del reporte"
          />
          <p className="text-right text-[11px] text-zinc-400">{reportProfileReason.length}/400</p>
          {reportProfileError && <p className="text-xs text-red-400">{reportProfileError}</p>}
          <div className="flex justify-end gap-2">
            <Button
              type="button"
              className="bg-zinc-700 px-3 py-1 text-xs"
              onClick={() => {
                setIsReportProfileModalOpen(false);
                setReportProfileError(null);
              }}
            >
              Cancelar
            </Button>
            <Button
              type="button"
              onClick={() => reportProfileMutation.mutate()}
              disabled={reportProfileMutation.isPending || !reportProfileReason.trim()}
            >
              {reportProfileMutation.isPending ? "Enviando..." : "Reportar"}
            </Button>
          </div>
        </div>
      </Modal>

    </section>
  );
}


