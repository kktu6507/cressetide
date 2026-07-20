# Evidence discovery

Techniques for finding and citing the evidence Cartographer's enrichment needs, beyond what the
deterministic baseline already inventories. Two invariants bound this work, exactly as
docs/map-contract.md and SKILL.md already require. First: Map's only durable output is cited prose
inside SYSTEM_MAP.md — Cartographer neither hand-builds an exhaustive call graph nor persists any
graph artifact of its own, and no index file ever becomes part of the Map. Second: no claim lands
in SYSTEM_MAP.md without opening the cited file, regardless of what surfaced the lead.

A structural index that already exists in the environment (an LSP server, a code-review-graph
database, or similar) may be queried as a lead source under Detect → Use → Else-Disclose
(../../vigil/references/external-capabilities.md, "Structural code indexes"). Index output is a
candidate, never evidence: confirm it in the real file, cite path:line, and treat a stale index as
suspect until its own freshness check passes. Without an index, the lean techniques below are the
baseline and are sufficient on their own.

Entry points are not only a main/index/app/program/server filename, a package.json bin path, or a
script's own shebang line — the deterministic baseline already finds and dedupes those signals.
Cartographer's remaining work here: what each package.json script actually runs, a Dockerfile's CMD
or ENTRYPOINT, a CI workflow step that invokes a script directly, and any documented CLI command in
the README or docs. A file that no other source file in the repository imports is itself a stronger
entry-point signal than a filename convention. A lean grep for the file's own basename across the
repository is enough to check this; it does not require building a full import graph.

Trace an execution flow one level, not recursively. Grep the export or function name at the entry
point, read its immediate call sites, and describe the flow as entry → boundary → side effect →
observable result. Do not chase the callees of callees; a bounded, cited single hop beats an
unbounded and uncited walk.

Trace a data flow the same way. Grep the write call sites and the read call sites for a candidate
store or path separately, then attribute ownership to whichever call sites actually persist or read
it. A filename that merely contains "store" or "cache" is a candidate to check, never evidence of
ownership by itself.
