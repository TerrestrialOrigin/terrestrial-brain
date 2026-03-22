/**
 * Extractor pipeline framework.
 *
 * Defines the Extractor interface, ExtractionContext, and the pipeline
 * runner that orchestrates sequential extraction from parsed notes.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { ParsedNote } from "../parser.ts";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ExtractionContext {
  supabase: SupabaseClient;
  knownProjects: { id: string; name: string }[];
  knownTasks: { id: string; content: string; reference_id: string | null }[];
  newlyCreatedProjects: { id: string; name: string }[];
  newlyCreatedTasks: { id: string; content: string }[];
}

export interface ExtractionResult {
  referenceKey: string;
  ids: string[];
}

export interface Extractor {
  readonly referenceKey: string;
  extract(
    note: ParsedNote,
    context: ExtractionContext,
  ): Promise<ExtractionResult>;
}

// ---------------------------------------------------------------------------
// Pipeline runner
// ---------------------------------------------------------------------------

/**
 * Runs extractors sequentially against a parsed note, collecting results
 * into a reference map. Each extractor may enrich the shared context for
 * downstream extractors.
 */
export async function runExtractionPipeline(
  note: ParsedNote,
  extractors: Extractor[],
  supabase: SupabaseClient,
): Promise<Record<string, string[]>> {
  // Initialize context — fetch known projects from DB
  const { data: activeProjects } = await supabase
    .from("projects")
    .select("id, name")
    .is("archived_at", null);

  const context: ExtractionContext = {
    supabase,
    knownProjects: (activeProjects || []).map(
      (project: { id: string; name: string }) => ({
        id: project.id,
        name: project.name,
      }),
    ),
    knownTasks: [],
    newlyCreatedProjects: [],
    newlyCreatedTasks: [],
  };

  // Run each extractor sequentially, collecting results
  const references: Record<string, string[]> = {};

  for (const extractor of extractors) {
    const result = await extractor.extract(note, context);
    references[result.referenceKey] = result.ids;
  }

  return references;
}
