# people-extractor — Delta (quota-metering-accuracy / phase-c-remainder)

## ADDED Requirements

### Requirement: One malformed detection element never poisons the batch

The people-detection parse callback SHALL validate each response element before property access; a malformed element (e.g. `null`) is skipped and the remaining valid detections are applied.

#### Scenario: Null element in detections

- **WHEN** the detection response is `[null, { name: "Alice", id: <known id> }]`
- **THEN** Alice is still detected and referenced
