import { env } from 'cloudflare:workers';
import {
  createCustomHostnamesClient,
  PENDING_TTL_MS,
  validCustomHost as validHostFor,
  type HostnameState,
} from '@rubrion/core/custom-hostnames';
import { and, eq, isNotNull, lt, ne, or, sql } from 'drizzle-orm';
import { getDbInstance, publications } from '../db';
import { invalidatePublicationCache, platformDomain } from './tenant';

/**
 * Cloudflare for SaaS custom hostnames on the platform zone. The writer points
 * a CNAME at CUSTOM_DOMAIN_TARGET; Cloudflare validates it and issues a
 * certificate (HTTP DCV), then traffic reaches this Worker via the zone's
 * fallback-origin route.
 */

type CfEnv = { CF_API_TOKEN?: string; CF_ZONE_ID?: string; CUSTOM_DOMAIN_TARGET?: string; MAX_CUSTOM_HOSTNAMES?: string };
const cfg = () => env as unknown as CfEnv;

export const customDomainsEnabled = (): boolean => !!cfg().CF_API_TOKEN && !!cfg().CF_ZONE_ID;
export const cnameTarget = (): string => cfg().CUSTOM_DOMAIN_TARGET || `customers.${platformDomain()}`;

export type { HostnameState };

// Cloudflare API client from @rubrion/core, built per call so env is read lazily.
const client = () => createCustomHostnamesClient({ apiToken: cfg().CF_API_TOKEN, zoneId: cfg().CF_ZONE_ID });

export const createHostname = (hostname: string): Promise<HostnameState> => client().create(hostname);

export const getHostname = (id: string): Promise<HostnameState> => client().get(id);

export const deleteHostname = (id: string): Promise<void> => client().remove(id);

/** A registrable hostname a writer may attach (not ours, no wildcards, no IPs). */
export const validCustomHost = (raw: string): string | null =>
  validHostFor(raw, [platformDomain()].filter(Boolean));

/**
 * Cost guard. Cloudflare allocates a large quota but bills each custom
 * hostname beyond the free allowance, so the platform enforces its own
 * ceiling (default 90, inside the 100 free hostnames).
 */
export const maxCustomHostnames = (): number => {
  const n = Number.parseInt(cfg().MAX_CUSTOM_HOSTNAMES ?? '', 10);
  return Number.isFinite(n) && n >= 0 ? n : 90;
};

export const customHostnamesInUse = async (): Promise<number> => {
  const [row] = await getDbInstance()
    .select({ n: sql<number>`count(*)` })
    .from(publications)
    .where(isNotNull(publications.cfHostnameId));
  return Number(row?.n ?? 0);
};

/** Remove a publication's hostname at Cloudflare and forget it locally. */
export const releaseHostname = async (publicationId: string, cfHostnameId: string | null): Promise<void> => {
  if (cfHostnameId && customDomainsEnabled()) await deleteHostname(cfHostnameId).catch(() => {});
  await getDbInstance()
    .update(publications)
    .set({ customDomain: null, pendingDomain: null, cfHostnameId: null, pendingDomainSince: null })
    .where(eq(publications.id, publicationId));
  invalidatePublicationCache();
};

/** Setups never finished within this window are released. */
export { PENDING_TTL_MS };

/**
 * Daily sweep (cron): release hostnames that are (a) still pending after a
 * week, or (b) held by a publication that is no longer Pro. Keeps the
 * billable count equal to what paying writers actually use.
 */
export const sweepCustomHostnames = async (): Promise<number> => {
  const stale = await getDbInstance()
    .select({ id: publications.id, cfHostnameId: publications.cfHostnameId })
    .from(publications)
    .where(
      and(
        isNotNull(publications.cfHostnameId),
        or(
          ne(publications.plan, 'pro'),
          and(
            sql`${publications.customDomain} IS NULL`,
            lt(publications.pendingDomainSince, new Date(Date.now() - PENDING_TTL_MS)),
          ),
        ),
      ),
    );
  for (const p of stale) await releaseHostname(p.id, p.cfHostnameId);
  return stale.length;
};
