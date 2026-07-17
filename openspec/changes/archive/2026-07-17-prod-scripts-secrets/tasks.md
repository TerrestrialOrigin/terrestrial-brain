## 1. SCRIPT-1 — env-file secrets

- [x] 1.1 `initial-setup-prod.sh`: replace the argv `secrets set "${SECRETS[@]}"` with a 0600 `mktemp` env-file + `--env-file` + EXIT trap cleanup.
- [x] 1.2 Update the "set them later" hints in both scripts to the env-file form.

## 2. SQL-7 — retention job verification

- [x] 2.1 Add a `db query --linked` check for `purge-function-call-logs-daily` to both scripts' verify steps; WARNING + `exit 1` if absent.

## 3. Tests & gates

- [x] 3.1 `tests/unit/prod-scripts.test.ts` static-content guards (env-file present, argv absent, umask/mktemp/trap present, cron verification + exit 1 present). GATE 2b by mutation.
- [x] 3.2 `bash -n` both scripts.
- [x] 3.3 Full gates: `deno task test` (green, 0 skips), plugin test+build, `scripts/validate-all.sh`.

## 4. Finalize

- [x] 4.1 `/opsx:verify`, sync delta spec, `/opsx:archive`.
- [x] 4.2 Check off Step 13 in the plan.
- [x] 4.3 Commit on branch, merge into develop, push.
