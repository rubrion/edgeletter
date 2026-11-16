import type { APIRoute } from 'astro';
import { and, eq, sql } from 'drizzle-orm';
import { getDbInstance, subscribers } from '../../../../db';
import { limitsFor, subscriberCount } from '../../../../lib/plans';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const POST: APIRoute = async ({ request, redirect, locals }) => {
  const ct = request.headers.get('content-type') ?? '';
  const isJson = ct.includes('application/json');

  let email: string | undefined;
  try {
    if (isJson) {
      const body = (await request.json()) as { email?: string };
      email = body.email;
    } else {
      const form = await request.formData();
      const v = form.get('email');
      if (typeof v === 'string') email = v;
    }
  } catch {
    if (isJson) return Response.json({ error: 'invalid body' }, { status: 400 });
    return redirect('/admin/subscribers?error=invalid+body', 303);
  }

  email = email?.trim().toLowerCase();
  if (!email || !EMAIL_RE.test(email)) {
    if (isJson) return Response.json({ error: 'invalid email' }, { status: 400 });
    return redirect('/admin/subscribers?error=invalid+email', 303);
  }

  const cap = limitsFor(locals.publication).subscribers;
  if ((await subscriberCount(locals.publication.id)) >= cap) {
    const msg = `Subscriber limit reached (${cap.toLocaleString()}).`;
    if (isJson) return Response.json({ error: msg }, { status: 403 });
    return redirect(`/admin/subscribers?error=${encodeURIComponent(msg)}`, 303);
  }
  const db = getDbInstance();
  const [existing] = await db
    .select({ status: subscribers.status })
    .from(subscribers)
    .where(and(eq(subscribers.publicationId, locals.publication.id), eq(subscribers.email, email)))
    .limit(1);
  if (existing?.status === 'unsubscribed') {
    // Opting back in is the reader's decision: they can subscribe again from the site.
    const msg = 'That person unsubscribed. Only they can re-subscribe, from your site.';
    if (isJson) return Response.json({ error: msg }, { status: 409 });
    return redirect(`/admin/subscribers?error=${encodeURIComponent(msg)}`, 303);
  }
  await db
    .insert(subscribers)
    .values({ publicationId: locals.publication.id, email, status: 'active', confirmedAt: new Date() })
    .onConflictDoUpdate({
      target: [subscribers.publicationId, subscribers.email],
      set: { status: sql`'active'` },
    });

  if (isJson) return Response.json({ ok: true }, { status: 200 });
  return redirect('/admin/subscribers?saved=1', 303);
};
