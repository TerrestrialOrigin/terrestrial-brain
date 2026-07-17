## Context

SCRIPT-2/3/4/5/6. `config.toml` cannot express a runtime port offset (integer ports, no env substitution), so the fix is a fixed unique port block, not a computed offset. The CLI exposes `supabase status --output json` (→ `.API_URL`) and `jq` is available, giving a robust dynamic URL for the validation probe. The stack is container-namespaced by `project_id` but ports are host-level and collide.

## Goals / Non-Goals

**Goals:** unique ports; blank-slate + dynamic-URL validation; `npx` everywhere; lockfile on; honest CI docs. **Non-Goals:** centralizing the test base URL behind one constant (Step 30) — literals are updated to the new fixed port here.

## Decisions

**D1 — Fixed unique port block, literals updated everywhere.** Since config.toml can't offset at runtime, pick a fixed non-default block and update every `54321` reference (tests, helper, docs, plugin config). The behavioral proof is the whole suite passing against the new port — nothing may still assume `:54321`. `validate-all.sh` derives the URL dynamically so it can never match a stranger's stack even if a literal is missed.

**D2 — Reset + warm in validation and dev.** `validate-all.sh` runs `npx supabase db reset` before the suite (blank slate), then a best-effort warmup POST absorbs the edge runtime's post-reset cold start (the documented 504 artifact) so the integration suite doesn't race it. `dev.sh` resets by default with a `TB_DEV_KEEP_DATA=1` opt-out for a long-lived local vault DB.

**D3 — `npx supabase` uniformly.** Removes global-CLI-version drift; matches the prod scripts and validate.

**D4 — Enable the lockfile.** `"lock": true` + committed `deno.lock` restores integrity pinning for transitive deps and registry tampering; exact-pinned import map already covered direct versions.

**D5 — CI honesty.** Delete the "red by design until Step 7" comment and the "intentional red" justification; keep `if: always()` on lint/format only so their signal survives a genuine test failure.

### User error scenarios
- **Another local Supabase project runs on the defaults:** no collision now — this project owns 5542x/55483.
- **A dev wants to keep local data across restarts:** `TB_DEV_KEEP_DATA=1 deno task dev`.
- **A contributor runs validate with a stale/dirty DB:** it is reset first, so results don't depend on leftovers.
- **`jq` or the stack is absent when validating:** the script errors out with an actionable message rather than probing a wrong port.

### Security analysis
- Reduces the risk of running tests/migrations against the wrong database (a data-integrity/leak hazard) by never matching a foreign stack. The lockfile adds supply-chain integrity for the service-role-holding runtime. No secrets or endpoints added.

### Test Strategy
- **Behavioral (the real SCRIPT-2 proof):** the full `deno task test` + pgTAP + plugin suite runs green against the dynamically-derived new port.
- **Static guards (`tests/unit/dev-scripts.test.ts`):** dev.sh uses `npx` + resets with an opt-out; validate derives the URL and hardcodes no `54321`; config uses the unique port; `gen:types` uses `npx`; the lockfile is enabled. GATE 2b by mutation (verified: reverting `lock` reddens). `bash -n` syntax-checks the scripts.

## Risks / Trade-offs

- **[A missed `54321` literal breaks a test]** → The green full-suite run against the new port is the exhaustive check; any missed literal fails loudly. A grep confirmed only historical/plan files retain the old port.
- **[`validate-all.sh` now resets — slower + destroys local data]** → Correct per the blank-slate rule; `dev.sh` offers the opt-out for a preserved local DB.
- **[Fixed ports could still collide with an unrelated service]** → The chosen block is well outside common defaults; a future collision is a one-line config change.
