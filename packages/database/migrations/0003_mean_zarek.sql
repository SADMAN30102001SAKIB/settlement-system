ALTER TABLE `settlements` ADD `delivered_units` integer;--> statement-breakpoint
ALTER TABLE `settlements` ADD `deduct_shipping` integer DEFAULT false NOT NULL;