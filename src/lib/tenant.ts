import { env } from 'cloudflare:workers';
import { createHostResolver, type HostResolver, TenantLookupError } from '@rubrion/core/host';
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

export { TenantLookupError };

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

// Host routing and its per-isolate cache come from @rubrion/core; EdgeLetter
// supplies the lookups. Built lazily: PLATFORM_DOMAIN is read from env.
let resolver: HostResolver<PublicationContext> | null = null;
const getResolver = (): HostResolver<PublicationContext> =>
  (resolver ??= createHostResolver<PublicationContext>({
    roots: [platformDomain()].filter(Boolean),
    lookups: {
      // Custom domains are a Pro feature: after a downgrade the domain stops serving.
      byCustomDomain: async (host) => {
        const custom = await byField('customDomain', host);
        return custom && custom.plan === 'pro' ? custom : null;
      },
      byAlias: async (host) => {
        const [alias] = await getDbInstance()
          .select({ publicationId: publicationAliases.publicationId })
          .from(publicationAliases)
          .where(eq(publicationAliases.host, host))
          .limit(1);
        return alias ? byField('id', alias.publicationId) : null;
      },
      bySubdomain: (handle) => byField('handle', handle),
    },
  }));

export const resolveHost = async (hostHeader: string | null): Promise<HostTarget> => {
  const target = await getResolver().resolve(hostHeader);
  switch (target.kind) {
    case 'tenant':
      return { kind: 'publication', publication: target.tenant };
    case 'alias':
      return { kind: 'alias', publication: target.tenant };
    case 'platform':
    case 'app':
      return { kind: target.kind };
    default:
      return { kind: 'unknown' };
  }
};

/** Drop cached host mappings (after a handle, domain, plan or status change). */
export const invalidatePublicationCache = (): void => resolver?.invalidate();

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
