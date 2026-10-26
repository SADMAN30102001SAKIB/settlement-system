CREATE TABLE `ad_invoices` (
	`id` text PRIMARY KEY NOT NULL,
	`invoice_number` text NOT NULL,
	`brand_id` text NOT NULL,
	`brand_name` text NOT NULL,
	`date` text NOT NULL,
	`period` text NOT NULL,
	`normalized_period` text NOT NULL,
	`total` integer NOT NULL,
	`revision` integer DEFAULT 1 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`brand_id`) REFERENCES `brands`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "ad_invoices_nonnegative" CHECK("ad_invoices"."total" >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ad_invoices_invoice_number_unique` ON `ad_invoices` (`invoice_number`);--> statement-breakpoint
CREATE UNIQUE INDEX `ad_invoices_brand_period_idx` ON `ad_invoices` (`brand_id`,`normalized_period`);--> statement-breakpoint
CREATE INDEX `ad_invoices_brand_date_idx` ON `ad_invoices` (`brand_id`,`date`,`id`);--> statement-breakpoint
CREATE INDEX `ad_invoices_date_idx` ON `ad_invoices` (`date`,`id`);--> statement-breakpoint
CREATE TABLE `admins` (
	`id` integer PRIMARY KEY NOT NULL,
	`username` text NOT NULL,
	`password_hash` text NOT NULL,
	`created_at` integer NOT NULL,
	CONSTRAINT "single_admin" CHECK("admins"."id" = 1)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `admins_username_unique` ON `admins` (`username`);--> statement-breakpoint
CREATE TABLE `brands` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`normalized_name` text NOT NULL,
	`making_cost` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	CONSTRAINT "brands_cost_nonnegative" CHECK("brands"."making_cost" IS NULL OR "brands"."making_cost" >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `brands_normalized_name_unique` ON `brands` (`normalized_name`);--> statement-breakpoint
CREATE TABLE `campaigns` (
	`id` text PRIMARY KEY NOT NULL,
	`invoice_id` text NOT NULL,
	`position` integer NOT NULL,
	`name` text NOT NULL,
	`amount` integer NOT NULL,
	FOREIGN KEY (`invoice_id`) REFERENCES `ad_invoices`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "campaigns_nonnegative" CHECK("campaigns"."amount" >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `campaigns_invoice_position_idx` ON `campaigns` (`invoice_id`,`position`);--> statement-breakpoint
CREATE TABLE `daily_ads` (
	`brand_id` text NOT NULL,
	`order_date` text NOT NULL,
	`amount` integer NOT NULL,
	`updated_at` integer NOT NULL,
	PRIMARY KEY(`brand_id`, `order_date`),
	FOREIGN KEY (`brand_id`) REFERENCES `brands`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "daily_ads_nonnegative" CHECK("daily_ads"."amount" >= 0)
);
--> statement-breakpoint
CREATE TABLE `expenses` (
	`id` text PRIMARY KEY NOT NULL,
	`date` text NOT NULL,
	`description` text NOT NULL,
	`amount` integer NOT NULL,
	`created_at` integer NOT NULL,
	CONSTRAINT "expenses_nonnegative" CHECK("expenses"."amount" >= 0)
);
--> statement-breakpoint
CREATE INDEX `expenses_date_idx` ON `expenses` (`date`,`id`);--> statement-breakpoint
CREATE TABLE `files` (
	`id` text PRIMARY KEY NOT NULL,
	`object_key` text NOT NULL,
	`filename` text NOT NULL,
	`mime` text NOT NULL,
	`size` integer NOT NULL,
	`kind` text NOT NULL,
	`created_at` integer NOT NULL,
	CONSTRAINT "files_size_positive" CHECK("files"."size" > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `files_object_key_unique` ON `files` (`object_key`);--> statement-breakpoint
CREATE TABLE `invoice_counters` (
	`kind` text NOT NULL,
	`date` text NOT NULL,
	`value` integer NOT NULL,
	PRIMARY KEY(`kind`, `date`)
);
--> statement-breakpoint
CREATE TABLE `login_attempts` (
	`key` text PRIMARY KEY NOT NULL,
	`failures` integer DEFAULT 0 NOT NULL,
	`window_started_at` integer NOT NULL,
	`locked_until` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE `notes` (
	`id` text PRIMARY KEY NOT NULL,
	`brand_id` text NOT NULL,
	`period` text NOT NULL,
	`type` text NOT NULL,
	`content` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`brand_id`) REFERENCES `brands`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE INDEX `notes_brand_created_idx` ON `notes` (`brand_id`,`created_at`,`id`);--> statement-breakpoint
CREATE TABLE `orders` (
	`id` text PRIMARY KEY NOT NULL,
	`brand_id` text NOT NULL,
	`order_date` text NOT NULL,
	`delivery_date` text,
	`status` text NOT NULL,
	`quantity` integer DEFAULT 1 NOT NULL,
	`partial_quantity` integer,
	`sales_override` integer,
	`cost_per_piece` integer,
	`cod_amount` integer NOT NULL,
	`shipping` integer NOT NULL,
	`cod_charge` integer NOT NULL,
	`ads` integer DEFAULT 0 NOT NULL,
	`revision` integer DEFAULT 1 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`brand_id`) REFERENCES `brands`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "orders_valid_status" CHECK("orders"."status" IN ('Delivered','Cancelled','Partial Delivered','Pending')),
	CONSTRAINT "orders_positive_quantity" CHECK("orders"."quantity" >= 1),
	CONSTRAINT "orders_valid_partial_quantity" CHECK("orders"."partial_quantity" IS NULL OR "orders"."partial_quantity" BETWEEN 0 AND "orders"."quantity"),
	CONSTRAINT "orders_nonnegative_amounts" CHECK("orders"."cod_amount" >= 0 AND "orders"."shipping" >= 0 AND "orders"."cod_charge" >= 0 AND "orders"."ads" >= 0 AND ("orders"."sales_override" IS NULL OR "orders"."sales_override" >= 0) AND ("orders"."cost_per_piece" IS NULL OR "orders"."cost_per_piece" >= 0))
);
--> statement-breakpoint
CREATE INDEX `orders_brand_order_date_idx` ON `orders` (`brand_id`,`order_date`,`id`);--> statement-breakpoint
CREATE INDEX `orders_order_date_idx` ON `orders` (`order_date`,`id`);--> statement-breakpoint
CREATE INDEX `orders_brand_delivery_date_idx` ON `orders` (`brand_id`,`delivery_date`,`id`);--> statement-breakpoint
CREATE INDEX `orders_delivery_date_idx` ON `orders` (`delivery_date`,`id`);--> statement-breakpoint
CREATE TABLE `payments` (
	`id` text PRIMARY KEY NOT NULL,
	`settlement_id` text,
	`ad_invoice_id` text,
	`brand_id` text,
	`amount` integer NOT NULL,
	`date` text NOT NULL,
	`note` text DEFAULT '' NOT NULL,
	`proof_file_id` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`settlement_id`) REFERENCES `settlements`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`ad_invoice_id`) REFERENCES `ad_invoices`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`brand_id`) REFERENCES `brands`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`proof_file_id`) REFERENCES `files`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "payments_positive" CHECK("payments"."amount" > 0),
	CONSTRAINT "payments_exactly_one_target" CHECK(("payments"."settlement_id" IS NOT NULL) + ("payments"."ad_invoice_id" IS NOT NULL) + ("payments"."brand_id" IS NOT NULL) = 1)
);
--> statement-breakpoint
CREATE INDEX `payments_settlement_idx` ON `payments` (`settlement_id`,`date`,`id`);--> statement-breakpoint
CREATE INDEX `payments_ad_invoice_idx` ON `payments` (`ad_invoice_id`,`date`,`id`);--> statement-breakpoint
CREATE INDEX `payments_brand_idx` ON `payments` (`brand_id`,`date`,`id`);--> statement-breakpoint
CREATE TABLE `sessions` (
	`token_hash` text PRIMARY KEY NOT NULL,
	`admin_id` integer NOT NULL,
	`expires_at` integer NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`admin_id`) REFERENCES `admins`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `sessions_expiry_idx` ON `sessions` (`expires_at`);--> statement-breakpoint
CREATE TABLE `settings` (
	`id` integer PRIMARY KEY NOT NULL,
	`company_name` text DEFAULT 'Hexa Agency Ltd.' NOT NULL,
	`address` text DEFAULT 'Binodpur Bazar, Rajshahi' NOT NULL,
	`phone` text DEFAULT '' NOT NULL,
	`email` text DEFAULT '' NOT NULL,
	`signature_label` text DEFAULT 'Authorized Signature' NOT NULL,
	`agency_basis_points` integer DEFAULT 1500 NOT NULL,
	`watermark_file_id` text,
	`signature_file_id` text,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`watermark_file_id`) REFERENCES `files`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`signature_file_id`) REFERENCES `files`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "single_settings" CHECK("settings"."id" = 1),
	CONSTRAINT "valid_agency_percentage" CHECK("settings"."agency_basis_points" BETWEEN 0 AND 10000)
);
--> statement-breakpoint
CREATE TABLE `settlements` (
	`id` text PRIMARY KEY NOT NULL,
	`invoice_number` text NOT NULL,
	`brand_id` text NOT NULL,
	`brand_name` text NOT NULL,
	`date` text NOT NULL,
	`period` text NOT NULL,
	`rule` text DEFAULT 'v2' NOT NULL,
	`delivered_qty` integer NOT NULL,
	`delivered_amount` integer NOT NULL,
	`cancelled_qty` integer NOT NULL,
	`cancelled_amount` integer NOT NULL,
	`partial_qty` integer NOT NULL,
	`partial_amount` integer NOT NULL,
	`pending_qty` integer DEFAULT 0 NOT NULL,
	`shipping` integer NOT NULL,
	`cod_charge` integer NOT NULL,
	`ads` integer NOT NULL,
	`product_cost` integer NOT NULL,
	`cost_per_piece` integer,
	`agency_basis_points` integer NOT NULL,
	`gross` integer NOT NULL,
	`net` integer NOT NULL,
	`commission` integer NOT NULL,
	`source_file_id` text,
	`revision` integer DEFAULT 1 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`brand_id`) REFERENCES `brands`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`source_file_id`) REFERENCES `files`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "settlements_valid_rule" CHECK("settlements"."rule" IN ('legacy','v2')),
	CONSTRAINT "settlements_valid_rate" CHECK("settlements"."agency_basis_points" BETWEEN 0 AND 10000),
	CONSTRAINT "settlements_nonnegative_counts" CHECK("settlements"."delivered_qty" >= 0 AND "settlements"."cancelled_qty" >= 0 AND "settlements"."partial_qty" >= 0 AND "settlements"."pending_qty" >= 0),
	CONSTRAINT "settlements_nonnegative_inputs" CHECK("settlements"."delivered_amount" >= 0 AND "settlements"."cancelled_amount" >= 0 AND "settlements"."partial_amount" >= 0 AND "settlements"."shipping" >= 0 AND "settlements"."cod_charge" >= 0 AND "settlements"."ads" >= 0 AND "settlements"."product_cost" >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `settlements_invoice_number_unique` ON `settlements` (`invoice_number`);--> statement-breakpoint
CREATE INDEX `settlements_brand_date_idx` ON `settlements` (`brand_id`,`date`,`id`);--> statement-breakpoint
CREATE INDEX `settlements_date_idx` ON `settlements` (`date`,`id`);