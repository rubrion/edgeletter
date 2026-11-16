-- Retire single-tenant mode: the original blog becomes the ordinary
-- publication `rubrion` (rubrion.<PLATFORM_DOMAIN>); its old host stays as an
-- alias that redirects pages and keeps emailed unsubscribe/confirm links working.
UPDATE `publications`
SET `handle` = 'rubrion',
    `name` = COALESCE((SELECT `value` FROM `settings` WHERE `publication_id` = 'default' AND `key` = 'clientName'), 'Rubrion'),
    `legacy_media_prefix` = 'edgeletter/rubrion'
WHERE `id` = 'default';
--> statement-breakpoint
INSERT OR IGNORE INTO `publication_aliases` (`host`, `publication_id`) VALUES ('edgeletter.rubrion.ai', 'default');
