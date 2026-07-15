// Behavioral regression runner for eval/fixtures/ — see eval/README.md.
//
// This is a Claude Code **Workflow** script (it uses the Workflow runtime globals: agent / pipeline /
// phase / log). It is NOT a standalone Node script. Run it on demand via the Workflow tool — e.g. after
// editing a reviewer/agent prompt — then update eval/baseline.md with the new scores. It costs model
// tokens (one reviewer + one judge per fixture), which is why this is on-demand, not a CI gate.
//
// Method: for each committed fixture it (1) extracts intent + code (the reviewer never sees the defect),
// (2) blind-reviews with the real ctide:code-reviewer, (3) scores with an INDEPENDENT judge against the
// fixture's `expected` + `defect`. Reports hit recall (with-bug fixtures) + clean precision (controls).

export const meta = {
  name: 'fixture-eval',
  description: "Behavioral regression baseline: blind-review each committed eval fixture with the real ctide:code-reviewer, score with an independent judge vs the fixture's expected outcome",
  phases: [
    { title: 'Evaluate', detail: 'extract -> blind review -> independent judge, per fixture' },
    { title: 'Synthesize', detail: 'hit recall + clean precision' },
  ],
}

const EXTRACT_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['id', 'lang', 'expected', 'defect', 'intent', 'code'],
  properties: {
    id: { type: 'string' }, lang: { type: 'string' },
    expected: { type: 'string', enum: ['hit', 'clean'] },
    defect: { type: 'string', description: 'ground-truth defect (hit) or why it is a clean control' },
    intent: { type: 'string', description: 'the Intent line (the contract)' },
    code: { type: 'string', description: 'the code from the fenced block, verbatim' },
  },
}
const JUDGE_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['result', 'pass', 'rationale'],
  properties: {
    result: { type: 'string', enum: ['hit', 'miss', 'clean-ok', 'false-positive'] },
    pass: { type: 'boolean', description: 'true = the reviewer did the right thing for this fixture' },
    rationale: { type: 'string' },
  },
}

// Keep in sync with the files under eval/fixtures/ (add new fixtures here).
const FIXTURES = [
  'eval/fixtures/01-js-missing-return.md',
  'eval/fixtures/02-py-off-by-one.md',
  'eval/fixtures/03-go-nil-before-check.md',
  'eval/fixtures/04-py-mutable-default.md',
  'eval/fixtures/05-js-foreach-await.md',
  'eval/fixtures/06-clean-js-guard.md',
  'eval/fixtures/07-clean-py-bounds.md',
]

phase('Evaluate')
const results = await pipeline(
  FIXTURES,
  // 1. extract the fixture (an Explore agent reads the committed file)
  (path) => agent(
    "Read the file " + path + " and extract its YAML frontmatter and body into the schema. `code` = the verbatim contents of the fenced code block; `intent` = the text after 'Intent:'. Return exactly what's in the file; do not edit or fix the code.",
    { label: 'extract:' + path.split('/').pop(), phase: 'Evaluate', agentType: 'Explore', schema: EXTRACT_SCHEMA }
  ),
  // 2. BLIND review with the real ctide:code-reviewer — sees ONLY intent + code (never defect/expected)
  (fx) => agent(
    "Review this code for correctness against the stated intent. It is a focused excerpt — treat undefined external symbols as correct and review only the logic shown. You do NOT know whether a defect exists; report what you actually find by severity (blocker/major/minor), or state it is clean. Be precise; do not pad.\n\nIntent: " + fx.intent + "\n\nCode (" + fx.lang + "):\n```\n" + fx.code + "\n```",
    { label: 'review:' + fx.id, phase: 'Evaluate', agentType: 'ctide:code-reviewer' }
  ).then((review) => ({ fx, review })),
  // 3. independent judge — sees the review + the fixture ground truth
  (x) => agent(
    "You are an INDEPENDENT benchmark judge (NOT a ctide reviewer). Score a blind review against a fixture's known ground truth.\n\nexpected = \"" + x.fx.expected + "\"\nground-truth: " + x.fx.defect + "\n\nThe reviewer's findings:\n" + x.review + "\n\nScoring:\n- If expected=hit: result='hit' & pass=true ONLY if the reviewer clearly flagged the actual ground-truth defect (a vaguely related comment is not a hit); else result='miss' & pass=false.\n- If expected=clean: result='false-positive' & pass=false if the reviewer raised a CONFIDENT blocker or major that is not a real defect (a hedged 'consider' or a pure style/minor note is NOT a false positive); else result='clean-ok' & pass=true.",
    { label: 'judge:' + x.fx.id, phase: 'Evaluate', schema: JUDGE_SCHEMA }
  ).then((j) => ({ id: x.fx.id, lang: x.fx.lang, expected: x.fx.expected, result: j.result, pass: j.pass, rationale: j.rationale }))
)

phase('Synthesize')
const r = results.filter(Boolean)
const hits = r.filter((x) => x.expected === 'hit')
const cleans = r.filter((x) => x.expected === 'clean')
const hitPass = hits.filter((x) => x.pass).length
const cleanPass = cleans.filter((x) => x.pass).length
log(`hit recall ${hitPass}/${hits.length} · clean precision ${cleanPass}/${cleans.length}`)

return {
  summary: `Behavioral baseline (current ctide:code-reviewer, blind, independent judge): hit recall ${hitPass}/${hits.length}, clean precision ${cleanPass}/${cleans.length}.`,
  hit_recall: `${hitPass}/${hits.length}`,
  clean_precision: `${cleanPass}/${cleans.length}`,
  details: r,
}
