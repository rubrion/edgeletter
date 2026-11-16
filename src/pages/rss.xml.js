import rss from '@astrojs/rss';
import { and, desc, eq } from 'drizzle-orm';
import { getDbInstance, posts } from '../db';
import { excerptFrom } from '../lib/post-meta';
import { sanitizeHtml } from '../lib/sanitize';
import { loadSettings } from '../lib/settings';

/** Full-content feed (latest 50): readers and other platforms can import it as is. */
export async function GET(context) {
	const settings = await loadSettings(context.locals.publication.id);
	const clientName = settings.clientName;

	const rows = await getDbInstance()
		.select({
			title: posts.title,
			slug: posts.slug,
			contentHtml: posts.contentHtml,
			excerpt: posts.excerpt,
			coverUrl: posts.coverUrl,
			publishedAt: posts.publishedAt,
		})
		.from(posts)
		.where(and(eq(posts.publicationId, context.locals.publication.id), eq(posts.isPublished, true)))
		.orderBy(desc(posts.publishedAt))
		.limit(50);

	return rss({
		title: clientName,
		description: settings.clientTagline || `Latest posts from ${clientName}.`,
		site: context.url.origin,
		xmlns: { content: 'http://purl.org/rss/1.0/modules/content/', media: 'http://search.yahoo.com/mrss/' },
		items: rows.map((p) => {
			const html = sanitizeHtml(p.contentHtml);
			return {
				title: p.title,
				pubDate: p.publishedAt ?? new Date(),
				link: `/blog/${p.slug}`,
				description: p.excerpt ?? excerptFrom(html),
				content: html,
				...(p.coverUrl ? { customData: `<media:content url="${p.coverUrl.replace(/&/g, '&amp;').replace(/"/g, '&quot;')}" medium="image"/>` } : {}),
			};
		}),
	});
}
