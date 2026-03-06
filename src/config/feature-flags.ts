type FlagName =
  | "streamsEnabled"
  | "walletEnabled"
  | "moderationEnabled"
  | "searchEnabled"
  | "supportEnabled";

type FeatureFlags = Record<FlagName, boolean>;

const parseBoolean = (value: string | undefined, fallback: boolean): boolean => {
  if (value == null) return fallback;
  const normalized = value.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  return fallback;
};

export const featureFlags: FeatureFlags = {
  streamsEnabled: parseBoolean(import.meta.env.VITE_FF_STREAMS, true),
  walletEnabled: parseBoolean(import.meta.env.VITE_FF_WALLET, true),
  moderationEnabled: parseBoolean(import.meta.env.VITE_FF_MODERATION, true),
  searchEnabled: parseBoolean(import.meta.env.VITE_FF_SEARCH, true),
  supportEnabled: parseBoolean(import.meta.env.VITE_FF_SUPPORT, true),
};

export const isFeatureEnabled = (name: FlagName): boolean => featureFlags[name];
