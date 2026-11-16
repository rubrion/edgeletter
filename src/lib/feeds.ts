import { and, asc, eq, inArray, isNull, lt, or, sql } from 'drizzle-orm';
import { feedItems, feedSources, getDbInstance, posts, publications, type FeedSource } from '../db';
import { sha256 } from './auth';
import { audienceFor, enqueueCampaign } from './email-queue';
import { parseFeed, type FeedItem } from './feed-parse';
import { limitsFor, reserveEmails } from './plans';
import { sanitizeHtml } from './sanitize';

/**
 * RSS/Atom import. A feed is checked when added (backfill: newest items,
 * never emailed) and then by cron. New items become published posts that
 * link back to the original (canonical_url); with auto-send on they are
 * emailed through the normal campaign path (limits, suppressions, queue).
 */

export const MAX_FEEDS_PER_PUBLICATION = 3;
export const BACKFILL_ITEMS = 20;
const MAX_NEW_PER_CHECK = 10;
const MAX_BYTES = 2 * 1024 * 1024;
const FETCH_TIMEOUT_MS = 10_000;
const CHECK_EVERY_MS = 30 * 60 * 1000;
const DISABLE_AFTER_FAILURES = 10;
export const FEEDS_PER_RUN = 25;

export class FeedError extends Error {}

/** http(s) only; the Worker can't reach private networks anyway (global_fetch_strictly_public). */
export const normalizeFeedUrl = (raw: string): string | null => {
  try {
    const u = new URL(raw.trim());
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
    u.hash = '';
    return u.toString();
  } catch {
    return null;
  }
};

type Fetched = { notModified: true } | { notModified: false; xml: string; etag: string | null; lastModified: string | null };

