interface RateLimitOptions {
  key: string;
  maxRequests: number;
  windowMs: number;
  message: string;
}

const buckets = new Map<string, number[]>();

export const enforceRateLimit = ({ key, maxRequests, windowMs, message }: RateLimitOptions): void => {
  const now = Date.now();
  const bucket = buckets.get(key) ?? [];
  const recent = bucket.filter((timestamp) => now - timestamp < windowMs);

  if (recent.length >= maxRequests) {
    throw new Error(message);
  }

  recent.push(now);
  buckets.set(key, recent);
};

