# Review Packet field example

Source: illustrative Cressetide contract-field example. It is not a historical run and is not evidence.

A real handoff must follow `cressetide/skills/vigil/references/review-packet.md` and include the full shared reviewer contract.

## Requirement summary

Add a bounded validator rule and regression tests without changing unrelated runtime behavior.

## Success criteria

1. Accepted input remains accepted.
2. The newly forbidden input fails with a specific diagnostic.
3. Missing, duplicate, and unexpected values are tested where applicable.
4. Repository-required validation, tests, and evals pass.
5. No unrelated file or technical contract changes.

## In scope

- The validator entry point and its delegated core module.
- Focused validator tests.
- The directly corresponding documentation.

## Out of scope

- Hook behavior.
- Agent or skill roster changes.
- Release publication, commit, push, or remote state.

## Assumptions

- The requirement is local and does not change a public schema.
- Existing test helpers remain the source of fixture setup.

## Changed files or diff summary

| Path | Purpose |
|---|---|
| `<validator path>` | Add the approved rule. |
| `<test path>` | Add success and failure regression coverage. |
| `<documentation path>` | Describe the current rule without release history. |

## Verification evidence

| Command or check | Ran? | Observed result |
|---|---:|---|
| `<focused test>` | `<yes/no>` | `<exit status and summary>` |
| `npm run validate` | `<yes/no>` | `<exit status and summary>` |
| `npm test` | `<yes/no>` | `<exit status and summary>` |
| `npm run eval` | `<yes/no>` | `<exit status and summary>` |

## Known risks

- `<remaining risk or none identified>`

## Reviewer-specific scope

- `intent-reviewer`: requirement and scope fidelity.
- `test-reviewer`: regression coverage and verification sufficiency.
- Add conditional reviewers only for the risks actually present.

## Context exclusions

Do not review unrelated modules, release history, or repository metadata unless the changed diff touches them.

## Shared reviewer contract

Paste the full contract verbatim from `cressetide/skills/vigil/references/review-packet.md`; this example does not duplicate the source of truth.

## fork_context

`fork_context=false`

Reason: the packet contains the current requirement, scope, evidence, risks, and exclusions. No historical context is required.
