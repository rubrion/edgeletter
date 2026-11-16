import { env } from 'cloudflare:workers';
import { randomToken } from './auth';

/**
 * Google sign-in: authorization code flow with PKCE. The ID token comes
 * straight from Google's token endpoint over TLS in exchange for our client
 * secret, so its claims are read without re-verifying the signature.
 */

type GoogleEnv = { GOOGLE_CLIENT_ID?: string; GOOGLE_CLIENT_SECRET?: string };
const cfg = () => env as unknown as GoogleEnv;

export const googleEnabled = (): boolean => !!cfg().GOOGLE_CLIENT_ID && !!cfg().GOOGLE_CLIENT_SECRET;

const b64url = (buf: ArrayBuffer): string =>
  btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

export const startGoogle = async (redirectUri: string) => {
  const state = randomToken(18);
  const verifier = randomToken(48);
  const challenge = b64url(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier)));
  const params = new URLSearchParams({
    client_id: cfg().GOOGLE_CLIENT_ID!,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: 'openid email profile',
    state,
    code_challenge: challenge,
    code_challenge_method: 'S256',
    prompt: 'select_account',
  });
  return { url: `https://accounts.google.com/o/oauth2/v2/auth?${params}`, state, verifier };
};

export type GoogleProfile = { sub: string; email: string; name: string | null; picture: string | null };

export const finishGoogle = async (code: string, verifier: string, redirectUri: string): Promise<GoogleProfile> => {
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: cfg().GOOGLE_CLIENT_ID!,
      client_secret: cfg().GOOGLE_CLIENT_SECRET!,
      redirect_uri: redirectUri,
      grant_type: 'authorization_code',
      code_verifier: verifier,
    }),
  });
  if (!res.ok) throw new Error(`google token exchange failed (${res.status})`);
  const { id_token } = (await res.json()) as { id_token?: string };
  const payload = id_token?.split('.')[1];
  if (!payload) throw new Error('google returned no id_token');
  const claims = JSON.parse(atob(payload.replace(/-/g, '+').replace(/_/g, '/'))) as {
    sub?: string;
    email?: string;
    email_verified?: boolean;
    name?: string;
    picture?: string;
    aud?: string;
    iss?: string;
  };
  if (claims.aud !== cfg().GOOGLE_CLIENT_ID) throw new Error('google token audience mismatch');
  if (!claims.iss?.includes('accounts.google.com')) throw new Error('google token issuer mismatch');
  if (!claims.sub || !claims.email || !claims.email_verified) throw new Error('google account email not verified');
  return { sub: claims.sub, email: claims.email, name: claims.name ?? null, picture: claims.picture ?? null };
};
