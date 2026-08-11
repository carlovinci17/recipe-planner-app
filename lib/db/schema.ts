import { pgTable, foreignKey, unique, pgPolicy, uuid, text, timestamp, index, integer, numeric, boolean, jsonb, check, date, customType, vector, primaryKey, pgEnum } from "drizzle-orm/pg-core"
import { sql } from "drizzle-orm"

// NOTE: RLS is enforced in the database and owned by the SQL migrations
// (supabase/migrations). The pgPolicy() entries below are introspected
// *documentation* — to be reconciled to `current_setting('app.user_id')` in ADR-002.

// Postgres types drizzle-kit can't map on its own:
// citext = case-insensitive text; tsvector = FTS column, trigger-maintained (never written directly).
const citext = customType<{ data: string }>({ dataType: () => "citext" });
const tsvector = customType<{ data: string }>({ dataType: () => "tsvector" });

export const householdRole = pgEnum("household_role", ['owner', 'member'])
export const ingestionEventKind = pgEnum("ingestion_event_kind", ['file_uploaded', 'ingestion_requested', 'ai_processing_started', 'extraction_completed', 'validation_completed', 'recipe_ready_for_review', 'recipe_saved', 'failed'])
export const integrationProvider = pgEnum("integration_provider", ['google_drive'])
export const mealSlot = pgEnum("meal_slot", ['breakfast', 'lunch', 'dinner', 'snack'])
export const recipeSourceKind = pgEnum("recipe_source_kind", ['manual', 'url', 'pdf', 'image', 'screenshot', 'google_drive', 'paste'])
export const recipeStatus = pgEnum("recipe_status", ['draft', 'processing', 'needs_review', 'published', 'failed'])


export const profiles = pgTable("profiles", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	email: citext("email").notNull(),
	// ADR-0005: link to the Microsoft Entra External ID object id (oid claim).
	entraOid: text("entra_oid").unique(),
	displayName: text("display_name"),
	avatarUrl: text("avatar_url"),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	unique("profiles_email_key").on(table.email),
	pgPolicy("profile household read", { as: "permissive", for: "select", to: ["public"], using: sql`(EXISTS ( SELECT 1
   FROM (household_members hm1
     JOIN household_members hm2 ON ((hm1.household_id = hm2.household_id)))
  WHERE ((hm1.user_id = auth.uid()) AND (hm2.user_id = profiles.id))))` }),
	pgPolicy("profile self update", { as: "permissive", for: "update", to: ["public"] }),
	pgPolicy("profile self read", { as: "permissive", for: "select", to: ["public"] }),
]);

export const households = pgTable("households", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	name: text().notNull(),
	createdBy: uuid("created_by").notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	foreignKey({
			columns: [table.createdBy],
			foreignColumns: [profiles.id],
			name: "households_created_by_fkey"
		}),
	pgPolicy("household owner delete", { as: "permissive", for: "delete", to: ["public"], using: sql`is_household_owner(id, auth.uid())` }),
	pgPolicy("household owner update", { as: "permissive", for: "update", to: ["public"] }),
	pgPolicy("household member can create", { as: "permissive", for: "insert", to: ["public"] }),
	pgPolicy("household member read", { as: "permissive", for: "select", to: ["public"] }),
]);

export const householdInvites = pgTable("household_invites", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	householdId: uuid("household_id").notNull(),
	email: citext("email").notNull(),
	role: householdRole().default('member').notNull(),
	token: text().default(sql`encode(gen_random_bytes(24), 'hex'::text)`).notNull(),
	invitedBy: uuid("invited_by").notNull(),
	expiresAt: timestamp("expires_at", { withTimezone: true, mode: 'string' }).default(sql`(now() + '14 days'::interval)`).notNull(),
	acceptedAt: timestamp("accepted_at", { withTimezone: true, mode: 'string' }),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("household_invites_email_idx").using("btree", table.email.asc().nullsLast().op("citext_ops")).where(sql`(accepted_at IS NULL)`),
	index("household_invites_household_idx").using("btree", table.householdId.asc().nullsLast().op("uuid_ops")),
	foreignKey({
			columns: [table.householdId],
			foreignColumns: [households.id],
			name: "household_invites_household_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.invitedBy],
			foreignColumns: [profiles.id],
			name: "household_invites_invited_by_fkey"
		}),
	unique("household_invites_token_key").on(table.token),
	pgPolicy("owner deletes invite", { as: "permissive", for: "delete", to: ["public"], using: sql`is_household_owner(household_id, auth.uid())` }),
	pgPolicy("owner creates invite", { as: "permissive", for: "insert", to: ["public"] }),
	pgPolicy("invites read by household", { as: "permissive", for: "select", to: ["public"] }),
]);

