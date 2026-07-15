# Failure-memory retrieval oracle

A **deterministic** eval that proves the failure-memory mechanism actually *surfaces the right lesson* for
a given task signature — the evidence gap that prose alone could not close (a lesson nobody retrieves is
dead weight). It is the counterpart to the reviewer-drift fixtures in `../README.md`, but needs **no
model**: it exercises the pure retrieval seam (`scripts/failure-retrieve.mjs`), so it runs in CI via
`npm test` (`../../test/failure-retrieve.test.mjs`), not on demand.

## What it proves — and what it does NOT

- **It IS** a recall + precision oracle for retrieval. For each seeded lesson there is a task signature
  (paths / language / area / error-type tokens) that **must** rank that lesson #1, and unrelated lessons
  **must not** surface. A retired (`expired` / `superseded`) entry must never come back. If a future edit
  to the scoring quietly breaks relevance ranking, a case fails.
- **It is NOT** proof that the model then *obeys* the surfaced lesson. That last hop — the planner reading
  the retrieved entry and not repeating the mistake — stays prompt-driven and is disclosed as such. This
  eval removes the *retrieval* from "model whim"; it does not claim to remove the *application*.

## Files

- `seed.md` — a committed, hand-validated `FAILURE_MEMORY.md` fixture (no extraction noise; the lessons
  live here in version control). Each entry has an unambiguous tag/area.
- `cases.json` — `{ query, expectTop, mustNotMatch }` per case. `query` is the task signature; `expectTop`
  is the title substring that must rank #1 (or `null` when nothing should surface); `mustNotMatch` lists
  titles that must stay out of the top results.

## Running

`npm test` runs it (the test loads `seed.md` + `cases.json` and asserts each case). To try a signature by
hand against the fixture:

```
node cressetide/skills/vigil/scripts/failure-retrieve.mjs \
  --file eval/failure-memory/seed.md --query "npm test jsdom devDependencies node ci"
```

## Discipline

- **Re-run after any change to `failure-retrieve.mjs` scoring or `load-failure-memory.js` ranking.** A case
  flipping from pass to fail is a relevance regression to investigate before merging.
- Adding cases is encouraged — keep `seed.md` entries unambiguous so an expected #1 is defensible.
