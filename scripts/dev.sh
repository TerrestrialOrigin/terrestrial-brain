#!/usr/bin/env bash
# One-command local development for Terrestrial Brain.
#
# Starts the local Supabase stack (which also serves the edge functions via the
# Edge Runtime) and runs the Obsidian plugin's esbuild watcher, then blocks until
# you Ctrl-C. On exit it tears down ONLY what it started: the plugin watcher it
# launched (by PID) and the Supabase stack. It never uses broad `pkill` name
# matches, so it is safe to run alongside other projects on the same machine.
#
# Usage: deno task dev   (or ./scripts/dev.sh)
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PLUGIN_DIR="$REPO_ROOT/obsidian-plugin"
PLUGIN_WATCH_PID=""

cleanup() {
  trap - EXIT INT TERM # run once, even though the signal also fires EXIT
  echo ""
  echo "==> Shutting down dev stack..."
  # Stop only the plugin watcher this script started.
  if [[ -n "$PLUGIN_WATCH_PID" ]] && kill -0 "$PLUGIN_WATCH_PID" 2>/dev/null; then
    kill "$PLUGIN_WATCH_PID" 2>/dev/null || true
    wait "$PLUGIN_WATCH_PID" 2>/dev/null || true
  fi
  # Stop the Supabase stack (idempotent — safe if already stopped).
  (cd "$REPO_ROOT" && npx supabase stop --no-backup) || true
  echo "==> Dev stack stopped."
}
trap cleanup EXIT INT TERM

if [[ ! -f "$REPO_ROOT/supabase/functions/.env" ]]; then
  echo "WARNING: supabase/functions/.env is missing — the edge function needs" >&2
  echo "         MCP_ACCESS_KEY (and TB_AI_PROVIDER / OPENROUTER_API_KEY). See README." >&2
fi

echo "==> Starting Supabase stack (serves the edge functions)..."
(cd "$REPO_ROOT" && npx supabase start)

# Blank-slate by default (SCRIPT-3): reset applies migrations + seed so the dev
# stack matches the e2e/CI path and the documented seed accounts exist. Set
# TB_DEV_KEEP_DATA=1 to preserve a long-lived local vault DB across restarts.
if [[ "${TB_DEV_KEEP_DATA:-0}" == "1" ]]; then
  echo "==> TB_DEV_KEEP_DATA=1 — keeping existing database state (no reset)."
else
  echo "==> Resetting database (migrations + seed) for a blank slate..."
  (cd "$REPO_ROOT" && npx supabase db reset)
fi

# Regenerate the typed database schema so the edge function's
# `database.types.ts` stays in sync with the applied migrations (Step 24).
echo "==> Regenerating database types from the local schema..."
(cd "$REPO_ROOT" && npx supabase gen types typescript --local --schema public \
  > "$REPO_ROOT/supabase/functions/terrestrial-brain-mcp/database.types.ts") \
  || echo "WARNING: database type generation failed; continuing with existing types." >&2

echo "==> Starting Obsidian plugin watcher..."
(cd "$PLUGIN_DIR" && npm run dev) &
PLUGIN_WATCH_PID=$!

echo ""
echo "==> Dev stack is up. Edit the vault / plugin and it rebuilds on save."
echo "==> Press Ctrl-C to stop everything."

# Block on the watcher; if it dies, the trap still tears down Supabase.
wait "$PLUGIN_WATCH_PID"