export const recipeIngredients = pgTable("recipe_ingredients", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	recipeId: uuid("recipe_id").notNull(),
	position: integer().notNull(),
	section: text(),
	rawText: text("raw_text").notNull(),
	// mode:"number" so reads return a JS number (matches the PostgREST path);
	// postgres.js otherwise returns `numeric` as a string. See tech-debt / code-review.
	quantity: numeric({ mode: "number" }),
	unit: text(),
	ingredient: text(),
	notes: text(),
	optional: boolean().default(false).notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("recipe_ingredients_name_trgm").using("gin", table.ingredient.asc().nullsLast().op("gin_trgm_ops")),
	index("recipe_ingredients_recipe_idx").using("btree", table.recipeId.asc().nullsLast().op("int4_ops"), table.position.asc().nullsLast().op("int4_ops")),
	foreignKey({
			columns: [table.recipeId],
			foreignColumns: [recipes.id],
			name: "recipe_ingredients_recipe_id_fkey"
		}).onDelete("cascade"),
	pgPolicy("recipe_ingredients delete by creator or owner", { as: "permissive", for: "delete", to: ["public"], using: sql`can_edit_recipe(recipe_id, auth.uid())` }),
	pgPolicy("recipe_ingredients write by creator or owner", { as: "permissive", for: "insert", to: ["public"] }),
	pgPolicy("recipe_ingredients read", { as: "permissive", for: "select", to: ["public"] }),
	pgPolicy("recipe_ingredients update by creator or owner", { as: "permissive", for: "update", to: ["public"] }),
]);

export const recipeInstructions = pgTable("recipe_instructions", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	recipeId: uuid("recipe_id").notNull(),
	position: integer().notNull(),
	section: text(),
	text: text().notNull(),
	durationMin: integer("duration_min"),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("recipe_instructions_recipe_idx").using("btree", table.recipeId.asc().nullsLast().op("int4_ops"), table.position.asc().nullsLast().op("int4_ops")),
	foreignKey({
			columns: [table.recipeId],
			foreignColumns: [recipes.id],
			name: "recipe_instructions_recipe_id_fkey"
		}).onDelete("cascade"),
	pgPolicy("recipe_instructions delete by creator or owner", { as: "permissive", for: "delete", to: ["public"], using: sql`can_edit_recipe(recipe_id, auth.uid())` }),
	pgPolicy("recipe_instructions update by creator or owner", { as: "permissive", for: "update", to: ["public"] }),
	pgPolicy("recipe_instructions write by creator or owner", { as: "permissive", for: "insert", to: ["public"] }),
	pgPolicy("recipe_instructions read", { as: "permissive", for: "select", to: ["public"] }),
]);

export const ingestionEvents = pgTable("ingestion_events", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	jobId: uuid("job_id").notNull(),
	kind: ingestionEventKind().notNull(),
	payload: jsonb().default({}).notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("ingestion_events_job_idx").using("btree", table.jobId.asc().nullsLast().op("timestamptz_ops"), table.createdAt.asc().nullsLast().op("timestamptz_ops")),
	foreignKey({
			columns: [table.jobId],
			foreignColumns: [ingestionJobs.id],
			name: "ingestion_events_job_id_fkey"
		}).onDelete("cascade"),
	pgPolicy("ingestion_events via job", { as: "permissive", for: "select", to: ["public"], using: sql`(EXISTS ( SELECT 1
   FROM ingestion_jobs j
  WHERE ((j.id = ingestion_events.job_id) AND is_household_member(j.household_id, auth.uid()))))` }),
]);

