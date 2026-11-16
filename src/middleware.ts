import { env } from 'cloudflare:workers';
import { defineMiddleware } from 'astro:middleware';
import { isAdminAuthed } from './lib/auth';

/**
 * Canonical form of a request path for auth decisions. Astro matches routes
 * loosely (trailing slash ignored, `.` segments tolerated), so the guard must
 * normalize at least as aggressively as the router or `/api/publish/` and
 * `/api/publish/.` slip past an exact-string check.
 */
export const normalizePath = (pathname: string): string => {
  let decoded = pathname;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    /* malformed escapes: judge the raw path */
  }
  const out: string[] = [];
  for (const seg of decoded.split('/')) {
    if (seg === '' || seg === '.') continue;
    if (seg === '..') out.pop();
    else out.push(seg.toLowerCase());
  }
  return '/' + out.join('/');
};

/** True when `path` is `base` or below it (segment-wise, not string prefix). */
const under = (path: string, base: string): boolean => path === base || path.startsWith(`${base}/`);

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

export const onRequest = defineMiddleware(async (context, next) => {
  const { request, url, cookies, redirect } = context;
  const path = normalizePath(url.pathname);
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
