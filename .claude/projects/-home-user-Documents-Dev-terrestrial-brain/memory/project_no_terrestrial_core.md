---
name: No TerrestrialCore dependency
description: terrestrial-brain does not use terrestrial-core packages — they are a separate, unrelated repo
type: project
---

terrestrial-brain has no dependency on terrestrial-core, terrestrial-core-firebase, terrestrial-core-algolia, terrestrial-core-react, or core-full-test. Those are a separate project at /home/user/Documents/Dev/TerrestrialCore/.

**Why:** The CLAUDE.md testing rules reference those packages, but they only apply when working in the TerrestrialCore repo, not here.

**How to apply:** When running tests in terrestrial-brain, run the tests that actually exist in this repo: Vitest unit tests (extractors, validators, obsidian-plugin) and Deno integration tests (tests/integration/). Do not reference terrestrial-core packages.
