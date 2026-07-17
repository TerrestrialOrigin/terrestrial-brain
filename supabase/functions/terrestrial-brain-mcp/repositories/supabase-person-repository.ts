/**
 * SupabasePersonRepository — the sole implementation of `PersonRepository`
 * (fix-plan Step 17). Every `people` table query formerly inline in
 * `tools/people.ts` / `extractors/people-extractor.ts` lives here.
 */

import type { AppSupabaseClient } from "../supabase-client.ts";
import { type RepoResult, toRepoError } from "./repo-result.ts";
import type {
  NewPersonValues,
  PersonFullRow,
  PersonIdentity,
  PersonListFilters,
  PersonListRow,
  PersonRepository,
} from "./person-repository.ts";

export class SupabasePersonRepository implements PersonRepository {
  constructor(private readonly supabase: AppSupabaseClient) {}

  async insert(values: NewPersonValues): Promise<RepoResult<PersonIdentity>> {
    const { data, error } = await this.supabase
      .from("people")
      .insert(values)
      .select("id, name")
      .single();
    return { data, error: toRepoError(error) };
  }

  async findByName(name: string): Promise<RepoResult<PersonIdentity | null>> {
    // `people.name` is globally unique (exact), so a 23505-losing racer recovers
    // the winning row by exact name. `maybeSingle` maps a clean miss to null.
    const { data, error } = await this.supabase
      .from("people")
      .select("id, name")
      .eq("name", name)
      .maybeSingle();
    return { data, error: toRepoError(error) };
  }

  async list(filters: PersonListFilters): Promise<RepoResult<PersonListRow[]>> {
    let query = this.supabase
      .from("people")
      .select("id, name, type, email, description, archived_at, created_at")
      .order("name");

    if (!filters.includeArchived) query = query.is("archived_at", null);
    if (filters.type) query = query.eq("type", filters.type);

    const { data, error } = await query;
    return { data, error: toRepoError(error) };
  }

  async findById(id: string): Promise<RepoResult<PersonFullRow>> {
    const { data, error } = await this.supabase
      .from("people")
      .select("*")
      .eq("id", id)
      .single();
    return { data, error: toRepoError(error) };
  }

  async findName(id: string): Promise<RepoResult<{ name: string }>> {
    const { data, error } = await this.supabase
      .from("people")
      .select("name")
      .eq("id", id)
      .single();
    return { data, error: toRepoError(error) };
  }

  async update(
    id: string,
    updates: Record<string, unknown>,
  ): Promise<RepoResult<{ id: string }>> {
    const { data, error } = await this.supabase
      .from("people")
      .update(updates)
      .eq("id", id)
      .select("id")
      .maybeSingle();
    return { data, error: toRepoError(error) };
  }

  async archive(id: string): Promise<RepoResult<void>> {
    const { error } = await this.supabase
      .from("people")
      .update({ archived_at: new Date().toISOString() })
      .eq("id", id);
    return { data: null, error: toRepoError(error) };
  }

  async listActive(): Promise<RepoResult<PersonIdentity[]>> {
    const { data, error } = await this.supabase
      .from("people")
      .select("id, name")
      .is("archived_at", null);
    return { data, error: toRepoError(error) };
  }
}
