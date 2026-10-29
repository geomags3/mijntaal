CREATE TABLE `lesson_programs` (
	`id` text PRIMARY KEY NOT NULL,
	`owner` text NOT NULL,
	`body` text NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`archived` integer DEFAULT 0 NOT NULL,
	`created` text NOT NULL,
	`updated` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `lesson_programs_owner` ON `lesson_programs` (`owner`,`archived`);--> statement-breakpoint
CREATE TABLE `lesson_progress` (
	`lesson_id` text NOT NULL,
	`owner` text NOT NULL,
	`revision` integer NOT NULL,
	`body` text NOT NULL,
	`updated` text NOT NULL,
	PRIMARY KEY(`lesson_id`, `owner`)
);
--> statement-breakpoint
CREATE TABLE `lesson_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`lesson_id` text NOT NULL,
	`owner` text NOT NULL,
	`lesson_version` integer NOT NULL,
	`body` text NOT NULL,
	`completed` text NOT NULL,
	`correct` integer NOT NULL,
	`total` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `lesson_runs_owner_lesson` ON `lesson_runs` (`owner`,`lesson_id`);--> statement-breakpoint
CREATE TABLE `lessons` (
	`id` text PRIMARY KEY NOT NULL,
	`owner` text NOT NULL,
	`body` text NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`archived` integer DEFAULT 0 NOT NULL,
	`program_id` text,
	`topic_id` text,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`created` text NOT NULL,
	`updated` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `lessons_owner_program` ON `lessons` (`owner`,`archived`,`program_id`,`sort_order`);