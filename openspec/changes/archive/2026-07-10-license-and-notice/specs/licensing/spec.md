## ADDED Requirements

### Requirement: Repository publishes an FSL-1.1-MIT license file

The repository SHALL contain a `LICENSE.md` file at its root holding the full, official **FSL-1.1-MIT** (Functional Source License 1.1, MIT future license) text, with the Licensor identified as Anastasia Rohner / Terrestrial Origin and the year 2026. No template parameter placeholders (tokens of the form `<...>` or unfilled `{{...}}`) SHALL remain in the shipped file.

#### Scenario: License file present and identifies FSL-1.1-MIT

- **WHEN** the repository root is inspected
- **THEN** `LICENSE.md` exists
- **AND** it contains the identifier "Functional Source License" and "MIT" as the future license
- **AND** it names Terrestrial Origin / Anastasia Rohner as the Licensor with year 2026

#### Scenario: No unfilled template placeholders

- **WHEN** `LICENSE.md` is scanned for placeholder tokens
- **THEN** it contains no unfilled `<placeholder>` parameter tokens

### Requirement: Repository publishes an MIT attribution NOTICE for Open Brain

The repository SHALL contain a `NOTICE.md` file at its root that attributes the MIT-era Open Brain material: it MUST state that portions of the schema/server derive from Open Brain by Nate B. Jones, published under the MIT License on 2026-03-11 (repository `NateBJones-Projects/OB1`, through commit `f3e45e1`), and MUST reproduce the MIT license text including the line "Copyright (c) 2026 Nate B. Jones." The NOTICE SHALL be retained permanently, independent of any later rewrite of the derived fragments.

#### Scenario: NOTICE names the source and provenance

- **WHEN** `NOTICE.md` is inspected
- **THEN** it names "Open Brain" and "Nate B. Jones"
- **AND** it states the MIT publication date 2026-03-11 and the commit `f3e45e1`

#### Scenario: NOTICE reproduces the MIT permission notice

- **WHEN** `NOTICE.md` is inspected
- **THEN** it contains "Copyright (c) 2026 Nate B. Jones"
- **AND** it contains the MIT permission-notice sentence "Permission is hereby granted, free of charge"

### Requirement: README states the actual license and tier split

The README `## License` section SHALL state that the project is licensed under FSL-1.1-MIT (referencing `LICENSE.md`), explain the tier split in plain language (free self-host, non-compete, per-version conversion to MIT two years after each release), and reference `NOTICE.md` for third-party attribution. It SHALL NOT present the project's own license as bare "MIT."

#### Scenario: README license section is accurate

- **WHEN** the README `## License` section is read
- **THEN** it references FSL-1.1-MIT and `LICENSE.md`
- **AND** it explains the free-self-host / non-compete / 2-year-MIT-conversion tier split
- **AND** it references `NOTICE.md`
- **AND** the section body is not merely the single word "MIT"
