CREATE TABLE `words_attempts` (
	`id` text PRIMARY KEY NOT NULL,
	`owner` text NOT NULL,
	`material_id` text NOT NULL,
	`body` text NOT NULL,
	`created` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `words_sessions` (
	`owner` text PRIMARY KEY NOT NULL,
	`id` text NOT NULL,
	`revision` integer DEFAULT 1 NOT NULL,
	`body` text NOT NULL,
	`updated` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `words_state` (
	`material_id` text PRIMARY KEY NOT NULL,
	`owner` text NOT NULL,
	`body` text NOT NULL,
	`updated` text NOT NULL
);
