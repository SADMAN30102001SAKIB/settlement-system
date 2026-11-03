CREATE TABLE `delivery_challans` (
	`id` text PRIMARY KEY NOT NULL,
	`brand_id` text NOT NULL,
	`date` text NOT NULL,
	`quantity_milli` integer NOT NULL,
	`unit_cost` integer NOT NULL,
	`total` integer NOT NULL,
	`revision` integer DEFAULT 1 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`brand_id`) REFERENCES `brands`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "challan_quantity_positive" CHECK("delivery_challans"."quantity_milli">0 AND "delivery_challans"."quantity_milli"<=1000000000),
	CONSTRAINT "challan_cost_valid" CHECK("delivery_challans"."unit_cost">=0 AND "delivery_challans"."total">=0)
);
--> statement-breakpoint
CREATE INDEX `delivery_challans_brand_date_idx` ON `delivery_challans` (`brand_id`,`date`,`id`);