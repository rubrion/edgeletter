import type { AstroCookies } from 'astro';
import { and, eq, gt, isNull } from 'drizzle-orm';
import {
  apiKeys,
  getDbInstance,
  loginTokens,
  memberships,
  publications,
  sessions,
  users,
  type Role,
  type User,
} from '../db';
import { publicationColumns, type PublicationContext } from './tenant';

/**
 * Accounts on the platform. Every secret (session token, login token, API
 * key) is random, shown to its owner once, and stored only as a SHA-256 hash.
 */

export const SESSION_COOKIE = 'el_session';
/** Active publication in the dashboard (its id; membership is re-checked on every request). */
export const PUB_COOKIE = 'el_pub';
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
export const LOGIN_TOKEN_TTL_MS = 15 * 60 * 1000;
export const INVITE_TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000;

const enc = new TextEncoder();

export const sha256 = async (value: string): Promise<string> => {
  const digest = await crypto.subtle.digest('SHA-256', enc.encode(value));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
};

export const randomToken = (bytes = 32): string => {
  const buf = crypto.getRandomValues(new Uint8Array(bytes));
  return btoa(String.fromCharCode(...buf)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};

export const normalizeEmail = (email: string): string => email.trim().toLowerCase();
export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// ---------- Sessions ----------

const cookieOpts = (secure: boolean, maxAge: number) => ({
  path: '/',
  httpOnly: true,
  sameSite: 'lax' as const,
  secure,
  maxAge,
});

export const startSession = async (
  cookies: AstroCookies,
  userId: string,
  opts: { secure: boolean; userAgent?: string | null },
): Promise<void> => {
  const token = randomToken();
  await getDbInstance()
    .insert(sessions)
    .values({
      id: await sha256(token),
      userId,
      expiresAt: new Date(Date.now() + SESSION_TTL_MS),
      userAgent: opts.userAgent?.slice(0, 200) ?? null,
    });
  cookies.set(SESSION_COOKIE, token, cookieOpts(opts.secure, SESSION_TTL_MS / 1000));
};

export const sessionUser = async (cookies: AstroCookies): Promise<User | null> => {
  const token = cookies.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const [row] = await getDbInstance()
    .select({ user: users })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(and(eq(sessions.id, await sha256(token)), gt(sessions.expiresAt, new Date())))
    .limit(1);
  return row?.user ?? null;
};

export const endSession = async (cookies: AstroCookies, secure: boolean): Promise<void> => {
  const token = cookies.get(SESSION_COOKIE)?.value;
  if (token) await getDbInstance().delete(sessions).where(eq(sessions.id, await sha256(token)));
  cookies.set(SESSION_COOKIE, '', cookieOpts(secure, 0));
  cookies.set(PUB_COOKIE, '', cookieOpts(secure, 0));
};

export const rememberPublication = (cookies: AstroCookies, publicationId: string, secure: boolean): void => {
  cookies.set(PUB_COOKIE, publicationId, cookieOpts(secure, SESSION_TTL_MS / 1000));
};

// ---------- Users ----------

export const findOrCreateUser = async (
  email: string,
  profile: { name?: string | null; avatarUrl?: string | null } = {},
): Promise<User> => {
  const db = getDbInstance();
  const normalized = normalizeEmail(email);
  const now = new Date();
  await db
    .insert(users)
    .values({ email: normalized, name: profile.name ?? null, avatarUrl: profile.avatarUrl ?? null, emailVerifiedAt: now })
    .onConflictDoNothing();
  const [user] = await db.select().from(users).where(eq(users.email, normalized)).limit(1);
  // Every way in (magic link, Google with verified email) proves the address.
  if (!user!.emailVerifiedAt || (!user!.name && profile.name)) {
    await db
      .update(users)
      .set({ emailVerifiedAt: user!.emailVerifiedAt ?? now, name: user!.name ?? profile.name ?? null, avatarUrl: user!.avatarUrl ?? profile.avatarUrl ?? null })
      .where(eq(users.id, user!.id));
  }
  return user!;
};

// ---------- Login / invite tokens ----------

export const issueLoginToken = async (input: {
  email: string;
  purpose?: 'login' | 'invite';
  publicationId?: string;
  role?: Role;
}): Promise<string> => {
  const token = randomToken();
  const invite = input.purpose === 'invite';
  await getDbInstance()
    .insert(loginTokens)
    .values({
      id: await sha256(token),
      email: normalizeEmail(input.email),
      purpose: input.purpose ?? 'login',
      publicationId: input.publicationId ?? null,
      role: input.role ?? null,
      expiresAt: new Date(Date.now() + (invite ? INVITE_TOKEN_TTL_MS : LOGIN_TOKEN_TTL_MS)),
    });
  return token;
};

/** Single-use: marks the token used in the same statement that reads it. */
export const consumeLoginToken = async (token: string) => {
  const now = new Date();
  const [row] = await getDbInstance()
    .update(loginTokens)
    .set({ usedAt: now })
    .where(and(eq(loginTokens.id, await sha256(token)), isNull(loginTokens.usedAt), gt(loginTokens.expiresAt, now)))
    .returning();
  return row ?? null;
};

// ---------- Memberships ----------

export type MembershipView = { role: Role; publication: PublicationContext };

export const membershipsOf = async (userId: string): Promise<MembershipView[]> => {
  const rows = await getDbInstance()
    .select({ role: memberships.role, publication: publicationColumns })
    .from(memberships)
    .innerJoin(publications, eq(publications.id, memberships.publicationId))
    .where(eq(memberships.userId, userId))
    .orderBy(memberships.createdAt);
  return rows;
};

export const roleIn = async (userId: string, publicationId: string): Promise<Role | null> => {
  const [row] = await getDbInstance()
    .select({ role: memberships.role })
    .from(memberships)
    .where(and(eq(memberships.userId, userId), eq(memberships.publicationId, publicationId)))
    .limit(1);
  return row?.role ?? null;
};

export const addMember = async (userId: string, publicationId: string, role: Role): Promise<void> => {
  await getDbInstance()
    .insert(memberships)
    .values({ userId, publicationId, role })
    .onConflictDoNothing();
};

// ---------- API keys (server-to-server publish / subscribe) ----------

export type ApiScope = 'publish' | 'subscribe';

export const createApiKey = async (publicationId: string, scope: ApiScope, label: string | null): Promise<string> => {
  const raw = `el_${scope === 'publish' ? 'pub' : 'sub'}_${randomToken(24)}`;
  await getDbInstance()
    .insert(apiKeys)
    .values({ publicationId, scope, keyHash: await sha256(raw), prefix: raw.slice(0, 12), label });
  return raw;
};

/** True when `raw` is a live key of this publication with this scope. */
export const verifyApiKey = async (raw: string | null, publicationId: string, scope: ApiScope): Promise<boolean> => {
  if (!raw || !raw.startsWith('el_')) return false;
  const db = getDbInstance();
  const [row] = await db
    .select({ id: apiKeys.id })
    .from(apiKeys)
    .where(
      and(
        eq(apiKeys.keyHash, await sha256(raw)),
        eq(apiKeys.publicationId, publicationId),
        eq(apiKeys.scope, scope),
        isNull(apiKeys.revokedAt),
      ),
    )
    .limit(1);
  if (!row) return false;
  await db.update(apiKeys).set({ lastUsedAt: new Date() }).where(eq(apiKeys.id, row.id));
  return true;
};

export const bearer = (request: Request): string | null => {
  const h = request.headers.get('authorization') ?? '';
  return h.startsWith('Bearer ') ? h.slice(7).trim() : null;
};
