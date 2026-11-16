-- RSS/Atom import: writers who already blog elsewhere point EdgeLetter at
-- their feed; new items become posts (linked back via canonical_url).
CREATE TABLE `feed_sources` (
	`id` text PRIMARY KEY NOT NULL,
	`publication_id` text NOT NULL REFERENCES `publications`(`id`) ON DELETE CASCADE,
	`url` text NOT NULL,
	`lang` text DEFAULT 'en' NOT NULL,
	`auto_send` integer DEFAULT false NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`etag` text,
	`last_modified` text,
	`last_checked_at` integer,
	`last_success_at` integer,
	`last_error` text,
	`fail_count` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `feed_sources_publication_url_unique` ON `feed_sources` (`publication_id`, `url`);
--> statement-breakpoint
CREATE INDEX `feed_sources_due_idx` ON `feed_sources` (`enabled`, `last_checked_at`);
--> statement-breakpoint
-- One row per feed item ever seen: makes imports idempotent across runs.
CREATE TABLE `feed_items` (
	`feed_id` text NOT NULL REFERENCES `feed_sources`(`id`) ON DELETE CASCADE,
	`guid_hash` text NOT NULL,
	`post_id` text,
	`created_at` integer NOT NULL,
	PRIMARY KEY (`feed_id`, `guid_hash`)
);
