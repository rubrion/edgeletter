import { and, desc, eq } from 'drizzle-orm';
import { getDbInstance, posts, publications } from '../db';

/** Recent published posts from publications that opted into discovery. */
export const recentListedPosts = async (limit: number, offset = 0) =>
  getDbInstance()
    .select({
      title: posts.title,
      slug: posts.slug,
      contentMd: posts.contentMd,
      publishedAt: posts.publishedAt,
      canonicalUrl: posts.canonicalUrl,
      pubName: publications.name,
      handle: publications.handle,
      customDomain: publications.customDomain,
    })
    .from(posts)
    .innerJoin(publications, eq(publications.id, posts.publicationId))
    .where(and(eq(posts.isPublished, true), eq(publications.listed, true), eq(publications.status, 'active')))
    .orderBy(desc(posts.publishedAt))
    .limit(limit)
    .offset(offset);

export const listedPublications = async () =>
  getDbInstance()
    .select({ name: publications.name, handle: publications.handle, customDomain: publications.customDomain, createdAt: publications.createdAt })
    .from(publications)
    .where(and(eq(publications.listed, true), eq(publications.status, 'active')))
    .orderBy(publications.name);

export const excerptOf = (md: string, n = 180): string =>
  md
    .replace(/^#+\s+.*$/gm, '')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[#*_`>]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, n);
