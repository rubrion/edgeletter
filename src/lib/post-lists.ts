import { and, desc, eq } from 'drizzle-orm';
import { getDbInstance, posts } from '../db';
import type { Lang } from '../i18n';

/**
 * Published posts for list pages, as card data. A publication that writes in
 * both languages (e.g. mirrored en/pt posts) shows visitors only their
 * language when it has posts in it; otherwise everything.
 */
export const listPosts = async (publicationId: string, lang: Lang, limit?: number) => {
  const query = getDbInstance()
    .select({
      slug: posts.slug,
      title: posts.title,
      publishedAt: posts.publishedAt,
      coverUrl: posts.coverUrl,
      excerpt: posts.excerpt,
      lang: posts.lang,
    })
    .from(posts)
    .where(and(eq(posts.publicationId, publicationId), eq(posts.isPublished, true)))
    .orderBy(desc(posts.publishedAt));
  const all = await query;
  const want = lang === 'pt-BR' ? 'pt' : 'en';
  const mine = all.filter((p) => p.lang === want);
  const list = mine.length > 0 ? mine : all;
  return typeof limit === 'number' ? list.slice(0, limit) : list;
};
