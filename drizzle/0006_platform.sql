-- Self-serve platform: accounts, memberships, keys, limits, moderation, billing.
CREATE TABLE `users` (
	`id` text PRIMARY KEY NOT NULL,
	`email` text NOT NULL,
	`name` text,
	`avatar_url` text,
	`is_staff` integer DEFAULT false NOT NULL,
	`email_verified_at` integer,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_email_unique` ON `users` (`email`);
--> statement-breakpoint
CREATE TABLE `sessions` (
	`id` text PRIMARY KEY NOT NULL, -- sha256(token), the raw token only lives in the cookie
	`user_id` text NOT NULL REFERENCES `users`(`id`) ON DELETE CASCADE,
	`expires_at` integer NOT NULL,
	`created_at` integer NOT NULL,
	`user_agent` text
);
--> statement-breakpoint
CREATE INDEX `sessions_user_idx` ON `sessions` (`user_id`);
--> statement-breakpoint
CREATE TABLE `login_tokens` (
	`id` text PRIMARY KEY NOT NULL, -- sha256(token)
	`email` text NOT NULL,
	`purpose` text DEFAULT 'login' NOT NULL, -- login | invite
	`publication_id` text REFERENCES `publications`(`id`) ON DELETE CASCADE,
	`role` text,
	`expires_at` integer NOT NULL,
	`used_at` integer,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `oauth_accounts` (
	`provider` text NOT NULL,
	`provider_user_id` text NOT NULL,
	`user_id` text NOT NULL REFERENCES `users`(`id`) ON DELETE CASCADE,
	`created_at` integer NOT NULL,
	PRIMARY KEY (`provider`, `provider_user_id`)
);
--> statement-breakpoint
CREATE TABLE `memberships` (
	`user_id` text NOT NULL REFERENCES `users`(`id`) ON DELETE CASCADE,
	`publication_id` text NOT NULL REFERENCES `publications`(`id`) ON DELETE CASCADE,
	`role` text NOT NULL, -- owner | editor
	`created_at` integer NOT NULL,
	PRIMARY KEY (`user_id`, `publication_id`)
);
--> statement-breakpoint
CREATE INDEX `memberships_publication_idx` ON `memberships` (`publication_id`);
--> statement-breakpoint
ALTER TABLE `publications` ADD COLUMN `plan` text DEFAULT 'free' NOT NULL;
--> statement-breakpoint
ALTER TABLE `publications` ADD COLUMN `listed` integer DEFAULT false NOT NULL;
--> statement-breakpoint
ALTER TABLE `publications` ADD COLUMN `legacy_media_prefix` text;
--> statement-breakpoint
ALTER TABLE `publications` ADD COLUMN `stripe_customer_id` text;
--> statement-breakpoint
ALTER TABLE `publications` ADD COLUMN `stripe_subscription_id` text;
--> statement-breakpoint
ALTER TABLE `publications` ADD COLUMN `pending_domain` text;
--> statement-breakpoint
ALTER TABLE `publications` ADD COLUMN `cf_hostname_id` text;
--> statement-breakpoint
CREATE TABLE `publication_aliases` (
	`host` text PRIMARY KEY NOT NULL,
	`publication_id` text NOT NULL REFERENCES `publications`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `api_keys` (
	`id` text PRIMARY KEY NOT NULL,
	`publication_id` text NOT NULL REFERENCES `publications`(`id`) ON DELETE CASCADE,
	`scope` text NOT NULL, -- publish | subscribe
	`key_hash` text NOT NULL,
	`prefix` text NOT NULL,
	`label` text,
	`created_at` integer NOT NULL,
	`last_used_at` integer,
	`revoked_at` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `api_keys_hash_unique` ON `api_keys` (`key_hash`);
--> statement-breakpoint
CREATE TABLE `usage_counters` (
	`publication_id` text NOT NULL REFERENCES `publications`(`id`) ON DELETE CASCADE,
	`month` text NOT NULL, -- YYYY-MM (UTC)
	`emails_sent` integer DEFAULT 0 NOT NULL,
	PRIMARY KEY (`publication_id`, `month`)
);
--> statement-breakpoint
CREATE TABLE `media_objects` (
	`key` text PRIMARY KEY NOT NULL,
	`publication_id` text NOT NULL REFERENCES `publications`(`id`) ON DELETE CASCADE,
	`size` integer NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `media_objects_publication_idx` ON `media_objects` (`publication_id`);
--> statement-breakpoint
CREATE TABLE `reports` (
	`id` text PRIMARY KEY NOT NULL,
	`publication_id` text NOT NULL REFERENCES `publications`(`id`) ON DELETE CASCADE,
	`url` text,
	`reason` text NOT NULL,
	`details` text,
	`reporter_email` text,
	`status` text DEFAULT 'open' NOT NULL, -- open | resolved
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `reports_status_idx` ON `reports` (`status`, `created_at`);
--> statement-breakpoint
ALTER TABLE `campaign_deliveries` ADD COLUMN `provider_id` text;
--> statement-breakpoint
ALTER TABLE `campaign_deliveries` ADD COLUMN `opened_at` integer;
--> statement-breakpoint
ALTER TABLE `campaign_deliveries` ADD COLUMN `clicked_at` integer;
--> statement-breakpoint
CREATE INDEX `campaign_deliveries_provider_idx` ON `campaign_deliveries` (`provider_id`);
--> statement-breakpoint
-- Platform sender replaces the per-publication From local-part.
DELETE FROM `settings` WHERE `key` = 'emailFromLocal';
