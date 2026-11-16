import { defineMiddleware } from 'astro:middleware';
import { bearer, membershipsOf, PUB_COOKIE, rememberPublication, roleIn, sessionUser, verifyApiKey } from './lib/auth';
import { normalizePath, under } from './lib/paths';
import { platformOrigin, publicationById, publicationOrigin, resolveHost, TenantLookupError } from './lib/tenant';

/**
 * Request routing by host (see src/lib/tenant.ts):
 *
 *   platform    → pages under src/pages/x-platform (landing, explore)
 *   app         → sign-in + dashboard pages under src/pages/x-app, plus the
 *                 publication-scoped /admin/* pages and /api/* endpoints for
 *                 the signed-in user's active publication
 *   publication → the public site; /admin redirects to the app; writes need an API key
 *   alias       → old address: 301 to the publication, except email links
 *   unknown     → 404
 *
 * Auth decisions are made on a normalized path (decoded, dot segments
 * resolved, trailing slash dropped, lowercased) so router-equivalent
 * variants can't slip past them.
 */

const page = (status: number, title: string, message: string): Response =>
  new Response(
    `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title>` +
      `<body style="margin:0;min-height:100vh;display:grid;place-items:center;background:#E7E4DE;color:#2A231D;font-family:Georgia,serif;text-align:center">` +
      `<div><h1 style="font-weight:500;font-size:2.4rem;margin:0 0 .5rem">${title}</h1><p style="font-style:italic;color:#7A6E62">${message}</p></div>`,
    { status, headers: { 'Content-Type': 'text/html; charset=utf-8' } },
  );

const jsonError = (status: number, error: string): Response =>
  new Response(JSON.stringify({ error }), { status, headers: { 'Content-Type': 'application/json' } });

/** Publication-scoped admin surface: needs a session (app) or an API key (publish only). */
const isAdminSurface = (path: string): boolean =>
  under(path, '/admin') ||
  under(path, '/api/publish') ||
  under(path, '/api/media') ||
  under(path, '/api/posts') ||
  under(path, '/api/admin') ||
  under(path, '/api/ai') ||
  under(path, '/api/billing') ||
  under(path, '/api/domain');

/** Dashboard areas only an owner may use. */
const isOwnerOnly = (path: string): boolean =>
  under(path, '/admin/settings') ||
  under(path, '/admin/widget') ||
  under(path, '/api/admin/settings') ||
  under(path, '/api/billing') ||
  under(path, '/api/domain') ||
  under(path, '/members') ||
  under(path, '/keys') ||
  under(path, '/billing') ||
  under(path, '/domain');

/** App pages that work without a session. */
const isPublicAppPath = (path: string): boolean => path === '/signin' || under(path, '/auth');

/** App pages (outside /admin) that act on the active publication. */
const needsPublicationInApp = (path: string): boolean =>
  ['/members', '/keys', '/billing', '/domain'].some((p) => under(path, p));

/** Email links in already-sent messages that must keep working on an old host. */
const ALIAS_IN_PLACE = ['/api/unsubscribe', '/api/subscribe/confirm'];

const rewriteInto = (prefix: string, url: URL): string =>
  `${prefix}${url.pathname === '/' ? '' : url.pathname}${url.search}`;

export const onRequest = defineMiddleware(async (context, next) => {
  const { request, url, cookies, redirect, locals } = context;
  const path = normalizePath(url.pathname);
  const secure = url.protocol === 'https:';

  // Internal page trees are only reachable through a host rewrite.
  if (under(path, '/x-platform') || under(path, '/x-app')) return page(404, 'Not found', 'There is nothing here.');
  // Provider webhooks are platform-level and verify their own signatures.
  if (under(path, '/api/webhooks')) return next();

  let target;
  try {
    target = await resolveHost(request.headers.get('host'));
  } catch (err) {
    if (err instanceof TenantLookupError) return page(503, 'Temporarily unavailable', 'Please try again in a moment.');
    throw err;
  }

  switch (target.kind) {
    case 'unknown':
      return page(404, 'Nothing here yet', 'There is no publication at this address.');

    case 'platform':
      if (under(path, '/admin') || under(path, '/api')) return page(404, 'Not found', 'There is nothing here.');
      return next(rewriteInto('/x-platform', url));

    case 'alias': {
      locals.publication = target.publication;
      if (ALIAS_IN_PLACE.includes(path)) return next();
      return redirect(`${publicationOrigin(url, target.publication)}${url.pathname}${url.search}`, 301);
    }

    case 'publication': {
      const publication = target.publication;
      locals.publication = publication;
      if (!isAdminSurface(path)) {
        if (publication.status === 'suspended') {
          return page(451, 'Publication unavailable', 'This publication has been suspended.');
        }
        return next();
      }
      // Server-to-server publishing (e.g. a site that syncs its posts here).
      if (
        path === '/api/publish' &&
        publication.status === 'active' &&
        (await verifyApiKey(bearer(request), publication.id, 'publish'))
      ) {
        return next();
      }
      if (under(path, '/api')) return jsonError(401, 'unauthorized');
      return redirect(`${platformOrigin(url, 'app')}/admin?pub=${publication.id}`, 302);
    }

    case 'app': {
      // Belt and braces on top of SameSite cookies + Astro's form origin check.
      const origin = request.headers.get('origin');
      if (request.method !== 'GET' && request.method !== 'HEAD' && origin && origin !== url.origin) {
        return jsonError(403, 'cross-origin request');
      }

      const user = await sessionUser(cookies);
      locals.user = user ?? undefined;
      const isApi = under(path, '/api');

      if (!user) {
        if (isPublicAppPath(path)) return next(rewriteInto('/x-app', url));
        if (isApi) return jsonError(401, 'unauthorized');
        return redirect(`/signin?next=${encodeURIComponent(url.pathname + url.search)}`, 302);
      }

      if (under(path, '/staff') && !user.isStaff) return page(403, 'Forbidden', 'Staff only.');

      if (isAdminSurface(path) || needsPublicationInApp(path)) {
        // Active publication: ?pub= wins (and is remembered), else the cookie,
        // else the first membership. Membership is re-checked on every request.
        const wanted = url.searchParams.get('pub') ?? cookies.get(PUB_COOKIE)?.value ?? null;
        let publicationId = wanted;
        let role = publicationId ? await roleIn(user.id, publicationId) : null;
        if (!role) {
          const first = (await membershipsOf(user.id))[0];
          if (!first) return isApi ? jsonError(403, 'no publication') : redirect('/onboarding', 302);
          publicationId = first.publication.id;
          role = first.role;
        }
        if (publicationId !== cookies.get(PUB_COOKIE)?.value) rememberPublication(cookies, publicationId!, secure);
        const publication = await publicationById(publicationId!);
        if (!publication) return isApi ? jsonError(404, 'publication not found') : redirect('/', 302);

        if (isOwnerOnly(path) && role !== 'owner') {
          return isApi ? jsonError(403, 'owner only') : page(403, 'Owners only', 'Ask the publication owner to make this change.');
        }
        if (publication.status === 'suspended' && (under(path, '/api/publish') || under(path, '/api/media'))) {
          return jsonError(403, 'publication suspended');
        }
        locals.publication = publication;
        locals.role = role;
      }

      if (under(path, '/admin') || isApi) return next();
      return next(rewriteInto('/x-app', url));
    }
  }
});
