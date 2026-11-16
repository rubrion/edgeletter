import { env } from 'cloudflare:workers';
import { defineMiddleware } from 'astro:middleware';
import { isAdminAuthed } from './lib/auth';
import { normalizePath, under } from './lib/paths';
import { resolvePublication, TenantLookupError } from './lib/tenant';

const PUBLIC_ADMIN_PATHS = new Set(['/admin/login', '/api/admin/login']);

const requiresAdmin = (path: string): boolean => {
  if (PUBLIC_ADMIN_PATHS.has(path)) return false;
  return (
    under(path, '/admin') ||
    under(path, '/api/publish') ||
    under(path, '/api/media') ||
    under(path, '/api/posts') ||
    under(path, '/api/admin') ||
    under(path, '/api/ai')
  );
};

const notFoundPage = (status: number, title: string, message: string): Response =>
  new Response(
    `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title>` +
      `<body style="margin:0;min-height:100vh;display:grid;place-items:center;background:#E7E4DE;color:#2A231D;font-family:Georgia,serif;text-align:center">` +
      `<div><h1 style="font-weight:500;font-size:2.4rem;margin:0 0 .5rem">${title}</h1><p style="font-style:italic;color:#7A6E62">${message}</p></div>`,
    { status, headers: { 'Content-Type': 'text/html; charset=utf-8' } },
  );

export const onRequest = defineMiddleware(async (context, next) => {
  const { request, url, cookies, redirect, locals } = context;
  const path = normalizePath(url.pathname);

  // Webhooks are platform-level, not tied to a publication host.
  if (under(path, '/api/webhooks')) return next();

  let publication;
  try {
    publication = await resolvePublication(request.headers.get('host'));
  } catch (err) {
    if (err instanceof TenantLookupError) {
      return notFoundPage(503, 'Temporarily unavailable', 'Please try again in a moment.');
    }
    throw err;
  }
  if (!publication) {
    return notFoundPage(404, 'Nothing here yet', 'There is no publication at this address.');
  }
  if (publication.status === 'suspended' && !requiresAdmin(path)) {
    return notFoundPage(451, 'Publication unavailable', 'This publication has been suspended.');
  }
  locals.publication = publication;

  if (!requiresAdmin(path)) return next();

  const masterKey = (env as unknown as { MASTER_ADMIN_KEY?: string }).MASTER_ADMIN_KEY;
  if (isAdminAuthed(request, cookies, masterKey)) return next();
  // A site that keeps its posts elsewhere syncs them in with SYNC_API_KEY: publish only, no admin.
  const syncKey = (env as unknown as { SYNC_API_KEY?: string }).SYNC_API_KEY;
  if (path === '/api/publish' && syncKey && request.headers.get('authorization') === `Bearer ${syncKey}`) return next();

  if (under(path, '/api')) {
    return new Response(JSON.stringify({ error: 'unauthorized' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }
  return redirect('/admin/login');
});
