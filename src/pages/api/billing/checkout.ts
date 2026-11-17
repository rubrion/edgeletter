import type { APIRoute } from 'astro';
import { eq } from 'drizzle-orm';
import { getDbInstance, publications } from '../../../db';
import { createCheckout, embeddedEnabled, stripeEnabled } from '../../../lib/stripe';

/**
 * Pro checkout. A JSON request gets an embedded Checkout session
 * ({ clientSecret }) that the billing page mounts in place; a plain form post
 * (no JavaScript) falls back to Stripe's hosted page.
 */
export const POST: APIRoute = async ({ locals, url, redirect, request }) => {
  const wantsJson = request.headers.get('content-type')?.includes('application/json') ?? false;
  const fail = (status: number, error: string) =>
    wantsJson ? Response.json({ error }, { status }) : redirect('/billing?error=billing', 303);

  let interval: 'month' | 'year' = 'month';
  if (wantsJson) {
    const body = (await request.json().catch(() => ({}))) as { interval?: unknown };
    if (body.interval === 'year') interval = 'year';
  } else {
    const form = await request.formData().catch(() => null);
    if (form?.get('interval') === 'year') interval = 'year';
  }

  if (!stripeEnabled() || (wantsJson && !embeddedEnabled())) return fail(503, 'billing not configured');
  if (locals.publication.plan === 'pro') return wantsJson ? fail(409, 'already pro') : redirect('/billing', 303);

  const [pub] = await getDbInstance()
    .select({ customerId: publications.stripeCustomerId })
    .from(publications)
    .where(eq(publications.id, locals.publication.id))
    .limit(1);
  const base = {
    publicationId: locals.publication.id,
    interval,
    customerId: pub?.customerId ?? null,
    email: locals.user!.email,
  };

  try {
    if (wantsJson) {
      const session = await createCheckout({
        ...base,
        // Stripe fills in the placeholder; the billing page confirms the outcome.
        returnUrl: `${url.origin}/billing?session_id={CHECKOUT_SESSION_ID}`,
      });
      if (!session.client_secret) return fail(502, 'no client secret');
      return Response.json({ clientSecret: session.client_secret });
    }
    const session = await createCheckout({
      ...base,
      successUrl: `${url.origin}/billing?upgraded=1`,
      cancelUrl: `${url.origin}/billing`,
    });
    return redirect(session.url!, 303);
  } catch (err) {
    console.error('checkout', err);
    return fail(502, 'checkout failed');
  }
};
