import type { APIRoute } from 'astro';
import { and, desc, eq } from 'drizzle-orm';
import { getDbInstance, posts } from '../db';

/** Per-publication sitemap: home, blog index, about, and every published post. */
export const GET: APIRoute = async ({ locals, url }) => {
  const rows = await getDbInstance()
    .select({ slug: posts.slug, publishedAt: posts.publishedAt, canonicalUrl: posts.canonicalUrl })
    .from(posts)
    .where(and(eq(posts.publicationId, locals.publication.id), eq(posts.isPublished, true)))
    .orderBy(desc(posts.publishedAt));
  const origin = url.origin;
  const entry = (loc: string, lastmod?: Date | null) =>
    `<url><loc>${loc}</loc>${lastmod ? `<lastmod>${lastmod.toISOString()}</lastmod>` : ''}</url>`;
  const body = [
    entry(`${origin}/`),
    entry(`${origin}/blog`),
    entry(`${origin}/about`),
    // Synced posts live elsewhere: their canonical URL is the one to index.
    ...rows.filter((r) => !r.canonicalUrl).map((r) => entry(`${origin}/blog/${r.slug}`, r.publishedAt)),
  ].join('');
  return new Response(
    `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${body}</urlset>`,
    { headers: { 'Content-Type': 'application/xml; charset=utf-8', 'Cache-Control': 'public, max-age=300' } },
  );
};
