import { eq } from 'drizzle-orm';
import { getDbInstance, publications } from '../db';
import { retrieveSubscription } from './stripe';
import { invalidatePublicationCache } from './tenant';
import { releaseHostname } from './custom-hostnames';

const ACTIVE = new Set(['active', 'trialing', 'past_due']);

/**
 * Stripe subscription → publications.plan. Never trusts a payload: re-reads
 * the subscription's current state from Stripe, so late or out-of-order
 * webhooks (and the embedded-checkout return page) all converge.
 */
export const applySubscription = async (subscriptionId: string, pubIdHint?: string): Promise<'pro' | 'free'> => {
  const db = getDbInstance();
  const sub = await retrieveSubscription(subscriptionId);
  const pubId = sub?.metadata?.publication_id ?? pubIdHint;
  const where = pubId ? eq(publications.id, pubId) : eq(publications.stripeSubscriptionId, subscriptionId);
  const pro = !!sub && ACTIVE.has(sub.status);
  if (!pro) {
    // Custom domains are Pro-only and billed per hostname: release on downgrade.
    const held = await db.select({ id: publications.id, cfHostnameId: publications.cfHostnameId }).from(publications).where(where);
    for (const h of held) if (h.cfHostnameId) await releaseHostname(h.id, h.cfHostnameId);
  }
  await db
    .update(publications)
    .set({
      plan: pro ? 'pro' : 'free',
      stripeSubscriptionId: pro ? subscriptionId : null,
      ...(sub?.customer ? { stripeCustomerId: sub.customer } : {}),
    })
    .where(where);
  invalidatePublicationCache();
  return pro ? 'pro' : 'free';
};
