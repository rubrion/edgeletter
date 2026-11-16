import type { APIRoute } from 'astro';
import { and, eq } from 'drizzle-orm';
import { getDbInstance, oauthAccounts, users } from '../../../../db';
import { findOrCreateUser, startSession } from '../../../../lib/auth';
import { finishGoogle } from '../../../../lib/google';

const safeNext = (v: unknown): string => (typeof v === 'string' && /^\/(?!\/)[^\s]*$/.test(v) ? v : '/');
const fail = (msg: string) => '/signin?error=' + encodeURIComponent(msg);

export const GET: APIRoute = async ({ url, cookies, redirect, request }) => {
  const raw = cookies.get('el_oauth')?.value;
  cookies.set('el_oauth', '', { path: '/auth/google', maxAge: 0 });
  let saved: { state?: string; verifier?: string; next?: string } = {};
  try {
    saved = raw ? JSON.parse(raw) : {};
  } catch {
    /* treated as missing */
  }
  const code = url.searchParams.get('code');
  if (!code || !saved.state || saved.state !== url.searchParams.get('state') || !saved.verifier) {
    return redirect(fail('Google sign-in was interrupted. Please try again.'), 302);
  }

  let profile;
  try {
    profile = await finishGoogle(code, saved.verifier, `${url.origin}/auth/google/callback`);
  } catch (err) {
    console.error('google sign-in failed', err);
    return redirect(fail('Google sign-in failed. Please try again.'), 302);
  }

  const db = getDbInstance();
  const [linked] = await db
    .select({ user: users })
    .from(oauthAccounts)
    .innerJoin(users, eq(users.id, oauthAccounts.userId))
    .where(and(eq(oauthAccounts.provider, 'google'), eq(oauthAccounts.providerUserId, profile.sub)))
    .limit(1);
  // Google only returns verified emails here, so linking by email is safe.
  const user = linked?.user ?? (await findOrCreateUser(profile.email, { name: profile.name, avatarUrl: profile.picture }));
  if (!linked) {
    await db.insert(oauthAccounts).values({ provider: 'google', providerUserId: profile.sub, userId: user.id }).onConflictDoNothing();
  }

  await startSession(cookies, user.id, { secure: url.protocol === 'https:', userAgent: request.headers.get('user-agent') });
  return redirect(safeNext(saved.next), 302);
};
