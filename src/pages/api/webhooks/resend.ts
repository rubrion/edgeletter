import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { emailSuppressions, getDbInstance } from '../../../db';

/**
 * Resend delivery events → platform-wide suppression list.
 *
 * Hard bounces and spam complaints must never be emailed again: on a shared
 * sending domain one bad list hurts every publication's deliverability.
 * Requests are signed with Svix; set RESEND_WEBHOOK_SECRET (whsec_…) as a
 * secret and point a Resend webhook at /api/webhooks/resend.
 */

const TOLERANCE_S = 5 * 60;

const b64ToBytes = (b64: string): Uint8Array<ArrayBuffer> => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)) as Uint8Array<ArrayBuffer>;

const verifySvix = async (secret: string, id: string, ts: string, body: string, header: string): Promise<boolean> => {
  const now = Math.floor(Date.now() / 1000);
  const t = Number.parseInt(ts, 10);
  if (!Number.isFinite(t) || Math.abs(now - t) > TOLERANCE_S) return false;

  const key = await crypto.subtle.importKey(
    'raw',
    b64ToBytes(secret.replace(/^whsec_/, '')),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['verify'],
  );
  const signed = new TextEncoder().encode(`${id}.${ts}.${body}`);
  // Header holds space-separated "v1,<base64sig>" entries (several during secret rotation).
  for (const part of header.split(' ')) {
    const [version, sig] = part.split(',');
    if (version !== 'v1' || !sig) continue;
    try {
      if (await crypto.subtle.verify('HMAC', key, b64ToBytes(sig), signed)) return true;
    } catch {
      /* malformed signature: try the next one */
    }
  }
  return false;
};

type ResendEvent = {
  type?: string;
  data?: {
    to?: string | string[];
    email?: string;
    bounce?: { type?: string; subType?: string; message?: string };
  };
};

const recipientsOf = (data: ResendEvent['data']): string[] => {
  const raw = data?.to ?? data?.email ?? [];
  return (Array.isArray(raw) ? raw : [raw])
    .map((e) => String(e).trim().toLowerCase())
    .filter((e) => e.includes('@'));
};

export const POST: APIRoute = async ({ request }) => {
  const secret = (env as unknown as { RESEND_WEBHOOK_SECRET?: string }).RESEND_WEBHOOK_SECRET;
  if (!secret) return new Response('webhook not configured', { status: 503 });

  const id = request.headers.get('svix-id');
  const ts = request.headers.get('svix-timestamp');
  const sig = request.headers.get('svix-signature');
  const body = await request.text();
  if (!id || !ts || !sig || !(await verifySvix(secret, id, ts, body, sig))) {
    return new Response('invalid signature', { status: 401 });
  }

  let event: ResendEvent;
  try {
    event = JSON.parse(body) as ResendEvent;
  } catch {
    return new Response('invalid json', { status: 400 });
  }

  let reason: 'bounce' | 'complaint' | null = null;
  if (event.type === 'email.complained') reason = 'complaint';
  if (event.type === 'email.bounced') {
    // Only permanent bounces suppress; soft/transient ones are retried by the provider.
    const kind = (event.data?.bounce?.type ?? '').toLowerCase();
    reason = kind && /transient|temporary|soft/.test(kind) ? null : 'bounce';
  }
  if (!reason) return new Response('ignored', { status: 200 });

  const detail = event.data?.bounce?.message?.slice(0, 500) ?? event.type ?? null;
  const db = getDbInstance();
  for (const email of recipientsOf(event.data)) {
    await db
      .insert(emailSuppressions)
      .values({ email, reason, detail, createdAt: new Date() })
      .onConflictDoNothing();
  }
  return new Response('ok', { status: 200 });
};
