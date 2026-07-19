import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "./database.types.ts";

/**
 * The Supabase client typed against the generated `Database` schema (Step 24,
 * finding 6.1). Every seam that holds a client — the composition root, the
 * repositories, and the tool `register` functions — uses this alias so row
 * shapes are inferred from the schema instead of hand-retyped.
 */
export type AppSupabaseClient = SupabaseClient<Database>;

/** A public-schema table name. */
export type TableName = keyof Database["public"]["Tables"];

/**
 * The full generated Row type for a table — the single source of truth for
 * row shapes (Step 24). Repository row DTOs derive projections from this via
 * `Pick`, so they can no longer drift from the schema.
 */
export type Row<Table extends TableName> =
  Database["public"]["Tables"][Table]["Row"];

/** The generated Insert type for a table. */
export type InsertRow<Table extends TableName> =
  Database["public"]["Tables"][Table]["Insert"];

/**
 * The generated Update type for a table (all columns optional). Repository
 * update payloads derive from this so a misspelled column in an update is a
 * compile error instead of a silent no-op (REPO-4).
 */
export type UpdateRow<Table extends TableName> =
  Database["public"]["Tables"][Table]["Update"];