export const plannerEntries = pgTable("planner_entries", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	householdId: uuid("household_id").notNull(),
	recipeId: uuid("recipe_id"),
	customTitle: text("custom_title"),
	date: date().notNull(),
	slot: mealSlot().notNull(),
	servings: integer(),
	notes: text(),
	position: integer().default(0).notNull(),
	createdBy: uuid("created_by").notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("planner_entries_household_date_idx").using("btree", table.householdId.asc().nullsLast().op("enum_ops"), table.date.asc().nullsLast().op("uuid_ops"), table.slot.asc().nullsLast().op("uuid_ops"), table.position.asc().nullsLast().op("enum_ops")),
	foreignKey({
			columns: [table.householdId],
			foreignColumns: [households.id],
			name: "planner_entries_household_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.createdBy],
			foreignColumns: [profiles.id],
			name: "planner_entries_created_by_fkey"
		}),
	foreignKey({
			columns: [table.recipeId],
			foreignColumns: [recipes.id],
			name: "planner_entries_recipe_id_fkey"
		}).onDelete("cascade"),
	pgPolicy("planner_entries household delete", { as: "permissive", for: "delete", to: ["public"], using: sql`is_household_member(household_id, auth.uid())` }),
	pgPolicy("planner_entries household update", { as: "permissive", for: "update", to: ["public"] }),
	pgPolicy("planner_entries household write", { as: "permissive", for: "insert", to: ["public"] }),
	pgPolicy("planner_entries household read", { as: "permissive", for: "select", to: ["public"] }),
	check("planner_entries_check", sql`(recipe_id IS NOT NULL) OR (custom_title IS NOT NULL)`),
]);

export const shoppingLists = pgTable("shopping_lists", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	householdId: uuid("household_id").notNull(),
	name: text().default('Shopping list').notNull(),
	weekStart: date("week_start"),
	isActive: boolean("is_active").default(true).notNull(),
	createdBy: uuid("created_by").notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("shopping_lists_household_idx").using("btree", table.householdId.asc().nullsLast().op("bool_ops"), table.isActive.asc().nullsLast().op("bool_ops")),
	foreignKey({
			columns: [table.householdId],
			foreignColumns: [households.id],
			name: "shopping_lists_household_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.createdBy],
			foreignColumns: [profiles.id],
			name: "shopping_lists_created_by_fkey"
		}),
	pgPolicy("shopping_lists household update", { as: "permissive", for: "update", to: ["public"], using: sql`is_household_member(household_id, auth.uid())` }),
	pgPolicy("shopping_lists household write", { as: "permissive", for: "insert", to: ["public"] }),
	pgPolicy("shopping_lists household read", { as: "permissive", for: "select", to: ["public"] }),
	pgPolicy("shopping_lists household delete", { as: "permissive", for: "delete", to: ["public"] }),
]);

export const shoppingListItems = pgTable("shopping_list_items", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	listId: uuid("list_id").notNull(),
	ingredient: text().notNull(),
	quantity: numeric({ mode: "number" }),
	unit: text(),
	category: text(),
	sourceRecipeIds: uuid("source_recipe_ids").array().default(sql`'{}'`).notNull(),
	custom: boolean().default(false).notNull(),
	isChecked: boolean("is_checked").default(false).notNull(),
	position: integer().default(0).notNull(),
	notes: text(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("shopping_list_items_list_idx").using("btree", table.listId.asc().nullsLast().op("int4_ops"), table.position.asc().nullsLast().op("int4_ops")),
	foreignKey({
			columns: [table.listId],
			foreignColumns: [shoppingLists.id],
			name: "shopping_list_items_list_id_fkey"
		}).onDelete("cascade"),
	pgPolicy("shopping_list_items via list", { as: "permissive", for: "all", to: ["public"], using: sql`(EXISTS ( SELECT 1
   FROM shopping_lists sl
  WHERE ((sl.id = shopping_list_items.list_id) AND is_household_member(sl.household_id, auth.uid()))))`, withCheck: sql`(EXISTS ( SELECT 1
   FROM shopping_lists sl
  WHERE ((sl.id = shopping_list_items.list_id) AND is_household_member(sl.household_id, auth.uid()))))`  }),
]);

export const integrationAccounts = pgTable("integration_accounts", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	householdId: uuid("household_id").notNull(),
	userId: uuid("user_id").notNull(),
	provider: integrationProvider().notNull(),
	externalId: text("external_id").notNull(),
	email: citext("email"),
	accessToken: text("access_token").notNull(),
	refreshToken: text("refresh_token"),
	scopes: text().array().default(sql`'{}'`).notNull(),
	expiresAt: timestamp("expires_at", { withTimezone: true, mode: 'string' }),
	metadata: jsonb().default({}).notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	foreignKey({
			columns: [table.householdId],
			foreignColumns: [households.id],
			name: "integration_accounts_household_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.userId],
			foreignColumns: [profiles.id],
			name: "integration_accounts_user_id_fkey"
		}).onDelete("cascade"),
	unique("integration_accounts_household_id_provider_external_id_key").on(table.householdId, table.provider, table.externalId),
	pgPolicy("integration_accounts household delete", { as: "permissive", for: "delete", to: ["public"], using: sql`is_household_member(household_id, auth.uid())` }),
	pgPolicy("integration_accounts household update", { as: "permissive", for: "update", to: ["public"] }),
	pgPolicy("integration_accounts household write", { as: "permissive", for: "insert", to: ["public"] }),
	pgPolicy("integration_accounts household read", { as: "permissive", for: "select", to: ["public"] }),
]);

