import DOMPurify from "dompurify";

export const sanitizeInput = (value: string): string => DOMPurify.sanitize(value, { ALLOWED_TAGS: [] }).trim();

