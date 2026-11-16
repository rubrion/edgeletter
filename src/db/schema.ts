import { sql } from 'drizzle-orm';
import { index, integer, primaryKey, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';

/** Publication every single-tenant deployment (and any unknown host) resolves to. */
export const DEFAULT_PUBLICATION_ID = 'default';

export const publications = sqliteTable(
  'publications',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    /** Subdomain handle: <handle>.<PLATFORM_DOMAIN>. */
    handle: text('handle').notNull(),
    name: text('name').notNull(),
    /** Optional custom hostname that serves this publication. */
    customDomain: text('custom_domain'),
    status: text('status', { enum: ['active', 'suspended'] })
      .notNull()
      .default('active'),
    createdAt: integer('created_at', { mode: 'timestamp_ms' })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (t) => ({
    publications_handle_unique: uniqueIndex('publications_handle_unique').on(t.handle),
    publications_custom_domain_unique: uniqueIndex('publications_custom_domain_unique').on(t.customDomain),
  }),
);

const publicationId = () =>
  text('publication_id')
    .notNull()
    .default(DEFAULT_PUBLICATION_ID)
    .references(() => publications.id);

export const subscribers = sqliteTable(
  'subscribers',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    publicationId: publicationId(),
    email: text('email').notNull(),
    status: text('status', { enum: ['active', 'pending', 'unsubscribed'] })
      .notNull()
      .default('active'),
    createdAt: integer('created_at', { mode: 'timestamp_ms' })
      .notNull()
      .$defaultFn(() => new Date()),
    confirmedAt: integer('confirmed_at', { mode: 'timestamp_ms' }),
    confirmToken: text('confirm_token'),
    confirmTokenExpiresAt: integer('confirm_token_expires_at', { mode: 'timestamp_ms' }),
    /** The language they signed up in: they get only posts in it. */
    lang: text('lang', { enum: ['en', 'pt'] }).notNull().default('en'),
  },
  (t) => ({
    subscribers_publication_email_unique: uniqueIndex('subscribers_publication_email_unique').on(t.publicationId, t.email),
    subscribers_confirm_token_idx: index('subscribers_confirm_token_idx').on(t.confirmToken),
    subscribers_publication_status_idx: index('subscribers_publication_status_idx').on(t.publicationId, t.status, t.lang),
  }),
);

export const posts = sqliteTable(
  'posts',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    publicationId: publicationId(),
    title: text('title').notNull(),
    slug: text('slug').notNull(),
    contentHtml: text('content_html').notNull(),
    contentMd: text('content_md').notNull(),
    isPublished: integer('is_published', { mode: 'boolean' }).notNull().default(false),
    publishedAt: integer('published_at', { mode: 'timestamp_ms' }),
    /** Sent only to subscribers in this language. */
    lang: text('lang', { enum: ['en', 'pt'] }).notNull().default('en'),
    /** Where the post really lives when it's synced from another site; emails and the page link there. */
    canonicalUrl: text('canonical_url'),
  },
  (t) => ({
    posts_publication_slug_unique: uniqueIndex('posts_publication_slug_unique').on(t.publicationId, t.slug),
    posts_publication_published_idx: index('posts_publication_published_idx').on(t.publicationId, t.isPublished, t.publishedAt),
  }),
);

export const campaigns = sqliteTable(
  'campaigns',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    publicationId: publicationId(),
    postId: text('post_id')
      .notNull()
      .references(() => posts.id),
    sentAt: integer('sent_at', { mode: 'timestamp_ms' })
      .notNull()
      .$defaultFn(() => new Date()),
    /** queued/sending while the email queue drains; then sent/partial/failed. */
    status: text('status', { enum: ['queued', 'sending', 'sent', 'partial', 'failed'] }).notNull(),
    providerUsed: text('provider_used', { enum: ['RESEND', 'GMAIL'] }).notNull(),
    recipients: integer('recipients').notNull().default(0),
    sent: integer('sent').notNull().default(0),
    failed: integer('failed').notNull().default(0),
  },
  (t) => ({
    campaigns_post_idx: index('campaigns_post_idx').on(t.postId),
    // One live campaign per post: concurrent publishes can't double-send.
    campaigns_post_live_unique: uniqueIndex('campaigns_post_live_unique')
      .on(t.postId)
      .where(sql`${t.status} IN ('queued', 'sending', 'sent', 'partial')`),
  }),
);

/** Per-recipient ledger: idempotent redelivery + source of campaign counters. */
export const campaignDeliveries = sqliteTable(
  'campaign_deliveries',
  {
    campaignId: text('campaign_id')
      .notNull()
      .references(() => campaigns.id, { onDelete: 'cascade' }),
    subscriberId: text('subscriber_id').notNull(),
    /** sending = claimed, in flight; sent/failed are final; skipped = no longer eligible. */
    status: text('status', { enum: ['sending', 'sent', 'failed', 'skipped'] }).notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.campaignId, t.subscriberId] }),
    campaign_deliveries_status_idx: index('campaign_deliveries_status_idx').on(t.campaignId, t.status),
  }),
);

export const settings = sqliteTable(
  'settings',
  {
    publicationId: publicationId(),
    key: text('key').notNull(),
    value: text('value').notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (t) => ({ pk: primaryKey({ columns: [t.publicationId, t.key] }) }),
);

export const aiUsage = sqliteTable(
  'ai_usage',
  {
    publicationId: publicationId(),
    day: text('day').notNull(),
    tokensUsed: integer('tokens_used').notNull().default(0),
  },
  (t) => ({ pk: primaryKey({ columns: [t.publicationId, t.day] }) }),
);

/** Platform-wide: never email these addresses again (hard bounce, complaint). */
export const emailSuppressions = sqliteTable('email_suppressions', {
  email: text('email').primaryKey(),
  reason: text('reason', { enum: ['bounce', 'complaint', 'manual'] }).notNull(),
  detail: text('detail'),
  createdAt: integer('created_at', { mode: 'timestamp_ms' })
    .notNull()
    .$defaultFn(() => new Date()),
});

export type Publication = typeof publications.$inferSelect;
export type Subscriber = typeof subscribers.$inferSelect;
export type NewSubscriber = typeof subscribers.$inferInsert;
export type Post = typeof posts.$inferSelect;
export type NewPost = typeof posts.$inferInsert;
export type Campaign = typeof campaigns.$inferSelect;
export type NewCampaign = typeof campaigns.$inferInsert;
export type Setting = typeof settings.$inferSelect;
export type NewSetting = typeof settings.$inferInsert;
