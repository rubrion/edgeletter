-- Phase 0: make every tenant-owned row belong to a publication.
-- Existing data is backfilled into the 'default' publication, which is what
-- single-publication deployments (and unknown hosts) resolve to.
PRAGMA defer_foreign_keys = on;
--> statement-breakpoint
CREATE TABLE `publications` (
	`id` text PRIMARY KEY NOT NULL,
	`handle` text NOT NULL,
	`name` text NOT NULL,
	`custom_domain` text,
	`status` text DEFAULT 'active' NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `publications_handle_unique` ON `publications` (`handle`);
--> statement-breakpoint
CREATE UNIQUE INDEX `publications_custom_domain_unique` ON `publications` (`custom_domain`);
--> statement-breakpoint
INSERT INTO `publications` (`id`, `handle`, `name`, `custom_domain`, `status`, `created_at`)
VALUES ('default', 'default', 'EdgeLetter', NULL, 'active', CAST(unixepoch('subsec') * 1000 AS INTEGER));
--> statement-breakpoint

-- campaigns references posts: park its rows in an FK-free table and drop it,
-- so rebuilding posts leaves no dangling reference (D1 checks deferred FKs
-- at commit and the counter is not reset by a rename).
CREATE TABLE `__campaigns_backup` AS SELECT * FROM `campaigns`;
--> statement-breakpoint
DROP TABLE `campaigns`;
--> statement-breakpoint

-- posts: slug unique per publication
CREATE TABLE `__new_posts` (
	`id` text PRIMARY KEY NOT NULL,
	`publication_id` text DEFAULT 'default' NOT NULL REFERENCES `publications`(`id`),
	`title` text NOT NULL,
	`slug` text NOT NULL,
	`content_html` text NOT NULL,
	`content_md` text NOT NULL,
	`is_published` integer DEFAULT false NOT NULL,
	`published_at` integer,
	`lang` text DEFAULT 'en' NOT NULL,
	`canonical_url` text
);
--> statement-breakpoint
INSERT INTO `__new_posts` (`id`, `publication_id`, `title`, `slug`, `content_html`, `content_md`, `is_published`, `published_at`, `lang`, `canonical_url`)
SELECT `id`, 'default', `title`, `slug`, `content_html`, `content_md`, `is_published`, `published_at`, `lang`, `canonical_url` FROM `posts`;
--> statement-breakpoint
DROP TABLE `posts`;
--> statement-breakpoint
ALTER TABLE `__new_posts` RENAME TO `posts`;
--> statement-breakpoint
CREATE UNIQUE INDEX `posts_publication_slug_unique` ON `posts` (`publication_id`, `slug`);
--> statement-breakpoint
CREATE INDEX `posts_publication_published_idx` ON `posts` (`publication_id`, `is_published`, `published_at`);
--> statement-breakpoint

-- subscribers: email unique per publication
CREATE TABLE `__new_subscribers` (
	`id` text PRIMARY KEY NOT NULL,
	`publication_id` text DEFAULT 'default' NOT NULL REFERENCES `publications`(`id`),
	`email` text NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`created_at` integer NOT NULL,
	`confirmed_at` integer,
	`confirm_token` text,
	`confirm_token_expires_at` integer,
	`lang` text DEFAULT 'en' NOT NULL
);
--> statement-breakpoint
INSERT INTO `__new_subscribers` (`id`, `publication_id`, `email`, `status`, `created_at`, `confirmed_at`, `confirm_token`, `confirm_token_expires_at`, `lang`)
SELECT `id`, 'default', `email`, `status`, `created_at`, `confirmed_at`, `confirm_token`, `confirm_token_expires_at`, `lang` FROM `subscribers`;
--> statement-breakpoint
DROP TABLE `subscribers`;
--> statement-breakpoint
ALTER TABLE `__new_subscribers` RENAME TO `subscribers`;
--> statement-breakpoint
CREATE UNIQUE INDEX `subscribers_publication_email_unique` ON `subscribers` (`publication_id`, `email`);
--> statement-breakpoint
CREATE INDEX `subscribers_confirm_token_idx` ON `subscribers` (`confirm_token`);
--> statement-breakpoint
CREATE INDEX `subscribers_publication_status_idx` ON `subscribers` (`publication_id`, `status`, `lang`);
--> statement-breakpoint

-- campaigns: recreated with publication + counters, rows restored from the backup
CREATE TABLE `campaigns` (
	`id` text PRIMARY KEY NOT NULL,
	`publication_id` text DEFAULT 'default' NOT NULL REFERENCES `publications`(`id`),
	`post_id` text NOT NULL REFERENCES `posts`(`id`),
	`sent_at` integer NOT NULL,
	`status` text NOT NULL,
	`provider_used` text NOT NULL,
	`recipients` integer DEFAULT 0 NOT NULL,
	`sent` integer DEFAULT 0 NOT NULL,
	`failed` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
INSERT INTO `campaigns` (`id`, `publication_id`, `post_id`, `sent_at`, `status`, `provider_used`)
SELECT `id`, 'default', `post_id`, `sent_at`, `status`, `provider_used` FROM `__campaigns_backup`;
--> statement-breakpoint
DROP TABLE `__campaigns_backup`;
--> statement-breakpoint
CREATE INDEX `campaigns_post_idx` ON `campaigns` (`post_id`);
--> statement-breakpoint
-- At most one live campaign per post (blocks double sends from concurrent
-- publishes). Older duplicates, if any, are retired first.
UPDATE `campaigns` SET `status` = 'failed'
WHERE `status` IN ('queued', 'sending', 'sent', 'partial')
  AND `rowid` NOT IN (
    SELECT max(`rowid`) FROM `campaigns`
    WHERE `status` IN ('queued', 'sending', 'sent', 'partial')
    GROUP BY `post_id`
  );
--> statement-breakpoint
CREATE UNIQUE INDEX `campaigns_post_live_unique` ON `campaigns` (`post_id`)
WHERE `status` IN ('queued', 'sending', 'sent', 'partial');
--> statement-breakpoint

-- Per-recipient delivery ledger: makes queue redelivery idempotent and is the
-- source of truth for campaign counters.
CREATE TABLE `campaign_deliveries` (
	`campaign_id` text NOT NULL REFERENCES `campaigns`(`id`) ON DELETE CASCADE,
	`subscriber_id` text NOT NULL,
	`status` text NOT NULL,
	`updated_at` integer NOT NULL,
	PRIMARY KEY (`campaign_id`, `subscriber_id`)
);
--> statement-breakpoint
CREATE INDEX `campaign_deliveries_status_idx` ON `campaign_deliveries` (`campaign_id`, `status`);
--> statement-breakpoint

-- settings: key/value per publication
CREATE TABLE `__new_settings` (
	`publication_id` text DEFAULT 'default' NOT NULL REFERENCES `publications`(`id`),
	`key` text NOT NULL,
	`value` text NOT NULL,
	`updated_at` integer NOT NULL,
	PRIMARY KEY (`publication_id`, `key`)
);
--> statement-breakpoint
INSERT INTO `__new_settings` (`publication_id`, `key`, `value`, `updated_at`)
SELECT 'default', `key`, `value`, `updated_at` FROM `settings`;
--> statement-breakpoint
DROP TABLE `settings`;
--> statement-breakpoint
ALTER TABLE `__new_settings` RENAME TO `settings`;
--> statement-breakpoint

-- ai_usage: daily counter per publication
CREATE TABLE `__new_ai_usage` (
	`publication_id` text DEFAULT 'default' NOT NULL REFERENCES `publications`(`id`),
	`day` text NOT NULL,
	`tokens_used` integer DEFAULT 0 NOT NULL,
	PRIMARY KEY (`publication_id`, `day`)
);
--> statement-breakpoint
INSERT INTO `__new_ai_usage` (`publication_id`, `day`, `tokens_used`)
SELECT 'default', `day`, `tokens_used` FROM `ai_usage`;
--> statement-breakpoint
DROP TABLE `ai_usage`;
--> statement-breakpoint
ALTER TABLE `__new_ai_usage` RENAME TO `ai_usage`;
--> statement-breakpoint

-- Platform-wide suppression list (hard bounces, spam complaints)
CREATE TABLE `email_suppressions` (
	`email` text PRIMARY KEY NOT NULL,
	`reason` text NOT NULL,
	`detail` text,
	`created_at` integer NOT NULL
);
