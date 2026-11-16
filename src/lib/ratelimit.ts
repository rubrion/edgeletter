import { env } from 'cloudflare:workers';

type Limiter = { limit: (opts: { key: string }) => Promise<{ success: boolean }> };

/**
 * Cloudflare rate-limit binding (wrangler `ratelimits`). Fails open when the
 * binding is absent (local dev) — Turnstile still guards sign-in there.
 */
export const allow = async (key: string): Promise<boolean> => {
  const limiter = (env as unknown as { AUTH_LIMITER?: Limiter }).AUTH_LIMITER;
  if (!limiter) return true;
  try {
    return (await limiter.limit({ key })).success;
  } catch {
    return true;
  }
};

export const clientIp = (request: Request): string =>
  request.headers.get('cf-connecting-ip') ?? request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown';
