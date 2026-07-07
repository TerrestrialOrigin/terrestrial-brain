# plugin-packaging Specification

## Purpose
TBD - created by archiving change plugin-config-hygiene. Update Purpose after archive.
## Requirements
### Requirement: Consistent plugin version across metadata files

The plugin SHALL report one authoritative version, identical in `manifest.json` and `package.json`. The `manifest.json` `version` field is the source of truth.

#### Scenario: Manifest and package versions match
- **WHEN** the plugin's `manifest.json` and `package.json` are read
- **THEN** both `version` fields SHALL be equal to the same value (`1.1.0`)

### Requirement: versions.json maps plugin version to minimum app version

The plugin SHALL include a root-level `versions.json` mapping each released plugin version to the minimum Obsidian app version it supports, so Obsidian can gate updates for compatibility.

#### Scenario: versions.json exists and covers the current version
- **WHEN** the plugin folder is read
- **THEN** a `versions.json` file SHALL exist
- **AND** it SHALL contain an entry whose key equals the `manifest.json` `version`
- **AND** whose value equals the `manifest.json` `minAppVersion`

### Requirement: Reproducible dependency versions

The plugin's build dependencies SHALL be pinned to explicit versions or bounded ranges, with no floating `"latest"` specifier, so that a checkout builds reproducibly.

#### Scenario: obsidian dependency is pinned
- **WHEN** `package.json` `devDependencies` are read
- **THEN** the `obsidian` entry SHALL be a concrete version specifier, not `"latest"`

#### Scenario: Build and tests pass on the pinned toolchain
- **WHEN** `npm run build` and `npm test` are run in `obsidian-plugin/`
- **THEN** both SHALL complete successfully with zero test failures and zero skips

### Requirement: Concise manifest description

The plugin `manifest.json` `description` SHALL be a short summary (one or two sentences); detailed command and usage documentation SHALL live in the README, not the manifest.

#### Scenario: Description is concise
- **WHEN** the `manifest.json` `description` is read
- **THEN** it SHALL be a brief summary of what the plugin does (materially shorter than the previous ~1,400-character text)
- **AND** the removed command/usage detail SHALL be present in the README

### Requirement: Theme-overridable modal styling via styles.css

The AI-output confirmation modal SHALL be styled via CSS rules in a root-level `styles.css`, keyed on the modal's `tb-ai-output-*` classes, rather than inline `element.style.*` assignments, so that Obsidian themes can override the appearance.

#### Scenario: Modal elements carry classes, not inline styles
- **WHEN** the confirm modal is rendered
- **THEN** its styled elements SHALL carry `tb-ai-output-*` classes
- **AND** the modal source SHALL NOT set presentational `element.style.*` properties for those elements

#### Scenario: styles.css provides the modal rules
- **WHEN** the plugin folder is read
- **THEN** a `styles.css` file SHALL exist
- **AND** it SHALL contain rules for the `tb-ai-output-*` classes used by the confirm modal

#### Scenario: Rendering behavior is unchanged
- **WHEN** the confirm modal is opened with pending AI outputs, including conflicting file paths
- **THEN** it SHALL render the same structure and controls as before (list, per-file conflict selector, accept/reject/postpone buttons) and behave identically

