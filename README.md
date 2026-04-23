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
- **Function call logging** -- Every MCP tool call and HTTP endpoint invocation is logged with input, response size, record count, errors, and caller IP address for a complete audit trail.
- **MCP server** -- 31 tools exposed via the Model Context Protocol, accessible to any MCP-compatible AI agent (Claude Desktop, Claude Code, custom agents).
- **Row-Level Security** -- All database tables have RLS enabled with access-key authentication.

## Project Structure

```
terrestrial-brain/
├── obsidian-plugin/              # Obsidian plugin (TypeScript/esbuild)
│   ├── src/main.ts               #   Plugin entry point
│   ├── src/main.test.ts          #   Plugin tests (Vitest)
│   ├── manifest.json             #   Obsidian plugin metadata
│   └── package.json              #   Node dependencies & scripts
├── supabase/                     # Supabase backend
│   ├── config.toml               #   Local dev configuration
│   ├── seed.sql                  #   Seed data for local development
│   ├── migrations/               #   Database migrations (PostgreSQL, 22 files)
│   └── functions/                #   Supabase Edge Functions (Deno)
│       ├── terrestrial-brain-mcp/    # Main MCP server
│       │   ├── index.ts              #   Hono + MCP server entry
│       │   ├── helpers.ts            #   OpenRouter API calls
│       │   ├── parser.ts             #   Markdown structural parser
│       │   ├── validators.ts         #   Zod schemas
│       │   ├── logger.ts             #   Function call audit logging
│       │   ├── extractors/           #   LLM-based content extractors
│       │   │   ├── pipeline.ts       #     Orchestrates all extractors
│       │   │   ├── project-extractor.ts
│       │   │   ├── task-extractor.ts
│       │   │   └── people-extractor.ts
│       │   └── tools/                #   MCP tool implementations
│       │       ├── thoughts.ts       #     search, list, capture, stats, usefulness
│       │       ├── projects.ts       #     CRUD + archive for projects
│       │       ├── tasks.ts          #     CRUD + archive for tasks
│       │       ├── people.ts         #     CRUD + archive for people
│       │       ├── documents.ts      #     Long-form document storage
│       │       ├── ai_output.ts      #     AI output + batch task creation
│       │       └── queries.ts        #     Cross-table composite queries
│       └── ingest-thought/       # Secondary edge function (Slack integration)
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

Optional -- if you want Slack integration:

```bash
npx supabase secrets set \
  SLACK_BOT_TOKEN=<your-slack-bot-token> \
  SLACK_CAPTURE_CHANNEL=<your-slack-channel-id> \
  --project-ref <your-project-ref>
```

#### 5d. Deploy edge functions

```bash
npx supabase functions deploy terrestrial-brain-mcp --project-ref <your-project-ref>
```

If you want the Slack integration too:

```bash
npx supabase functions deploy ingest-thought --project-ref <your-project-ref>
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
```

#### 6c. Enable the plugin

1. Open Obsidian and go to **Settings > Community plugins**.
2. If prompted, turn off **Restricted mode**.
3. Find **Terrestrial Brain** in the list and toggle it **on**.

#### 6d. Configure the plugin

1. Go to **Settings > Terrestrial Brain** (in the Community plugins section).
2. Set **Endpoint URL** to:
   ```
   https://<your-project-ref>.supabase.co/functions/v1/terrestrial-brain-mcp?key=<your-mcp-access-key>
   ```
3. Adjust other settings as desired:
   - **Sync delay** (minutes before a saved note is synced, default 5)
   - **Poll interval** (minutes between checking for AI output, default 10)
   - **Exclude tag** (notes with this tag are not synced)
   - **Projects folder base** (where AI-generated project files are created)

### Step 7: Connect AI Agents via MCP

Any MCP-compatible AI agent can connect to your Terrestrial Brain. Here's how to configure common ones:

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

```bash
# Plugin unit tests
cd obsidian-plugin && npm test

# Integration tests (requires local Supabase emulator running)
cd tests && npx vitest run
```

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
| `MCP_ACCESS_KEY` | Yes | Authenticates clients calling the MCP server. Use a strong random string. |
| `OPENROUTER_API_KEY` | Yes | Used for LLM calls (metadata extraction, embeddings). Get from [openrouter.ai/settings/keys](https://openrouter.ai/settings/keys). |
| `SLACK_BOT_TOKEN` | No | Only needed for Slack integration (`ingest-thought` function). |
| `SLACK_CAPTURE_CHANNEL` | No | Only needed for Slack integration. The Slack channel ID to listen on. |

---

## Troubleshooting

- **`operator does not exist: extensions.vector <=> extensions.vector`** -- The pgvector extension is not enabled. Go to Supabase dashboard > Database > Extensions and enable `vector`.
- **Edge function returns 401** -- Check that `MCP_ACCESS_KEY` is set correctly: `npx supabase secrets list --project-ref <your-project-ref>`.
- **`413 request entity too large`** -- Your SQL import file is too big. See [docs/fresh-install.md](docs/fresh-install.md) Step 5 for batch splitting instructions.
- **Notes not syncing** -- Check the Obsidian developer console (Ctrl+Shift+I) for errors. Verify the endpoint URL in plugin settings is correct and includes the `?key=` parameter.

---

## License

MIT
