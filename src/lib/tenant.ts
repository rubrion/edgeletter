import { env } from 'cloudflare:workers';
import { eq } from 'drizzle-orm';
import { getDbInstance, publicationAliases, publications, type Publication } from '../db';

/**
 * Host → what this request is for.
 *
 *   <PLATFORM_DOMAIN>, www.<PLATFORM_DOMAIN>  → platform (landing, discovery)
 *   app.<PLATFORM_DOMAIN>                     → app (sign-in, dashboard, staff)
 *   <handle>.<PLATFORM_DOMAIN>, custom domain → a publication
 *   publication_aliases host                  → old address of a publication (redirects)
 *   anything else                             → unknown (404)
 *
 * Lookups are cached per isolate for a short TTL. Database errors are never
 * cached and surface as TenantLookupError so the request fails closed.
 */

export type PublicationContext = Pick<
  Publication,
  'id' | 'handle' | 'name' | 'status' | 'customDomain' | 'plan' | 'listed' | 'createdAt' | 'legacyMediaPrefix'
>;

export type HostTarget =
  | { kind: 'platform' }
  | { kind: 'app' }
  | { kind: 'publication'; publication: PublicationContext }
  | { kind: 'alias'; publication: PublicationContext }
  | { kind: 'unknown' };

export class TenantLookupError extends Error {}

export const platformDomain = (): string =>
  ((env as unknown as { PLATFORM_DOMAIN?: string }).PLATFORM_DOMAIN ?? '').trim().toLowerCase();

export const publicationColumns = {
  id: publications.id,
  handle: publications.handle,
  name: publications.name,
  status: publications.status,
  customDomain: publications.customDomain,
  plan: publications.plan,
  listed: publications.listed,
  createdAt: publications.createdAt,
  legacyMediaPrefix: publications.legacyMediaPrefix,
};

const TTL_MS = 60_000;
const NEGATIVE_TTL_MS = 10_000;
const MAX_ENTRIES = 1000;
const cache = new Map<string, { value: HostTarget; at: number }>();

const byField = async (field: 'customDomain' | 'handle' | 'id', value: string) => {
  const [row] = await getDbInstance()
    .select(publicationColumns)
    .from(publications)
    .where(eq(publications[field], value))
    .limit(1);
  return row ?? null;
};

export const publicationById = (id: string) => byField('id', id);
export const publicationByHandle = (handle: string) => byField('handle', handle);

const lookup = async (host: string): Promise<HostTarget> => {
  const root = platformDomain();
  try {
    if (root && (host === root || host === `www.${root}`)) return { kind: 'platform' };
    if (root && host === `app.${root}`) return { kind: 'app' };

    // Custom domains are a Pro feature: after a downgrade the domain stops serving.
    const custom = await byField('customDomain', host);
    if (custom && custom.plan === 'pro') return { kind: 'publication', publication: custom };

    const [alias] = await getDbInstance()
      .select({ publicationId: publicationAliases.publicationId })
      .from(publicationAliases)
      .where(eq(publicationAliases.host, host))
      .limit(1);
    if (alias) {
      const pub = await byField('id', alias.publicationId);
      if (pub) return { kind: 'alias', publication: pub };
    }

    if (root && host.endsWith(`.${root}`)) {
      const handle = host.slice(0, -(root.length + 1));
      if (handle && !handle.includes('.')) {
        const pub = await byField('handle', handle);
        if (pub) return { kind: 'publication', publication: pub };
      }
    }
    return { kind: 'unknown' };
  } catch (err) {
    throw new TenantLookupError(String(err));
  }
};

export const resolveHost = async (hostHeader: string | null): Promise<HostTarget> => {
  const host = (hostHeader ?? '').toLowerCase().replace(/:\d+$/, '');
  const hit = cache.get(host);
  const ttl = hit && hit.value.kind !== 'unknown' ? TTL_MS : NEGATIVE_TTL_MS;
  if (hit && Date.now() - hit.at < ttl) return hit.value;
  const value = await lookup(host);
  if (cache.size >= MAX_ENTRIES) cache.clear();
  cache.set(host, { value, at: Date.now() });
  return value;
};

/** Drop cached host mappings (after a handle, domain, plan or status change). */
export const invalidatePublicationCache = (): void => cache.clear();

/** The publication of the current request; set by middleware. */
export const pubId = (locals: App.Locals): string => locals.publication.id;

/** Public hostname of a publication: custom domain, else <handle>.<PLATFORM_DOMAIN>. */
export const publicationHost = (publication: Pick<PublicationContext, 'handle' | 'customDomain'>): string =>
  publication.customDomain || `${publication.handle}.${platformDomain()}`;

/**
 * Origin for a platform subdomain ('' = root), keeping the scheme and port of
 * the current request so links also work in local dev (*.localhost:4321).
 */
export const platformOrigin = (current: URL, sub: string): string => {
  const host = sub ? `${sub}.${platformDomain()}` : platformDomain();
  return `${current.protocol}//${host}${current.port ? `:${current.port}` : ''}`;
};

/** Origin of a publication's public site, same scheme/port rules as platformOrigin. */
export const publicationOrigin = (current: URL, publication: Pick<PublicationContext, 'handle' | 'customDomain'>): string =>
  publication.customDomain
    ? `https://${publication.customDomain}`
    : platformOrigin(current, publication.handle);

/** R2 key prefix for a publication's uploads. */
export const mediaPrefix = (publicationId: string): string => `edgeletter/pub/${publicationId}`;

/** Every prefix that may hold this publication's media (current + pre-platform). */
export const mediaPrefixes = (publication: Pick<PublicationContext, 'id' | 'legacyMediaPrefix'>): string[] =>
  [mediaPrefix(publication.id), publication.legacyMediaPrefix].filter((p): p is string => !!p);
