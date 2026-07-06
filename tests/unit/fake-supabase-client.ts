import type { SupabaseClient } from "@supabase/supabase-js";

// Shared fake Supabase client for repository unit tests (fix-plan Step 16).
// Records the query chain a repository builds and resolves a canned result, so
// the repositories can be exercised with no database. NOT a *.test.ts file, so
// `deno test` imports it without treating it as a test.

export interface FakeClientResult {
  data?: unknown;
  error?: { message: string; code?: string } | null;
  count?: number | null;
}

export interface RecordedFilter {
  method: string;
  column: string;
  value: unknown;
}

export interface RecordedQuery {
  table?: string;
  rpcName?: string;
  rpcParams?: Record<string, unknown>;
  op?: "select" | "insert" | "update" | "upsert" | "delete";
  columns?: string;
  selectOptions?: { count?: string; head?: boolean };
  payload?: Record<string, unknown>;
  onConflict?: string;
  filters: RecordedFilter[];
  single: boolean;
  order?: { column: string; ascending?: boolean };
  limit?: number;
}

interface FakeBuilder {
  select(
    columns: string,
    options?: { count?: string; head?: boolean },
  ): FakeBuilder;
  insert(payload: Record<string, unknown>): FakeBuilder;
  update(payload: Record<string, unknown>): FakeBuilder;
  upsert(
    payload: Record<string, unknown>,
    options?: { onConflict?: string },
  ): FakeBuilder;
  delete(): FakeBuilder;
  order(column: string, options?: { ascending?: boolean }): FakeBuilder;
  limit(count: number): FakeBuilder;
  eq(column: string, value: unknown): FakeBuilder;
  neq(column: string, value: unknown): FakeBuilder;
  is(column: string, value: unknown): FakeBuilder;
  lt(column: string, value: unknown): FakeBuilder;
  gte(column: string, value: unknown): FakeBuilder;
  in(column: string, value: unknown): FakeBuilder;
  ilike(column: string, value: unknown): FakeBuilder;
  contains(column: string, value: unknown): FakeBuilder;
  returns(): FakeBuilder;
  single(): FakeBuilder;
  maybeSingle(): FakeBuilder;
  then(resolve: (value: FakeClientResult) => void): void;
}

export function makeFakeClient(
  result: FakeClientResult,
): { client: SupabaseClient; recorded: RecordedQuery } {
  const recorded: RecordedQuery = { filters: [], single: false };
  const resolved: FakeClientResult = {
    data: result.data ?? null,
    error: result.error ?? null,
    count: result.count ?? null,
  };

  const pushFilter = (method: string, column: string, value: unknown) => {
    recorded.filters.push({ method, column, value });
    return builder;
  };

  const builder: FakeBuilder = {
    select(columns, options) {
      recorded.op = recorded.op ?? "select";
      recorded.columns = columns;
      if (options) recorded.selectOptions = options;
      return builder;
    },
    insert(payload) {
      recorded.op = "insert";
      recorded.payload = payload;
      return builder;
    },
    update(payload) {
      recorded.op = "update";
      recorded.payload = payload;
      return builder;
    },
    upsert(payload, options) {
      recorded.op = "upsert";
      recorded.payload = payload;
      if (options?.onConflict) recorded.onConflict = options.onConflict;
      return builder;
    },
    delete() {
      recorded.op = "delete";
      return builder;
    },
    order(column, options) {
      recorded.order = { column, ascending: options?.ascending };
      return builder;
    },
    limit(count) {
      recorded.limit = count;
      return builder;
    },
    eq: (column, value) => pushFilter("eq", column, value),
    neq: (column, value) => pushFilter("neq", column, value),
    is: (column, value) => pushFilter("is", column, value),
    lt: (column, value) => pushFilter("lt", column, value),
    gte: (column, value) => pushFilter("gte", column, value),
    in: (column, value) => pushFilter("in", column, value),
    ilike: (column, value) => pushFilter("ilike", column, value),
    contains: (column, value) => pushFilter("contains", column, value),
    returns() {
      return builder;
    },
    single() {
      recorded.single = true;
      return builder;
    },
    maybeSingle() {
      recorded.single = true;
      return builder;
    },
    then(resolve) {
      resolve(resolved);
    },
  };

  const client = {
    from(table: string) {
      recorded.table = table;
      return builder;
    },
    rpc(name: string, params: Record<string, unknown>) {
      recorded.rpcName = name;
      recorded.rpcParams = params;
      return {
        then(resolve: (value: FakeClientResult) => void) {
          resolve(resolved);
        },
      };
    },
  };

  return { client: client as unknown as SupabaseClient, recorded };
}
