-- Card data for post lists: a cover image (first image of the post, or the
-- feed's media) and a plain-text excerpt, computed when a post is written.
ALTER TABLE `posts` ADD COLUMN `cover_url` text;
--> statement-breakpoint
ALTER TABLE `posts` ADD COLUMN `excerpt` text;
--> statement-breakpoint
CREATE INDEX `posts_publication_canonical_idx` ON `posts` (`publication_id`, `canonical_url`);
