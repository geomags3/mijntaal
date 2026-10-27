CREATE TABLE `lookup_cache` (
	`id` text PRIMARY KEY NOT NULL,
	`owner` text NOT NULL,
	`body` text NOT NULL,
	`created` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `review_attempts` (
	`id` text PRIMARY KEY NOT NULL,
	`owner` text NOT NULL,
	`material_id` text NOT NULL,
	`rating` text NOT NULL,
	`created` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `review_state` (
	`material_id` text PRIMARY KEY NOT NULL,
	`owner` text NOT NULL,
	`rank` integer DEFAULT 0 NOT NULL,
	`active` integer DEFAULT 1 NOT NULL,
	`last_seen` text,
	`updated` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `user_settings` (
	`owner` text PRIMARY KEY NOT NULL,
	`key_cipher` text,
	`preferences` text DEFAULT '{}' NOT NULL,
	`updated` text NOT NULL
);
