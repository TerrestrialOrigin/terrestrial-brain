// TOOL-14 — the extractor set is a composition-root seam: handlers receive it
// through their deps object instead of constructing `createDefaultExtractors()`
// inline. This test proves the seam by driving the real `handleIngestNote`
// with a FAKE extractor set — no real extractor (and no LLM/DB) runs.

import { assert, assertEquals } from "@std/assert";
import { handleIngestNote } from "../../supabase/functions/terrestrial-brain-mcp/tools/thoughts.ts";
import type {
  ExtractionContext,
  Extractor,
} from "../../supabase/functions/terrestrial-brain-mcp/extractors/pipeline.ts";
import type { ParsedNote } from "../../supabase/functions/terrestrial-brain-mcp/parser.ts";
import { FakeAiProvider } from "../../supabase/functions/terrestrial-brain-mcp/ai/fake-provider.ts";
import {
  fakeNoteSnapshotRepository,
  fakePersonRepository,
  fakeProjectRepository,
  fakeTaskRepository,
  fakeThoughtRepository,
} from "./fakes/repository-fakes.ts";

Deno.test("handleIngestNote runs the injected fake extractor set, not the default factory", async () => {
  const extractorRuns: string[] = [];
  const fakeExtractor: Extractor = {
    referenceKey: "tasks",
    extract(_note: ParsedNote, _context: ExtractionContext) {
      extractorRuns.push("fake-extractor");
      return Promise.resolve({
        referenceKey: "tasks",
        ids: ["11111111-1111-4111-9111-111111111111"],
      });
    },
  };

  const inserted: unknown[] = [];
  const result = await handleIngestNote(
    {
      aiProvider: new FakeAiProvider(),
      thoughtRepository: fakeThoughtRepository({
        findByReference: () => Promise.resolve({ data: [], error: null }),
        insert: (row) => {
          inserted.push(row);
          return Promise.resolve({ data: undefined, error: null });
        },
      }),
      taskRepository: fakeTaskRepository({
        findByReference: () => Promise.resolve({ data: [], error: null }),
      }),
      projectRepository: fakeProjectRepository({
        listActive: () => Promise.resolve({ data: [], error: null }),
      }),
      personRepository: fakePersonRepository({
        listActive: () => Promise.resolve({ data: [], error: null }),
      }),
      noteSnapshotRepository: fakeNoteSnapshotRepository({
        findContentByReference: () =>
          Promise.resolve({ data: null, error: null }),
        upsert: () =>
          Promise.resolve({ data: { id: "snapshot-1" }, error: null }),
      }),
      extractors: [fakeExtractor],
      timeZone: "UTC",
    },
    {
      content: "- [ ] a task the fake extractor sees",
      title: "Injection test",
      note_id: "notes/injection-test.md",
    },
  );

  assertEquals(extractorRuns, ["fake-extractor"]);
  assert(result.success, `expected success, got: ${JSON.stringify(result)}`);
  assert(inserted.length > 0, "the ingest should insert at least one thought");
});
