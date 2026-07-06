# Threat Model — Deterministic LLM/embedding stub mode (Step 22)

Scope: the `FakeAiProvider` and its selection via `TB_AI_PROVIDER`. The fake is a
test-only implementation of the existing `AiProvider` seam. It introduces no new
network endpoint, reads no secrets, and performs no I/O beyond returning
in-process computed values.

| # | Threat | Vector | Likelihood / Impact | Mitigation |
|---|--------|--------|---------------------|------------|
| T1 | **Fake selected in production**, silently replacing real AI with canned output (knowledge base stops being enriched, embeddings become meaningless). | Operator accidentally sets `TB_AI_PROVIDER=fake` in a prod deploy, or a default flips it on. | Low / High | Default is the REAL provider for every value except the exact string `fake`. `TB_AI_PROVIDER` is never set in production config or deploy scripts. README documents it as a test-only switch. Selection lives at one factory line, easy to audit. |
| T2 | **Prompt-dispatch fallback masks a real change** — a reworded system prompt falls through to `{}` and a caller silently degrades. | Future edit reworks a system prompt without updating the fake. | Medium / Low (test-only) | Unit test asserts every real system prompt matches a dispatch branch; an unmatched prompt reddens that test. Impact is confined to the test stack (fake never runs in prod). |
| T3 | **Weakened test signal** — a fake that returns blanks lets broken code pass. | Fake returns safe empty defaults everywhere. | Medium / Medium | Fake derives extractor/reconcile output from the actual input against supplied known-entity lists, so the tool must genuinely process it (GATE 2b: deleting the tool logic still reddens the test). De-hedged assertions are hard, not conditional. |
| T4 | **Secret exposure via a live key required in CI** — the pre-change state where every test run needed a real `OPENROUTER_API_KEY`. | Key committed/leaked to make CI green. | (pre-existing) | This change REMOVES the need for a live key in the default/CI path, reducing exposure. The live key is only needed for the explicitly-invoked `test:live-llm` tier. |
| T5 | **Injection through fake output** — fake returns attacker-controlled content that flows into a mutation. | N/A | None | Fake output is a pure function of local test input; there is no external input to the fake. Callers' existing allowlist validation (`parse` callbacks) still applies. |

## Residual risk
The only residual risk is operational (T1): a misconfigured production deploy.
Mitigated by safe-by-default selection and documentation; no code path in
production references `TB_AI_PROVIDER` intentionally.
