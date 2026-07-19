## ADDED Requirements

### Requirement: Multi-dependency functions SHALL take typed deps objects

`freshIngest`, every tool `register*` function, and `handleIngestNote` SHALL receive their dependencies through a typed deps object (a shared `ToolDeps` interface narrowed per consumer with `Pick`) rather than positional parameters. No function on these paths SHALL take four or more positional parameters. `freshIngest` SHALL additionally be decomposed into named phase functions (splitting content into thoughts, per-thought ingestion, summary assembly) with the top level acting as orchestration.

#### Scenario: Register functions take a deps object

- **WHEN** `createMcpServer` wires the tool modules
- **THEN** each `register*` call passes `(server, deps)` where `deps` is a named-field object, and transposing two repositories is a compile-time error because the fields are named

#### Scenario: freshIngest takes deps and input objects

- **WHEN** `freshIngest` is called
- **THEN** its signature is `(deps, input)` with named fields for content, title, noteId, noteSnapshotId, references, and provenance — no adjacent same-typed optional positionals

### Requirement: The extractor set SHALL be wired at the composition root

The default extractor array SHALL be constructed exactly once at the composition root (`index.ts`) and injected into the tool handlers through the deps object. Tool handlers SHALL NOT call `createDefaultExtractors()` inline, so a unit test can substitute a fake extractor set.

#### Scenario: No inline extractor construction in handlers

- **WHEN** `tools/thoughts.ts` and `tools/documents.ts` are searched for `createDefaultExtractors(`
- **THEN** no call sites remain — the handlers use the injected `deps.extractors`

#### Scenario: A fake extractor set is injectable

- **WHEN** a unit test registers `capture_thought` with a deps object whose `extractors` field is a fake
- **THEN** the handler runs the fake extractor without touching the real extractor factory

### Requirement: Task lines SHALL be rendered by one shared renderer

All task-line output (in `get_tasks`, `list_tasks`-family rendering, and the project-summary open-task lines) SHALL flow through the shared `renderTaskLine` helper, extended with optional parent-name and archived-date support, with the status icon and due-date rendering exported as `taskStatusIcon` and `formatDueDate`. The due-date renderer SHALL NOT mark a `done` task as overdue. Rendered output for existing fixtures SHALL be byte-identical to the pre-refactor output.

#### Scenario: get_tasks uses the shared renderer

- **WHEN** `get_tasks` renders a task with a parent and an archived date
- **THEN** the line comes from `renderTaskLine` plus the genuinely-extra fields, and is byte-identical to the pre-refactor output for the same fixture

#### Scenario: Done tasks are never rendered overdue

- **WHEN** `formatDueDate` is called for a task whose `status` is `done` and whose `due_by` is in the past
- **THEN** the output contains no OVERDUE marker

### Requirement: Thought rendering SHALL be composed from pure extracted formatters

The project-refs collection preamble, the provenance block, and the topics/people/actions metadata lines SHALL each exist once as pure module-level formatters (`collectProjectRefs`, `formatProvenance`, `formatThoughtMetadataLines`) composed into per-tool result formatters. The registered `search_thoughts`, `list_thoughts`, and `get_thought_by_id` handlers SHALL reduce to query → error/empty envelope → name resolution → logged touch → formatted result, with output byte-identical to the pre-refactor text.

#### Scenario: Formatters are pure and shared

- **WHEN** the thought formatters are called with fixture rows and a synthetic name map
- **THEN** they return the exact pre-refactor text without any I/O, and `search_thoughts`/`list_thoughts` no longer contain verbatim-duplicated formatting blocks

#### Scenario: Refactored handlers preserve integration output

- **WHEN** the existing integration suite runs after the extraction
- **THEN** every string assertion against search/list/get-thought output passes unchanged