export const driveWatchedFolders = pgTable("drive_watched_folders", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	accountId: uuid("account_id").notNull(),
	householdId: uuid("household_id").notNull(),
	folderId: text("folder_id").notNull(),
	folderName: text("folder_name"),
	pageToken: text("page_token"),
	isActive: boolean("is_active").default(true).notNull(),
	lastSyncedAt: timestamp("last_synced_at", { withTimezone: true, mode: 'string' }),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("drive_watched_folders_household_idx").using("btree", table.householdId.asc().nullsLast().op("uuid_ops")),
	foreignKey({
			columns: [table.accountId],
			foreignColumns: [integrationAccounts.id],
			name: "drive_watched_folders_account_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.householdId],
			foreignColumns: [households.id],
			name: "drive_watched_folders_household_id_fkey"
		}).onDelete("cascade"),
	unique("drive_watched_folders_account_id_folder_id_key").on(table.accountId, table.folderId),
	pgPolicy("drive_watched_folders household delete", { as: "permissive", for: "delete", to: ["public"], using: sql`is_household_member(household_id, auth.uid())` }),
	pgPolicy("drive_watched_folders household update", { as: "permissive", for: "update", to: ["public"] }),
	pgPolicy("drive_watched_folders household write", { as: "permissive", for: "insert", to: ["public"] }),
	pgPolicy("drive_watched_folders household read", { as: "permissive", for: "select", to: ["public"] }),
]);

export const ingestionJobs = pgTable("ingestion_jobs", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	householdId: uuid("household_id").notNull(),
	createdBy: uuid("created_by").notNull(),
	recipeId: uuid("recipe_id"),
	sourceKind: recipeSourceKind("source_kind").notNull(),
	sourceUrl: text("source_url"),
	storagePath: text("storage_path"),
	storageBucket: text("storage_bucket"),
	pageImagePaths: text("page_image_paths").array().default(sql`'{}'`).notNull(),
	status: recipeStatus().default('draft').notNull(),
	error: text(),
	aiModel: text("ai_model"),
	promptTokens: integer("prompt_tokens"),
	completionTokens: integer("completion_tokens"),
	costCents: integer("cost_cents"),
	rawExtraction: jsonb("raw_extraction"),
	normalized: jsonb(),
	inngestRunId: text("inngest_run_id"),
	attempts: integer().default(0).notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	externalFileId: text("external_file_id"),
	externalModifiedTime: timestamp("external_modified_time", { withTimezone: true, mode: 'string' }),
	skimResults: jsonb("skim_results"),
}, (table) => [
	index("ingestion_jobs_external_file_idx").using("btree", table.householdId.asc().nullsLast().op("text_ops"), table.externalFileId.asc().nullsLast().op("uuid_ops")).where(sql`(external_file_id IS NOT NULL)`),
	index("ingestion_jobs_household_idx").using("btree", table.householdId.asc().nullsLast().op("uuid_ops"), table.createdAt.desc().nullsFirst().op("timestamptz_ops")),
	index("ingestion_jobs_status_idx").using("btree", table.householdId.asc().nullsLast().op("enum_ops"), table.status.asc().nullsLast().op("enum_ops")),
	foreignKey({
			columns: [table.householdId],
			foreignColumns: [households.id],
			name: "ingestion_jobs_household_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.createdBy],
			foreignColumns: [profiles.id],
			name: "ingestion_jobs_created_by_fkey"
		}),
	foreignKey({
			columns: [table.recipeId],
			foreignColumns: [recipes.id],
			name: "ingestion_jobs_recipe_id_fkey"
		}).onDelete("set null"),
	pgPolicy("ingestion_jobs household delete", { as: "permissive", for: "delete", to: ["public"], using: sql`is_household_member(household_id, auth.uid())` }),
	pgPolicy("ingestion_jobs household update", { as: "permissive", for: "update", to: ["public"] }),
	pgPolicy("ingestion_jobs household write", { as: "permissive", for: "insert", to: ["public"] }),
	pgPolicy("ingestion_jobs household read", { as: "permissive", for: "select", to: ["public"] }),
]);

