import type { APIRoute } from 'astro';
import { eq } from 'drizzle-orm';
import { getDbInstance, publications } from '../../../db';
import { createPortal, stripeEnabled } from '../../../lib/stripe';

export const POST: APIRoute = async ({ locals, url, redirect }) => {
  const [pub] = await getDbInstance()
    .select({ customerId: publications.stripeCustomerId })
    .from(publications)
    .where(eq(publications.id, locals.publication.id))
    .limit(1);
  if (!stripeEnabled() || !pub?.customerId) return redirect('/billing', 303);
  const session = await createPortal(pub.customerId, `${url.origin}/billing`);
  return redirect(session.url, 303);
};
