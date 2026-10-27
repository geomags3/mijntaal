import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';
export const materials = sqliteTable('materials', {
  id: text('id').primaryKey(),
  owner: text('owner').notNull(),
  kind: text('kind').notNull(),
  title: text('title').notNull(),
  body: text('body').notNull(),
  created: text('created').notNull(),
});
export const userSettings = sqliteTable('user_settings', {
  owner: text('owner').primaryKey(),
  keyCipher: text('key_cipher'),
  preferences: text('preferences').notNull().default('{}'),
  updated: text('updated').notNull(),
});
export const lookupCache = sqliteTable('lookup_cache', {
  id: text('id').primaryKey(),
  owner: text('owner').notNull(),
  body: text('body').notNull(),
  created: text('created').notNull(),
});
export const reviewState = sqliteTable('review_state', {
  materialId: text('material_id').primaryKey(),
  owner: text('owner').notNull(),
  rank: integer('rank').notNull().default(0),
  active: integer('active').notNull().default(1),
  lastSeen: text('last_seen'),
  updated: text('updated').notNull(),
});
export const reviewAttempts = sqliteTable('review_attempts', {
  id: text('id').primaryKey(),
  owner: text('owner').notNull(),
  materialId: text('material_id').notNull(),
  rating: text('rating').notNull(),
  created: text('created').notNull(),
});
export const wordsState = sqliteTable('words_state', {
  materialId: text('material_id').primaryKey(),
  owner: text('owner').notNull(),
  body: text('body').notNull(),
  updated: text('updated').notNull(),
});
export const wordsAttempts = sqliteTable('words_attempts', {
  id: text('id').primaryKey(),
  owner: text('owner').notNull(),
  materialId: text('material_id').notNull(),
  body: text('body').notNull(),
  created: text('created').notNull(),
});
export const wordsSessions = sqliteTable('words_sessions', {
  owner: text('owner').primaryKey(),
  id: text('id').notNull(),
  revision: integer('revision').notNull().default(1),
  body: text('body').notNull(),
  updated: text('updated').notNull(),
});
