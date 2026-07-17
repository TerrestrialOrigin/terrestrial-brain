#!/usr/bin/env bash
# Validate the whole repo the same way CI does: deterministic Deno suite (fake AI
# provider) + Deno lint/format checks + plugin tests + plugin build.
# Prerequisite: the local Supabase stack must be running (npx supabase start),
# with edge-function secrets in supabase/functions/.env.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

echo "==> Locating the running Supabase stack (SCRIPT-2: no hardcoded port)..."
# Derive the API URL from the running stack instead of assuming the default
# port, so the probe can never match a DIFFERENT project's stack on the stock
# default port.
API_URL="$(cd "$REPO_ROOT" && npx supabase status --output json 2>/dev/null \
  | jq -r '.API_URL // empty')"
if [[ -z "$API_URL" ]]; then
  echo "ERROR: could not read the local Supabase API URL — run 'npx supabase start' first." >&2
  exit 1
fi
echo "    API_URL=$API_URL"

echo "==> Checking the stack is reachable..."
if ! curl -s -o /dev/null -m 5 "$API_URL/functions/v1/terrestrial-brain-mcp"; then
  echo "ERROR: local Supabase stack is not reachable at $API_URL — run 'npx supabase start' first." >&2
  exit 1
fi

# SCRIPT-3: reset to a blank slate (migrations + seed) so validation never
# depends on leftover state from a previous run (the documented dirty-stack
# dedup-collision / cold-start artifacts). Keep the tree stable during the run.
echo "==> Resetting database (migrations + seed)..."
(cd "$REPO_ROOT" && npx supabase db reset)

# The reset restarts the edge runtime, so the first request cold-starts (and can
# 504). Warm it best-effort so the integration suite doesn't race a cold start.
echo "==> Warming the edge function..."
curl -s -o /dev/null -m 40 \
  -X POST "$API_URL/functions/v1/terrestrial-brain-mcp/ingest-note" \
  -H "Content-Type: application/json" -H "x-brain-key: dev-test-key-123" \
  -d '{"content":"warmup"}' || true

echo "==> Running pgTAP database tests (supabase test db)..."
(cd "$REPO_ROOT" && npx supabase test db)

echo "==> Running Deno test suite (deterministic, TB_AI_PROVIDER=fake)..."
(cd "$REPO_ROOT" && deno task test)

echo "==> Running Deno lint..."
(cd "$REPO_ROOT" && deno lint)

echo "==> Checking Deno formatting..."
(cd "$REPO_ROOT" && deno fmt --check)

echo "==> Running Obsidian plugin tests..."
(cd "$REPO_ROOT/obsidian-plugin" && npm test)

echo "==> Building Obsidian plugin..."
(cd "$REPO_ROOT/obsidian-plugin" && npm run build)

echo "==> All validation passed."
