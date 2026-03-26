#!/usr/bin/env bash
#
# Deploy to production — push migrations and redeploy edge functions.
# Assumes the Supabase CLI is already linked to the remote project.
#
# Usage:
#   ./scripts/deploy-prod.sh
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$PROJECT_ROOT"

# Resolve project ref from linked project
PROJECT_REF=$(npx supabase projects list 2>/dev/null | awk -F'|' '/●/ {gsub(/^[ \t]+|[ \t]+$/, "", $3); print $3}')
if [ -z "$PROJECT_REF" ]; then
  echo "ERROR: No linked Supabase project found. Run: npx supabase link --project-ref <ref>"
  exit 1
fi

echo "=== Deploying to project: $PROJECT_REF ==="
echo ""

# Step 1: Push new migrations
echo "--- Step 1/4: Pushing migrations ---"
npx supabase db push --linked
echo ""

# Step 2: Deploy edge functions
echo "--- Step 2/4: Deploying edge functions ---"
for FUNC_DIR in supabase/functions/*/; do
  FUNC_NAME=$(basename "$FUNC_DIR")
  echo "  Deploying $FUNC_NAME..."
  npx supabase functions deploy "$FUNC_NAME" --project-ref "$PROJECT_REF"
done
echo ""

# Step 3: List secrets (reminder to set any new ones)
echo "--- Step 3/4: Current secrets ---"
npx supabase secrets list --project-ref "$PROJECT_REF"
echo ""
echo "  If this deploy introduced new env vars, set them with:"
echo "    npx supabase secrets set KEY=value --project-ref $PROJECT_REF"
echo ""

# Step 4: Verify migration status
echo "--- Step 4/4: Migration status ---"
npx supabase migration list --linked
echo ""

echo "=== Deploy complete ==="
