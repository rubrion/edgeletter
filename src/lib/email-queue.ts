import { and, eq, inArray, sql } from 'drizzle-orm';
import {
  campaignDeliveries,
  campaigns,
  emailSuppressions,
  getDbInstance,
  memberships,
  posts,
  publications,
  subscribers,
  users,
  type Post,
} from '../db';
import { limitsFor } from './plans';
import { providerFor, sendBatch, type Recipient } from './dispatch';
import { loadSettings } from './settings';
import { publicationHost } from './tenant';

/**
 * Campaign fan-out.
 *
 * Publishing records a `queued` campaign and pushes recipient batches onto
 * EMAIL_QUEUE; the consumer (src/worker.ts) sends each batch. Every recipient
 * is tracked in `campaign_deliveries`, which makes redelivery idempotent
 * (Queues is at-least-once) and is the only source of the campaign counters.
 * Without a queue binding, batches are processed inline through the same path.
 */

export type EmailJob = {
  campaignId: string;
  publicationId: string;
  postId: string;
  subscriberIds: string[];
  attempt: number;
};

/** D1 caps bound parameters at 100 per statement: keep id lists well under. */
export const JOB_SIZE = 50;
const INSERT_CHUNK = 20; // 4 columns per delivery row
const MAX_ATTEMPTS = 4; // app-level retries for transient provider failures
/** Queue redeliveries (wrangler max_retries) before recipients are written off. */
export const MAX_QUEUE_ATTEMPTS = 5;
/** A queued/sending campaign older than this no longer blocks a re-send. */
export const STALE_CAMPAIGN_MS = 6 * 60 * 60 * 1000;

const LIVE = ['queued', 'sending', 'sent', 'partial'] as const;
const FINAL = ['sent', 'failed', 'skipped'] as const;

const queueOf = (env: Env): Queue<EmailJob> | undefined =>
  (env as unknown as { EMAIL_QUEUE?: Queue<EmailJob> }).EMAIL_QUEUE;

const chunk = <T>(xs: T[], n: number): T[][] => {
  const out: T[][] = [];
  for (let i = 0; i < xs.length; i += n) out.push(xs.slice(i, i + n));
  return out;
};

/** Active, non-suppressed subscribers of this publication in the post's language. */
export const audienceFor = async (publicationId: string, lang: Post['lang']): Promise<string[]> => {
  const rows = await getDbInstance()
    .select({ id: subscribers.id })
    .from(subscribers)
    .leftJoin(emailSuppressions, eq(emailSuppressions.email, subscribers.email))
    .where(
      and(
        eq(subscribers.publicationId, publicationId),
        eq(subscribers.status, 'active'),
        eq(subscribers.lang, lang),
        sql`${emailSuppressions.email} IS NULL`,
      ),
    );
  return rows.map((r) => r.id);
};

/**
 * Retire queued/sending campaigns for a post that have made no delivery
 * progress for STALE_CAMPAIGN_MS (a large campaign still draining keeps
 * advancing `campaign_deliveries.updated_at`, so it is left alone).
 */
export const retireStaleCampaigns = async (postId: string): Promise<void> => {
  const cutoff = Date.now() - STALE_CAMPAIGN_MS;
  await getDbInstance()
    .update(campaigns)
    .set({ status: 'failed' })
    .where(
      and(
        eq(campaigns.postId, postId),
        inArray(campaigns.status, ['queued', 'sending']),
        sql`coalesce((SELECT max(d.updated_at) FROM campaign_deliveries d WHERE d.campaign_id = ${campaigns.id}), ${campaigns.sentAt}) < ${cutoff}`,
      ),
    );
};

/** The live campaign for a post, if any (queued, sending or delivered). */
export const liveCampaignFor = async (postId: string) =>
  (
    await getDbInstance()
      .select()
      .from(campaigns)
      .where(and(eq(campaigns.postId, postId), inArray(campaigns.status, [...LIVE])))
      .limit(1)
  )[0];

export class CampaignAlreadyLive extends Error {}

export type EnqueueResult = { campaignId: string; recipients: number; queued: boolean };

