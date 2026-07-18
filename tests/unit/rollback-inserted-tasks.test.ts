import { assertEquals } from "@std/assert";
import { rollbackInsertedTasks } from "../../supabase/functions/terrestrial-brain-mcp/tools/ai_output.ts";
import { FakeTaskRepository } from "./fakes/extraction-fakes.ts";
import type { RepoResult } from "../../supabase/functions/terrestrial-brain-mcp/repositories/repo-result.ts";

// Step 15 (TOOL-3) — the shared rollback-and-report helper. A fake repository
// exercises both branches. GATE 2b: if the helper stops checking the delete's
// error channel, the "warns, not rolled back" assertion reddens.

class RollbackTaskRepo extends FakeTaskRepository {
  deletedIds: string[] | null = null;
  constructor(private readonly deleteResult: RepoResult<void>) {
    super();
  }
  override deleteByIds(ids: string[]): Promise<RepoResult<void>> {
    this.deletedIds = ids;
    return Promise.resolve(this.deleteResult);
  }
}

Deno.test("rollbackInsertedTasks: successful delete reports a clean roll back", async () => {
  const repo = new RollbackTaskRepo({ data: null, error: null });

  const note = await rollbackInsertedTasks(repo, ["t1", "t2"]);

  assertEquals(repo.deletedIds, ["t1", "t2"]);
  assertEquals(note.includes("Rolled back 2 already-inserted task(s)"), true);
  assertEquals(note.includes("WARNING"), false);
});

Deno.test("rollbackInsertedTasks: failed delete warns about orphans, does not claim rollback", async () => {
  const repo = new RollbackTaskRepo({
    data: null,
    error: { message: "delete blew up" },
  });

  const note = await rollbackInsertedTasks(repo, ["t1", "t2"]);

  assertEquals(note.includes("WARNING"), true);
  assertEquals(note.includes("may be orphaned"), true);
  assertEquals(note.includes("t1, t2"), true);
  assertEquals(note.includes("delete blew up"), true);
  assertEquals(
    note.includes("Rolled back"),
    false,
    "a failed rollback must NOT claim the rows were rolled back",
  );
});

Deno.test("rollbackInsertedTasks: no ids returns an empty note and deletes nothing", async () => {
  const repo = new RollbackTaskRepo({ data: null, error: null });

  const note = await rollbackInsertedTasks(repo, []);

  assertEquals(note, "");
  assertEquals(repo.deletedIds, null);
});
