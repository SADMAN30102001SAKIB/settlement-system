ALTER TABLE `ad_invoices` ADD `vat_basis_points` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `settlements` ADD `vat_added_to_agency` integer DEFAULT false NOT NULL;