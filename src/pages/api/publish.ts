import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { and, eq, inArray, or } from 'drizzle-orm';
import { marked } from 'marked';
import { audienceFor, CampaignAlreadyLive, enqueueCampaign, liveCampaignFor, retireStaleCampaigns } from '../../lib/email-queue';
import { limitsFor, reserveEmails } from '../../lib/plans';
import { postMeta } from '../../lib/post-meta';
import { sanitizeHtml } from '../../lib/sanitize';
import { pubId } from '../../lib/tenant';
import { getDbInstance, campaigns, posts, type Post } from '../../db';

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

export const POST: APIRoute = async ({ request, locals }) => {
  const publicationId = pubId(locals);
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
  const contentHtml = sanitizeHtml(await marked.parse(contentMd, { async: true }));
  const lang = body.lang === 'pt' ? 'pt' : 'en';
  // Must be a well-formed https URL; normalizing through URL() also escapes
  // characters that could break out of the href it ends up in (pages, emails).
  const canonicalUrl = (() => {
    try {
      const u = new URL(body.canonical_url ?? '');
      return u.protocol === 'https:' && !/["'<>\s]/.test(body.canonical_url ?? '') ? u.toString() : null;
    } catch {
      return null;
    }
  })();
  const stamped = body.published_at && !Number.isNaN(Date.parse(body.published_at)) ? new Date(body.published_at) : null;

  const db = getDbInstance();

  let existing: Post | undefined;
  if (body.id) {
    [existing] = await db
      .select()
      .from(posts)
      .where(and(eq(posts.id, body.id), eq(posts.publicationId, publicationId)))
      .limit(1);
    if (!existing) return Response.json({ error: 'post not found' }, { status: 404 });
  } else {
    // No id: a sync matches the post by its slug, or by its canonical URL (it
    // may already exist from a feed import), so re-running updates instead of duplicating.
    [existing] = await db
      .select()
      .from(posts)
      .where(
        and(
          eq(posts.publicationId, publicationId),
          canonicalUrl ? or(eq(posts.slug, slug), eq(posts.canonicalUrl, canonicalUrl)) : eq(posts.slug, slug),
        ),
      )
      .limit(1);
  }

  // Has a campaign already gone out (or is one in flight)? If so, never re-send.
  // Campaigns stuck in queued/sending for hours are retired first so they
  // don't block forever.
  if (existing) await retireStaleCampaigns(existing.id);
  const priorCampaign = existing ? await liveCampaignFor(existing.id) : undefined;
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
        ...postMeta(contentHtml),
        ...(stamped ? { publishedAt: stamped } : {}),
        ...(transitioningToPublished
          ? { isPublished: true, publishedAt: stamped ?? new Date() }
          : body.publish
            ? { isPublished: true }
            : {}),
      })
      .where(and(eq(posts.id, existing.id), eq(posts.publicationId, publicationId)))
      .returning();
    saved = updated!;
  } else {
    const [inserted] = await db
      .insert(posts)
      .values({
        publicationId,
        title,
        slug,
        contentMd,
        contentHtml,
        lang,
        canonicalUrl,
        ...postMeta(contentHtml),
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

  const subscriberIds = await audienceFor(publicationId, saved.lang);
  const { emailsPerMonth, probation } = limitsFor(locals.publication);
  if (!(await reserveEmails(publicationId, subscriberIds.length, emailsPerMonth))) {
    return Response.json(
      {
        post: saved,
        campaign: null,
        dispatch: null,
        alreadySent: false,
        error: `Monthly email limit reached (${emailsPerMonth.toLocaleString()} emails${probation ? ' during the first week' : ''}). The post is published; ${locals.inApp ? '' : 'upgrade to Pro or '}wait for next month to send it.`,
      },
      { status: 402 },
    );
  }
  try {
    const result = await enqueueCampaign({ env, publicationId, post: saved, subscriberIds });
    const [campaignRow] = await db.select().from(campaigns).where(eq(campaigns.id, result.campaignId)).limit(1);
    return Response.json({
      post: saved,
      campaign: campaignRow,
      dispatch: { recipients: result.recipients, queued: result.queued, sent: campaignRow?.sent ?? 0, failed: campaignRow?.failed ?? 0 },
      alreadySent: false,
    });
  } catch (err) {
    if (err instanceof CampaignAlreadyLive) {
      // A concurrent publish of the same post won the race.
      return Response.json({ post: saved, campaign: await liveCampaignFor(saved.id), dispatch: null, alreadySent: true });
    }
    const msg = err instanceof Error ? err.message : String(err);
    return Response.json({ post: saved, campaign: null, dispatch: null, alreadySent: false, error: msg }, { status: 502 });
  }
};
