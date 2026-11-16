import type { APIRoute } from 'astro';
import { eq } from 'drizzle-orm';
import { getDbInstance, publications } from '../../../db';
import { retrieveSubscription, verifyStripeSignature, webhookSecret } from '../../../lib/stripe';
import { invalidatePublicationCache } from '../../../lib/tenant';

type StripeObject = {
  id?: string;
  customer?: string;
  subscription?: string;
  status?: string;
  client_reference_id?: string;
  metadata?: { publication_id?: string };
};

const ACTIVE = new Set(['active', 'trialing', 'past_due']);

/**
 * Stripe → publications.plan. Checkout completion upgrades; subscription
 * updates follow Stripe's status; deletion downgrades to free.
 */
export const POST: APIRoute = async ({ request }) => {
  const secret = webhookSecret();
  if (!secret) return new Response('webhook not configured', { status: 503 });
  const body = await request.text();
  if (!(await verifyStripeSignature(body, request.headers.get('stripe-signature'), secret))) {
    return new Response('invalid signature', { status: 400 });
  }
  const event = JSON.parse(body) as { type?: string; data?: { object?: StripeObject } };
  const obj = event.data?.object ?? {};
  const db = getDbInstance();

  const setPlan = async (where: ReturnType<typeof eq>, patch: Partial<typeof publications.$inferInsert>) => {
    await db.update(publications).set(patch).where(where);
    invalidatePublicationCache();
  };

  // Webhooks can arrive late or out of order, so subscription events are never
  // applied from the payload: re-read the subscription's current state instead.
  const applySubscription = async (subscriptionId: string, pubIdHint?: string) => {
    const sub = await retrieveSubscription(subscriptionId);
    const pubId = sub?.metadata?.publication_id ?? pubIdHint;
    const where = pubId ? eq(publications.id, pubId) : eq(publications.stripeSubscriptionId, subscriptionId);
    const pro = !!sub && ACTIVE.has(sub.status);
    await setPlan(where, {
      plan: pro ? 'pro' : 'free',
      stripeSubscriptionId: pro ? subscriptionId : null,
      ...(sub?.customer ? { stripeCustomerId: sub.customer } : {}),
    });
  };

  switch (event.type) {
    case 'checkout.session.completed': {
      const pubId = obj.metadata?.publication_id ?? obj.client_reference_id;
      if (obj.subscription) await applySubscription(obj.subscription, pubId);
      break;
    }
    case 'customer.subscription.created':
    case 'customer.subscription.updated':
    case 'customer.subscription.deleted': {
      if (obj.id) await applySubscription(obj.id, obj.metadata?.publication_id);
      break;
    }
  }
  return new Response('ok', { status: 200 });
};
