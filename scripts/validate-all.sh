#!/usr/bin/env bash
# Validate the whole repo the same way CI does: deterministic Deno suite (fake AI
# provider) + Deno lint/format checks + plugin tests + plugin build.
# Prerequisite: the local Supabase stack must be running (npx supabase start),
# with edge-function secrets in supabase/functions/.env.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

echo "==> Checking local Supabase stack is up..."
if ! curl -s -o /dev/null -m 5 http://localhost:54321/functions/v1/terrestrial-brain-mcp; then
  echo "ERROR: local Supabase stack is not reachable on :54321 — run 'npx supabase start' first." >&2
  exit 1
fi

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
