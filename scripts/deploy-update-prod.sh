#!/usr/bin/env bash
#
# Deploy to production — push migrations and redeploy edge functions.
# Assumes the Supabase CLI is already linked to the remote project.
#
# Usage:
#   ./scripts/deploy-update-prod.sh
#
# Environment:
#   TB_SELINUX_WORKAROUND=1   Opt in to the SELinux permissive-mode workaround
#                             (Fedora/Qubes hosts where SELinux blocks Docker from
#                             reading mounted volumes). When unset, SELinux is left
#                             untouched and no sudo is required. When enabled, the
#                             prior enforcing state is always restored on exit —
#                             including on interrupt (Ctrl-C) — via a trap.
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$PROJECT_ROOT"

# Resolve the linked project ref from a machine-readable source rather than by
# scraping decorative glyphs out of `supabase projects list` human output.
resolve_project_ref() {
  # 1) The CLI writes the linked ref here on `supabase link`.
  if [ -f "supabase/.temp/project-ref" ]; then
    tr -d '[:space:]' < "supabase/.temp/project-ref"
    return
  fi
  # 2) Fall back to the machine-readable project list.
  local json
  json=$(npx supabase projects list --output json 2>/dev/null) || return
  if command -v jq &>/dev/null; then
    # `linked` is true for exactly the linked project.
    jq -r '(map(select(.linked == true)) | .[0].id) // empty' <<<"$json"
  else
    # Minimal fallback: the id of the first object flagged linked:true.
    grep -o '"id"[^,]*\|"linked"[^,]*' <<<"$json" | grep -B1 '"linked": *true' | grep '"id"' | head -1 | sed 's/.*"id" *: *"\([^"]*\)".*/\1/'
  fi
}

PROJECT_REF="$(resolve_project_ref)"
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
# Opt in with TB_SELINUX_WORKAROUND=1 to temporarily switch to permissive for the
# deploy. The restore runs from a trap so an interrupt or failure can never leave
# the host permissive.
SELINUX_WAS_ENFORCING=false

restore_selinux() {
  if [ "$SELINUX_WAS_ENFORCING" = true ]; then
    SELINUX_WAS_ENFORCING=false  # idempotent — a second trap firing is a no-op
    sudo setenforce 1
    echo "  SELinux restored to Enforcing"
  fi
}
# EXIT covers normal completion and `set -e` failures. INT/TERM turn an interrupt
# into a non-zero exit (so an aborted deploy never falls through to "complete");
# that exit re-fires the EXIT trap, and restore_selinux is idempotent.
trap restore_selinux EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

if [ "${TB_SELINUX_WORKAROUND:-0}" = "1" ] \
  && command -v getenforce &>/dev/null && [ "$(getenforce)" = "Enforcing" ]; then
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

restore_selinux

if [ "$deploy_failed" = true ]; then
  echo "  ERROR: One or more functions failed to deploy — check output above"
  exit 1
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
