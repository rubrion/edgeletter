import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { and, eq } from 'drizzle-orm';
import { emailSuppressions, getDbInstance, subscribers } from '../../db';
import { loadSettings } from '../../lib/settings';
import { matchAllowedOrigin, corsHeaders } from '../../lib/cors';
import { isTurnstileEnabled, verifyTurnstile } from '../../lib/turnstile';
import { sendConfirmationEmail } from '../../lib/confirm-email';
import { verifyApiKey } from '../../lib/auth';
import { limitsFor, subscriberCount } from '../../lib/plans';
import { allow, clientIp } from '../../lib/ratelimit';
import { publicationHost } from '../../lib/tenant';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const CONFIRM_TTL_MS = 24 * 60 * 60 * 1000;

const json = (
  body: unknown,
  status: number,
  cors: Record<string, string>,
): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...cors },
  });

export const OPTIONS: APIRoute = async ({ request, locals }) => {
  const settings = await loadSettings(locals.publication.id);
  const match = matchAllowedOrigin(request.headers.get('origin'), settings.widgetAllowedOrigins);
  return new Response(null, { status: 204, headers: corsHeaders(match) });
};

export const POST: APIRoute = async ({ request, locals }) => {
  const publicationId = locals.publication.id;
  const settings = await loadSettings(publicationId);
  const match = matchAllowedOrigin(request.headers.get('origin'), settings.widgetAllowedOrigins);
  const cors = corsHeaders(match);

  let email: string | undefined;
  let turnstileToken: string | null = null;
  let honeypot: string | null = null;
  let lang: 'en' | 'pt' = 'en';
  const ct = request.headers.get('content-type') ?? '';
  try {
    if (ct.includes('application/json')) {
      const body = (await request.json()) as { email?: string; turnstile?: string; website?: string; lang?: string };
      email = body.email;
      if (body.lang === 'pt') lang = 'pt';
      turnstileToken = body.turnstile ?? null;
      honeypot = body.website ?? null;
    } else {
      const form = await request.formData();
      const v = form.get('email');
      if (typeof v === 'string') email = v;
      const t = form.get('cf-turnstile-response') ?? form.get('turnstile');
      if (typeof t === 'string') turnstileToken = t;
      if (form.get('lang') === 'pt') lang = 'pt';
      const hp = form.get('website');
      if (typeof hp === 'string') honeypot = hp;
    }
  } catch {
    return json({ error: 'invalid body' }, 400, cors);
  }

  // Honeypot — silently succeed so bots don't probe.
  if (honeypot && honeypot.trim() !== '') {
    return json({ ok: true }, 200, cors);
  }

  email = email?.trim().toLowerCase();
  if (!email || !EMAIL_RE.test(email)) {
    return json({ error: 'invalid email' }, 400, cors);
  }

  // A trusted server (the writer's own site, which ran its own captcha) can
  // subscribe on a visitor's behalf with a `subscribe` API key, so a custom form
  // still lands here: same list, same double opt-in, same dispatch.
  const trusted = await verifyApiKey(request.headers.get('x-subscribe-key'), publicationId, 'subscribe');

  if (!trusted && isTurnstileEnabled(env)) {
    const remoteIp =
      request.headers.get('cf-connecting-ip') ??
      request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
      null;
    const verdict = await verifyTurnstile({ env, token: turnstileToken, remoteIp });
    if (!verdict.ok) return json({ error: verdict.error }, 400, cors);
  }

  // Each confirmation is an email from the platform sender: cap the rate per
  // visitor and per address so the form can't be used to mail-bomb anyone.
  if (!trusted && (!(await allow(`subscribe:ip:${clientIp(request)}`)) || !(await allow(`subscribe:email:${email}`)))) {
    return json({ error: 'Too many attempts. Try again in a minute.' }, 429, cors);
  }

  const db = getDbInstance();
  const host = publicationHost(locals.publication);
  const origin = host ? `https://${host}` : new URL(request.url).origin;

  const [existing] = await db
    .select()
    .from(subscribers)
    .where(and(eq(subscribers.publicationId, publicationId), eq(subscribers.email, email)))
    .limit(1);

  // Already active: nothing to send. Same response as a new sign-up, so the
  // endpoint can't be used to check whether someone is on the list.
  if (existing && existing.status === 'active') {
    return json({ ok: true, pending: true }, 200, cors);
  }

  // New addresses count toward the plan's list size.
  if (!existing || existing.status === 'unsubscribed') {
    const { subscribers: cap } = limitsFor(locals.publication);
    if ((await subscriberCount(publicationId)) >= cap) {
      return json({ error: 'This publication is not accepting new subscribers right now.' }, 403, cors);
    }
  }

  const token = crypto.randomUUID().replace(/-/g, '') + crypto.randomUUID().replace(/-/g, '');
  const now = new Date();
  const expires = new Date(now.getTime() + CONFIRM_TTL_MS);

  if (existing) {
    await db
      .update(subscribers)
      .set({
        status: 'pending',
        confirmToken: token,
        confirmTokenExpiresAt: expires,
        lang,
      })
      .where(eq(subscribers.id, existing.id));
  } else {
    await db.insert(subscribers).values({
      publicationId,
      email,
      status: 'pending',
      confirmToken: token,
      confirmTokenExpiresAt: expires,
      lang,
    });
  }

  // Never mail an address that hard-bounced or complained; answer as usual so
  // the endpoint doesn't reveal suppression status.
  const [suppressed] = await db
    .select({ email: emailSuppressions.email })
    .from(emailSuppressions)
    .where(eq(emailSuppressions.email, email))
    .limit(1);
  if (suppressed) return json({ ok: true, pending: true }, 200, cors);

  const confirmUrl = `${origin}/api/subscribe/confirm?token=${token}`;
  try {
    await sendConfirmationEmail({ settings, host, to: email, confirmUrl, lang });
  } catch (err) {
    // Don't leak the address back if email fails — caller will retry.
    const msg = err instanceof Error ? err.message : String(err);
    return json({ error: 'could not send confirmation email', detail: msg }, 502, cors);
  }

  return json({ ok: true, pending: true }, 200, cors);
};
