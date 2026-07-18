#!/usr/bin/env bash
#
# Purge archived data (GDPR erasure/retention) without hand-written SQL
# (change: archive-retention-and-purge, SQL-9). Wraps the service-role RPCs
# count_archived_rows / purge_archived_rows via `npx supabase db query`.
#
# Usage:
#   ./scripts/purge-archived.sh [--local|--linked] [--yes] [TABLE [ON_OR_BEFORE]]
#
#   (no TABLE)              purge ALL archived rows in ALL archivable tables
#   TABLE ON_OR_BEFORE      purge only TABLE's rows archived on that date or older
#
#   --local / --linked      target the local (default) or linked/prod DB
#   --yes                   skip the confirmation prompt (automation)
#
# It ALWAYS prints a dry-run count first. The delete-everything case requires
# typing PURGE; a targeted purge requires y/N — unless --yes is given.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ARCHIVABLE=("thoughts" "projects" "tasks" "people")

DB_TARGET="--local"
ASSUME_YES=0
TABLE=""
ON_OR_BEFORE=""

# ─── Parse arguments ────────────────────────────────────────────────────────
for arg in "$@"; do
  case "$arg" in
    --local) DB_TARGET="--local" ;;
    --linked) DB_TARGET="--linked" ;;
    --yes) ASSUME_YES=1 ;;
    --*)
      echo "ERROR: unknown flag: $arg" >&2
      exit 2
      ;;
    *)
      if [[ -z "$TABLE" ]]; then
        TABLE="$arg"
      elif [[ -z "$ON_OR_BEFORE" ]]; then
        ON_OR_BEFORE="$arg"
      else
        echo "ERROR: too many positional arguments" >&2
        exit 2
      fi
      ;;
  esac
done

# ─── Validate the table against the allowlist ───────────────────────────────
if [[ -n "$TABLE" ]]; then
  valid=0
  for candidate in "${ARCHIVABLE[@]}"; do
    [[ "$TABLE" == "$candidate" ]] && valid=1
  done
  if [[ "$valid" -ne 1 ]]; then
    echo "ERROR: '$TABLE' is not an archivable table (allowed: ${ARCHIVABLE[*]})" >&2
    exit 2
  fi
fi

# Build the SQL arguments (quoted literals or NULL).
if [[ -n "$TABLE" ]]; then TABLE_ARG="'$TABLE'"; else TABLE_ARG="NULL"; fi
if [[ -n "$ON_OR_BEFORE" ]]; then DATE_ARG="'$ON_OR_BEFORE'"; else DATE_ARG="NULL"; fi

run_query() {
  (cd "$REPO_ROOT" && npx supabase db query "$DB_TARGET" "$1")
}

# ─── Dry-run: show what would be deleted ────────────────────────────────────
echo "==> Archived rows that WOULD be deleted (${DB_TARGET#--}):"
run_query "select * from public.count_archived_rows($TABLE_ARG, $DATE_ARG);"
echo ""

# ─── Confirmation ───────────────────────────────────────────────────────────
if [[ "$ASSUME_YES" -ne 1 ]]; then
  if [[ -z "$TABLE" ]]; then
    # Delete-everything: require typing PURGE.
    read -rp "This permanently deletes ALL archived data above. Type PURGE to proceed: " reply
    if [[ "$reply" != "PURGE" ]]; then
      echo "Aborted — nothing was deleted."
      exit 0
    fi
  else
    read -rp "Permanently delete the archived '$TABLE' rows above? [y/N] " reply
    if [[ ! "$reply" =~ ^[Yy]$ ]]; then
      echo "Aborted — nothing was deleted."
      exit 0
    fi
  fi
fi

# ─── Purge ──────────────────────────────────────────────────────────────────
echo "==> Purging..."
run_query "select * from public.purge_archived_rows($TABLE_ARG, $DATE_ARG);"
echo ""
echo "==> Done."
