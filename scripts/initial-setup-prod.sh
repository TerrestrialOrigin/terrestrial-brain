#!/usr/bin/env bash
#
# Initial production setup — link project, push all migrations, deploy
# edge functions, and configure secrets.
#
# Prerequisites:
#   - Supabase CLI installed (npx supabase)
#   - A Supabase project already created via the dashboard
#   - You are logged in: npx supabase login
#
# Usage:
#   ./scripts/initial-setup-prod.sh <project-ref>
#
# Example:
#   ./scripts/initial-setup-prod.sh jhqhtryqjwzhnjaqtkui
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$PROJECT_ROOT"

if [ $# -lt 1 ]; then
  echo "Usage: $0 <supabase-project-ref>"
  echo ""
  echo "Find your project ref in the Supabase dashboard URL:"
  echo "  https://supabase.com/dashboard/project/<project-ref>"
  echo ""
  echo "Or list your projects with: npx supabase projects list"
  exit 1
fi

PROJECT_REF="$1"

echo "=== Initial setup for project: $PROJECT_REF ==="
echo ""

# ─── Step 1: Link local project to remote ─────────────────────────────────────

echo "--- Step 1/5: Linking project ---"
npx supabase link --project-ref "$PROJECT_REF"
echo ""

# ─── Step 2: Push all migrations ──────────────────────────────────────────────

echo "--- Step 2/5: Pushing all migrations ---"
npx supabase db push --linked
echo ""

# ─── Step 3: Deploy edge functions ────────────────────────────────────────────

echo "--- Step 3/5: Deploying edge functions ---"
for FUNC_DIR in supabase/functions/*/; do
  FUNC_NAME=$(basename "$FUNC_DIR")
  echo "  Deploying $FUNC_NAME..."
  npx supabase functions deploy "$FUNC_NAME" --project-ref "$PROJECT_REF"
done
echo ""

# ─── Step 4: Set secrets ──────────────────────────────────────────────────────

echo "--- Step 4/5: Configuring secrets ---"
echo ""
echo "  The following secrets are required:"
echo ""
echo "    OPENROUTER_API_KEY    — API key from https://openrouter.ai"
echo "    MCP_ACCESS_KEY        — Shared secret for authenticating MCP requests"
echo ""
echo "  Note: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are automatically"
echo "  available to edge functions — you do not need to set them."
echo ""

read -rp "  Do you want to set secrets now? [Y/n] " REPLY
REPLY=${REPLY:-Y}

if [[ "$REPLY" =~ ^[Yy]$ ]]; then
  # -s so secrets are not echoed to the terminal; print the newline -s swallows.
  read -rsp "  OPENROUTER_API_KEY: " OPENROUTER_API_KEY
  echo ""
  read -rsp "  MCP_ACCESS_KEY: " MCP_ACCESS_KEY
  echo ""

  # SCRIPT-1: pass secrets via a private env-file, NOT as argv. Process
  # arguments are world-readable via `ps` / /proc/<pid>/cmdline for the whole
  # (network-bound) CLI call — and this machine is shared. The file is created
  # 0600 (umask 077) and removed by a trap so an interrupted run leaves nothing.
  SECRETS_FILE="$(umask 077 && mktemp)"
  trap 'rm -f "${SECRETS_FILE:-}"' EXIT
  cat > "$SECRETS_FILE" <<ENVFILE
OPENROUTER_API_KEY=$OPENROUTER_API_KEY
MCP_ACCESS_KEY=$MCP_ACCESS_KEY
ENVFILE

  npx supabase secrets set --env-file "$SECRETS_FILE" --project-ref "$PROJECT_REF"

  rm -f "$SECRETS_FILE"
  trap - EXIT
  echo ""
  echo "  Secrets set."
else
  echo ""
  echo "  Skipped. Set them later with an env-file (never argv — see SCRIPT-1):"
  echo "    printf 'KEY=value\\n' > secrets.env && chmod 600 secrets.env"
  echo "    npx supabase secrets set --env-file secrets.env --project-ref $PROJECT_REF"
fi
echo ""

# ─── Step 5: Verify ──────────────────────────────────────────────────────────

echo "--- Step 5/5: Verification ---"
echo ""
echo "  Migration status:"
npx supabase migration list --linked
echo ""
echo "  Secrets:"
npx supabase secrets list --project-ref "$PROJECT_REF"
echo ""

# SQL-7: the 90-day retention purge of function_call_logs (note content + IP
# addresses) is a GDPR control. Its pg_cron schedule is best-effort in the
# migration (so local/CI without pg_cron still applies), which means a
# production scheduling failure would otherwise pass silently. Verify the job
# exists on the linked project and FAIL LOUD if it does not.
echo "  Retention purge job (GDPR):"
if npx supabase db query --linked \
  "select jobname from cron.job where jobname = 'purge-function-call-logs-daily';" \
  2>/dev/null | grep -q 'purge-function-call-logs-daily'; then
  echo "    ✓ purge-function-call-logs-daily is scheduled"
else
  echo "    WARNING: retention purge job 'purge-function-call-logs-daily' is NOT" >&2
  echo "    scheduled. function_call_logs (note content + IP addresses) will never" >&2
  echo "    be purged. Enable pg_cron and re-run 'npx supabase db push --linked'." >&2
  exit 1
fi
echo ""

echo "=== Setup complete ==="
echo ""
echo "  MCP endpoint: https://$PROJECT_REF.supabase.co/functions/v1/terrestrial-brain-mcp"
echo ""
echo "  Next steps:"
echo "    - Configure your Obsidian plugin to point at the MCP endpoint"
echo "    - Use deploy-update-prod.sh for future updates"
