import type { APIRoute } from 'astro';
import { and, eq } from 'drizzle-orm';
import { getDbInstance, subscribers } from '../../db';
import { loadSettings } from '../../lib/settings';
import { matchAllowedOrigin, corsHeaders } from '../../lib/cors';

const corsFor = async (request: Request, publicationId: string) => {
  const settings = await loadSettings(publicationId);
  const match = matchAllowedOrigin(request.headers.get('origin'), settings.widgetAllowedOrigins);
  return corsHeaders(match, ['GET', 'POST', 'OPTIONS']);
};

// Handles both one-click POST (List-Unsubscribe-Post) and GET (link click)
export const GET: APIRoute = async ({ request, url, redirect, locals }) => {
  const id = url.searchParams.get('id');
  if (!id) return new Response('Missing id', { status: 400, headers: await corsFor(request, locals.publication.id) });

  const db = getDbInstance();
  await db
    .update(subscribers)
    .set({ status: 'unsubscribed' })
    .where(and(eq(subscribers.id, id), eq(subscribers.publicationId, locals.publication.id)));

  return redirect('/?unsubscribed=1', 302);
};

export const POST: APIRoute = async ({ request, url, locals }) => {
  const cors = await corsFor(request, locals.publication.id);
  const id = url.searchParams.get('id');
  if (!id) return new Response('Missing id', { status: 400, headers: cors });

  const db = getDbInstance();
  await db
    .update(subscribers)
    .set({ status: 'unsubscribed' })
    .where(and(eq(subscribers.id, id), eq(subscribers.publicationId, locals.publication.id)));

  return new Response('Unsubscribed', { status: 200, headers: cors });
};

export const OPTIONS: APIRoute = async ({ request, locals }) => {
  return new Response(null, { status: 204, headers: await corsFor(request, locals.publication.id) });
};
