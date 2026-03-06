import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { Select } from "@/components/ui/select";
import { PageHeader } from "@/components/ui/page-header";
import { ROUTES } from "@/lib/constants";
import {
  ACCOUNT_CONTEXTS,
  PROFILE_VISIBILITY_FIELDS,
  deleteMyAccount,
  getMyAccountPhone,
  getMyAccountSettings,
  sendPasswordRecoveryToCurrentEmail,
  updateAccountEmail,
  updateAccountPassword,
  updateAccountPhone,
  updateMyAccountSettings,
} from "@/services/account-settings.service";
import { listBlockedProfiles, listFriends, unblockProfile } from "@/services/relations.service";
import { toAppError } from "@/services/error.service";
import { useAppStore } from "@/store/app.store";
import type { AccountContentContext, MentionRestrictionMode, ProfileVisibilityField, RestrictionMode } from "@/types/models";

const contextLabel: Record<AccountContentContext, string> = {
  posts: "Publicaciones",
  photos: "Fotos",
  videos: "Videos",
  streams: "Streams",
  stories: "Historias",
  reels: "Reels",
  relationship: "Situacion sentimental",
};

const fieldLabel: Record<ProfileVisibilityField, string> = {
  birth_date: "Fecha de nacimiento",
  city: "Ciudad",
  country: "Pais",
  relationship_status: "Relacion sentimental",
};

