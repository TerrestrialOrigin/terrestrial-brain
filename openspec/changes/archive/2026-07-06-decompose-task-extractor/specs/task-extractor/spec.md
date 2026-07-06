## ADDED Requirements

### Requirement: Task reconciliation matches checkboxes to existing tasks one-to-one

On re-ingest, `TaskExtractor` SHALL reconcile the note's checkboxes against the existing (non-archived) tasks for the note using a two-pass, greedy, strictly one-to-one matching. Pass 1 SHALL match on content similarity (`longestCommonSubsequence / maxLength`) at a threshold of at least 0.8. Pass 2 SHALL match remaining checkboxes and tasks on containment (`longestCommonSubsequence / minLength`) at a threshold of at least 0.85, considering only pairs whose shorter normalized text is at least a minimum length. Within each pass, candidate pairs SHALL be accepted highest-score-first, and each checkbox and each existing task SHALL be matched at most once. Checkboxes left unmatched SHALL become new tasks; existing tasks left unmatched SHALL be archived. Any cheap prefilter applied before scoring SHALL be a necessary condition for clearing the pass threshold, so the set of accepted matches is identical to matching without the prefilter.

#### Scenario: Unchanged checkbox re-ingested matches its existing task
- **WHEN** a note is ingested creating a task, then re-ingested with the same checkbox text unchanged
- **THEN** the checkbox SHALL match the existing task (updated in place, not duplicated) and no new task SHALL be created for it

#### Scenario: Lightly edited checkbox still matches its existing task
- **WHEN** a checkbox whose stored task content is "Review the deployment plan" is re-ingested as "Review the deployment plans" (similarity ≥ 0.8)
- **THEN** the checkbox SHALL match the existing task via the similarity pass rather than creating a new task

#### Scenario: Checkbox with added metadata matches via containment
- **WHEN** a checkbox whose stored task content is "Fix the login bug" is re-ingested as "Fix the login bug (assigned: Alice) (deadline: March 30)" so the stored content is fully contained after marker stripping (containment ≥ 0.85)
- **THEN** the checkbox SHALL match the existing task via the containment pass rather than creating a new task

#### Scenario: Each existing task is matched at most once
- **WHEN** two near-duplicate checkboxes are reconciled against a single existing task
- **THEN** at most one checkbox SHALL match that task and the other SHALL be treated as unmatched (a new task), never matching the same task twice

#### Scenario: Prefilters do not change which pairs match
- **WHEN** reconciliation runs with the cheap prefilters (exact-equality, length-ratio, token-set overlap) enabled
- **THEN** the resulting matched set SHALL be identical to reconciliation that scores every pair with the full LCS and no prefilter

#### Scenario: Removed checkbox archives its existing task
- **WHEN** a note previously produced a task and is re-ingested with that checkbox removed and no other checkbox matches the task
- **THEN** the existing task SHALL be archived (unmatched task path), not left active

### Requirement: greedyMatch is an exported one-to-one assignment helper

`TaskExtractor` SHALL expose a `greedyMatch` helper that, given scored checkbox-to-task candidate pairs and a threshold, returns the accepted pairs selected greedily in descending score order such that no checkbox index and no task id appears in more than one accepted pair, and no pair below the threshold is accepted. Both reconciliation passes SHALL use this single helper.

#### Scenario: Highest-scoring pair wins a contested assignment
- **WHEN** `greedyMatch` receives two pairs sharing the same task id with scores 0.95 and 0.90, both above threshold
- **THEN** only the 0.95 pair SHALL be accepted and the 0.90 pair SHALL be rejected because its task is already taken

#### Scenario: Below-threshold pairs are excluded
- **WHEN** `greedyMatch` receives a pair whose score is below the given threshold
- **THEN** that pair SHALL NOT appear in the accepted result

#### Scenario: Disjoint pairs are all accepted
- **WHEN** `greedyMatch` receives pairs with distinct checkbox indices and distinct task ids, all above threshold
- **THEN** every pair SHALL be accepted