export const enqueueCampaign = async ({
  env,
  publicationId,
  post,
  subscriberIds,
}: {
  env: Env;
  publicationId: string;
  post: Pick<Post, 'id'>;
  subscriberIds: string[];
}): Promise<EnqueueResult> => {
  const db = getDbInstance();
  const empty = subscriberIds.length === 0;
  let campaignId: string;
  try {
    const [row] = await db
      .insert(campaigns)
      .values({
        publicationId,
        postId: post.id,
        sentAt: new Date(),
        status: empty ? 'sent' : 'queued',
        providerUsed: providerFor(env),
        recipients: subscriberIds.length,
      })
      .returning({ id: campaigns.id });
    campaignId = row!.id;
  } catch (err) {
    // campaigns_post_live_unique: a concurrent publish already claimed this post.
    if (/UNIQUE constraint failed/i.test(String(err))) throw new CampaignAlreadyLive();
    throw err;
  }
  if (empty) return { campaignId, recipients: 0, queued: false };

  const jobs: EmailJob[] = chunk(subscriberIds, JOB_SIZE).map((ids) => ({
    campaignId,
    publicationId,
    postId: post.id,
    subscriberIds: ids,
    attempt: 1,
  }));

  const queue = queueOf(env);
  if (queue) {
    let enqueued = 0;
    try {
      for (const group of chunk(jobs, 100)) {
        await queue.sendBatch(group.map((body) => ({ body })));
        enqueued += group.reduce((n, j) => n + j.subscriberIds.length, 0);
      }
    } catch (err) {
      // Only what actually reached the queue can ever be counted; shrink the
      // target so the campaign still settles instead of sitting in `queued`.
      await db
        .update(campaigns)
        .set({ recipients: enqueued, ...(enqueued === 0 ? { status: 'failed' as const } : {}) })
        .where(eq(campaigns.id, campaignId));
      if (enqueued > 0) await settle(campaignId);
      throw err;
    }
    return { campaignId, recipients: subscriberIds.length, queued: true };
  }

  for (const first of jobs) {
    // No queue: retry transient failures right away until MAX_ATTEMPTS; after
    // that they are recorded as failed, so the campaign always settles.
    let job: EmailJob | null = first;
    while (job) {
      const retry: string[] = await processEmailJob(env, job);
      job = retry.length > 0 ? { ...job, subscriberIds: retry, attempt: job.attempt + 1 } : null;
    }
  }
  return { campaignId, recipients: subscriberIds.length, queued: false };
};

const setDeliveries = async (
  campaignId: string,
  ids: string[],
  status: (typeof campaignDeliveries.$inferInsert)['status'],
): Promise<void> => {
  if (ids.length === 0) return;
  const db = getDbInstance();
  const now = new Date();
  for (const part of chunk(ids, INSERT_CHUNK)) {
    await db
      .insert(campaignDeliveries)
      .values(part.map((subscriberId) => ({ campaignId, subscriberId, status, updatedAt: now })))
      .onConflictDoUpdate({
        target: [campaignDeliveries.campaignId, campaignDeliveries.subscriberId],
        set: { status, updatedAt: now },
      });
  }
};

/** Remember provider email ids so open/click webhooks can find the delivery. */
const recordProviderIds = async (campaignId: string, ids: Record<string, string>): Promise<void> => {
  const entries = Object.entries(ids);
  if (entries.length === 0) return;
  const db = getDbInstance();
  // One small statement per recipient keeps well under D1's parameter cap;
  // D1 batches them into a single round trip.
  const statements = entries.map(([subscriberId, providerId]) =>
    db
      .update(campaignDeliveries)
      .set({ providerId })
      .where(and(eq(campaignDeliveries.campaignId, campaignId), eq(campaignDeliveries.subscriberId, subscriberId))),
  );
  await db.batch(statements as unknown as Parameters<typeof db.batch>[0]);
};

/** Recompute counters and status from the ledger in one atomic statement. */
export const settle = async (campaignId: string): Promise<void> => {
  const d = (statuses: string) =>
    sql.raw(
      `(SELECT count(*) FROM campaign_deliveries d WHERE d.campaign_id = campaigns.id AND d.status IN (${statuses}))`,
    );
  await getDbInstance().run(sql`
    UPDATE campaigns SET
      sent = ${d("'sent'")},
      failed = ${d("'failed','skipped'")},
      status = CASE
        WHEN ${d("'sent','failed','skipped'")} < recipients THEN 'sending'
        WHEN ${d("'failed','skipped'")} = 0 THEN 'sent'
        WHEN ${d("'sent'")} = 0 THEN 'failed'
        ELSE 'partial' END
    WHERE id = ${campaignId} AND recipients > 0 AND status <> 'failed'
  `);
};

/** Recipients of this job that already reached a final state (redelivery). */
const finalized = async (campaignId: string, ids: string[]): Promise<Set<string>> => {
  const rows = await getDbInstance()
    .select({ id: campaignDeliveries.subscriberId })
    .from(campaignDeliveries)
    .where(
      and(
        eq(campaignDeliveries.campaignId, campaignId),
        inArray(campaignDeliveries.subscriberId, ids),
        inArray(campaignDeliveries.status, [...FINAL]),
      ),
    );
  return new Set(rows.map((r) => r.id));
};

