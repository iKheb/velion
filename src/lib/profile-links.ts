import type { Json, Profile } from "@/types/models";

const EXTERNAL_LINK_KEYS = ["website", "twitch", "youtube", "x", "instagram"] as const;
export type ExternalLinkKey = (typeof EXTERNAL_LINK_KEYS)[number];

export type ExternalLinksMap = Partial<Record<ExternalLinkKey, string>>;

const isRecord = (value: Json | null): value is Record<string, Json> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

export const getExternalLinks = (profile: Pick<Profile, "external_links">): ExternalLinksMap => {
  if (!isRecord(profile.external_links)) return {};

  const links: ExternalLinksMap = {};
  for (const key of EXTERNAL_LINK_KEYS) {
    const value = profile.external_links[key];
    if (typeof value === "string" && value.trim()) {
      links[key] = value.trim();
    }
  }
  return links;
};

export const normalizeExternalLink = (value?: string): string | null => {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  return `https://${trimmed}`;
};

export const isValidExternalLinkInput = (value?: string): boolean => {
  const normalized = normalizeExternalLink(value);
  if (!normalized) return true;

  try {
    const parsed = new URL(normalized);
    if (!["http:", "https:"].includes(parsed.protocol)) return false;
    return parsed.hostname.includes(".") || parsed.hostname === "localhost";
  } catch {
    return false;
  }
};

export const getExternalLinkLabel = (key: string): string => {
  switch (key) {
    case "x":
      return "X";
    case "youtube":
      return "YouTube";
    case "twitch":
      return "Twitch";
    case "instagram":
      return "Instagram";
    case "website":
      return "Website";
    default:
      return key;
  }
};

export const buildExternalLinks = (input: ExternalLinksMap): ExternalLinksMap | null => {
  const normalizedEntries = Object.entries(input)
    .map(([key, value]) => [key, normalizeExternalLink(value)] as const)
    .filter((entry): entry is [string, string] => Boolean(entry[1]));

  if (!normalizedEntries.length) return null;
  return Object.fromEntries(normalizedEntries) as ExternalLinksMap;
};
