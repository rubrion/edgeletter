-- Platform-wide daily AI token counter (ceiling across all publications).
CREATE TABLE IF NOT EXISTS `ai_platform_usage` (
	`day` text PRIMARY KEY NOT NULL,
	`tokens_used` integer DEFAULT 0 NOT NULL
);
