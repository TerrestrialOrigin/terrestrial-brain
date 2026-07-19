/**
 * SupabasePersonRepository — the sole implementation of `PersonRepository`
 * (fix-plan Step 17). Every `people` table query formerly inline in
 * `tools/people.ts` / `extractors/people-extractor.ts` lives here. Each method
 * delegates its await-then-wrap to the shared `runQuery` / `runWrite` helpers
 * (REPO-3).
 */

import type { AppSupabaseClient } from "../supabase-client.ts";
import { LIST_ACTIVE_HARD_CAP } from "../constants.ts";
import { type RepoResult, runQuery, runWrite } from "./repo-result.ts";
import type {
  NewPersonValues,
  PersonFullRow,
  PersonIdentity,
  PersonListFilters,
  PersonListRow,
  PersonRepository,
  PersonUpdate,
} from "./person-repository.ts";

export class SupabasePersonRepository implements PersonRepository {
  constructor(private readonly supabase: AppSupabaseClient) {}

  insert(values: NewPersonValues): Promise<RepoResult<PersonIdentity>> {
    return runQuery(
      this.supabase
        .from("people")
        .insert(values)
        .select("id, name")
        .single(),
    );
  }

  findByName(name: string): Promise<RepoResult<PersonIdentity | null>> {
    // `people.name` is globally unique (exact), so a 23505-losing racer recovers
    // the winning row by exact name. `maybeSingle` maps a clean miss to null.
    return runQuery(
      this.supabase
        .from("people")
        .select("id, name")
        .eq("name", name)
        .maybeSingle(),
    );
  }

  list(filters: PersonListFilters): Promise<RepoResult<PersonListRow[]>> {
    let query = this.supabase
      .from("people")
      .select("id, name, type, email, description, archived_at, created_at")
      .order("name");

    if (!filters.includeArchived) query = query.is("archived_at", null);
    if (filters.type) query = query.eq("type", filters.type);
    // Fetch one extra so the handler distinguishes "exactly at the cap" from
    // "more exist" and reports truncation (never a silent fetch-all).
    query = query.limit(filters.limit + 1);

    return runQuery(query);
  }

  findById(id: string): Promise<RepoResult<PersonFullRow>> {
    return runQuery(
      this.supabase
        .from("people")
        .select("*")
        .eq("id", id)
        .single(),
    );
  }

  findName(id: string): Promise<RepoResult<{ name: string }>> {
    return runQuery(
      this.supabase
        .from("people")
        .select("name")
        .eq("id", id)
        .single(),
    );
  }

  update(
    id: string,
    updates: PersonUpdate,
  ): Promise<RepoResult<{ id: string }>> {
    return runQuery(
      this.supabase
        .from("people")
        .update(updates)
        .eq("id", id)
        .select("id")
        .maybeSingle(),
    );
  }

  archive(id: string): Promise<RepoResult<void>> {
    // Claim-style: skip already-archived rows so a retried archive preserves
    // the original `archived_at`.
    return runWrite(
      this.supabase
        .from("people")
        .update({ archived_at: new Date().toISOString() })
        .eq("id", id)
        .is("archived_at", null),
    );
  }

  async listActive(): Promise<RepoResult<PersonIdentity[]>> {
    const result = await runQuery(
      this.supabase
        .from("people")
        .select("id, name")
        .is("archived_at", null)
        // Whole-set seed for the extractor, but explicitly bounded — a silent
        // full scan is not allowed. Truncation past the cap is logged.
        .limit(LIST_ACTIVE_HARD_CAP),
    );
    if (result.data && result.data.length === LIST_ACTIVE_HARD_CAP) {
      console.warn(
        `listActive(people) hit the ${LIST_ACTIVE_HARD_CAP}-row cap — extractor seed may be truncated`,
      );
    }
    return result;
  }
}