/** Send one job; returns ids to retry later (empty when the job is done). */
export const processEmailJob = async (env: Env, job: EmailJob): Promise<string[]> => {
  const db = getDbInstance();
  const done = await finalized(job.campaignId, job.subscriberIds);
  const pending = job.subscriberIds.filter((id) => !done.has(id));
  if (pending.length === 0) return [];

  const [post] = await db
    .select()
    .from(posts)
    .where(and(eq(posts.id, job.postId), eq(posts.publicationId, job.publicationId)))
    .limit(1);
  const [publication] = await db
    .select({
      id: publications.id,
      handle: publications.handle,
      customDomain: publications.customDomain,
      status: publications.status,
      plan: publications.plan,
      createdAt: publications.createdAt,
    })
    .from(publications)
    .where(eq(publications.id, job.publicationId))
    .limit(1);

  // Post deleted or publication suspended mid-send: write the rest off.
  if (!post || !publication || publication.status !== 'active') {
    await setDeliveries(job.campaignId, pending, 'failed');
    await settle(job.campaignId);
    return [];
  }

  // People unsubscribe or bounce between publish and delivery: re-check now.
  const recipients: Recipient[] = await db
    .select({ id: subscribers.id, email: subscribers.email })
    .from(subscribers)
    .leftJoin(emailSuppressions, eq(emailSuppressions.email, subscribers.email))
    .where(
      and(
        inArray(subscribers.id, pending),
        eq(subscribers.publicationId, job.publicationId),
        eq(subscribers.status, 'active'),
        sql`${emailSuppressions.email} IS NULL`,
      ),
    );
  const eligible = new Set(recipients.map((r) => r.id));
  await setDeliveries(job.campaignId, pending.filter((id) => !eligible.has(id)), 'skipped');
  // Claim before sending so a crash mid-send leaves a visible in-flight marker.
  await setDeliveries(job.campaignId, [...eligible], 'sending');

  const settings = await loadSettings(job.publicationId);
  const [owner] = await db
    .select({ email: users.email })
    .from(memberships)
    .innerJoin(users, eq(users.id, memberships.userId))
    .where(and(eq(memberships.publicationId, job.publicationId), eq(memberships.role, 'owner')))
    .limit(1);
  const outcome = await sendBatch({
    env,
    settings,
    host: publicationHost(publication),
    replyTo: owner?.email ?? null,
    showWatermark: limitsFor(publication).watermark,
    post,
    recipients,
  });

  const giveUp = job.attempt >= MAX_ATTEMPTS;
  await setDeliveries(job.campaignId, outcome.sent, 'sent');
  await recordProviderIds(job.campaignId, outcome.providerIds);
  await setDeliveries(job.campaignId, giveUp ? [...outcome.permanent, ...outcome.transient] : outcome.permanent, 'failed');
  await settle(job.campaignId);
  return giveUp ? [] : outcome.transient;
};

/** Give up on a job: every recipient not already final is recorded as failed. */
export const failEmailJob = async (job: EmailJob): Promise<void> => {
  const done = await finalized(job.campaignId, job.subscriberIds);
  await setDeliveries(job.campaignId, job.subscriberIds.filter((id) => !done.has(id)), 'failed');
  await settle(job.campaignId);
};

/** Queue consumer: process each job; re-enqueue transient failures with backoff. */
export const consumeEmailBatch = async (batch: MessageBatch<EmailJob>, env: Env): Promise<void> => {
  const queue = queueOf(env);
  for (const msg of batch.messages) {
    const job = msg.body;
    try {
      const retry = await processEmailJob(env, job);
      if (retry.length > 0 && queue) {
        const delaySeconds = Math.min(60 * 2 ** (job.attempt - 1), 900);
        await queue.send({ ...job, subscriberIds: retry, attempt: job.attempt + 1 }, { delaySeconds });
      }
      msg.ack();
    } catch (err) {
      console.error('email job failed', job.campaignId, msg.attempts, err);
      if (msg.attempts >= MAX_QUEUE_ATTEMPTS) {
        // Last delivery before the DLQ: record the outcome so the campaign settles.
        try {
          await failEmailJob(job);
          msg.ack();
          continue;
        } catch (inner) {
          console.error('could not record failed email job', job.campaignId, inner);
        }
      }
      // Redelivery is safe: the ledger skips recipients that already finished.
      msg.retry({ delaySeconds: 30 });
    }
  }
};
