// Cloudflare Turnstile token verification (shared logic in @rubrion/core).
//
// Returns:
//  - { ok: true }  when verification succeeds OR Turnstile is not configured
//    for this tenant (so the feature is opt-in by setting TURNSTILE_SECRET).
//  - { ok: false, error } on bad/missing token when configured.
import {
  isTurnstileEnabled as enabledFor,
  verifyTurnstile as verify,
  type TurnstileResult,
} from '@rubrion/core/turnstile';

export type { TurnstileResult };

const secretOf = (env: unknown): string | undefined => (env as { TURNSTILE_SECRET?: string }).TURNSTILE_SECRET;

export const isTurnstileEnabled = (env: unknown): boolean => enabledFor(secretOf(env));

export const verifyTurnstile = ({
  env,
  token,
  remoteIp,
}: {
  env: unknown;
  token: string | null;
  remoteIp?: string | null;
}): Promise<TurnstileResult> => verify({ secret: secretOf(env), token, remoteIp });
