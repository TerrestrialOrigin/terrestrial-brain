# product-branding Specification

## Purpose
TBD - created by archiving change branding-separation. Update Purpose after archive.
## Requirements
### Requirement: README headline describes the product without third-party provenance

The README opening tagline (the first prose line beneath the `# Terrestrial Brain` H1) SHALL describe the product on its own terms and SHALL NOT reference "Open Brain", "OB1", or "Nate" (in any casing or spelling, including the "Johnes" misspelling), and SHALL NOT contain third-party endorsement copy such as "subscribe" or "youtube". Legally-required third-party attribution SHALL remain confined to `NOTICE.md` and the README `## License` section.

#### Scenario: README tagline is product-only

- **WHEN** the first prose line under the `# Terrestrial Brain` heading in `README.md` is read
- **THEN** it contains no occurrence of "Open Brain", "open-brain", "OB1", or "Nate" (case-insensitive)
- **AND** it contains no endorsement copy such as "subscribe" or "youtube"
- **AND** it describes Terrestrial Brain as a product (second brain / memory for AI connecting Obsidian to a cloud knowledge base)

#### Scenario: Attribution is retained in its correct home

- **WHEN** the repository is inspected after the branding change
- **THEN** `NOTICE.md` still attributes the MIT-era Open Brain material to Nate B. Jones
- **AND** the README `## License` section still references `NOTICE.md` for third-party attribution

### Requirement: GitHub repository description carries no third-party provenance

The GitHub repository description (repository settings metadata) SHALL describe the product without any "Open Brain" / "OB1" / "Nate" reference. Because this value lives in GitHub settings rather than the repository tree, the change SHALL record the exact required replacement text so the manual update is unambiguous, and SHALL NOT be reported complete while the live description still carries the old provenance text.

#### Scenario: Replacement description text is recorded and provenance-free

- **WHEN** the change artifacts are inspected
- **THEN** an exact replacement description is provided for the GitHub repository settings
- **AND** that replacement text contains no occurrence of "Open Brain", "OB1", or "Nate"
- **AND** the task to apply it in GitHub settings is tracked as a manual action, not auto-completed

### Requirement: No marketing branding references third-party provenance outside retained attribution

A repository sweep for the strings "open brain" / "open-brain" / "OB1" / "Nate" (case-insensitive) SHALL find no occurrence in marketing or product copy. Every surviving occurrence SHALL fall within an allowlisted retained set: `NOTICE.md` (permanent attribution), the README `## License` section (factual attribution pointing at `NOTICE.md`), `ThreatModel.md` factual/compliance notes, append-only `supabase/migrations/**` comments, `codeEval/**` and `openspec/changes/archive/**` historical records, and regex false positives (e.g. "hallucinated", "originated").

#### Scenario: Sweep finds only allowlisted occurrences

- **WHEN** the repository is swept for "open brain" / "open-brain" / "OB1" / "Nate" (case-insensitive), excluding `.git` and `node_modules`
- **THEN** every match is within the allowlisted retained set (attribution, factual/compliance notes, append-only history, plan/archive records, or a documented regex false positive)
- **AND** no match is marketing or product copy that endorses or brands the project through Open Brain / OB1 / Nate

