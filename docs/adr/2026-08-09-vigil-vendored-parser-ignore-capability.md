# ADR: Vendored parser and Git-ignore capability for Vigil

- **Status**: accepted
- **Date**: 2026-08-09
- **Scope**: dependency selection and resource policy only

## Context

Approved `test-provenance` v1.6 requires AST parsing and Git-compatible ignore matching to be authorized together before a populated changed-test inventory can be implemented. The repository has no runtime dependencies or lockfile. The release archive contains tracked files under `cressetide/**`, while distribution validation rejects `cressetide/package.json` and `cressetide/node_modules`; therefore an ordinary npm runtime dependency would not be present in the installed plugin.

A non-shipping proof on 2026-08-09 verified `acorn@8.18.0` and `ignore@7.0.6`, including exact tarball integrity, selected-member hashes, MIT license files, normalized UTF-8 byte-range mapping, fail-closed AST profile checks, case-sensitive Git-ignore behavior, nested ignore roots, negation, directory handling, and symlink handling.

Resource measurements on Windows x64 with Node v24.16.0 found a current tracked-source maximum of 210,740 normalized UTF-8 bytes, 24,977 AST nodes, and 21.386 ms parse time; the tracked `.gitignore` is 870 bytes with 15 active patterns. A dense 524,240-byte source produced 109,293 nodes in 1,660.980 ms, and 3,000 patterns occupying 61,889 bytes matched against 1,000 paths in 1,442.875 ms. Earlier 1 MiB/10,000-pattern probes each took about 9.2 seconds, establishing that package identity alone is insufficient without bounded worker execution. One tracked eval fixture did not parse as a standalone module or script because it deliberately contains a top-level `return`; it is outside the authorized `node:test` source profile and is not counted as positive parser evidence.

## Decision

1. Authorize the dependency identities as one inseparable capability set: parser identity `{ implementationId: "node-test-v1", parserId: "acorn", parserVersion: "8.18.0" }` and ignore-engine identity `{ engineId: "ignore", engineVersion: "7.0.6" }`. In this ADR and its manifest, that tuple is an authorization-packet selection only; it is not the formal adapter-registry carrier and does not replace `test-adapters.json`.
2. The only authorized acquisition form is the exact tracked vendored members and license files listed in `cressetide/skills/vigil/vendor/vendor-manifest.json`. Runtime package installation, package-manager resolution, network access, unpinned versions, alternate package members, and transitive dependencies remain unauthorized.
3. This ADR and the manifest authorize only the exact selection, the allowed future vendoring shape, and the required resource policy. They do not themselves authorize copying third-party bytes, writing `test-adapters.json`, implementing the populated producer/consumer path, removing `unsupported-populated-inventory`, migrating records, publishing, or pushing.
4. Acorn offsets are never byte offsets by authority: the wrapper must normalize BOM/line endings first and explicitly map Acorn code-unit ranges to normalized UTF-8 byte ranges.
5. The ignore wrapper must construct `ignore({ ignorecase: false, allowRelativePaths: false })`, apply only tracked S1 `.gitignore` bytes in root-to-leaf order, use canonical repository-relative POSIX paths with literal case, and preserve the approved spec's directory/symlink rules. Unsupported syntax, CommonJS test binding, computed member access, dynamic import, and re-export remain fail-closed for the v1 profile.

## Resource policy

The future dependency wrapper must enforce all limits before producing any artifact.

| Boundary | Limit | Enforcement point |
|---|---:|---|
| Normalized source | 524,288 UTF-8 bytes per source | Before worker dispatch |
| AST size | 100,000 nodes per source | After parsing, before semantic output |
| One authoritative `.gitignore` | 65,536 bytes | Before worker dispatch |
| All authoritative `.gitignore` bytes | 262,144 bytes | Before worker dispatch |
| Authoritative `.gitignore` files | 256 | Before worker dispatch |
| Active ignore patterns | 4,096 per S1 snapshot | Before worker dispatch |
| One ignore pattern | 1,024 UTF-8 bytes | Before worker dispatch |
| Ignore layer depth | 64 directories | Before worker dispatch |
| S1 snapshot entries | 50,000 | Before worker dispatch |

Parser and ignore evaluation must run outside the coordinator in `node:worker_threads` workers, at concurrency one, with `maxOldGenerationSizeMb: 256`, `maxYoungGenerationSizeMb: 64`, and `stackSizeMb: 4`. Parser jobs have a 3,000 ms wall timeout per source; the ignore compile-and-match job has a 5,000 ms wall timeout per S1 snapshot.

Timeout, worker error/exit, memory termination, stack exhaustion, malformed result, or any limit breach is fail-closed and yields no inventory or partial artifact. Workers receive only already-captured S1 bytes and canonical metadata, have no direct filesystem authority, and perform no network access.

## Alternatives considered

- An ordinary root npm dependency plus lockfile was rejected for this release architecture because the shipped plugin is the tracked `cressetide/**` tree and cannot rely on the repository root's installation state. A nested plugin `package.json`/`node_modules` is explicitly forbidden by distribution validation. Changing the release/runtime architecture to make npm dependencies installable is viable only as a separate approved design.
- Writing a new parser or approximate glob matcher was rejected because it would recreate security-sensitive syntax and Git-ignore semantics already supplied by the selected zero-runtime-dependency packages.
- `espree` was not selected because it wraps Acorn and adds dependencies without closing a required capability.
- `minimatch` was not selected because glob matching is not Git-ignore semantics.

## Consequences

Future vendoring is a deliberate source import, not an npm install. It must copy only the four authorized members, preserve both MIT notices, mechanically verify tarball SRI plus extracted byte count/SHA-256 against the manifest, and add tests for provenance, wrapper semantics, limit rejection, timeout/worker termination, and no-write behavior.

Upgrades require a new proof and an intentional manifest/ADR update; floating or compatible ranges are not allowed. The resource ceilings intentionally fail closed on repositories or files outside the authorized operating envelope; raising a ceiling requires measurements and review.

No approved spec is changed by this ADR. The formal `test-adapters.json` remains absent, the populated-inventory gate remains in place, and AC138 continues to apply.

## Revisit triggers

- The release architecture gains an approved, deterministic runtime dependency installation mechanism.
- Either selected version becomes incompatible with Node >=20, changes license, or receives a relevant security advisory.
- A required approved parser/ignore capability is missing.
- Legitimate repositories exceed a resource ceiling with measured safe behavior.
- A dependency version, selected member, or resource-policy change is proposed.

## Approval evidence

The exact selection followed a non-shipping proof and targeted architecture, security, test, and gatekeeper review. The user explicitly approved creation of the dependency authorization packet on 2026-08-09. Copying the authorized third-party members remains a separate explicit step.
