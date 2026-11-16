import { and, eq, inArray, sql } from 'drizzle-orm';
import { getDbInstance, mediaObjects, subscribers, usageCounters, type Publication } from '../db';

/**
 * Plan limits. Free publications start in a 7-day probation with a lower
 * email cap, which keeps throwaway sign-ups from using the shared sending
 * domain to spam.
 */

export type Limits = {
  subscribers: number;
  emailsPerMonth: number;
  mediaBytes: number;
  aiTokensPerDay: number;
  customDomain: boolean;
  /** Show "Made with EdgeLetter" in emails and the widget. */
  watermark: boolean;
  probation: boolean;
};

const MB = 1024 * 1024;
export const PROBATION_MS = 7 * 24 * 60 * 60 * 1000;

export const PLAN_LIMITS = {
  free: { subscribers: 1_000, emailsPerMonth: 4_000, mediaBytes: 200 * MB, aiTokensPerDay: 5_000, customDomain: false, watermark: true },
  pro: { subscribers: 25_000, emailsPerMonth: 100_000, mediaBytes: 5 * 1024 * MB, aiTokensPerDay: 30_000, customDomain: true, watermark: false },
} as const;
export const PROBATION_EMAILS_PER_MONTH = 500;

export const limitsFor = (pub: Pick<Publication, 'plan' | 'createdAt'>, now = Date.now()): Limits => {
  const base = PLAN_LIMITS[pub.plan];
  const probation = pub.plan === 'free' && now - pub.createdAt.getTime() < PROBATION_MS;
  return {
    ...base,
    emailsPerMonth: probation ? Math.min(base.emailsPerMonth, PROBATION_EMAILS_PER_MONTH) : base.emailsPerMonth,
    probation,
  };
};

export const currentMonth = (now = new Date()): string => now.toISOString().slice(0, 7);

/**
 * Atomically reserve `count` campaign emails from this month's allowance.
 * Returns false (and reserves nothing) when it would exceed the limit.
 */
export const reserveEmails = async (publicationId: string, count: number, limit: number): Promise<boolean> => {
  if (count <= 0) return true;
  const db = getDbInstance();
  const month = currentMonth();
  await db.insert(usageCounters).values({ publicationId, month, emailsSent: 0 }).onConflictDoNothing();
  const rows = await db
    .update(usageCounters)
    .set({ emailsSent: sql`${usageCounters.emailsSent} + ${count}` })
    .where(
      and(
        eq(usageCounters.publicationId, publicationId),
        eq(usageCounters.month, month),
        sql`${usageCounters.emailsSent} + ${count} <= ${limit}`,
      ),
    )
    .returning({ month: usageCounters.month });
  return rows.length > 0;
};

export const emailsThisMonth = async (publicationId: string): Promise<number> => {
  const [row] = await getDbInstance()
    .select({ n: usageCounters.emailsSent })
    .from(usageCounters)
    .where(and(eq(usageCounters.publicationId, publicationId), eq(usageCounters.month, currentMonth())))
    .limit(1);
  return row?.n ?? 0;
};

/** Subscribers that count toward the plan: active plus pending confirmations. */
export const subscriberCount = async (publicationId: string): Promise<number> => {
  const [row] = await getDbInstance()
    .select({ n: sql<number>`count(*)` })
    .from(subscribers)
    .where(and(eq(subscribers.publicationId, publicationId), inArray(subscribers.status, ['active', 'pending'])));
  return Number(row?.n ?? 0);
};

export const mediaBytesUsed = async (publicationId: string): Promise<number> => {
  const [row] = await getDbInstance()
    .select({ n: sql<number>`coalesce(sum(${mediaObjects.size}), 0)` })
    .from(mediaObjects)
    .where(eq(mediaObjects.publicationId, publicationId));
  return Number(row?.n ?? 0);
};

export const formatBytes = (n: number): string =>
  n >= 1024 * MB ? `${(n / (1024 * MB)).toFixed(1)} GB` : n >= MB ? `${Math.round(n / MB)} MB` : `${Math.round(n / 1024)} KB`;
