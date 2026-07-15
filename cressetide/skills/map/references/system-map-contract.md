# System Map contract

SYSTEM_MAP.md is a high-density evidence index, not a directory dump or exhaustive call graph.

Each important section records the checked commit, update time, confidence, and source paths with
line anchors. verified means the cited source directly establishes the claim; derived means the
claim follows from multiple cited facts; unverified is an explicit coverage gap.

Create and refresh regenerate repository-derived claims so deleted paths are not silently retained.
Version 0.1.0 supports one SYSTEM_MAP.md and no split schema. Verify is read-only and reports commit
drift, missing sections, invalid or out-of-repository sources, unverified sections, and conflicts.
Human operational knowledge exists only between the `CTIDE:MANUAL-NOTES:START` and
`CTIDE:MANUAL-NOTES:END` markers. Refresh preserves that bounded block verbatim; Cartographer compares
it with current evidence, surfaces disagreement, and never overwrites it.

Vigil reads the map before grounding but validates the touched area live. Salvage reads it for rapid
orientation and continues with rapid recon when the map is missing or stale.
