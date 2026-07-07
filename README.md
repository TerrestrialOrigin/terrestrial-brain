# Terrestrial Brain

The project is inspired by and is an extension of "Open Brain" by Nate B Johnes (Seriously, subscribe to his youtube channel. He makes AWESOME content!)

>[!DANGER]
> The supabase connection string with the key gets stored in your plugin data uncencrypted!!! This means that if you install a malicous plugin and it scans your obsidian folder to steal data it will be able to connect to the supabase database and read all data. There will be an enhancement later to take care of this, but for now that's a known vulnerability.

An AI-powered second brain that bridges [Obsidian](https://obsidian.md) with a cloud backend on [Supabase](https://supabase.com). Notes you write in Obsidian are automatically ingested, split into atomic thoughts, enriched with AI-extracted metadata (people, projects, tasks, topics), and embedded as vectors for semantic search. AI agents interact with your knowledge base through an [MCP](https://modelcontextprotocol.io/) (Model Context Protocol) server and can deliver insights, summaries, and analyses back into your vault for review.

## How It Works

```
Obsidian Vault
  |  (auto-sync after configurable delay)
  v
Obsidian Plugin ----> Supabase Edge Function (MCP Server)
                          |
                          |---> Split note into atomic thoughts (LLM)
                          |---> Extract metadata: people, topics, action items (LLM)
                          |---> Generate vector embeddings (OpenRouter)
                          |---> Detect and link projects, tasks, people
                          |---> Store in PostgreSQL + pgvector
                          v
                      Supabase Database
                          ^
                          |
AI Agents (Claude, etc.) -+---> Search thoughts semantically
  via MCP tools               |---> Analyze patterns, create insights
                               |---> Submit AI output for human review
                               v
                      Plugin polls for AI output
                          |
                          v
                      Obsidian Vault (AI-generated files appear for review)
```

## Features

- **Automatic note ingestion** -- Edit a note in Obsidian and it syncs to your brain after a configurable delay (default 5 min). Hash-based dedup prevents redundant syncs.
- **Semantic search** -- All thoughts are embedded with `text-embedding-3-small` via OpenRouter. Search by meaning, not just keywords. Filter by author model and reliability level.
- **AI extraction pipeline** -- LLM-powered extractors automatically detect projects, tasks, and people mentioned in your notes and create/link database records.
- **Document storage** -- Store and manage long-form reference documents (research, specs, briefs) linked to projects. Documents are automatically scanned for people and task references.
- **Provenance tracking** -- Every thought records which AI model authored it and a reliability classification (`reliable` / `less reliable`), so you can filter your knowledge base by trust level.
- **Usefulness scoring** -- AI agents can mark thoughts they found helpful, incrementing a `usefulness_score`. Over time this surfaces the most valuable knowledge.
- **Archiving** -- Soft-delete support across projects, tasks, and people. Archiving a project cascades to its children and their open tasks. Archived records are hidden by default but remain queryable.
- **Composite queries** -- Single-call summaries like `get_project_summary` (project details, child projects, open tasks, recent thoughts, source notes) and `get_recent_activity` (cross-table activity feed with configurable lookback).
- **AI output workflow** -- AI agents can submit content (summaries, analyses, plans) to an `ai_output` table. The plugin polls for pending output, presents it for human review (accept/reject/postpone), and writes accepted content back into your vault. Batch task creation with auto-generated markdown checklists is also supported.
- **Function call logging** -- Every MCP tool call and HTTP endpoint invocation is logged with input, response size, record count, errors, and caller IP address for a complete audit trail. Logged input is capped in size, and rows are purged automatically after a retention window (see [Data privacy, retention & erasure](#data-privacy-retention--erasure)).
- **Note erasure (GDPR)** -- Deleting a note in your vault erases its backend data (the note snapshot and every thought derived from it); a "Forget this note in Terrestrial Brain" command does the same on demand without deleting the vault file.
- **MCP server** -- 31 tools exposed via the Model Context Protocol, accessible to any MCP-compatible AI agent (Claude Desktop, Claude Code, custom agents).
- **Security model** -- A single shared secret (`MCP_ACCESS_KEY`) enforced at the edge function is the system's security boundary; send it via the `x-brain-key` request header (the `?key=` query parameter still works but is deprecated). The edge function talks to the database with the service-role key; Row-Level Security's role is to lock the public anon key out of all data entirely. See [ThreatModel.md](ThreatModel.md) for the full analysis.

## Data privacy, retention & erasure

**What leaves your vault.** When a note syncs, its **content** and **title** are sent to the backend over HTTPS. Nothing else about the note leaves the vault. Notes tagged with the exclude tag (default `terrestrialBrainExclude`) are never synced.

**Where it is stored.** Synced content is stored as a row in `note_snapshots`, and the AI extraction pipeline derives rows in `thoughts` (and may create/link `projects`, `tasks`, and `people`). Every backend request is recorded in `function_call_logs` (function name, serialized input, caller IP, timestamp, errors) as an audit trail.

**How to erase it.** Deleting a note in your vault erases that note's backend footprint — its `note_snapshots` row and every `thought` derived from it are **permanently deleted** (a deliberate hard-delete for the right to erasure, unlike the soft-archive used elsewhere). The **"Forget this note in Terrestrial Brain"** command does the same for the active note without deleting the vault file. Erasure is scoped to the note's snapshot and thoughts; shared `projects`/`tasks`/`people` that a note contributed to are not removed automatically (delete those explicitly via their own tools if needed).

**Log retention.** `function_call_logs` rows are purged automatically after a retention window (default **90 days**) by the `purge_function_call_logs(retention_days)` SQL function, scheduled daily via `pg_cron` where available. Set `TB_LOG_RETENTION_DAYS` to document a different policy, and re-schedule the job with the new window on production. Serialized log input is capped at 10,000 characters so a single log row cannot accumulate unbounded note content.

## Project Structure

```
terrestrial-brain/
├── obsidian-plugin/              # Obsidian plugin (TypeScript/esbuild)
│   ├── src/main.ts               #   Plugin entry point
│   ├── src/main.test.ts          #   Plugin tests (Vitest)
│   ├── manifest.json             #   Obsidian plugin metadata
│   ├── versions.json             #   Plugin version → minimum Obsidian version map
│   ├── styles.css                #   Modal styling (theme-overridable)
│   └── package.json              #   Node dependencies & scripts
├── supabase/                     # Supabase backend
│   ├── config.toml               #   Local dev configuration
│   ├── seed.sql                  #   Seed data for local development
│   ├── migrations/               #   Database migrations (PostgreSQL, 22 files)
│   └── functions/                #   Supabase Edge Functions (Deno)
│       └── terrestrial-brain-mcp/    # Main MCP server
│           ├── index.ts              #   Hono + MCP server entry
│           ├── helpers.ts            #   OpenRouter API calls
│           ├── parser.ts             #   Markdown structural parser
│           ├── validators.ts         #   Zod schemas
│           ├── logger.ts             #   Function call audit logging
│           ├── extractors/           #   LLM-based content extractors
│           │   ├── pipeline.ts       #     Orchestrates all extractors
│           │   ├── project-extractor.ts
│           │   ├── task-extractor.ts
│           │   └── people-extractor.ts
│           └── tools/                #   MCP tool implementations
│               ├── thoughts.ts       #     search, list, capture, stats, usefulness
│               ├── projects.ts       #     CRUD + archive for projects
│               ├── tasks.ts          #     CRUD + archive for tasks
│               ├── people.ts         #     CRUD + archive for people
│               ├── documents.ts      #     Long-form document storage
│               ├── ai_output.ts      #     AI output + batch task creation
│               └── queries.ts        #     Cross-table composite queries
├── tests/                        # Node.js integration tests (Vitest)
│   └── integration/
├── test-vault/                   # Sample Obsidian vault for development
├── docs/                         # Deployment & operations docs
│   ├── fresh-install.md          #   Cloud deployment from scratch
│   └── upgrade.md                #   Deploying updates without data loss
└── openspec/                     # Feature specs & change management
    ├── specs/                    #   Source-of-truth specifications
    └── changes/                  #   In-flight and archived changes
```

## Technology Stack

| Layer | Technology |
|---|---|
| Note-taking | Obsidian |
| Plugin | TypeScript, esbuild, Vitest |
| Backend | Supabase (PostgreSQL 17, Edge Functions, RLS) |
| Edge runtime | Deno 2, Hono, MCP SDK |
| AI / LLM | OpenRouter (GPT-4o-mini for extraction, text-embedding-3-small for embeddings) |
| Vector search | pgvector (HNSW index, 1536-dimension embeddings) |
| Validation | Zod |
| Protocol | MCP (Model Context Protocol) v2.0 over HTTP/SSE |

## Database Schema

| Table | Purpose |
|---|---|
| `thoughts` | Atomic ideas/notes with vector embeddings, JSONB metadata, provenance (author/reliability), usefulness scoring, and soft-delete archiving |
| `projects` | Project groupings (client/personal/research/internal), with hierarchy via `parent_id` and soft-delete archiving |
| `tasks` | Action items linked to projects and people, with status tracking (open/in_progress/done/deferred) and subtask hierarchy |
| `people` | Human and AI entities referenced in notes, with soft-delete archiving |
| `documents` | Long-form reference documents (research, specs, briefs) linked to projects, with extracted people/task references |
| `note_snapshots` | Version history of ingested notes with source tracking |
| `ai_output` | AI-generated content awaiting human review (accept/reject/postpone) with pickup and archival workflow |
| `function_call_logs` | Audit trail for all MCP tool calls and HTTP endpoint invocations, tracking input, response size, errors, and caller IP |

---

## Setup Guide

### Prerequisites

- [Node.js](https://nodejs.org/) (v18+)
- [Supabase CLI](https://supabase.com/docs/guides/cli/getting-started) (`npm install -g supabase`)
- [Git](https://git-scm.com/)
- An [Obsidian](https://obsidian.md) vault

### Step 1: Clone the Repository

```bash
git clone https://github.com/TerrestrialOrigin/terrestrial-brain.git
cd terrestrial-brain
```

### Step 2: Create an OpenRouter Account

[OpenRouter](https://openrouter.ai) provides access to AI models (GPT-4o-mini for metadata extraction, text-embedding-3-small for vector embeddings). Terrestrial Brain uses OpenRouter as its LLM provider.

1. Go to [https://openrouter.ai](https://openrouter.ai) and click **Sign Up**.
2. Create an account (email or OAuth).
3. After signing in, go to [https://openrouter.ai/settings/credits](https://openrouter.ai/settings/credits).
4. Click **Add Credits** and load your account with money. $5-10 is a reasonable starting amount -- the models used (GPT-4o-mini and text-embedding-3-small) are inexpensive.
5. Go to [https://openrouter.ai/settings/keys](https://openrouter.ai/settings/keys).
6. Click **Create Key**, give it a name (e.g. "Terrestrial Brain"), and copy the key. It starts with `sk-or-v1-...`.
7. Save this key somewhere safe -- you will need it in Step 5.

### Step 3: Create a Supabase Account and Project

1. Go to [https://supabase.com](https://supabase.com) and click **Start your project**.
2. Sign up with GitHub or email.
3. Once logged in, click **New project**.
4. Fill in:
   - **Project name**: e.g. `terrestrial-brain`
   - **Database password**: Choose a strong password and save it -- you'll need it to link the CLI.
   - **Region**: Pick the region closest to you.
   - **Pricing plan**: The free tier works to start.
5. Wait for the project to finish provisioning (takes about 1 minute).
6. Note your **project ref** -- this is the subdomain of your Supabase URL. For example, if your project URL is `https://abcdefgh.supabase.co`, your project ref is `abcdefgh`. You can find it in **Project Settings > General**.

### Step 4: Enable the pgvector Extension

Terrestrial Brain uses vector embeddings for semantic search. You need to enable the `vector` extension in your Supabase database.

1. In the Supabase dashboard, go to **Database > Extensions**.
2. Search for `vector`.
3. Toggle it **on** (enable it).

### Step 5: Deploy the Backend

From the root of the cloned repository:

#### 5a. Link your local project to the remote Supabase instance

```bash
npx supabase link --project-ref <your-project-ref>
```

You'll be prompted for the database password you set in Step 3.

#### 5b. Push all database migrations

This creates all tables, indexes, RLS policies, and functions in your remote database.

```bash
npx supabase db push --linked
```

> **Note:** This does NOT run `seed.sql`. Seed data is for local development only.

#### 5c. Set remote secrets

Generate a strong random string for your MCP access key (this authenticates clients calling your MCP server):

```bash
# Generate a random access key (or use any strong random string)
openssl rand -hex 32
```

Now set the secrets on your Supabase project:

```bash
npx supabase secrets set \
  MCP_ACCESS_KEY=<your-generated-access-key> \
  OPENROUTER_API_KEY=<your-openrouter-api-key-from-step-2> \
  --project-ref <your-project-ref>
```

#### 5d. Deploy edge functions

```bash
npx supabase functions deploy terrestrial-brain-mcp --project-ref <your-project-ref>
```

#### 5e. Verify the deployment

Test that your MCP server is responding:

```bash
curl -X POST https://<your-project-ref>.supabase.co/functions/v1/terrestrial-brain-mcp \
  -H "Content-Type: application/json" \
  -H "x-brain-key: <your-mcp-access-key>" \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-03-26","capabilities":{},"clientInfo":{"name":"test","version":"1.0.0"}}}'
```

You should get a JSON-RPC response (not a 401 or 500).

You can also check the Supabase dashboard:
- **Table Editor** -- tables exist: `thoughts`, `projects`, `tasks`, `people`, `documents`, `note_snapshots`, `ai_output`, `function_call_logs`
- **Edge Functions** -- `terrestrial-brain-mcp` is listed and active

### Step 6: Install the Obsidian Plugin

The plugin is not yet published to the Obsidian community plugin directory, so you install it manually.

#### 6a. Build the plugin

```bash
cd obsidian-plugin
npm install
npm run build
cd ..
```

#### 6b. Copy to your Obsidian vault

```bash
# Create the plugin directory in your vault
mkdir -p /path/to/your/vault/.obsidian/plugins/terrestrial-brain

# Copy the built plugin files
cp obsidian-plugin/dist/main.js /path/to/your/vault/.obsidian/plugins/terrestrial-brain/
cp obsidian-plugin/manifest.json /path/to/your/vault/.obsidian/plugins/terrestrial-brain/
cp obsidian-plugin/styles.css /path/to/your/vault/.obsidian/plugins/terrestrial-brain/
```

#### 6c. Enable the plugin

1. Open Obsidian and go to **Settings > Community plugins**.
2. If prompted, turn off **Restricted mode**.
3. Find **Terrestrial Brain** in the list and toggle it **on**.

#### 6d. Configure the plugin

1. Go to **Settings > Terrestrial Brain** (in the Community plugins section).
2. Set **Endpoint URL** to (no `?key=` — the key goes in the next field):
   ```
   https://<your-project-ref>.supabase.co/functions/v1/terrestrial-brain-mcp
   ```
3. Set **Access key** to your `MCP_ACCESS_KEY`. The plugin sends it as an `x-brain-key` request header, never in the URL. (If you paste an old-style URL that still contains `?key=`, the plugin moves the key into this field automatically.)
4. Adjust other settings as desired:
   - **Sync delay** (minutes before a saved note is synced, default 5)
   - **Poll interval** (minutes between checking for AI output, default 10)
   - **Exclude tag** (notes with this tag are not synced)
   - **Projects folder base** (where AI-generated project files are created)

#### 6e. Commands and usage

Once enabled, the plugin adds the following commands (open the command palette with **Ctrl/Cmd+P**):

- **Sync current note to Terrestrial Brain** -- immediately sync the active note, bypassing the debounce timer.
- **Sync entire vault to Terrestrial Brain** -- sync all non-excluded markdown files in the vault.
- **Pull AI output from Terrestrial Brain** -- manually check for and retrieve pending AI-generated content.

The ribbon **brain icon** offers a quick menu with:

- **Sync note to Terrestrial Brain** -- sync the active note.
- **Pull AI Output from Terrestrial Brain** -- check for pending AI output.

**Excluding a note from sync.** Put the exclude tag anywhere in a note (inline or in frontmatter) to keep it out of Terrestrial Brain. The tag is configurable in the plugin settings and defaults to `terrestrialBrainExclude`.

### Step 7: Connect AI Agents via MCP

Any MCP-compatible AI agent can connect to your Terrestrial Brain. Authentication uses the `x-brain-key` request header when the client supports custom headers. The `?key=` query parameter shown below is **deprecated** — it is kept only for MCP clients that cannot set custom headers (keys in URLs can end up in proxy logs and request traces). Here's how to configure common ones:

#### Claude Desktop

Add this to your Claude Desktop MCP config (`~/Library/Application Support/Claude/claude_desktop_config.json` on macOS or `%APPDATA%/Claude/claude_desktop_config.json` on Windows):

```json
{
  "mcpServers": {
    "terrestrial-brain": {
      "url": "https://<your-project-ref>.supabase.co/functions/v1/terrestrial-brain-mcp?key=<your-mcp-access-key>"
    }
  }
}
```

#### Claude Code

Add to your `.claude/settings.json`:

```json
{
  "mcpServers": {
    "Terrestrial-Brain": {
      "type": "url",
      "url": "https://<your-project-ref>.supabase.co/functions/v1/terrestrial-brain-mcp?key=<your-mcp-access-key>"
    }
  }
}
```

Once connected, your AI agent has access to 31 MCP tools:

| Category | Tools |
|---|---|
| Thoughts | `search_thoughts`, `list_thoughts`, `capture_thought`, `get_thought_by_id`, `update_thought`, `thought_stats`, `record_useful_thoughts`, `archive_thought` |
| Projects | `create_project`, `list_projects`, `get_project`, `update_project`, `archive_project` |
| Tasks | `create_task`, `list_tasks`, `get_tasks`, `update_task`, `archive_task` |
| People | `create_person`, `list_people`, `get_person`, `update_person`, `archive_person` |
| Documents | `write_document`, `list_documents`, `get_document`, `update_document` |
| AI Output | `create_ai_output`, `create_tasks_with_output` |
| Queries | `get_project_summary`, `get_recent_activity` |

### Usefulness feedback loop

`search_thoughts` returns a `⚠️ REQUIRED BEFORE NEXT USER RESPONSE:` header listing candidate thought IDs and instructing the model to call `record_useful_thoughts` before its next user-facing reply.

- `record_useful_thoughts` accepts an empty `thought_ids` array — pass `[]` when no returned thought contributed to your answer. Skipping the call is not the correct response to "nothing was useful"; passing `[]` is.
- `capture_thought` accepts an optional `builds_on: string[]` parameter. When provided, each listed thought's `usefulness_score` is incremented by 1 after the insert succeeds. This is additive to `record_useful_thoughts` for synthesis flows, not a replacement.

---

## Local Development

### One command: `deno task dev`

```bash
deno task dev
```

This is the single entry point for local work. It starts the local Supabase
stack (PostgreSQL, API server, and the edge-function runtime that serves the MCP
function), regenerates the typed database schema
(`supabase/functions/terrestrial-brain-mcp/database.types.ts`) from the applied
migrations, and runs the Obsidian plugin's esbuild watcher. Press **Ctrl-C** to
stop: the script tears down only what it started (the plugin watcher it launched
and the Supabase stack) — it never kills unrelated processes, so it is safe to
run alongside other projects. It expects `supabase/functions/.env` to exist with
at least `MCP_ACCESS_KEY` (and `TB_AI_PROVIDER` / `OPENROUTER_API_KEY`).

### Regenerate the database types after a migration

The edge function is typed against generated schema types
(`SupabaseClient<Database>`). After adding a migration, refresh the committed
types so the compiler stays in sync with the schema:

```bash
deno task gen:types   # requires the local Supabase stack running
```

`deno task dev` runs this automatically on start; the file is committed so
type-checking and CI never need a running database.

The two steps it automates can also be run manually:

### Start the local Supabase emulator

```bash
npx supabase start
```

This starts a local PostgreSQL database, API server, and edge function runtime. Seed data from `supabase/seed.sql` is loaded automatically.

### Run the plugin in dev mode

```bash
cd obsidian-plugin
npm install
npm run dev
```

This watches for changes and rebuilds the plugin. The dev build is configured to output to `test-vault/.obsidian/plugins/terrestrial-brain-dev/`.

### Run tests

The backend suite is written for [Deno](https://deno.com/) and runs in two
tiers:

- **Default tier (deterministic, no LLM key).** `deno task test` (and
  `test:unit` / `test:integration`) set `TB_AI_PROVIDER=fake`, which selects a
  deterministic `FakeAiProvider` for embeddings and completions. The suite runs
  green with **no `OPENROUTER_API_KEY` set** — no live, paid API, no flake. The
  test stack sets `TB_AI_PROVIDER=fake` in `supabase/functions/.env` so the
  served edge function uses the fake too. Deterministic unit tests need nothing
  running; the integration tests require the local Supabase stack
  (`npx supabase start`).
- **Live-LLM tier (opt-in).** `deno task test:live-llm` runs a small smoke suite
  against the **real** OpenRouter provider. It is never part of `deno task test`
  and is not a skip: it requires `OPENROUTER_API_KEY` and fails loudly (naming
  the variable) if the key is absent.

```bash
# Plugin unit tests
cd obsidian-plugin && npm test

# Backend unit tests only (no stack needed, deterministic, no key)
deno task test:unit

# Backend integration tests (requires local Supabase stack running; deterministic, no key)
deno task test:integration

# Everything in the default tier (unit + integration)
deno task test

# Opt-in live-LLM smoke tier (requires a real key)
OPENROUTER_API_KEY=sk-... deno task test:live-llm
```

### Continuous integration

Every push and pull request runs the GitHub Actions workflow at
[`.github/workflows/ci.yml`](.github/workflows/ci.yml), which mirrors the local
validation exactly:

- **Backend job** — installs Deno and the Supabase CLI, starts a minimal
  Supabase stack with `TB_AI_PROVIDER=fake` (no `OPENROUTER_API_KEY` required),
  then runs `deno task test`, `deno lint`, and `deno fmt --check`.
- **Plugin job** — runs `npm ci`, `npm test`, and `npm run build` in
  `obsidian-plugin/`.

To reproduce the full CI check locally with the stack already up, run
`scripts/validate-all.sh`.

`test` / `test:unit` / `test:integration` map to
`TB_AI_PROVIDER=fake deno test --allow-net --allow-env <dir>`, so you can also
run a single file directly, e.g.
`TB_AI_PROVIDER=fake deno test --allow-net --allow-env tests/integration/projects.test.ts`.
To exercise the served edge function against the real LLM locally, set
`TB_AI_PROVIDER` to anything other than `fake` (or remove it) in
`supabase/functions/.env`, provide `OPENROUTER_API_KEY`, and restart the stack.

### Create a new database migration

```bash
npx supabase migration new <description>
```

Edit the generated file in `supabase/migrations/`, then apply locally with:

```bash
npx supabase db reset
```

---

## Deploying Updates

After making changes, deploy them to your remote Supabase instance without losing data:

```bash
# Push new migrations only (already-applied migrations are skipped)
npx supabase db push --linked

# Redeploy edge functions
npx supabase functions deploy terrestrial-brain-mcp --project-ref <your-project-ref>

# Set any new secrets if needed
npx supabase secrets set NEW_VAR=value --project-ref <your-project-ref>
```

See [docs/upgrade.md](docs/upgrade.md) for detailed upgrade instructions and safe migration practices.

---

## Secrets Reference

| Secret | Required | Description |
|---|---|---|
| `MCP_ACCESS_KEY` | Yes | Authenticates clients calling the MCP server (sent via the `x-brain-key` header; `?key=` is deprecated). Use a strong random string. |
| `OPENROUTER_API_KEY` | Prod / live tests | Used for real LLM calls (metadata extraction, embeddings). Required in production and for the opt-in `deno task test:live-llm` tier. NOT needed for the default test suite, which runs against the deterministic fake (`TB_AI_PROVIDER=fake`). Get from [openrouter.ai/settings/keys](https://openrouter.ai/settings/keys). |
| `TB_AI_PROVIDER` | No | Set to exactly `fake` to select the deterministic offline `FakeAiProvider` (used by the default test stack so it runs with no OpenRouter key). Any other value — unset, empty, or differently-cased — selects the live OpenRouter provider. Never set to `fake` in production. |
| `TB_USER_TIMEZONE` | No | IANA timezone name (e.g. `America/New_York`, `Europe/Zurich`) used to resolve relative task due-dates ("today", "tomorrow", weekday names) against your local calendar day instead of UTC. Defaults to `UTC`; an invalid value falls back to `UTC` with a warning. |

---

## Troubleshooting

- **`operator does not exist: extensions.vector <=> extensions.vector`** -- The pgvector extension is not enabled. Go to Supabase dashboard > Database > Extensions and enable `vector`.
- **Edge function returns 401** -- Check that `MCP_ACCESS_KEY` is set correctly: `npx supabase secrets list --project-ref <your-project-ref>`.
- **`413 request entity too large`** -- Your SQL import file is too big. See [docs/fresh-install.md](docs/fresh-install.md) Step 5 for batch splitting instructions.
- **Notes not syncing** -- Check the Obsidian developer console (Ctrl+Shift+I) for errors. Verify the endpoint URL in plugin settings is correct and that the **Access key** field contains your `MCP_ACCESS_KEY`.

---

## License

MIT
