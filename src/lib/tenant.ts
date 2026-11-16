import { env } from 'cloudflare:workers';
import { eq } from 'drizzle-orm';
import { DEFAULT_PUBLICATION_ID, getDbInstance, publications, type Publication } from '../db';

/**
 * Host → publication resolution.
 *
 * 1. Exact custom domain match (publications.custom_domain).
 * 2. <handle>.<PLATFORM_DOMAIN>, when PLATFORM_DOMAIN is configured.
 * 3. Otherwise the default publication — this is what single-publication
 *    (white-label) deployments and local dev resolve to.
 *
 * Results are cached per isolate for a short TTL; D1 is only hit on a miss.
 */

export type PublicationContext = Pick<Publication, 'id' | 'handle' | 'name' | 'status' | 'customDomain'>;

const TTL_MS = 60_000;
const cache = new Map<string, { value: PublicationContext | null; at: number }>();

const platformDomain = (): string =>
  ((env as unknown as { PLATFORM_DOMAIN?: string }).PLATFORM_DOMAIN ?? '').trim().toLowerCase();

const FALLBACK: PublicationContext = {
  id: DEFAULT_PUBLICATION_ID,
  handle: DEFAULT_PUBLICATION_ID,
  name: 'EdgeLetter',
  status: 'active',
  customDomain: null,
};

const columns = {
  id: publications.id,
  handle: publications.handle,
  name: publications.name,
  status: publications.status,
  customDomain: publications.customDomain,
};

const lookup = async (host: string): Promise<PublicationContext | null> => {
  const db = getDbInstance();
  try {
    const [byDomain] = await db.select(columns).from(publications).where(eq(publications.customDomain, host)).limit(1);
    if (byDomain) return byDomain;

    const root = platformDomain();
    if (root && host.endsWith(`.${root}`)) {
      const handle = host.slice(0, -(root.length + 1));
      if (handle && !handle.includes('.')) {
        const [byHandle] = await db.select(columns).from(publications).where(eq(publications.handle, handle)).limit(1);
        if (byHandle) return byHandle;
        // A subdomain of the platform with no publication behind it.
        return null;
      }
    }

    const [def] = await db.select(columns).from(publications).where(eq(publications.id, DEFAULT_PUBLICATION_ID)).limit(1);
    return def ?? FALLBACK;
  } catch {
    // Pre-migration database: behave as the single default publication.
    return FALLBACK;
  }
};

export const resolvePublication = async (hostHeader: string | null): Promise<PublicationContext | null> => {
  const host = (hostHeader ?? '').toLowerCase().replace(/:\d+$/, '');
  const hit = cache.get(host);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.value;
  const value = await lookup(host);
  cache.set(host, { value, at: Date.now() });
  return value;
};

/** Drop cached host mappings (after a publication's handle/domain changes). */
export const invalidatePublicationCache = (): void => cache.clear();

/** The publication of the current request; set by middleware. */
export const pubId = (locals: App.Locals): string => locals.publication.id;

/**
 * Public hostname of a publication, used for links in emails and feeds:
 * custom domain → <handle>.<PLATFORM_DOMAIN> → CLIENT_DOMAIN (single-tenant).
 */
export const publicationHost = (publication: Pick<PublicationContext, 'id' | 'handle' | 'customDomain'>): string => {
  if (publication.customDomain) return publication.customDomain;
  const root = platformDomain();
  if (root && publication.id !== DEFAULT_PUBLICATION_ID) return `${publication.handle}.${root}`;
  return ((env as unknown as { CLIENT_DOMAIN?: string }).CLIENT_DOMAIN ?? '').trim();
};

/**
 * R2 key prefix for a publication's uploads. The default publication keeps the
 * historical `edgeletter/<CLIENT_SLUG>/` layout so existing media URLs still work.
 */
export const mediaPrefix = (publicationId: string): string => {
  if (publicationId === DEFAULT_PUBLICATION_ID) {
    const slug = ((env as unknown as { CLIENT_SLUG?: string }).CLIENT_SLUG ?? 'default').trim() || 'default';
    return `edgeletter/${slug}`;
  }
  return `edgeletter/pub/${publicationId}`;
};
