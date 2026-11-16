import type { APIRoute } from 'astro';
import { eq } from 'drizzle-orm';
import { getDbInstance, publications } from '../../../db';
import { verifyStripeSignature, webhookSecret } from '../../../lib/stripe';
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

  switch (event.type) {
    case 'checkout.session.completed': {
      const pubId = obj.metadata?.publication_id ?? obj.client_reference_id;
      if (pubId) {
        await setPlan(eq(publications.id, pubId), {
          plan: 'pro',
          stripeCustomerId: obj.customer ?? null,
          stripeSubscriptionId: obj.subscription ?? null,
        });
      }
      break;
    }
    case 'customer.subscription.created':
    case 'customer.subscription.updated': {
      const pubId = obj.metadata?.publication_id;
      const where = pubId ? eq(publications.id, pubId) : obj.id ? eq(publications.stripeSubscriptionId, obj.id) : null;
      if (where) {
        await setPlan(where, {
          plan: obj.status && ACTIVE.has(obj.status) ? 'pro' : 'free',
          stripeSubscriptionId: obj.id ?? null,
          ...(obj.customer ? { stripeCustomerId: obj.customer } : {}),
        });
      }
      break;
    }
    case 'customer.subscription.deleted': {
      if (obj.id) await setPlan(eq(publications.stripeSubscriptionId, obj.id), { plan: 'free', stripeSubscriptionId: null });
      break;
    }
  }
  return new Response('ok', { status: 200 });
};
