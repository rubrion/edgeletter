import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { and, eq, inArray } from 'drizzle-orm';
import { marked } from 'marked';
import { dispatchCampaign } from '../../lib/dispatch';
import { getDbInstance, campaigns, posts, subscribers, type Post } from '../../db';

type PublishBody = {
  id?: string;
  title: string;
  slug: string;
  content_md: string;
  publish: boolean;
  /** 'en' (default) or 'pt': who it's sent to. */
  lang?: string;
  /** The post's home when it's synced from another site. */
  canonical_url?: string;
  /** ISO date to stamp as published (a synced post keeps its real date). */
  published_at?: string;
  /** false: publish without emailing anyone (importing old posts). */
  send?: boolean;
};

const slugify = (s: string): string =>
  s
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

export const POST: APIRoute = async ({ request }) => {
  let body: PublishBody;
  try {
    body = (await request.json()) as PublishBody;
  } catch {
    return Response.json({ error: 'invalid json' }, { status: 400 });
  }

  const title = body.title?.trim();
  const slug = (body.slug?.trim() || slugify(body.title ?? '')) as string;
  const contentMd = body.content_md ?? '';
  if (!title || !slug || !contentMd) {
    return Response.json({ error: 'title, slug, content_md required' }, { status: 400 });
  }
  const contentHtml = await marked.parse(contentMd, { async: true });
  const lang = body.lang === 'pt' ? 'pt' : 'en';
  const canonicalUrl = /^https:\/\//.test(body.canonical_url ?? '') ? body.canonical_url! : null;
  const stamped = body.published_at && !Number.isNaN(Date.parse(body.published_at)) ? new Date(body.published_at) : null;

  const db = getDbInstance();

  let existing: Post | undefined;
  if (body.id) {
    [existing] = await db.select().from(posts).where(eq(posts.id, body.id)).limit(1);
    if (!existing) return Response.json({ error: 'post not found' }, { status: 404 });
  } else {
    // No id: a sync matches the post by its slug, so running it again updates instead of duplicating.
    [existing] = await db.select().from(posts).where(eq(posts.slug, slug)).limit(1);
  }

  // Has a successful campaign already gone out? If so, never re-send.
  const priorCampaign = existing
    ? (
        await db
          .select()
          .from(campaigns)
          .where(
            and(
              eq(campaigns.postId, existing.id),
              inArray(campaigns.status, ['sent', 'partial']),
            ),
          )
          .limit(1)
      )[0]
    : undefined;
  const alreadySent = !!priorCampaign;

  // Only stamp publishedAt on the first draft → published transition.
  const transitioningToPublished = body.publish && !existing?.isPublished;

  let saved: Post;
  if (existing) {
    const [updated] = await db
      .update(posts)
      .set({
        title,
        slug,
        contentMd,
        contentHtml,
        lang,
        canonicalUrl,
        ...(stamped ? { publishedAt: stamped } : {}),
        ...(transitioningToPublished
          ? { isPublished: true, publishedAt: stamped ?? new Date() }
          : body.publish
            ? { isPublished: true }
            : {}),
      })
      .where(eq(posts.id, existing.id))
      .returning();
    saved = updated!;
  } else {
    const [inserted] = await db
      .insert(posts)
      .values({
        title,
        slug,
        contentMd,
        contentHtml,
        lang,
        canonicalUrl,
        isPublished: body.publish,
        publishedAt: body.publish ? (stamped ?? new Date()) : null,
      })
      .returning();
    saved = inserted!;
  }

  // A sync (no id) that only updates an already published post never emails.
  if (!body.publish || body.send === false || (!body.id && !transitioningToPublished)) {
    return Response.json({ post: saved, campaign: null, dispatch: null, alreadySent: false });
  }

  if (alreadySent) {
    return Response.json({
      post: saved,
      campaign: priorCampaign,
      dispatch: null,
      alreadySent: true,
    });
  }

  const activeSubs = await db
    .select({ id: subscribers.id, email: subscribers.email })
    .from(subscribers)
    .where(and(eq(subscribers.status, 'active'), eq(subscribers.lang, saved.lang)));

  let dispatchResult;
  try {
    dispatchResult = await dispatchCampaign({ env, post: saved, subscribers: activeSubs });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const [failedRow] = await db
      .insert(campaigns)
      .values({
        postId: saved.id,
        sentAt: new Date(),
        status: 'failed',
        providerUsed: (env.EMAIL_PROVIDER as string) === 'GMAIL' ? 'GMAIL' : 'RESEND',
      })
      .returning();
    return Response.json(
      { post: saved, campaign: failedRow, dispatch: null, alreadySent: false, error: msg },
      { status: 502 },
    );
  }

  const [campaignRow] = await db
    .insert(campaigns)
    .values({
      postId: saved.id,
      sentAt: new Date(),
      status: dispatchResult.status,
      providerUsed: dispatchResult.provider,
    })
    .returning();

  return Response.json({
    post: saved,
    campaign: campaignRow,
    dispatch: dispatchResult,
    alreadySent: false,
  });
};