export const recipes = pgTable("recipes", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	householdId: uuid("household_id").notNull(),
	createdBy: uuid("created_by").notNull(),
	title: text().notNull(),
	description: text(),
	servings: integer(),
	prepTimeMin: integer("prep_time_min"),
	cookTimeMin: integer("cook_time_min"),
	totalTimeMin: integer("total_time_min").generatedAlwaysAs(sql`(COALESCE(prep_time_min, 0) + COALESCE(cook_time_min, 0))`),
	notes: text(),
	sourceKind: recipeSourceKind("source_kind").default('manual').notNull(),
	sourceUrl: text("source_url"),
	sourceMetadata: jsonb("source_metadata").default({}).notNull(),
	coverImagePath: text("cover_image_path"),
	imagePaths: text("image_paths").array().default(sql`'{}'`).notNull(),
	nutrition: jsonb().default({}).notNull(),
	aiMetadata: jsonb("ai_metadata").default({}).notNull(),
	aiConfidence: numeric("ai_confidence", { precision: 4, scale:  3, mode: "number" }),
	aiModel: text("ai_model"),
	cuisines: text().array().default(sql`'{}'`).notNull(),
	mealTypes: text("meal_types").array().default(sql`'{}'`).notNull(),
	dietTypes: text("diet_types").array().default(sql`'{}'`).notNull(),
	cookingMethods: text("cooking_methods").array().default(sql`'{}'`).notNull(),
	difficulty: text(),
	occasions: text().array().default(sql`'{}'`).notNull(),
	tags: text().array().default(sql`'{}'`).notNull(),
	rating: integer(),
	isFavorite: boolean("is_favorite").default(false).notNull(),
	status: recipeStatus().default('published').notNull(),
	archivedAt: timestamp("archived_at", { withTimezone: true, mode: 'string' }),
	embedding: vector({ dimensions: 1536 }),
	searchTsv: tsvector("search_tsv"),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	ingestionJobId: uuid("ingestion_job_id"),
	externalSourceId: text("external_source_id"),
	coverFocalX: integer("cover_focal_x").default(50).notNull(),
	coverFocalY: integer("cover_focal_y").default(50).notNull(),
	sourceName: text("source_name"),
}, (table) => [
	index("recipes_created_idx").using("btree", table.householdId.asc().nullsLast().op("uuid_ops"), table.createdAt.desc().nullsFirst().op("uuid_ops")),
	index("recipes_cuisines_gin").using("gin", table.cuisines.asc().nullsLast().op("array_ops")),
	index("recipes_diet_types_gin").using("gin", table.dietTypes.asc().nullsLast().op("array_ops")),
	index("recipes_external_source_id_idx").using("btree", table.householdId.asc().nullsLast().op("text_ops"), table.externalSourceId.asc().nullsLast().op("text_ops")).where(sql`(external_source_id IS NOT NULL)`),
	index("recipes_favorite_idx").using("btree", table.householdId.asc().nullsLast().op("bool_ops"), table.isFavorite.asc().nullsLast().op("bool_ops")).where(sql`is_favorite`),
	index("recipes_household_idx").using("btree", table.householdId.asc().nullsLast().op("uuid_ops")),
	index("recipes_ingestion_job_id_idx").using("btree", table.ingestionJobId.asc().nullsLast().op("uuid_ops")),
	index("recipes_meal_types_gin").using("gin", table.mealTypes.asc().nullsLast().op("array_ops")),
	index("recipes_search_tsv_idx").using("gin", table.searchTsv.asc().nullsLast().op("tsvector_ops")),
	index("recipes_status_idx").using("btree", table.householdId.asc().nullsLast().op("uuid_ops"), table.status.asc().nullsLast().op("uuid_ops")),
	index("recipes_tags_gin").using("gin", table.tags.asc().nullsLast().op("array_ops")),
	index("recipes_title_trgm").using("gin", table.title.asc().nullsLast().op("gin_trgm_ops")),
	foreignKey({
			columns: [table.householdId],
			foreignColumns: [households.id],
			name: "recipes_household_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.createdBy],
			foreignColumns: [profiles.id],
			name: "recipes_created_by_fkey"
		}),
	// NOTE: recipes.ingestion_job_id → ingestion_jobs FK omitted here to break a
	// TypeScript circular-reference (ingestion_jobs.recipe_id → recipes points back).
	// The real constraint still exists in the DB (owned by the SQL migrations).
	pgPolicy("recipes delete by creator or owner", { as: "permissive", for: "delete", to: ["public"], using: sql`((created_by = auth.uid()) OR is_household_owner(household_id, auth.uid()))` }),
	pgPolicy("recipes update by creator or owner", { as: "permissive", for: "update", to: ["public"] }),
	pgPolicy("recipes household write", { as: "permissive", for: "insert", to: ["public"] }),
	pgPolicy("recipes household read", { as: "permissive", for: "select", to: ["public"] }),
	check("recipes_rating_check", sql`(rating >= 0) AND (rating <= 5)`),
	check("recipes_cover_focal_x_check", sql`(cover_focal_x >= 0) AND (cover_focal_x <= 100)`),
	check("recipes_cover_focal_y_check", sql`(cover_focal_y >= 0) AND (cover_focal_y <= 100)`),
]);

