# memory-mechanism-audit Specification

## Purpose
TBD - created by archiving change memory-mechanism-audit. Update Purpose after archive.
## Requirements
### Requirement: Reproducible READ-ONLY memory-mechanism audit procedure

The project SHALL maintain a documented, repeatable procedure for auditing its memory mechanisms
(usefulness scoring, deduplication, extraction) against the live production database. The procedure
SHALL be strictly READ-ONLY and SHALL NOT print or persist credentials.

#### Scenario: Procedure is documented and re-runnable
- **WHEN** an agent or human needs to audit the memory mechanisms
- **THEN** `docs/usefulness-audit-runbook.md` provides the project ref source, an authentication path,
  and a numbered set of `SELECT`-only queries covering corpus, volume/trend, nudge compliance,
  increment integrity, rubber-stamp, deduplication, and extraction-allowlist adherence

#### Scenario: Audit never mutates production
- **WHEN** any query in the runbook is executed against production
- **THEN** it is a `SELECT` — no `UPDATE`, `DELETE`, or `INSERT` is run during an audit, and any needed
  fix is filed as a task rather than applied to production

#### Scenario: Credentials are never leaked
- **WHEN** the audit authenticates via the Management API query endpoint
- **THEN** the access token is read into a shell variable (or kept in the keyring) and never appears in
  command output, report files, or committed content

### Requirement: Current memory-mechanism audit report

The project SHALL keep a current, dated audit report that classifies every memory mechanism as either
server-side-enforced or prompt-nudge/LLM-dependent, backed by production data and a code map, so that
memory-hygiene work has an explicit evidence base.

#### Scenario: Report classifies each mechanism by enforcement
- **WHEN** the memory-mechanism audit report is read
- **THEN** for deduplication, extraction, and usefulness scoring it states whether the mechanism is
  enforced server-side or relies on prompt-nudge/LLM compliance, and lists the mechanisms that must move
  to server-side enforcement in the hygiene-implementation step

#### Scenario: Every numeric claim is reproducible
- **WHEN** the report states a metric (e.g. duplicate counts, out-of-allowlist type counts, compliance %)
- **THEN** the metric is traceable to a runbook query that can be independently re-run READ-ONLY

#### Scenario: Report carries the interpretation guards
- **WHEN** a reader draws a conclusion about archival or usefulness from the report
- **THEN** the report supplies the epoch rule and the "score 0 = no data, not not-useful" guard, and does
  not recommend score-alone archival

#### Scenario: Report is provenance-clean
- **WHEN** the report and committed audit artifacts are swept for external-provenance branding
- **THEN** they contain no Open Brain / OB1 / Nate references outside the allowlisted attribution homes,
  consistent with the branding-separation guard

