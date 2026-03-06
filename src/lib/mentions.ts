export interface MentionMatch {
  start: number;
  end: number;
  query: string;
}

const MENTION_ALLOWED = /^[a-z0-9_]*$/i;

export const getMentionMatch = (value: string, cursor: number): MentionMatch | null => {
  if (!value || cursor < 0) return null;

  const cappedCursor = Math.min(cursor, value.length);
  const beforeCursor = value.slice(0, cappedCursor);
  const atIndex = beforeCursor.lastIndexOf("@");
  if (atIndex < 0) return null;

  const prefixChar = beforeCursor[atIndex - 1];
  if (prefixChar && !/\s/.test(prefixChar)) return null;

  const query = beforeCursor.slice(atIndex + 1);
  if (query.includes(" ") || !MENTION_ALLOWED.test(query)) return null;

  return { start: atIndex, end: cappedCursor, query };
};

export const applyMentionSelection = (value: string, cursor: number, username: string): { nextValue: string; nextCursor: number } => {
  const match = getMentionMatch(value, cursor);
  if (!match) return { nextValue: value, nextCursor: cursor };

  const mentionToken = `@${username} `;
  const nextValue = `${value.slice(0, match.start)}${mentionToken}${value.slice(match.end)}`;
  const nextCursor = match.start + mentionToken.length;

  return { nextValue, nextCursor };
};
