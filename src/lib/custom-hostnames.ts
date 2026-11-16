import { env } from 'cloudflare:workers';
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

export type HostnameState = {
  id: string;
  status: string;
  sslStatus: string;
  active: boolean;
  errors: string[];
};

const api = async (path: string, init: RequestInit = {}) => {
  const res = await fetch(`https://api.cloudflare.com/client/v4/zones/${cfg().CF_ZONE_ID}/custom_hostnames${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${cfg().CF_API_TOKEN}`, 'Content-Type': 'application/json', ...(init.headers ?? {}) },
  });
  const json = (await res.json()) as {
    success: boolean;
    errors?: { message: string }[];
    result?: {
      id: string;
      status: string;
      ssl?: { status?: string; validation_errors?: { message: string }[] };
      verification_errors?: string[];
    };
  };
  if (!json.success) throw new Error(json.errors?.map((e) => e.message).join('; ') || `cloudflare ${res.status}`);
  return json.result;
};

const toState = (r: NonNullable<Awaited<ReturnType<typeof api>>>): HostnameState => ({
  id: r.id,
  status: r.status,
  sslStatus: r.ssl?.status ?? 'unknown',
  active: r.status === 'active' && r.ssl?.status === 'active',
  errors: [...(r.verification_errors ?? []), ...(r.ssl?.validation_errors?.map((e) => e.message) ?? [])],
});

export const createHostname = async (hostname: string): Promise<HostnameState> =>
  toState((await api('', { method: 'POST', body: JSON.stringify({ hostname, ssl: { method: 'http', type: 'dv' } }) }))!);

export const getHostname = async (id: string): Promise<HostnameState> => toState((await api(`/${id}`))!);

export const deleteHostname = async (id: string): Promise<void> => {
  await api(`/${id}`, { method: 'DELETE' });
};

/** A registrable hostname a writer may attach (not ours, no wildcards, no IPs). */
export const validCustomHost = (raw: string): string | null => {
  const host = raw.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '');
  if (!/^(?=.{4,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(host)) return null;
  const root = platformDomain();
  if (root && (host === root || host.endsWith(`.${root}`))) return null;
  return host;
};

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
export const PENDING_TTL_MS = 7 * 24 * 60 * 60 * 1000;

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
