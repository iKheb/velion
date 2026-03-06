import type { User } from "@supabase/supabase-js";
import { supabase } from "@/services/supabase";

export const requireAuthUser = async (): Promise<User> => {
  const user = (await supabase.auth.getUser()).data.user;
  if (!user) throw new Error("No autenticado");
  return user;
};

export const requireNonEmptyText = (value: string | null | undefined, message: string): string => {
  const normalized = (value ?? "").trim();
  if (!normalized) throw new Error(message);
  return normalized;
};

