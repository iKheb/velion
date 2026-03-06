import { sanitizeInput } from "@/lib/sanitize";

const HASHTAG_REGEX = /(^|\s)#([\p{L}\p{N}_]+)/gu;
const MENTION_REGEX = /(^|\s)@([\p{L}\p{N}_]+)/gu;

const collectUniqueMatches = (value: string, regex: RegExp, prefix: "#" | "@"): string[] => {
  const normalized = new Set<string>();
  const matches = Array.from(value.matchAll(regex));
  matches.forEach((match) => {
    const token = `${prefix}${(match[2] ?? "").toLowerCase()}`;
    if (token.length <= 1) return;
    normalized.add(token);
  });
  return Array.from(normalized);
};

export const validateSocialTextRules = (rawValue: string): string => {
  const value = sanitizeInput(rawValue ?? "");
  if (!value) return value;

  const hashtags = collectUniqueMatches(value, HASHTAG_REGEX, "#");
  const mentions = collectUniqueMatches(value, MENTION_REGEX, "@");

  const totalHashtagMatches = Array.from(value.matchAll(HASHTAG_REGEX)).length;
  const totalMentionMatches = Array.from(value.matchAll(MENTION_REGEX)).length;

  if (hashtags.length > 5) {
    throw new Error("Solo puedes usar hasta 5 hashtags por publicacion/historia.");
  }

  if (totalHashtagMatches > hashtags.length) {
    throw new Error("No puedes repetir hashtags.");
  }

  if (totalMentionMatches > mentions.length) {
    throw new Error("No puedes repetir menciones.");
  }

  return value;
};

