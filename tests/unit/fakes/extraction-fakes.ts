/**
 * Shared, type-safe test doubles for extractor-pipeline unit tests (Step 20).
 *
 * Each fake fully implements its repository/provider interface — no `as any` /
 * `as unknown as X` casts. Methods a given test does not exercise reject with a
 * clear "not implemented" error (typed `Promise<never>`, assignable to any
 * result type), so an accidental reliance on an un-stubbed method fails loudly
 * rather than silently returning undefined.
 */

import type {
  AiJsonCompletionRequest,
  AiProvider,
} from "../../../supabase/functions/terrestrial-brain-mcp/ai/ai-provider.ts";
import type {
  ProjectIdentity,
  ProjectRepository,
} from "../../../supabase/functions/terrestrial-brain-mcp/repositories/project-repository.ts";
import type {
  PersonIdentity,
  PersonRepository,
} from "../../../supabase/functions/terrestrial-brain-mcp/repositories/person-repository.ts";
import type {
  CreatedTask,
  TaskReferenceRow,
  TaskRepository,
} from "../../../supabase/functions/terrestrial-brain-mcp/repositories/task-repository.ts";
import type { RepoResult } from "../../../supabase/functions/terrestrial-brain-mcp/repositories/repo-result.ts";

function notImplemented(method: string): Promise<never> {
  return Promise.reject(
    new Error(`FakeRepository.${method} not implemented for this test`),
  );
}

function ok<Data>(data: Data): Promise<RepoResult<Data>> {
  return Promise.resolve({ data, error: null });
}

// ---------------------------------------------------------------------------
// Fake ProjectRepository — only `listActive` and `insert` are stubbed.
// ---------------------------------------------------------------------------

export class FakeProjectRepository implements ProjectRepository {
  inserted: ProjectIdentity[] = [];
  private nextId = 1;

  /**
   * Names for which `insert` simulates a unique-violation (23505) — the losing
   * side of a concurrent auto-create. `findByName` then returns the identity
   * seeded in `existingByName`, exercising the create-or-get recovery (EXTR-7).
   */
  collideOn = new Set<string>();
  existingByName = new Map<string, ProjectIdentity>();
  findByNameError: string | null = null;

  constructor(private readonly active: ProjectIdentity[] = []) {}

  listActive(): Promise<RepoResult<ProjectIdentity[]>> {
    return ok(this.active);
  }

  insert(values: { name: string }): Promise<RepoResult<ProjectIdentity>> {
    if (this.collideOn.has(values.name)) {
      return Promise.resolve({
        data: null,
        error: { message: "duplicate key value", code: "23505" },
      });
    }
    const identity = { id: `new-project-${this.nextId++}`, name: values.name };
    this.inserted.push(identity);
    return ok(identity);
  }

  findByName(name: string): Promise<RepoResult<ProjectIdentity | null>> {
    if (this.findByNameError) {
      return Promise.resolve({
        data: null,
        error: { message: this.findByNameError },
      });
    }
    return ok(this.existingByName.get(name) ?? null);
  }

  list() {
    return notImplemented("list");
  }
  findById() {
    return notImplemented("findById");
  }
  findName() {
    return notImplemented("findName");
  }
  listChildrenBasic() {
    return notImplemented("listChildrenBasic");
  }
  listChildParentIds() {
    return notImplemented("listChildParentIds");
  }
  listActiveChildIds() {
    return notImplemented("listActiveChildIds");
  }
  update() {
    return notImplemented("update");
  }
  archiveManyActive() {
    return notImplemented("archiveManyActive");
  }
}

// ---------------------------------------------------------------------------
// Fake PersonRepository — only `listActive` and `insert` are stubbed.
// ---------------------------------------------------------------------------

export class FakePersonRepository implements PersonRepository {
  inserted: PersonIdentity[] = [];
  private nextId = 1;

