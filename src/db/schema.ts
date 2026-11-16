import { sql } from 'drizzle-orm';
import { index, integer, primaryKey, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';

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
    plan: text('plan', { enum: ['free', 'pro'] }).notNull().default('free'),
    /** Shown on the platform's discovery pages. */
    listed: integer('listed', { mode: 'boolean' }).notNull().default(false),
    /** R2 prefix of media uploaded before per-publication prefixes existed. */
    legacyMediaPrefix: text('legacy_media_prefix'),
    stripeCustomerId: text('stripe_customer_id'),
    stripeSubscriptionId: text('stripe_subscription_id'),
    /** Custom hostname being provisioned (Cloudflare for SaaS); moves to customDomain once active. */
    pendingDomain: text('pending_domain'),
    cfHostnameId: text('cf_hostname_id'),
    pendingDomainSince: integer('pending_domain_since', { mode: 'timestamp_ms' }),
  },
  (t) => ({
    publications_handle_unique: uniqueIndex('publications_handle_unique').on(t.handle),
    publications_custom_domain_unique: uniqueIndex('publications_custom_domain_unique').on(t.customDomain),
  }),
);

const publicationId = () =>
  text('publication_id')
    .notNull()
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
    /** Historical rows may say GMAIL (pre-platform); new campaigns are always RESEND. */
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
    /** Email id returned by the provider; maps open/click webhooks back here. */
    providerId: text('provider_id'),
    openedAt: integer('opened_at', { mode: 'timestamp_ms' }),
    clickedAt: integer('clicked_at', { mode: 'timestamp_ms' }),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.campaignId, t.subscriberId] }),
    campaign_deliveries_status_idx: index('campaign_deliveries_status_idx').on(t.campaignId, t.status),
    campaign_deliveries_provider_idx: index('campaign_deliveries_provider_idx').on(t.providerId),
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

const now = () => new Date();
const ts = (name: string) => integer(name, { mode: 'timestamp_ms' });

export const users = sqliteTable(
  'users',
  {
    id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
    email: text('email').notNull(),
    name: text('name'),
    avatarUrl: text('avatar_url'),
    isStaff: integer('is_staff', { mode: 'boolean' }).notNull().default(false),
    emailVerifiedAt: ts('email_verified_at'),
    createdAt: ts('created_at').notNull().$defaultFn(now),
  },
  (t) => ({ users_email_unique: uniqueIndex('users_email_unique').on(t.email) }),
);

export const sessions = sqliteTable(
  'sessions',
  {
    /** sha256 of the session token; the token itself only lives in the cookie. */
    id: text('id').primaryKey(),
    userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    expiresAt: ts('expires_at').notNull(),
    createdAt: ts('created_at').notNull().$defaultFn(now),
    userAgent: text('user_agent'),
  },
  (t) => ({ sessions_user_idx: index('sessions_user_idx').on(t.userId) }),
);

export const loginTokens = sqliteTable('login_tokens', {
  /** sha256 of the emailed token. */
  id: text('id').primaryKey(),
  email: text('email').notNull(),
  purpose: text('purpose', { enum: ['login', 'invite'] }).notNull().default('login'),
  publicationId: text('publication_id').references(() => publications.id, { onDelete: 'cascade' }),
  role: text('role', { enum: ['owner', 'editor'] }),
  expiresAt: ts('expires_at').notNull(),
  usedAt: ts('used_at'),
  createdAt: ts('created_at').notNull().$defaultFn(now),
});

export const oauthAccounts = sqliteTable(
  'oauth_accounts',
  {
    provider: text('provider', { enum: ['google'] }).notNull(),
    providerUserId: text('provider_user_id').notNull(),
    userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    createdAt: ts('created_at').notNull().$defaultFn(now),
  },
  (t) => ({ pk: primaryKey({ columns: [t.provider, t.providerUserId] }) }),
);

export const memberships = sqliteTable(
  'memberships',
  {
    userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    publicationId: text('publication_id').notNull().references(() => publications.id, { onDelete: 'cascade' }),
    role: text('role', { enum: ['owner', 'editor'] }).notNull(),
    createdAt: ts('created_at').notNull().$defaultFn(now),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.userId, t.publicationId] }),
    memberships_publication_idx: index('memberships_publication_idx').on(t.publicationId),
  }),
);

/** Extra hosts that point at a publication (e.g. its pre-platform domain). */
export const publicationAliases = sqliteTable('publication_aliases', {
  host: text('host').primaryKey(),
  publicationId: text('publication_id').notNull().references(() => publications.id, { onDelete: 'cascade' }),
});

export const apiKeys = sqliteTable(
  'api_keys',
  {
    id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
    publicationId: text('publication_id').notNull().references(() => publications.id, { onDelete: 'cascade' }),
    scope: text('scope', { enum: ['publish', 'subscribe'] }).notNull(),
    keyHash: text('key_hash').notNull(),
    /** First characters of the key, shown in the dashboard to tell keys apart. */
    prefix: text('prefix').notNull(),
    label: text('label'),
    createdAt: ts('created_at').notNull().$defaultFn(now),
    lastUsedAt: ts('last_used_at'),
    revokedAt: ts('revoked_at'),
  },
  (t) => ({ api_keys_hash_unique: uniqueIndex('api_keys_hash_unique').on(t.keyHash) }),
);

export const usageCounters = sqliteTable(
  'usage_counters',
  {
    publicationId: text('publication_id').notNull().references(() => publications.id, { onDelete: 'cascade' }),
    /** YYYY-MM, UTC. */
    month: text('month').notNull(),
    emailsSent: integer('emails_sent').notNull().default(0),
  },
  (t) => ({ pk: primaryKey({ columns: [t.publicationId, t.month] }) }),
);

export const mediaObjects = sqliteTable(
  'media_objects',
  {
    key: text('key').primaryKey(),
    publicationId: text('publication_id').notNull().references(() => publications.id, { onDelete: 'cascade' }),
    size: integer('size').notNull(),
    createdAt: ts('created_at').notNull().$defaultFn(now),
  },
  (t) => ({ media_objects_publication_idx: index('media_objects_publication_idx').on(t.publicationId) }),
);

export const reports = sqliteTable(
  'reports',
  {
    id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
    publicationId: text('publication_id').notNull().references(() => publications.id, { onDelete: 'cascade' }),
    url: text('url'),
    reason: text('reason').notNull(),
    details: text('details'),
    reporterEmail: text('reporter_email'),
    status: text('status', { enum: ['open', 'resolved'] }).notNull().default('open'),
    createdAt: ts('created_at').notNull().$defaultFn(now),
  },
  (t) => ({ reports_status_idx: index('reports_status_idx').on(t.status, t.createdAt) }),
);

export type User = typeof users.$inferSelect;
export type Membership = typeof memberships.$inferSelect;
export type Role = Membership['role'];
export type Publication = typeof publications.$inferSelect;
export type Subscriber = typeof subscribers.$inferSelect;
export type NewSubscriber = typeof subscribers.$inferInsert;
export type Post = typeof posts.$inferSelect;
export type NewPost = typeof posts.$inferInsert;
export type Campaign = typeof campaigns.$inferSelect;
export type NewCampaign = typeof campaigns.$inferInsert;
export type Setting = typeof settings.$inferSelect;
export type NewSetting = typeof settings.$inferInsert;
