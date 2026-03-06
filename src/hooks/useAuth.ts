import { useEffect, useState } from "react";
import { getMyProfile, getSession, signInWithEmail, signOut, signUpWithEmailExtended, type RegisterWithEmailPayload } from "@/services/auth.service";
import { toAppError } from "@/services/error.service";
import { useAppStore } from "@/store/app.store";
import { supabase } from "@/services/supabase";

interface EmailAuthPayload {
  email: string;
  password: string;
}

export const useAuth = () => {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const profile = useAppStore((state) => state.profile);
  const setProfile = useAppStore((state) => state.setProfile);

  useEffect(() => {
    const load = async () => {
      try {
        const session = await getSession();
        if (!session) {
          setProfile(null);
          return;
        }
        const me = await getMyProfile();
        if (me?.is_banned) {
          await signOut();
          setProfile(null);
          setError("Tu cuenta fue suspendida.");
          return;
        }
        setProfile(me);
      } catch (err) {
        setError(toAppError(err));
      } finally {
        setLoading(false);
      }
    };

    void load();

    const { data: authSubscription } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!session) {
        setProfile(null);
        return;
      }

      void getMyProfile()
        .then(async (me) => {
          if (me?.is_banned) {
            await signOut();
            setProfile(null);
            setError("Tu cuenta fue suspendida.");
            return;
          }
          setProfile(me);
        })
        .catch((err) => setError(toAppError(err)));
    });

    return () => {
      authSubscription.subscription.unsubscribe();
    };
  }, [setProfile]);

  const login = async (payload: EmailAuthPayload) => {
    setError(null);
    await signInWithEmail(payload);
    const me = await getMyProfile();
    if (me?.is_banned) {
      await signOut();
      throw new Error("Tu cuenta fue suspendida.");
    }
    setProfile(me);
  };

  const register = async (payload: RegisterWithEmailPayload) => {
    setError(null);
    await signUpWithEmailExtended(payload);
    const me = await getMyProfile();
    if (me?.is_banned) {
      await signOut();
      throw new Error("Tu cuenta fue suspendida.");
    }
    setProfile(me);
  };

  return {
    loading,
    error,
    profile,
    login,
    register,
    logout: signOut,
  };
};