  /** Names whose `insert` simulates a unique-violation (23505); see EXTR-7. */
  collideOn = new Set<string>();
  existingByName = new Map<string, PersonIdentity>();
  findByNameError: string | null = null;

  constructor(private readonly active: PersonIdentity[] = []) {}

  listActive(): Promise<RepoResult<PersonIdentity[]>> {
    return ok(this.active);
  }

  insert(values: { name: string }): Promise<RepoResult<PersonIdentity>> {
    if (this.collideOn.has(values.name)) {
      return Promise.resolve({
        data: null,
        error: { message: "duplicate key value", code: "23505" },
      });
    }
    const identity = { id: `new-person-${this.nextId++}`, name: values.name };
    this.inserted.push(identity);
    return ok(identity);
  }

  findByName(name: string): Promise<RepoResult<PersonIdentity | null>> {
    if (this.findByNameError) {
      return Promise.resolve({
        data: null,
        error: { message: this.findByNameError },
      });
    }
    return ok(this.existingByName.get(name) ?? null);
  }

  list() {
    return notImplemented("list");
  }
  findById() {
    return notImplemented("findById");
  }
  findName() {
    return notImplemented("findName");
  }
  update() {
    return notImplemented("update");
  }
  archive() {
    return notImplemented("archive");
  }
}

// ---------------------------------------------------------------------------
// Fake TaskRepository — only `findByReference` and `insert` are stubbed.
// ---------------------------------------------------------------------------

export class FakeTaskRepository implements TaskRepository {
  inserted: CreatedTask[] = [];
  private nextId = 1;

  constructor(private readonly byReference: TaskReferenceRow[] = []) {}

  findByReference(): Promise<RepoResult<TaskReferenceRow[]>> {
    return ok(this.byReference);
  }

  insert(values: { content: string }): Promise<RepoResult<CreatedTask>> {
    const created = {
      id: `new-task-${this.nextId++}`,
      content: values.content,
    };
    this.inserted.push(created);
    return ok(created);
  }

  list() {
    return notImplemented("list");
  }
  listIncompleteUnarchived() {
    return notImplemented("listIncompleteUnarchived");
  }
  findByIds() {
    return notImplemented("findByIds");
  }
  update() {
    return notImplemented("update");
  }
  archive() {
    return notImplemented("archive");
  }
  archiveIfActive() {
    return notImplemented("archiveIfActive");
  }
  countOpenByProject() {
    return notImplemented("countOpenByProject");
  }
  countOpenByAssignee() {
    return notImplemented("countOpenByAssignee");
  }
  findOpenIdsByProjects() {
    return notImplemented("findOpenIdsByProjects");
  }
  archiveMany() {
    return notImplemented("archiveMany");
  }
  deleteByIds(_ids: string[]): Promise<RepoResult<void>> {
    return notImplemented("deleteByIds");
  }
}

// ---------------------------------------------------------------------------
// Fake AiProvider — feeds a canned raw value through the caller's own parse
// callback (so the extractor's validation still runs), keyed by the system
// prompt so a single provider can serve multiple extractors deterministically.
// ---------------------------------------------------------------------------

export class FakeAiProvider implements AiProvider {
  readonly requests: AiJsonCompletionRequest[] = [];

  /**
   * @param rawFor Returns the canned raw JSON value the model would have
   *   produced for a given request (matched however the test likes, e.g. by a
   *   substring of the system prompt). Return `undefined` to yield `{}`.
   */
  constructor(
    private readonly rawFor: (request: AiJsonCompletionRequest) => unknown,
  ) {}

  getEmbedding(): Promise<number[]> {
    return Promise.resolve([]);
  }

  completeJson<Parsed>(
    request: AiJsonCompletionRequest,
    parse: (raw: unknown) => Parsed,
  ): Promise<Parsed> {
    this.requests.push(request);
    const raw = this.rawFor(request);
    return Promise.resolve(parse(raw ?? {}));
  }
}
