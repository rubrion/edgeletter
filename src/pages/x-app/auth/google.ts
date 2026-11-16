import type { APIRoute } from 'astro';
import { googleEnabled, startGoogle } from '../../../lib/google';

export const GET: APIRoute = async ({ url, cookies, redirect }) => {
  if (!googleEnabled()) return redirect('/signin', 302);
  const { url: target, state, verifier } = await startGoogle(`${url.origin}/auth/google/callback`);
  const next = url.searchParams.get('next') ?? '/';
  const opts = { path: '/auth/google', httpOnly: true, sameSite: 'lax' as const, secure: url.protocol === 'https:', maxAge: 600 };
  // state + PKCE verifier + destination ride in a short-lived cookie scoped to the callback.
  cookies.set('el_oauth', JSON.stringify({ state, verifier, next }), opts);
  return redirect(target, 302);
};
