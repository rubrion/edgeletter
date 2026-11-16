import { env } from 'cloudflare:workers';

/**
 * Minimal Stripe client over fetch (no SDK): Checkout for the Pro plan, the
 * customer portal, and webhook signature verification.
 */

type StripeEnv = { STRIPE_SECRET_KEY?: string; STRIPE_PRICE_PRO?: string; STRIPE_WEBHOOK_SECRET?: string };
const cfg = () => env as unknown as StripeEnv;

export const stripeEnabled = (): boolean => !!cfg().STRIPE_SECRET_KEY && !!cfg().STRIPE_PRICE_PRO;

/** Stripe's form encoding: nested keys as a[b][c]=v. */
const form = (obj: Record<string, unknown>, prefix = ''): string[] =>
  Object.entries(obj).flatMap(([k, v]) => {
    const key = prefix ? `${prefix}[${k}]` : k;
    if (v === undefined || v === null) return [];
    if (typeof v === 'object') return form(v as Record<string, unknown>, key);
    return [`${encodeURIComponent(key)}=${encodeURIComponent(String(v))}`];
  });

const call = async <T>(path: string, body: Record<string, unknown>): Promise<T> => {
  const res = await fetch(`https://api.stripe.com/v1/${path}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${cfg().STRIPE_SECRET_KEY}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: form(body).join('&'),
  });
  const json = (await res.json()) as T & { error?: { message?: string } };
  if (!res.ok) throw new Error(`stripe ${path}: ${json.error?.message ?? res.status}`);
  return json;
};

export const createCheckout = (input: {
  publicationId: string;
  customerId: string | null;
  email: string;
  successUrl: string;
  cancelUrl: string;
}) =>
  call<{ url: string }>('checkout/sessions', {
    mode: 'subscription',
    'line_items[0][price]': cfg().STRIPE_PRICE_PRO,
    'line_items[0][quantity]': 1,
    client_reference_id: input.publicationId,
    ...(input.customerId ? { customer: input.customerId } : { customer_email: input.email }),
    success_url: input.successUrl,
    cancel_url: input.cancelUrl,
    allow_promotion_codes: 'true',
    metadata: { publication_id: input.publicationId },
    subscription_data: { metadata: { publication_id: input.publicationId } },
  });

/** Current state of a subscription, straight from Stripe. */
export const retrieveSubscription = async (id: string) => {
  const res = await fetch(`https://api.stripe.com/v1/subscriptions/${encodeURIComponent(id)}`, {
    headers: { Authorization: `Bearer ${cfg().STRIPE_SECRET_KEY}` },
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`stripe subscriptions: ${res.status}`);
  return (await res.json()) as { id: string; status: string; customer: string; metadata?: { publication_id?: string } };
};

export const createPortal = (customerId: string, returnUrl: string) =>
  call<{ url: string }>('billing_portal/sessions', { customer: customerId, return_url: returnUrl });

export { verifyStripeSignature } from './stripe-verify';

export const webhookSecret = (): string | undefined => cfg().STRIPE_WEBHOOK_SECRET;
