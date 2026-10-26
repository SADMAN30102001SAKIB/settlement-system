-- D1 keeps foreign keys enabled. Preserve child payments before the table rebuild.
PRAGMA defer_foreign_keys=ON;--> statement-breakpoint
CREATE TABLE `__v3_payments` AS SELECT * FROM `payments`;--> statement-breakpoint
ALTER TABLE `settlements` ADD `delivered_cod_charge` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `settlements` ADD `partial_cod_charge` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `settlements` ADD `vat_basis_points` integer DEFAULT 1000 NOT NULL;--> statement-breakpoint
CREATE TABLE `__new_settlements` (
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
	`delivered_cod_charge` integer DEFAULT 0 NOT NULL,
	`partial_cod_charge` integer DEFAULT 0 NOT NULL,
	`vat_basis_points` integer DEFAULT 1000 NOT NULL,
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
	CONSTRAINT "settlements_valid_rule" CHECK("__new_settlements"."rule" IN ('legacy','v2','v3')),
	CONSTRAINT "settlements_valid_rate" CHECK("__new_settlements"."agency_basis_points" BETWEEN 0 AND 10000),
	CONSTRAINT "settlements_nonnegative_counts" CHECK("__new_settlements"."delivered_qty" >= 0 AND "__new_settlements"."cancelled_qty" >= 0 AND "__new_settlements"."partial_qty" >= 0 AND "__new_settlements"."pending_qty" >= 0),
	CONSTRAINT "settlements_nonnegative_inputs" CHECK("__new_settlements"."delivered_amount" >= 0 AND "__new_settlements"."cancelled_amount" >= 0 AND "__new_settlements"."partial_amount" >= 0 AND "__new_settlements"."shipping" >= 0 AND "__new_settlements"."cod_charge" >= 0 AND "__new_settlements"."ads" >= 0 AND "__new_settlements"."product_cost" >= 0)
);
--> statement-breakpoint
INSERT INTO `__new_settlements`("id", "invoice_number", "brand_id", "brand_name", "date", "period", "rule", "delivered_qty", "delivered_amount", "cancelled_qty", "cancelled_amount", "partial_qty", "partial_amount", "pending_qty", "shipping", "cod_charge", "delivered_cod_charge", "partial_cod_charge", "vat_basis_points", "ads", "product_cost", "cost_per_piece", "agency_basis_points", "gross", "net", "commission", "source_file_id", "revision", "created_at", "updated_at") SELECT "id", "invoice_number", "brand_id", "brand_name", "date", "period", "rule", "delivered_qty", "delivered_amount", "cancelled_qty", "cancelled_amount", "partial_qty", "partial_amount", "pending_qty", "shipping", "cod_charge", "delivered_cod_charge", "partial_cod_charge", "vat_basis_points", "ads", "product_cost", "cost_per_piece", "agency_basis_points", "gross", "net", "commission", "source_file_id", "revision", "created_at", "updated_at" FROM `settlements`;--> statement-breakpoint
DROP TABLE `settlements`;--> statement-breakpoint
ALTER TABLE `__new_settlements` RENAME TO `settlements`;--> statement-breakpoint
INSERT OR IGNORE INTO `payments` SELECT * FROM `__v3_payments`;--> statement-breakpoint
DROP TABLE `__v3_payments`;--> statement-breakpoint
PRAGMA defer_foreign_keys=OFF;--> statement-breakpoint
CREATE UNIQUE INDEX `settlements_invoice_number_unique` ON `settlements` (`invoice_number`);--> statement-breakpoint
CREATE INDEX `settlements_brand_date_idx` ON `settlements` (`brand_id`,`date`,`id`);--> statement-breakpoint
CREATE INDEX `settlements_date_idx` ON `settlements` (`date`,`id`);