export default function AccountSettingsPage() {
  const profile = useAppStore((state) => state.profile);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [email, setEmail] = useState("");
  const [currentPasswordForEmail, setCurrentPasswordForEmail] = useState("");
  const [currentPasswordForPassword, setCurrentPasswordForPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmNewPassword, setConfirmNewPassword] = useState("");
  const [phone, setPhone] = useState("");
  const [currentPasswordForPhone, setCurrentPasswordForPhone] = useState("");
  const [savedPhoneMasked, setSavedPhoneMasked] = useState<string | null>(null);
  const [deletePassword, setDeletePassword] = useState("");
  const [deleteModalOpen, setDeleteModalOpen] = useState(false);

  const settingsQuery = useQuery({
    queryKey: ["account-settings", profile?.id],
    queryFn: getMyAccountSettings,
    enabled: Boolean(profile?.id),
  });

  const friendsQuery = useQuery({
    queryKey: ["account-settings-friends", profile?.id],
    queryFn: () => listFriends(profile!.id),
    enabled: Boolean(profile?.id),
  });
  const blockedProfilesQuery = useQuery({
    queryKey: ["account-settings-blocked-profiles", profile?.id],
    queryFn: listBlockedProfiles,
    enabled: Boolean(profile?.id),
  });
  const phoneQuery = useQuery({
    queryKey: ["account-phone", profile?.id],
    queryFn: getMyAccountPhone,
    enabled: Boolean(profile?.id),
  });

  const settings = settingsQuery.data;
  const friends = friendsQuery.data ?? [];
  const blockedProfiles = blockedProfilesQuery.data ?? [];
  const maskPhone = (rawPhone: string | null | undefined): string | null => {
    if (!rawPhone) return null;
    const digits = rawPhone.replace(/\D/g, "");
    const suffix = (digits || rawPhone).slice(-4);
    return `*******${suffix}`;
  };

  useEffect(() => {
    if (phoneQuery.data) {
      setSavedPhoneMasked(maskPhone(phoneQuery.data));
    }
  }, [phoneQuery.data]);

  const upsertSettingsMutation = useMutation({
    mutationFn: updateMyAccountSettings,
    onSuccess: () => {
      setError(null);
      setSuccess("Configuracion guardada.");
      void settingsQuery.refetch();
    },
    onError: (err) => setError(toAppError(err)),
  });

  const updateEmailMutation = useMutation({
    mutationFn: updateAccountEmail,
    onSuccess: () => {
      setEmail("");
      setCurrentPasswordForEmail("");
      setError(null);
      setSuccess("Revisa tu correo para confirmar el cambio.");
    },
    onError: (err) => setError(toAppError(err)),
  });

  const updatePasswordMutation = useMutation({
    mutationFn: updateAccountPassword,
    onSuccess: () => {
      setCurrentPasswordForPassword("");
      setNewPassword("");
      setConfirmNewPassword("");
      setError(null);
      setSuccess("Contrasena actualizada.");
    },
    onError: (err) => setError(toAppError(err)),
  });

  const sendRecoveryMutation = useMutation({
    mutationFn: sendPasswordRecoveryToCurrentEmail,
    onSuccess: () => {
      setError(null);
      setSuccess("Enviamos un enlace de recuperacion a tu correo actual.");
    },
    onError: (err) => setError(toAppError(err)),
  });

  const updatePhoneMutation = useMutation({
    mutationFn: updateAccountPhone,
    onSuccess: () => {
      setSavedPhoneMasked(maskPhone(phone));
      setPhone("");
      setCurrentPasswordForPhone("");
      setError(null);
      setSuccess("Telefono actualizado.");
      void phoneQuery.refetch();
    },
    onError: (err) => setError(toAppError(err)),
  });

  const deleteMutation = useMutation({
    mutationFn: deleteMyAccount,
    onSuccess: () => {
      setDeleteModalOpen(false);
      setDeletePassword("");
      setError(null);
      setSuccess("Cuenta eliminada.");
    },
    onError: (err) => setError(toAppError(err)),
  });
  const unblockProfileMutation = useMutation({
    mutationFn: unblockProfile,
    onSuccess: () => {
      setError(null);
      setSuccess("Perfil desbaneado.");
      void blockedProfilesQuery.refetch();
    },
    onError: (err) => setError(toAppError(err)),
  });

  const friendOptions = useMemo(
    () => friends.map((friend) => ({ id: friend.id, label: `${friend.full_name} (@${friend.username})` })),
    [friends],
  );

  const saveMentionMode = (context: AccountContentContext, mode: MentionRestrictionMode) => {
    if (!settings) return;
    void upsertSettingsMutation.mutate({
      mention_permissions: {
        ...settings.mention_permissions,
        [context]: mode,
      },
    });
  };

  const saveInteractionFlag = (context: AccountContentContext, action: "share" | "comment" | "save" | "like", enabled: boolean) => {
    if (!settings) return;
    void upsertSettingsMutation.mutate({
      interaction_permissions: {
        ...settings.interaction_permissions,
        [context]: {
          ...settings.interaction_permissions[context],
          [action]: enabled,
        },
      },
    });
  };

  const saveVisibilityMode = (context: AccountContentContext, mode: RestrictionMode) => {
    if (!settings) return;
    const current = settings.content_visibility[context];
    void upsertSettingsMutation.mutate({
      content_visibility: {
        ...settings.content_visibility,
        [context]: {
          mode,
          excluded_friend_ids: mode === "friends_except" ? current.excluded_friend_ids : [],
        },
      },
    });
  };

  const toggleExcludedFriend = (context: AccountContentContext, friendId: string, checked: boolean) => {
    if (!settings) return;
    const currentIds = new Set(settings.content_visibility[context].excluded_friend_ids);
    if (checked) currentIds.add(friendId);
    else currentIds.delete(friendId);

    void upsertSettingsMutation.mutate({
      content_visibility: {
        ...settings.content_visibility,
        [context]: {
          ...settings.content_visibility[context],
          excluded_friend_ids: Array.from(currentIds),
        },
      },
    });
  };

  const saveProfileFieldVisibility = (field: ProfileVisibilityField, mode: RestrictionMode) => {
    if (!settings) return;
    const current = settings.profile_field_visibility[field];
    void upsertSettingsMutation.mutate({
      profile_field_visibility: {
        ...settings.profile_field_visibility,
        [field]: {
          mode,
          excluded_friend_ids: mode === "friends_except" ? current.excluded_friend_ids : [],
        },
      },
    });
  };

  const toggleExcludedFriendForField = (field: ProfileVisibilityField, friendId: string, checked: boolean) => {
    if (!settings) return;
    const currentIds = new Set(settings.profile_field_visibility[field].excluded_friend_ids);
    if (checked) currentIds.add(friendId);
    else currentIds.delete(friendId);
    void upsertSettingsMutation.mutate({
      profile_field_visibility: {
        ...settings.profile_field_visibility,
        [field]: {
          ...settings.profile_field_visibility[field],
          excluded_friend_ids: Array.from(currentIds),
        },
      },
    });
  };

  if (settingsQuery.isLoading) {
    return <p className="text-sm text-zinc-400">Cargando configuracion de cuenta...</p>;
  }

  return (
    <section className="space-y-4">
      <PageHeader title="Configuracion de cuenta" subtitle="Gestiona seguridad, privacidad, permisos y restricciones de tu cuenta." />

      {error && <p className="text-xs text-red-400">{error}</p>}
      {success && <p className="text-xs text-emerald-400">{success}</p>}

      <Card className="space-y-3">
        <h2 className="font-semibold">Seguridad y acceso</h2>
        <div className="grid gap-2">
          <Input value={email} onChange={(event) => setEmail(event.target.value)} placeholder="Nuevo correo" type="email" />
          <Input
            value={currentPasswordForEmail}
            onChange={(event) => setCurrentPasswordForEmail(event.target.value)}
            placeholder="Contrasena actual (para confirmar cambio de correo)"
            type="password"
          />
          <Button
            className="justify-self-start"
            type="button"
            disabled={!email.trim() || !currentPasswordForEmail.trim() || updateEmailMutation.isPending}
            onClick={() => updateEmailMutation.mutate({ email: email.trim(), currentPassword: currentPasswordForEmail })}
          >
            Cambiar correo
          </Button>
        </div>
        <div className="grid gap-2">
          <Input
            value={currentPasswordForPassword}
            onChange={(event) => setCurrentPasswordForPassword(event.target.value)}
            placeholder="Contrasena actual (para cambiar contrasena)"
            type="password"
          />
          <Input
            value={newPassword}
            onChange={(event) => setNewPassword(event.target.value)}
            placeholder="Nueva contrasena"
            type="password"
          />
          <Input
            value={confirmNewPassword}
            onChange={(event) => setConfirmNewPassword(event.target.value)}
            placeholder="Confirmar nueva contrasena"
            type="password"
          />
          <Button
            className="justify-self-start"
            type="button"
            disabled={
              !currentPasswordForPassword.trim() ||
              !newPassword.trim() ||
              !confirmNewPassword.trim() ||
              newPassword !== confirmNewPassword ||
              updatePasswordMutation.isPending
            }
            onClick={() =>
              updatePasswordMutation.mutate({
                currentPassword: currentPasswordForPassword,
                newPassword: newPassword.trim(),
              })
            }
          >
            Cambiar contrasena
          </Button>
          {newPassword && confirmNewPassword && newPassword !== confirmNewPassword && (
            <p className="text-xs text-red-400">La confirmacion de contrasena no coincide.</p>
          )}
          <Button type="button" className="bg-zinc-700 hover:bg-zinc-600" disabled={sendRecoveryMutation.isPending} onClick={() => sendRecoveryMutation.mutate()}>
            {sendRecoveryMutation.isPending ? "Enviando enlace..." : "No recuerdo mi contrasena (enviar enlace de recuperacion)"}
          </Button>
          <p className="text-xs text-zinc-400">
            Si no tienes acceso a tu correo, abre un ticket con soporte de Velion en{" "}
            <Link to={ROUTES.support} className="text-velion-fuchsia hover:underline">
              Centro de soporte
            </Link>
            .
          </p>
        </div>
        <div className="space-y-2">
          <p className="text-xs text-zinc-400">Telefono actual: {savedPhoneMasked ?? "No registrado"}</p>
          <Input value={phone} onChange={(event) => setPhone(event.target.value)} placeholder="Telefono (+codigo)" />
          <Input
            value={currentPasswordForPhone}
            onChange={(event) => setCurrentPasswordForPhone(event.target.value)}
            placeholder="Contrasena actual (para confirmar telefono)"
            type="password"
          />
          <Button
            type="button"
            disabled={!phone.trim() || !currentPasswordForPhone.trim() || updatePhoneMutation.isPending}
            onClick={() => updatePhoneMutation.mutate({ phone, currentPassword: currentPasswordForPhone })}
          >
            Guardar telefono
          </Button>
        </div>
      </Card>

      <Card className="space-y-3">
        <h2 className="font-semibold">Restriccion de menciones</h2>
        {settings &&
          ACCOUNT_CONTEXTS.map((context) => (
            <div key={context} className="grid gap-2 md:grid-cols-[220px_1fr] md:items-center">
              <p className="text-sm text-zinc-200">{contextLabel[context]}</p>
              <Select
                value={settings.mention_permissions[context]}
                onChange={(event) => saveMentionMode(context, event.target.value as MentionRestrictionMode)}
              >
                <option value="everyone">Todos</option>
                <option value="friends">Solo amigos</option>
                <option value="nobody">Nadie</option>
              </Select>
            </div>
          ))}
      </Card>

      <Card className="space-y-3">
        <h2 className="font-semibold">Permisos de interaccion por tipo de contenido</h2>
        {settings &&
          ACCOUNT_CONTEXTS.map((context) => (
            <div key={context} className="rounded-lg bg-velion-black/40 p-3">
              <p className="mb-2 text-sm font-medium text-zinc-100">{contextLabel[context]}</p>
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                {(["share", "comment", "save", "like"] as const).map((action) => (
                  <label key={`${context}-${action}`} className="flex items-center gap-2 text-xs text-zinc-300">
                    <input
                      type="checkbox"
                      checked={settings.interaction_permissions[context][action]}
                      onChange={(event) => saveInteractionFlag(context, action, event.target.checked)}
                    />
                    {action === "share" ? "Compartir" : action === "comment" ? "Comentar" : action === "save" ? "Guardar" : "Me gusta"}
                  </label>
                ))}
              </div>
            </div>
          ))}
      </Card>

      <Card className="space-y-3">
        <h2 className="font-semibold">Visibilidad de contenido</h2>
        {settings &&
          ACCOUNT_CONTEXTS.map((context) => (
            <div key={context} className="rounded-lg bg-velion-black/40 p-3">
              <div className="grid gap-2 md:grid-cols-[220px_1fr] md:items-center">
                <p className="text-sm text-zinc-200">{contextLabel[context]}</p>
                <Select
                  value={settings.content_visibility[context].mode}
                  onChange={(event) => saveVisibilityMode(context, event.target.value as RestrictionMode)}
                >
                  <option value="everyone">Todos</option>
                  <option value="friends">Solo amigos</option>
                  <option value="friends_except">Amigos excepto</option>
                </Select>
              </div>
              {settings.content_visibility[context].mode === "friends_except" && (
                <div className="mt-2 grid gap-2 sm:grid-cols-2">
                  {friendOptions.map((friend) => (
                    <label key={`${context}-${friend.id}`} className="flex items-center gap-2 text-xs text-zinc-300">
                      <input
                        type="checkbox"
                        checked={settings.content_visibility[context].excluded_friend_ids.includes(friend.id)}
                        onChange={(event) => toggleExcludedFriend(context, friend.id, event.target.checked)}
                      />
                      {friend.label}
                    </label>
                  ))}
                </div>
              )}
            </div>
          ))}
      </Card>

      <Card className="space-y-3">
        <h2 className="font-semibold">Baneos</h2>
        <p className="text-xs text-zinc-400">
          Los perfiles baneados no pueden mostrarte su contenido. Al desbanear, deberas volver a seguir, suscribirte y enviar solicitud de amistad si quieres reconectar.
        </p>
        {blockedProfilesQuery.isLoading && <p className="text-xs text-zinc-400">Cargando perfiles baneados...</p>}
        {!blockedProfilesQuery.isLoading && blockedProfiles.length === 0 && (
          <p className="text-xs text-zinc-400">No has baneado perfiles.</p>
        )}
        <div className="space-y-2">
          {blockedProfiles.map((item) => (
            <div key={item.block_id} className="flex items-center justify-between gap-2 rounded-lg bg-velion-black/40 p-2">
              <div className="flex min-w-0 items-center gap-2">
                <img
                  src={item.blocked_avatar_url ?? "https://placehold.co/64"}
                  alt={item.blocked_username}
                  className="h-9 w-9 rounded-full object-cover"
                />
                <div className="min-w-0">
                  <p className="truncate text-sm text-zinc-100">{item.blocked_full_name}</p>
                  <p className="truncate text-xs text-zinc-400">@{item.blocked_username}</p>
                </div>
              </div>
              <Button
                type="button"
                className="bg-zinc-700 px-3 py-1 text-xs hover:bg-zinc-600"
                onClick={() => unblockProfileMutation.mutate(item.blocked_id)}
                disabled={unblockProfileMutation.isPending}
              >
                {unblockProfileMutation.isPending ? "Procesando..." : "Desbanear"}
              </Button>
            </div>
          ))}
        </div>
      </Card>

      <Card className="space-y-3">
        <h2 className="font-semibold">Privacidad de perfil</h2>
        {settings && (
          <>
            <label className="flex items-center gap-2 text-sm text-zinc-200">
              <input
                type="checkbox"
                checked={settings.discoverability.searchable_profile}
                onChange={(event) =>
                  upsertSettingsMutation.mutate({
                    discoverability: { searchable_profile: event.target.checked },
                  })
                }
              />
              Permitir que encuentren mi perfil en el buscador
            </label>

            {PROFILE_VISIBILITY_FIELDS.map((field) => (
              <div key={field} className="rounded-lg bg-velion-black/40 p-3">
                <div className="grid gap-2 md:grid-cols-[220px_1fr] md:items-center">
                  <p className="text-sm text-zinc-200">{fieldLabel[field]}</p>
                  <Select
                    value={settings.profile_field_visibility[field].mode}
                    onChange={(event) => saveProfileFieldVisibility(field, event.target.value as RestrictionMode)}
                  >
                    <option value="everyone">Todos</option>
                    <option value="friends">Solo amigos</option>
                    <option value="friends_except">Amigos excepto</option>
                  </Select>
                </div>
                {settings.profile_field_visibility[field].mode === "friends_except" && (
                  <div className="mt-2 grid gap-2 sm:grid-cols-2">
                    {friendOptions.map((friend) => (
                      <label key={`${field}-${friend.id}`} className="flex items-center gap-2 text-xs text-zinc-300">
                        <input
                          type="checkbox"
                          checked={settings.profile_field_visibility[field].excluded_friend_ids.includes(friend.id)}
                          onChange={(event) => toggleExcludedFriendForField(field, friend.id, event.target.checked)}
                        />
                        {friend.label}
                      </label>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </>
        )}
      </Card>

      <Card className="space-y-3 border border-rose-500/40">
        <h2 className="font-semibold text-rose-300">Zona peligrosa</h2>
        <p className="text-xs text-zinc-400">Eliminar cuenta de Velion de forma permanente (requiere contrasena).</p>
        <div>
          <Button type="button" className="bg-rose-700 hover:bg-rose-600" onClick={() => setDeleteModalOpen(true)}>
            Eliminar cuenta
          </Button>
        </div>
      </Card>

      <Modal open={deleteModalOpen} onClose={() => setDeleteModalOpen(false)} title="Eliminar cuenta">
        <div className="space-y-3">
          <p className="text-sm text-zinc-300">Confirma tu contrasena para eliminar tu cuenta permanentemente.</p>
          <Input
            value={deletePassword}
            onChange={(event) => setDeletePassword(event.target.value)}
            placeholder="Contrasena actual"
            type="password"
          />
          <div className="flex justify-end gap-2">
            <Button type="button" className="bg-zinc-700 hover:bg-zinc-600" onClick={() => setDeleteModalOpen(false)}>
              Cancelar
            </Button>
            <Button
              type="button"
              className="bg-rose-700 hover:bg-rose-600"
              disabled={!deletePassword.trim() || deleteMutation.isPending}
              onClick={() => deleteMutation.mutate(deletePassword)}
            >
              {deleteMutation.isPending ? "Eliminando..." : "Eliminar definitivamente"}
            </Button>
          </div>
        </div>
      </Modal>
    </section>
  );
}
