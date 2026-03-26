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
echo "    SLACK_BOT_TOKEN       — Slack bot token (for ingest-thought function)"
echo "    SLACK_CAPTURE_CHANNEL — Slack channel ID for captures"
echo ""
echo "  Note: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are automatically"
echo "  available to edge functions — you do not need to set them."
echo ""

read -rp "  Do you want to set secrets now? [Y/n] " REPLY
REPLY=${REPLY:-Y}

if [[ "$REPLY" =~ ^[Yy]$ ]]; then
  read -rp "  OPENROUTER_API_KEY: " OPENROUTER_API_KEY
  read -rp "  MCP_ACCESS_KEY: " MCP_ACCESS_KEY
  read -rp "  SLACK_BOT_TOKEN (blank to skip): " SLACK_BOT_TOKEN
  read -rp "  SLACK_CAPTURE_CHANNEL (blank to skip): " SLACK_CAPTURE_CHANNEL

  SECRETS="OPENROUTER_API_KEY=$OPENROUTER_API_KEY MCP_ACCESS_KEY=$MCP_ACCESS_KEY"

  if [ -n "$SLACK_BOT_TOKEN" ]; then
    SECRETS="$SECRETS SLACK_BOT_TOKEN=$SLACK_BOT_TOKEN"
  fi
  if [ -n "$SLACK_CAPTURE_CHANNEL" ]; then
    SECRETS="$SECRETS SLACK_CAPTURE_CHANNEL=$SLACK_CAPTURE_CHANNEL"
  fi

  npx supabase secrets set $SECRETS --project-ref "$PROJECT_REF"
  echo ""
  echo "  Secrets set."
else
  echo ""
  echo "  Skipped. Set them later with:"
  echo "    npx supabase secrets set KEY=value --project-ref $PROJECT_REF"
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

echo "=== Setup complete ==="
echo ""
echo "  MCP endpoint: https://$PROJECT_REF.supabase.co/functions/v1/terrestrial-brain-mcp"
echo "  Ingest endpoint: https://$PROJECT_REF.supabase.co/functions/v1/ingest-thought"
echo ""
echo "  Next steps:"
echo "    - Configure your Obsidian plugin to point at the MCP endpoint"
echo "    - Use deploy-prod.sh for future updates"
