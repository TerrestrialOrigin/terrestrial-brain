# Fresh Install — Terrestrial Brain on Supabase Cloud

Deploy the full project to a new (or wiped) Supabase instance from scratch.

## Prerequisites

- Node.js installed
- Supabase CLI installed (`npm install -g supabase` or use `npx supabase`)
- A Supabase project created at https://supabase.com/dashboard
- Your project ref (the subdomain of your Supabase URL, e.g. if your URL is `https://abcdefgh.supabase.co`, the ref is `abcdefgh`)

## Step 1: Link the local project to your remote instance

```bash
npx supabase link --project-ref <your-project-ref>
```

You'll be prompted for your database password (the one you set when creating the Supabase project).

## Step 2: Push all migrations

This applies every migration in `supabase/migrations/` to the remote database, creating all tables, indexes, RLS policies, and functions.

```bash
npx supabase db push --linked
```

> **Note:** This does NOT run `seed.sql`. Seed data is for local development only.

## Step 3: Set remote secrets

The edge functions need these environment variables. Set them as secrets on the remote instance:

```bash
npx supabase secrets set \
  MCP_ACCESS_KEY=<your-mcp-access-key> \
  OPENROUTER_API_KEY=<your-openrouter-api-key> \
  SLACK_BOT_TOKEN=<your-slack-bot-token> \
  SLACK_CAPTURE_CHANNEL=<your-slack-channel-id> \
  --project-ref <your-project-ref>
```

- `MCP_ACCESS_KEY` — authenticates clients calling the MCP server (choose a strong random string)
- `OPENROUTER_API_KEY` — used by the MCP server for embeddings and metadata extraction
- `SLACK_BOT_TOKEN` — (only needed for `ingest-thought`) your Slack app's bot token
- `SLACK_CAPTURE_CHANNEL` — (only needed for `ingest-thought`) the Slack channel ID to listen on

If you're not using the Slack integration, you can skip `SLACK_BOT_TOKEN` and `SLACK_CAPTURE_CHANNEL`, but you still need `MCP_ACCESS_KEY` and `OPENROUTER_API_KEY`.

## Step 4: Deploy edge functions

Deploy both functions:

```bash
npx supabase functions deploy terrestrial-brain-mcp --project-ref <your-project-ref>
npx supabase functions deploy ingest-thought --project-ref <your-project-ref>
```

## Step 5: Import existing data (optional)

If you have a SQL export of thoughts to import:

```bash
npx supabase db query -f /path/to/your/thoughts_export.sql --linked
```

If the file is too large (>2MB) and you get a `413 request entity too large` error, split it into smaller batches first:

```bash
# Split into 100-row batches
python3 -c "
import os
with open('/path/to/your/thoughts_export.sql', 'r') as f:
    data = f.read()
prefix = data[:data.index('VALUES') + 7]
values_part = data[data.index('VALUES') + 7:].rstrip(';')
tuples = []
depth = 0
current = ''
for char in values_part:
    current += char
    if char == '(':
        depth += 1
    elif char == ')':
        depth -= 1
        if depth == 0:
            tuples.append(current.strip().strip(',').strip())
            current = ''
os.makedirs('/tmp/thoughts-split', exist_ok=True)
batch_size = 100
for i in range(0, len(tuples), batch_size):
    batch = tuples[i:i+batch_size]
    sql = prefix + ', '.join(batch) + ';'
    with open(f'/tmp/thoughts-split/batch_{i//batch_size:03d}.sql', 'w') as f:
        f.write(sql)
print(f'Created {len(os.listdir(\"/tmp/thoughts-split\"))} batch files')
"

# Upload each batch
for f in /tmp/thoughts-split/batch_*.sql; do
  echo "Uploading $(basename $f)..."
  npx supabase db query -f "$f" --linked
done

# Clean up
rm -rf /tmp/thoughts-split
```

## Step 6: Verify

1. Open the Supabase dashboard and check:
   - **Table Editor** — tables exist: `thoughts`, `projects`, `tasks`, `people`, `note_snapshots`, `ai_output`
   - **Edge Functions** — both `terrestrial-brain-mcp` and `ingest-thought` are listed and active
2. Test the MCP endpoint:
   ```bash
   curl -X POST https://<your-project-ref>.supabase.co/functions/v1/terrestrial-brain-mcp \
     -H "Content-Type: application/json" \
     -H "x-brain-key: <your-mcp-access-key>" \
     -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-03-26","capabilities":{},"clientInfo":{"name":"test","version":"1.0.0"}}}'
   ```
   You should get a JSON-RPC response back (not a 401 or 500).

## Troubleshooting

- **`operator does not exist: extensions.vector <=> extensions.vector`** — The pgvector extension may not be enabled. Go to Supabase dashboard > Database > Extensions and enable `vector`.
- **`413 request entity too large`** — Your SQL file is too big for the Management API. Use the batch splitting method in Step 5.
- **Edge function returns 401** — Check that `MCP_ACCESS_KEY` is set correctly via `npx supabase secrets list --project-ref <your-project-ref>`.
