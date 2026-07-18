# Evidence discovery

Techniques for finding and citing the evidence Cartographer's enrichment needs, beyond what the
deterministic baseline already inventories. This is not a license for an exhaustive call graph or a
persisted graph artifact of any kind. The only durable output stays cited prose inside
SYSTEM_MAP.md, exactly as docs/map-contract.md and SKILL.md already require.

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
