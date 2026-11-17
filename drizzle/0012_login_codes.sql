-- Sign-in by 6-digit code (store app: magic links open the system browser,
-- so the code is typed into the app instead). sha256 of `<token id>:<code>`.
ALTER TABLE `login_tokens` ADD COLUMN `code_hash` text;
--> statement-breakpoint
ALTER TABLE `login_tokens` ADD COLUMN `attempts` integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
CREATE INDEX `login_tokens_email_idx` ON `login_tokens` (`email`, `created_at`);
