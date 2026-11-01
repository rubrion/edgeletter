ALTER TABLE `subscribers` ADD COLUMN `lang` text DEFAULT 'en' NOT NULL;--> statement-breakpoint
ALTER TABLE `posts` ADD COLUMN `lang` text DEFAULT 'en' NOT NULL;--> statement-breakpoint
ALTER TABLE `posts` ADD COLUMN `canonical_url` text;
