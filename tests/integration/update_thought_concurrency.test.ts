import { assertEquals, assertExists } from "@std/assert";
import { createClient } from "@supabase/supabase-js";
import {
  SUPABASE_SERVICE_KEY,
  SUPABASE_URL,
  uniqueToken,
} from "../helpers/mcp-client.ts";
import { SupabaseThoughtRepository } from "../../supabase/functions/terrestrial-brain-mcp/repositories/supabase-thought-repository.ts";
import { FakeAiProvider } from "../../supabase/functions/terrestrial-brain-mcp/ai/fake-provider.ts";
import { hashContent } from "../../supabase/functions/terrestrial-brain-mcp/helpers.ts";

// Step 17 (update-thought-concurrency, TOOL-6) — integration: the REAL
// repository against the REAL local stack (no mocks on the path under test).
// Replicates the interleave deterministically: two writes from one read
// snapshot; the trigger-maintained updated_at etag must reject the second.

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
const thoughtRepository = new SupabaseThoughtRepository(supabase);
const aiProvider = new FakeAiProvider();

async function insertTestThought(): Promise<string> {
  const content = `concurrency etag probe ${uniqueToken()}`;
  const contentHash = await hashContent(content);
  const { error: insertError } = await thoughtRepository.insert({
    content,
    embedding: await aiProvider.getEmbedding(content),
    content_hash: contentHash,
    last_actor: "sync",
    metadata: { topics: ["test"], type: "observation" },
  });
  assertEquals(insertError, null);
  const { data: found, error: findError } = await thoughtRepository
    .findByContentHash(contentHash);
  assertEquals(findError, null);
  assertExists(found?.[0]?.id);
  return found![0].id;
}

Deno.test("update: a stale updated_at snapshot matches zero rows and preserves the first write", async () => {
  const id = await insertTestThought();

  // One read snapshot…
  const { data: snapshot, error: readError } = await thoughtRepository
    .findForUpdate(id);
  assertEquals(readError, null);
  assertExists(snapshot);
  const staleEtag = snapshot!.updated_at;

  // …first writer commits (trigger bumps updated_at)…
  const first = await thoughtRepository.update(
    id,
    { author: "writer-one" },
    { expectedUpdatedAt: staleEtag },
  );
  assertEquals(first.error, null);
  assertEquals(first.data, { id }, "the fresh-snapshot write must apply");

  // …second writer still holds the stale snapshot: must match nothing.
  const second = await thoughtRepository.update(
    id,
    { author: "writer-two" },
    { expectedUpdatedAt: staleEtag },
  );
  assertEquals(second.error, null);
  assertEquals(
    second.data,
    null,
    "a stale-snapshot write must match zero rows",
  );

  const { data: after } = await thoughtRepository.findForUpdate(id);
  assertEquals(
    after?.author,
    "writer-one",
    "the first writer's value must survive the stale write",
  );
});

Deno.test("update: re-reading after a concurrent-edit rejection succeeds", async () => {
  const id = await insertTestThought();

  const { data: firstRead } = await thoughtRepository.findForUpdate(id);
  assertExists(firstRead);
  await thoughtRepository.update(
    id,
    { author: "writer-one" },
    { expectedUpdatedAt: firstRead!.updated_at },
  );

  // Fresh re-read picks up the new etag; the retry applies.
  const { data: secondRead } = await thoughtRepository.findForUpdate(id);
  assertExists(secondRead);
  const retry = await thoughtRepository.update(
    id,
    { author: "writer-two" },
    { expectedUpdatedAt: secondRead!.updated_at },
  );
  assertEquals(retry.error, null);
  assertEquals(retry.data, { id });

  const { data: after } = await thoughtRepository.findForUpdate(id);
  assertEquals(after?.author, "writer-two");
});