export const driveFileIndex = pgTable("drive_file_index", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	householdId: uuid("household_id").notNull(),
	driveFileId: text("drive_file_id").notNull(),
	fileName: text("file_name").notNull(),
	folderPath: text("folder_path").default("").notNull(),
	mimeType: text("mime_type").notNull(),
	modifiedTime: timestamp("modified_time", { withTimezone: true, mode: 'string' }),
	indexStatus: text("index_status").default('pending').notNull(),
	currentPage: integer("current_page"),
	totalPages: integer("total_pages"),
	recipeTitles: text("recipe_titles").array().default(sql`'{}'`).notNull(),
	indexedAt: timestamp("indexed_at", { withTimezone: true, mode: 'string' }),
	error: text(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	indexMethod: text("index_method"),
}, (table) => [
	index("drive_file_index_household_status").using("btree", table.householdId.asc().nullsLast().op("uuid_ops"), table.indexStatus.asc().nullsLast().op("uuid_ops")),
	foreignKey({
			columns: [table.householdId],
			foreignColumns: [households.id],
			name: "drive_file_index_household_id_fkey"
		}).onDelete("cascade"),
	unique("drive_file_index_household_id_drive_file_id_key").on(table.householdId, table.driveFileId),
	pgPolicy("household members can manage drive_file_index", { as: "permissive", for: "all", to: ["public"], using: sql`(household_id IN ( SELECT household_members.household_id
   FROM household_members
  WHERE (household_members.user_id = auth.uid())))` }),
]);

export const householdMembers = pgTable("household_members", {
	householdId: uuid("household_id").notNull(),
	userId: uuid("user_id").notNull(),
	role: householdRole().default('member').notNull(),
	joinedAt: timestamp("joined_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("household_members_user_idx").using("btree", table.userId.asc().nullsLast().op("uuid_ops")),
	foreignKey({
			columns: [table.householdId],
			foreignColumns: [households.id],
			name: "household_members_household_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.userId],
			foreignColumns: [profiles.id],
			name: "household_members_user_id_fkey"
		}).onDelete("cascade"),
	primaryKey({ columns: [table.householdId, table.userId], name: "household_members_pkey"}),
	pgPolicy("owner manages members", { as: "permissive", for: "all", to: ["public"], using: sql`is_household_owner(household_id, auth.uid())`, withCheck: sql`is_household_owner(household_id, auth.uid())`  }),
	pgPolicy("members read own households", { as: "permissive", for: "select", to: ["public"] }),
]);

export const recipeRatings = pgTable("recipe_ratings", {
	recipeId: uuid("recipe_id").notNull(),
	userId: uuid("user_id").notNull(),
	rating: integer().notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("recipe_ratings_recipe_idx").using("btree", table.recipeId.asc().nullsLast().op("uuid_ops")),
	foreignKey({
			columns: [table.recipeId],
			foreignColumns: [recipes.id],
			name: "recipe_ratings_recipe_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.userId],
			foreignColumns: [profiles.id],
			name: "recipe_ratings_user_id_fkey"
		}).onDelete("cascade"),
	primaryKey({ columns: [table.recipeId, table.userId], name: "recipe_ratings_pkey"}),
	pgPolicy("ratings update own", { as: "permissive", for: "update", to: ["public"], using: sql`(user_id = auth.uid())`, withCheck: sql`(user_id = auth.uid())`  }),
	pgPolicy("ratings write own", { as: "permissive", for: "insert", to: ["public"] }),
	pgPolicy("ratings read by household member", { as: "permissive", for: "select", to: ["public"] }),
	pgPolicy("ratings delete own", { as: "permissive", for: "delete", to: ["public"] }),
	check("recipe_ratings_rating_check", sql`(rating >= 1) AND (rating <= 5)`),
]);
