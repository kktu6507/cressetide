# Map contract

The Cressetide Map is a high-density, repository-grounded index for system
orientation, change planning, and incident response. It is not a directory
dump, exhaustive call graph, or substitute for direct evidence.

## Storage model

Version 0.1.0 supports exactly one Map document:

```text
.ctide/map/SYSTEM_MAP.md
```

Split Map documents for large monorepositories are not implemented in version
0.1.0. The runtime does not create, refresh, or verify `REPOSITORY.md`,
`ARCHITECTURE.md`, `FLOWS.md`, or `OPERATIONS.md`.

## Required coverage

### Repository structure

- top-level directories, languages, and frameworks;
- package and workspace boundaries;
- generated, vendor, and build directories;
- primary configuration, test locations, scripts, and commands.

### Architecture boundaries

- modules, services, packages, and responsibilities;
- entry points, public interfaces, internal boundaries, and ownership hints
  when evidence supports them.

### Execution flows

- important request and user flows;
- background jobs and scheduled tasks;
- event producers, consumers, and queues;
- command-line entry points.

### Data flows

- stores, schema changes, transactions, and caches;
- serialized formats, data ownership, external exchange, and trust boundaries.

### External integrations

- APIs, identity providers, payment gateways, message brokers, cloud services,
  file transfer, third-party dependencies, and known health locations.

### Runtime and operations

- environments, build, run, and deployment mechanisms;
- containers and orchestration;
- health checks, logs, metrics, and traces;
- rollback, feature flags, kill switches, backup, and restore.

### Risk and uncertainty

- high-risk modules, authentication boundaries, and destructive operations;
- production-only assumptions and unverified paths;
- stale sections, missing observability, and missing rollback validation.

## Provenance

The document header records the repository state independently of commit
identity:

```text
Verified at commit: <SHA or UNBORN>
Working tree fingerprint: sha256:<digest>
Last updated: <ISO-8601 date>
```

The fingerprint hashes the scanner-visible repository paths and file bytes,
excluding `.git/`, `.ctide/`, and the generated or vendored directories that
Map deliberately omits. It therefore detects dirty source changes and source
changes in an `UNBORN` repository even when commit identity cannot change.

Every important section includes:

```text
Verified at commit: <SHA or UNBORN>
Last updated: <ISO-8601 date>
Confidence: verified | derived | unverified
Source fingerprint: sha256:<digest> | UNVERIFIED
Sources:
- path/to/file:line-or-line-range
```

- `verified` means the stated claim was directly confirmed from the cited
  current evidence.
- `derived` means the claim is a bounded inference from cited current evidence;
  the inference must be explained.
- `unverified` means available repository evidence cannot establish the claim;
  the text includes `UNVERIFIED` and the missing evidence.

Each citation must use an existing repository-relative text path and a positive
line or inclusive line range, such as `src/main.js:12` or
`src/main.js:12-18`. The cited range must exist and the source fingerprint must
match its current content. Generated files, missing paths, invalid ranges, or a
matching commit alone are not sufficient evidence.

The deterministic helper emits an inventory baseline, not a completed Map.
Any heuristic sentence that says evidence is required or that Cartographer
must confirm a claim remains `Confidence: unverified`, carries an explicit
`UNVERIFIED` marker, and makes `map verify` fail. Verification passes only
after every such placeholder is replaced by concrete, cited enrichment.

## Create, refresh, and verify

### Create

`/ctide:map` inventories repository boundaries, records current commit identity
and the working-tree/source fingerprints, and creates the single supported
`SYSTEM_MAP.md`. Heuristic coverage gaps remain explicitly unverified until
Cartographer replaces them with concrete repository evidence.

### Refresh

`/ctide:map refresh` compares every generated section with current evidence.
It removes or replaces references to deleted paths, recomputes confidence,
source fingerprints, and the working-tree fingerprint, surfaces conflicts with
marked human-verified operational notes, and updates the recorded commit and
date. It does not silently preserve a generated claim whose source is gone.

### Verify

`/ctide:map verify` is read-only. It checks:

- recorded commit versus current commit or `UNBORN` state;
- working-tree and cited-source content fingerprints;
- cited source existence and valid relevant line ranges;
- required section coverage;
- confidence labels and `UNVERIFIED` markers;
- heuristic placeholders that still require or must confirm evidence;
- conflicting or stale claims.

The result identifies each stale, missing, conflicting, or unverified section
and the evidence needed to resolve it.

## Consumer behavior

Vigil reads the Map before planning, then verifies every touched area live.
Salvage reads it at wartime start for entry points, dependencies, observability,
data paths, rollback, and kill switches. If the Map is missing or stale,
Salvage continues with rapid reconnaissance, discloses the coverage gap, and
requests a later refresh. Neither loop blindly trusts the Map.

See [`../examples/SYSTEM_MAP.md`](../examples/SYSTEM_MAP.md) for a fictional
template with no operational assertions.
