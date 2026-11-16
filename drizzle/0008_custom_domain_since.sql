-- When a custom hostname was requested, so unfinished setups can be cleaned
-- up (Cloudflare bills per custom hostname, active or not).
ALTER TABLE `publications` ADD COLUMN `pending_domain_since` integer;
