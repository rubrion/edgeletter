import { and, eq, sql } from 'drizzle-orm';
import { env } from 'cloudflare:workers';
import { aiPlatformUsage, aiUsage, getDbInstance } from '../db';

/** Platform ceiling when AI_PLATFORM_DAILY_TOKENS is unset (~US$0.40/day on llama-3.3-70b). */
export const DEFAULT_PLATFORM_DAILY_TOKENS = 300_000;

export const utcDay = (now = new Date()): string => now.toISOString().slice(0, 10);

export const platformDailyTokens = (): number => {
  const raw = Number((env as unknown as { AI_PLATFORM_DAILY_TOKENS?: string }).AI_PLATFORM_DAILY_TOKENS);
  return Number.isFinite(raw) && raw >= 0 ? raw : DEFAULT_PLATFORM_DAILY_TOKENS;
};

export type Reservation =
  | { ok: true; usedBefore: number }
  | { ok: false; reason: 'budget' | 'platform'; used: number };

/**
 * Atomically reserve `tokens` from both the publication's daily budget and the
 * platform-wide ceiling. Each counter only moves when the result stays within
 * its limit, so concurrent requests can't overspend. If the platform step
 * fails, the publication reservation is handed back.
 */
export const reserveAiTokens = async (
  publicationId: string,
  tokens: number,
  limit: number,
  day = utcDay(),
): Promise<Reservation> => {
  const db = getDbInstance();
  await db.batch([
    db.insert(aiUsage).values({ publicationId, day, tokensUsed: 0 }).onConflictDoNothing(),
    db.insert(aiPlatformUsage).values({ day, tokensUsed: 0 }).onConflictDoNothing(),
  ]);

  const pub = await db
    .update(aiUsage)
    .set({ tokensUsed: sql`${aiUsage.tokensUsed} + ${tokens}` })
    .where(
      and(
        eq(aiUsage.publicationId, publicationId),
        eq(aiUsage.day, day),
        sql`${aiUsage.tokensUsed} + ${tokens} <= ${limit}`,
      ),
    )
    .returning({ used: aiUsage.tokensUsed });
  if (pub.length === 0) {
    const [row] = await db
      .select({ used: aiUsage.tokensUsed })
      .from(aiUsage)
      .where(and(eq(aiUsage.publicationId, publicationId), eq(aiUsage.day, day)));
    return { ok: false, reason: 'budget', used: row?.used ?? 0 };
  }

  const platform = await db
    .update(aiPlatformUsage)
    .set({ tokensUsed: sql`${aiPlatformUsage.tokensUsed} + ${tokens}` })
    .where(and(eq(aiPlatformUsage.day, day), sql`${aiPlatformUsage.tokensUsed} + ${tokens} <= ${platformDailyTokens()}`))
    .returning({ used: aiPlatformUsage.tokensUsed });
  if (platform.length === 0) {
    await adjustAiTokens(publicationId, -tokens, day, false);
    return { ok: false, reason: 'platform', used: pub[0]!.used - tokens };
  }
  return { ok: true, usedBefore: pub[0]!.used - tokens };
};

/**
 * Move both counters by `delta` (negative to refund). Used to settle a
 * reservation against the model's reported usage, or to release it on error.
 */
export const adjustAiTokens = async (
  publicationId: string,
  delta: number,
  day = utcDay(),
  platform = true,
): Promise<void> => {
  if (delta === 0) return;
  const db = getDbInstance();
  const pubStmt = db
    .update(aiUsage)
    .set({ tokensUsed: sql`max(0, ${aiUsage.tokensUsed} + ${delta})` })
    .where(and(eq(aiUsage.publicationId, publicationId), eq(aiUsage.day, day)));
  if (!platform) {
    await pubStmt;
    return;
  }
  await db.batch([
    pubStmt,
    db
      .update(aiPlatformUsage)
      .set({ tokensUsed: sql`max(0, ${aiPlatformUsage.tokensUsed} + ${delta})` })
      .where(eq(aiPlatformUsage.day, day)),
  ]);
};
