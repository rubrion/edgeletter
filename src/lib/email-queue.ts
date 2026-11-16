import { and, eq, inArray, sql } from 'drizzle-orm';
import { campaigns, emailSuppressions, getDbInstance, posts, publications, subscribers, type Post } from '../db';
import { MAX_BATCH, providerFor, sendBatch, type Recipient } from './dispatch';
import { loadSettings } from './settings';
import { publicationHost } from './tenant';

/**
 * Campaign fan-out.
 *
 * Publishing records a `queued` campaign and pushes recipient batches onto
 * EMAIL_QUEUE; the queue consumer (src/worker.ts) sends each batch, retries
 * transient failures with backoff, and bumps the campaign's counters. When
 * no queue is bound (local dev, minimal white-label deploys) the batches are
 * processed inline, as before — same code path, just synchronous.
 */

export type EmailJob = {
  campaignId: string;
  publicationId: string;
  postId: string;
  subscriberIds: string[];
  attempt: number;
};

const MAX_ATTEMPTS = 4;

const queueOf = (env: Env): Queue<EmailJob> | undefined =>
  (env as unknown as { EMAIL_QUEUE?: Queue<EmailJob> }).EMAIL_QUEUE;

const chunk = <T>(xs: T[], n: number): T[][] => {
  const out: T[][] = [];
  for (let i = 0; i < xs.length; i += n) out.push(xs.slice(i, i + n));
  return out;
};

/** Active, non-suppressed subscribers of this publication in the post's language. */
export const audienceFor = async (publicationId: string, lang: Post['lang']): Promise<string[]> => {
  const db = getDbInstance();
  const rows = await db
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
  const [campaign] = await db
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
  const campaignId = campaign!.id;
  if (empty) return { campaignId, recipients: 0, queued: false };

  const jobs: EmailJob[] = chunk(subscriberIds, MAX_BATCH).map((ids) => ({
    campaignId,
    publicationId,
    postId: post.id,
    subscriberIds: ids,
    attempt: 1,
  }));

  const queue = queueOf(env);
  if (queue) {
    // sendBatch accepts up to 100 messages per call.
    for (const group of chunk(jobs, 100)) {
      await queue.sendBatch(group.map((body) => ({ body })));
    }
    return { campaignId, recipients: subscriberIds.length, queued: true };
  }

  for (const first of jobs) {
    // No queue: retry transient failures right away until MAX_ATTEMPTS, after
    // which processEmailJob counts them as failed, so the campaign always settles.
    let job: EmailJob | null = first;
    while (job) {
      const retry: string[] = await processEmailJob(env, job);
      job = retry.length > 0 ? { ...job, subscriberIds: retry, attempt: job.attempt + 1 } : null;
    }
  }
  return { campaignId, recipients: subscriberIds.length, queued: false };
};

/** Send one batch; returns ids that should be retried later (empty when done). */
export const processEmailJob = async (env: Env, job: EmailJob): Promise<string[]> => {
  const db = getDbInstance();

  const [post] = await db
    .select()
    .from(posts)
    .where(and(eq(posts.id, job.postId), eq(posts.publicationId, job.publicationId)))
    .limit(1);
  const [publication] = await db
    .select({ id: publications.id, handle: publications.handle, customDomain: publications.customDomain, status: publications.status })
    .from(publications)
    .where(eq(publications.id, job.publicationId))
    .limit(1);

  // Post deleted or publication suspended mid-send: count the rest as failed.
  if (!post || !publication || publication.status !== 'active') {
    await record(job.campaignId, 0, job.subscriberIds.length);
    return [];
  }

  // Re-check status + suppressions at send time: people unsubscribe or bounce
  // between publish and delivery.
  const recipients: Recipient[] = await db
    .select({ id: subscribers.id, email: subscribers.email })
    .from(subscribers)
    .leftJoin(emailSuppressions, eq(emailSuppressions.email, subscribers.email))
    .where(
      and(
        inArray(subscribers.id, job.subscriberIds),
        eq(subscribers.publicationId, job.publicationId),
        eq(subscribers.status, 'active'),
        sql`${emailSuppressions.email} IS NULL`,
      ),
    );
  const skipped = job.subscriberIds.length - recipients.length;

  const settings = await loadSettings(job.publicationId);
  const outcome = await sendBatch({ env, settings, host: publicationHost(publication), post, recipients });

  const giveUp = job.attempt >= MAX_ATTEMPTS;
  const failedNow = outcome.permanent.length + (giveUp ? outcome.transient.length : 0) + skipped;
  await record(job.campaignId, outcome.sent.length, failedNow);
  return giveUp ? [] : outcome.transient;
};

/** Add to a campaign's counters and settle its status once every recipient is accounted for. */
const record = async (campaignId: string, sent: number, failed: number): Promise<void> => {
  if (sent === 0 && failed === 0) return;
  const db = getDbInstance();
  await db
    .update(campaigns)
    .set({
      sent: sql`${campaigns.sent} + ${sent}`,
      failed: sql`${campaigns.failed} + ${failed}`,
      status: sql`CASE
        WHEN ${campaigns.sent} + ${sent} + ${campaigns.failed} + ${failed} < ${campaigns.recipients} THEN 'sending'
        WHEN ${campaigns.failed} + ${failed} = 0 THEN 'sent'
        WHEN ${campaigns.sent} + ${sent} = 0 THEN 'failed'
        ELSE 'partial' END`,
    })
    .where(eq(campaigns.id, campaignId));
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
      // Unexpected failure (e.g. D1 hiccup): let the queue redeliver the whole job.
      console.error('email job failed', job.campaignId, err);
      msg.retry({ delaySeconds: 30 });
    }
  }
};
