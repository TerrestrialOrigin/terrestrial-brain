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

# SELinux on Fedora/Qubes blocks Docker containers from reading mounted volumes.
# Temporarily switch to permissive mode for the deploy, then restore.
SELINUX_WAS_ENFORCING=false
if command -v getenforce &>/dev/null && [ "$(getenforce)" = "Enforcing" ]; then
  echo "  SELinux is Enforcing — switching to Permissive for Docker deploy..."
  sudo setenforce 0
  SELINUX_WAS_ENFORCING=true
fi

deploy_failed=false
for FUNC_DIR in supabase/functions/*/; do
  FUNC_NAME=$(basename "$FUNC_DIR")
  echo "  Deploying $FUNC_NAME..."
  if ! npx supabase functions deploy "$FUNC_NAME" --project-ref "$PROJECT_REF"; then
    echo "  WARNING: Failed to deploy $FUNC_NAME"
    deploy_failed=true
  fi
done

if [ "$SELINUX_WAS_ENFORCING" = true ]; then
  sudo setenforce 1
  echo "  SELinux restored to Enforcing"
fi

if [ "$deploy_failed" = true ]; then
  echo "  Some functions failed to deploy — check output above"
fi
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
