CREATE TABLE `order_cost_corrections` (
	`id` text PRIMARY KEY NOT NULL,
	`brand_id` text NOT NULL,
	`name` text NOT NULL,
	`making_cost` integer NOT NULL,
	`from_date` text NOT NULL,
	`to_date` text NOT NULL,
	`version` text NOT NULL,
	`snapshot` text NOT NULL,
	`actor` text NOT NULL,
	`created_at` integer NOT NULL
);
