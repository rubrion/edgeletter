import type { APIRoute } from 'astro';
import { applySubscription } from '../../../lib/billing';
import { verifyStripeSignature, webhookSecret } from '../../../lib/stripe';

type StripeObject = {
  id?: string;
  customer?: string;
  subscription?: string;
  status?: string;
  client_reference_id?: string;
  metadata?: { publication_id?: string };
};

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
