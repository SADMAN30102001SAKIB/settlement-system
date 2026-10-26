CREATE INDEX `daily_ads_date_idx` ON `daily_ads` (`order_date`,`brand_id`);--> statement-breakpoint
CREATE INDEX `files_created_idx` ON `files` (`created_at`,`id`);--> statement-breakpoint
CREATE INDEX `notes_created_idx` ON `notes` (`created_at`,`id`);