const fetchFeed = async (source: Pick<FeedSource, 'url' | 'etag' | 'lastModified'>): Promise<Fetched> => {
  const res = await fetch(source.url, {
    headers: {
      'User-Agent': 'EdgeLetter-FeedImport/1.0 (+https://edgeletter.blog)',
      Accept: 'application/rss+xml, application/atom+xml, application/xml;q=0.9, text/xml;q=0.8, */*;q=0.1',
      ...(source.etag ? { 'If-None-Match': source.etag } : {}),
      ...(source.lastModified ? { 'If-Modified-Since': source.lastModified } : {}),
    },
    redirect: 'follow',
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (res.status === 304) return { notModified: true };
  if (!res.ok) throw new FeedError(`The feed answered ${res.status}.`);
  const declared = Number(res.headers.get('content-length') ?? 0);
  if (declared > MAX_BYTES) throw new FeedError('The feed is too large (over 2 MB).');
  // Read with a hard cap even when no length is declared.
  const reader = res.body?.getReader();
  if (!reader) throw new FeedError('The feed was empty.');
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_BYTES) {
      await reader.cancel();
      throw new FeedError('The feed is too large (over 2 MB).');
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) {
    bytes.set(c, off);
    off += c.byteLength;
  }
  return {
    notModified: false,
    xml: new TextDecoder().decode(bytes),
    etag: res.headers.get('etag'),
    lastModified: res.headers.get('last-modified'),
  };
};

const slugify = (s: string): string =>
  s
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'post';

/**
 * Slug unique within the publication: "title", then "title-2" … "title-9",
 * then a short random suffix. (Exact matches only: D1 rejects long LIKE
 * patterns, and slugs can be 80 characters.)
 */
const uniqueSlug = async (publicationId: string, base: string): Promise<string> => {
  const candidates = [base, ...Array.from({ length: 8 }, (_, i) => `${base}-${i + 2}`)];
  const taken = new Set(
    (
      await getDbInstance()
        .select({ slug: posts.slug })
        .from(posts)
        .where(and(eq(posts.publicationId, publicationId), inArray(posts.slug, candidates)))
    ).map((r) => r.slug),
  );
  return candidates.find((c) => !taken.has(c)) ?? `${base}-${crypto.randomUUID().slice(0, 6)}`;
};

const httpsOrNull = (link: string | null): string | null => {
  try {
    const u = new URL(link ?? '');
    return u.protocol === 'https:' ? u.toString() : null;
  } catch {
    return null;
  }
};

export type ImportResult = { imported: number; emailed: number; skippedEmail: number; notModified?: boolean };

/**
 * Fetch and import one feed. `backfill` imports up to BACKFILL_ITEMS newest
 * items and never emails; otherwise new items are imported (oldest first)
 * and emailed when the feed has auto-send on and the plan allows it.
 */
export const importFeed = async (env: Env, source: FeedSource, backfill = false): Promise<ImportResult> => {
  const db = getDbInstance();
  const fetched = await fetchFeed(backfill ? { ...source, etag: null, lastModified: null } : source);
  const now = new Date();
  if (fetched.notModified) {
    await db.update(feedSources).set({ lastCheckedAt: now, lastSuccessAt: now, lastError: null, failCount: 0 }).where(eq(feedSources.id, source.id));
    return { imported: 0, emailed: 0, skippedEmail: 0, notModified: true };
  }

  let parsed;
  try {
    parsed = parseFeed(fetched.xml);
  } catch {
    throw new FeedError('That address is not an RSS or Atom feed.');
  }

  // Newest first, keep only items we have never seen.
  const items = [...parsed.items].sort((a, b) => (b.date?.getTime() ?? 0) - (a.date?.getTime() ?? 0));
  const fresh: (FeedItem & { hash: string })[] = [];
  for (const item of items.slice(0, backfill ? BACKFILL_ITEMS : 50)) {
    if (!item.title && !item.html) continue;
    const hash = await sha256(item.guid);
    const [seen] = await db
      .select({ h: feedItems.guidHash })
      .from(feedItems)
      .where(and(eq(feedItems.feedId, source.id), eq(feedItems.guidHash, hash)))
      .limit(1);
    if (!seen) fresh.push({ ...item, hash });
  }

  const [pub] = await db.select().from(publications).where(eq(publications.id, source.publicationId)).limit(1);
  if (!pub || pub.status !== 'active') throw new FeedError('Publication is not active.');

  const result: ImportResult = { imported: 0, emailed: 0, skippedEmail: 0 };
  // Oldest first so posts (and emails) go out in publication order.
  for (const item of fresh.slice(0, backfill ? BACKFILL_ITEMS : MAX_NEW_PER_CHECK).reverse()) {
    // Claim the item first: a concurrent check of the same feed skips it.
    const claimed = await db
      .insert(feedItems)
      .values({ feedId: source.id, guidHash: item.hash, createdAt: now })
      .onConflictDoNothing()
      .returning({ h: feedItems.guidHash });
    if (claimed.length === 0) continue;

    const html = sanitizeHtml(item.html || '');
    const title = (item.title || 'Untitled').slice(0, 300);
    const [post] = await db
      .insert(posts)
      .values({
        publicationId: source.publicationId,
        title,
        slug: await uniqueSlug(source.publicationId, slugify(title)),
        contentHtml: html,
        // The editor works in markdown; raw HTML is valid markdown and round-trips.
        contentMd: html,
        isPublished: true,
        publishedAt: item.date ?? now,
        lang: source.lang,
        canonicalUrl: httpsOrNull(item.link),
      })
      .returning();
    await db.update(feedItems).set({ postId: post!.id }).where(and(eq(feedItems.feedId, source.id), eq(feedItems.guidHash, item.hash)));
    result.imported++;

    if (backfill || !source.autoSend) continue;
    const audience = await audienceFor(source.publicationId, source.lang);
    if (!(await reserveEmails(source.publicationId, audience.length, limitsFor(pub).emailsPerMonth))) {
      result.skippedEmail++;
      continue;
    }
    await enqueueCampaign({ env, publicationId: source.publicationId, post: post!, subscriberIds: audience });
    result.emailed++;
  }

  await db
    .update(feedSources)
    .set({
      etag: fetched.etag,
      lastModified: fetched.lastModified,
      lastCheckedAt: now,
      lastSuccessAt: now,
      lastError: result.skippedEmail ? `Monthly email limit reached: ${result.skippedEmail} imported post(s) were not emailed.` : null,
      failCount: 0,
    })
    .where(eq(feedSources.id, source.id));
  return result;
};

/** Record a failed check; repeated failures switch the feed off. */
export const recordFeedFailure = async (source: FeedSource, err: unknown): Promise<void> => {
  console.error('feed check failed', source.url, err);
  const message = err instanceof FeedError ? err.message : err instanceof Error && err.name === 'TimeoutError' ? 'The feed took too long to answer.' : 'Could not read the feed.';
  const failCount = source.failCount + 1;
  await getDbInstance()
    .update(feedSources)
    .set({
      lastCheckedAt: new Date(),
      lastError: failCount >= DISABLE_AFTER_FAILURES ? `${message} Paused after ${failCount} failed checks.` : message,
      failCount,
      enabled: failCount < DISABLE_AFTER_FAILURES,
    })
    .where(eq(feedSources.id, source.id));
};

/** Cron: check enabled feeds whose last check is older than CHECK_EVERY_MS. */
export const checkDueFeeds = async (env: Env): Promise<{ checked: number; imported: number }> => {
  const due = await getDbInstance()
    .select({ feed: feedSources })
    .from(feedSources)
    .innerJoin(publications, eq(publications.id, feedSources.publicationId))
    .where(
      and(
        eq(feedSources.enabled, true),
        eq(publications.status, 'active'),
        or(isNull(feedSources.lastCheckedAt), lt(feedSources.lastCheckedAt, new Date(Date.now() - CHECK_EVERY_MS))),
      ),
    )
    .orderBy(asc(sql`coalesce(${feedSources.lastCheckedAt}, 0)`))
    .limit(FEEDS_PER_RUN);
  let imported = 0;
  for (const { feed } of due) {
    try {
      imported += (await importFeed(env, feed)).imported;
    } catch (err) {
      await recordFeedFailure(feed, err);
    }
  }
  return { checked: due.length, imported };
};
