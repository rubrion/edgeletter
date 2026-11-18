import { env } from 'cloudflare:workers';
import { allow as allowWith, clientIp, type RateLimiter } from '@rubrion/core/ratelimit';

export { clientIp };

/**
 * Cloudflare rate-limit binding (wrangler `ratelimits`). Fails open when the
 * binding is absent (local dev) — Turnstile still guards sign-in there.
 */
export const allow = (key: string): Promise<boolean> =>
  allowWith((env as unknown as { AUTH_LIMITER?: RateLimiter }).AUTH_LIMITER, key);
