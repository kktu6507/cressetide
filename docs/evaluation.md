# Evaluation framework

Cressetide includes a neutral, deterministic evaluation dataset for the five
public capabilities. It validates fixture and rubric integrity without calling
an external model, using credentials, or saving run output.

See [`docs/benchmark-contract.md`](benchmark-contract.md) for where a score is safe (this dataset's
closed-world validation and the on-demand behavioral fixtures under `eval/`) and where it never
appears (cressetide's live-run artifacts — the final report, the run ledger, `run-consolidate.mjs`).

## Dataset

Cases live in `eval/cases/*.json`. Each case contains:

- a stable unique `id`;
- one `capability`: `vigil`, `salvage`, `map`, `doctor`, or `ship`;
- a neutral `prompt`;
- bounded fictional `evidence`;
- `requiredTerms` that an evaluated response must include literally;
- `forbiddenTerms` that an evaluated response must not include;
- a `rationale` describing the observable behavior under test.

The dataset contains no production records, model transcripts, benchmark
scores, or stored execution results.

## Validate the dataset

```bash
npm run eval
```

This checks JSON parsing, schema, ID uniqueness, supported capabilities,
non-empty evidence, non-overlapping terms, and neutral fixture boundaries. It
prints a deterministic summary to standard output and writes no files.

## Score candidate responses

Place one UTF-8 Markdown response per case in an arbitrary directory. The
filename must be `<case-id>.md`, then run:

```bash
node eval/run-eval.mjs --responses path/to/responses
```

The runner checks literal required and forbidden terms and exits nonzero when a
response is missing, malformed, or fails a rubric. It does not judge prose
style or semantic similarity. This makes the result reproducible but narrow;
human review is still needed for evidence quality, safety, and correctness.

## Adding a case

Use a fictional repository, system, date, and actor. Keep the evidence small
enough for a reviewer to audit. Prefer one behavioral boundary per case, such
as stale Map handling, evidence preservation before mitigation, or a Doctor
claim that must remain unverified without a live session.

Do not add expected claims that the evidence cannot support. Do not preserve
candidate responses or output files in `eval/`.
