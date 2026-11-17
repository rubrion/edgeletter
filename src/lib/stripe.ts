import { env } from 'cloudflare:workers';

/**
 * Minimal Stripe client over fetch (no SDK): Checkout for the Pro plan, the
 * customer portal, and webhook signature verification.
 */

type StripeEnv = {
  STRIPE_SECRET_KEY?: string;
  /** Monthly Pro price; BRL with a USD currency option (Checkout localizes). */
  STRIPE_PRICE_PRO?: string;
  STRIPE_PRICE_PRO_YEARLY?: string;
  STRIPE_WEBHOOK_SECRET?: string;
  STRIPE_PORTAL_CONFIG?: string;
  /** Public key for Stripe.js (embedded Checkout). Safe to ship to browsers. */
  STRIPE_PUBLISHABLE_KEY?: string;
};
const cfg = () => env as unknown as StripeEnv;

export const stripeEnabled = (): boolean => !!cfg().STRIPE_SECRET_KEY && !!cfg().STRIPE_PRICE_PRO;
export const publishableKey = (): string | undefined => cfg().STRIPE_PUBLISHABLE_KEY;
export const embeddedEnabled = (): boolean => stripeEnabled() && !!cfg().STRIPE_PUBLISHABLE_KEY;

export const yearlyEnabled = (): boolean => stripeEnabled() && !!cfg().STRIPE_PRICE_PRO_YEARLY;

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
  interval: 'month' | 'year';
  customerId: string | null;
  email: string;
  /** Hosted page: success/cancel. Embedded: Stripe redirects to returnUrl. */
  successUrl?: string;
  cancelUrl?: string;
  returnUrl?: string;
}) =>
  call<{ url?: string; client_secret?: string }>('checkout/sessions', {
    mode: 'subscription',
    'line_items[0][price]': input.interval === 'year' && cfg().STRIPE_PRICE_PRO_YEARLY ? cfg().STRIPE_PRICE_PRO_YEARLY : cfg().STRIPE_PRICE_PRO,
    'line_items[0][quantity]': 1,
    client_reference_id: input.publicationId,
    ...(input.customerId ? { customer: input.customerId } : { customer_email: input.email }),
    ...(input.returnUrl
      ? { ui_mode: 'embedded_page', return_url: input.returnUrl }
      : { success_url: input.successUrl, cancel_url: input.cancelUrl }),
    allow_promotion_codes: 'true',
    metadata: { publication_id: input.publicationId },
    subscription_data: { metadata: { publication_id: input.publicationId } },
  });

/** A Checkout session's outcome (embedded return page). */
export const retrieveCheckout = async (id: string) => {
  const res = await fetch(`https://api.stripe.com/v1/checkout/sessions/${encodeURIComponent(id)}`, {
    headers: { Authorization: `Bearer ${cfg().STRIPE_SECRET_KEY}` },
  });
  if (!res.ok) return null;
  return (await res.json()) as {
    id: string;
    status: 'open' | 'complete' | 'expired';
    subscription: string | null;
    client_reference_id: string | null;
  };
};

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
  call<{ url: string }>('billing_portal/sessions', {
    customer: customerId,
    return_url: returnUrl,
    // Our portal configuration (cancel at period end, payment method, invoices).
    ...(cfg().STRIPE_PORTAL_CONFIG ? { configuration: cfg().STRIPE_PORTAL_CONFIG } : {}),
  });

export { verifyStripeSignature } from './stripe-verify';

export const webhookSecret = (): string | undefined => cfg().STRIPE_WEBHOOK_SECRET;
