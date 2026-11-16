import type { APIRoute } from 'astro';
import { eq } from 'drizzle-orm';
import { getDbInstance, publications } from '../../../db';
import { createCheckout, stripeEnabled } from '../../../lib/stripe';

export const POST: APIRoute = async ({ locals, url, redirect, request }) => {
  const form = await request.formData().catch(() => null);
  const interval = form?.get('interval') === 'year' ? 'year' : 'month';
  if (!stripeEnabled()) return redirect('/billing?error=' + encodeURIComponent('Billing is not configured yet.'), 303);
  if (locals.publication.plan === 'pro') return redirect('/billing', 303);
  const [pub] = await getDbInstance()
    .select({ customerId: publications.stripeCustomerId })
    .from(publications)
    .where(eq(publications.id, locals.publication.id))
    .limit(1);
  const session = await createCheckout({
    publicationId: locals.publication.id,
    interval,
    customerId: pub?.customerId ?? null,
    email: locals.user!.email,
    successUrl: `${url.origin}/billing?upgraded=1`,
    cancelUrl: `${url.origin}/billing`,
  });
  return redirect(session.url, 303);
};
