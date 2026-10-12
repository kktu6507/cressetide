#!/usr/bin/env node
// L1b baseline driver: prepare -> run-one-next (x14) -> set-budget -> summarize.
//
// One paid role invocation per `run-one-next`, in a frozen order, with exclusive per-attempt
// markers and no implicit retry. It produces a constrained-excerpt prompt-drift baseline for
// the shipped code-reviewer prompt, plus the call accounting for those same invocations. It
// never writes to the repository, never writes to a product ledger, never updates
// `eval/baseline.md`, and performs no git operations. See docs/efficiency-measurement.md.
//
// The method is frozen (Opus 5 / xhigh / CLI 2.1.263). There is no operator configuration:
// no extra argv, no flag remapping, no model override. A different method is a source edit.
//
// Integrity model: recorded claims are never consumed. Every number, grade and fault used by
// this driver is re-derived from the raw transcript, and the recorded values are compared
// against that derivation. The manifest and budget seals detect accidental edits and
// corruption. They are NOT signatures and NOT authentication: someone able to rewrite the
// records, the raw transcripts, the seals and this source can produce any result.
//
// Import-safe: importing this module performs no I/O and starts no process.

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawn, spawnSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { fileURLToPath, pathToFileURL } from 'node:url'

import * as protocol from './protocol.mjs'
import { parseStream, strictZeroChildFaults, initFaults, splitJsonLines } from './stream-usage.mjs'

export const ROOT_PREFIX = 'ctide-eff-'
export const WORK_PREFIX = 'ctide-eff-work-'
export const PER_CALL_BUDGET_USD = 2
export const PER_CALL_TIMEOUT_MS = 300_000
export const POST_KILL_GRACE_MS = 10_000
export const VERSION_PROBE_TIMEOUT_MS = 20_000
export const MAX_AGGREGATE_USD = 28
export const FIRST_PAIR_STEPS = 2
export const TOTAL_STEPS = 14
export const MANIFEST_VERSION = 2

const MODULE_PATH = fileURLToPath(import.meta.url)
const DEFAULT_REPO_ROOT = path.resolve(path.dirname(MODULE_PATH), '..', '..')

// --- small helpers --------------------------------------------------------------------------

export function isWithin(parent, child) {
  const rel = path.relative(parent, child)
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel))
}

function readText(file) {
  return fs.readFileSync(file, 'utf8')
}

function readJson(file) {
  return JSON.parse(readText(file))
}

function writeExclusive(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, data, { flag: 'wx' })
}

function sha256File(file) {
  return protocol.sha256Hex(fs.readFileSync(file))
}

function stepTag(index) {
  return `step-${String(index).padStart(2, '0')}`
}

export function attemptPath(root, index, kind) {
  return path.join(root, 'attempts', `${stepTag(index)}.${kind}.json`)
}

export function rawPath(root, index, stream) {
  return path.join(root, 'raw', `${stepTag(index)}.${stream === 'stdout' ? 'stdout.jsonl' : 'stderr.txt'}`)
}

export function promptPath(root, index) {
  return path.join(root, 'prompts', `${stepTag(index)}.user.txt`)
}

export function systemPromptPath(root, role) {
  return path.join(root, 'prompts', role === 'reviewer' ? 'reviewer.system.txt' : 'judge.system.txt')
}

export function manifestPath(root) {
  return path.join(root, 'manifest.json')
}

export function manifestSealPath(root) {
  return path.join(root, 'manifest.seal')
}

export function budgetPath(root) {
  return path.join(root, 'budget.json')
}

export function budgetSealPath(root) {
  return path.join(root, 'budget.seal')
}

export function expectedToolsFor(role) {
  return role === 'reviewer' ? protocol.REVIEWER_TOOLS : protocol.JUDGE_TOOLS
}

function defaultDeps(overrides = {}) {
  return {
    spawn,
    spawnSync,
    uuid: randomUUID,
    now: () => new Date().toISOString(),
    tmpdir: () => os.tmpdir(),
    workspaceRoot: DEFAULT_REPO_ROOT,
    log: (line) => process.stdout.write(`${line}\n`),
    ...overrides,
  }
}

// --- executable identity ------------------------------------------------------------------------

/**
 * One bounded, offline, injectable probe answering one question: what version does this exact
 * executable report? It is a SELF-REPORT. Together with the file hash it detects an upgrade, a
 * rebuild or a wrong binary; neither is authenticity evidence.
 */
export function probeCliVersion(commandRealPath, deps) {
  let outcome
  try {
    outcome = deps.spawnSync(commandRealPath, ['--version'], {
      shell: false,
      windowsHide: true,
      timeout: VERSION_PROBE_TIMEOUT_MS,
      encoding: 'utf8',
    })
  } catch {
    return { ok: false, version: null, fault: 'cli-version-probe-failed' }
  }
  if (!outcome || outcome.error || outcome.status !== 0) {
    return { ok: false, version: null, fault: 'cli-version-probe-failed' }
  }
  const match = /(\d+\.\d+\.\d+)/.exec(String(outcome.stdout ?? ''))
  if (!match) return { ok: false, version: null, fault: 'cli-version-unparsed' }
  return { ok: true, version: match[1], fault: null }
}

export function cliDriftFaults(cli, deps) {
  let digest
  try {
    digest = sha256File(cli.commandRealPath)
  } catch {
    return ['cli-command-missing']
  }
  const faults = []
  if (digest !== cli.commandSha256) faults.push('cli-command-drift')
  const probe = probeCliVersion(cli.commandRealPath, deps)
  if (!probe.ok) faults.push(probe.fault)
  else if (probe.version !== protocol.CLI_VERSION) faults.push(`cli-version-mismatch:${probe.version}`)
  else if (cli.observedVersion !== probe.version) faults.push(`cli-version-changed:${probe.version}`)
  return faults
}

// --- root, sources and manifest validation --------------------------------------------------------

/**
 * The experiment root must be a direct child of the real temp directory with the reserved
 * prefix, and must not nest with the source workspace in either direction. Canonical paths are
 * compared so a symlink cannot smuggle the root into the workspace.
 */
export function rootFaults(root, { workspaceRoot, tmpdir }) {
  let real
  try {
    real = fs.realpathSync(root)
  } catch {
    return ['root-missing']
  }
  const faults = []
  const realTmp = fs.realpathSync(tmpdir())
  if (path.dirname(real) !== realTmp) faults.push('root-not-direct-tmpdir-child')
  if (!path.basename(real).startsWith(ROOT_PREFIX)) faults.push('root-prefix')
  const realWorkspace = fs.realpathSync(workspaceRoot)
  if (isWithin(realWorkspace, real) || isWithin(real, realWorkspace)) faults.push('root-workspace-nesting')
  return faults
}

export function manifestRootFaults(root, manifest) {
  let real
  let repo
  try {
    real = fs.realpathSync(root)
    repo = fs.realpathSync(manifest.repoRoot)
  } catch {
    return ['manifest-repo-root-missing']
  }
  if (isWithin(repo, real) || isWithin(real, repo)) return ['root-workspace-nesting']
  return []
}

export function sourceRelativePaths(entries) {
  return [
    protocol.AGENT_RELATIVE_PATH,
    protocol.REVIEW_PACKET_RELATIVE_PATH,
    protocol.REVIEWER_COMMON_RELATIVE_PATH,
    protocol.MANIFEST_RELATIVE_PATH,
    'eval/efficiency/stream-usage.mjs',
    'eval/efficiency/protocol.mjs',
    'eval/efficiency/l1b-driver.mjs',
    ...entries.map((entry) => entry.file),
  ]
}

export function hashSources(repoRoot, relativePaths) {
  const out = {}
  for (const relative of relativePaths) {
    out[relative] = sha256File(path.join(repoRoot, relative))
  }
  return out
}

export function sourceDriftFaults(repoRoot, frozen) {
  const faults = []
  for (const [relative, digest] of Object.entries(frozen)) {
    let current
    try {
      current = sha256File(path.join(repoRoot, relative))
    } catch {
      faults.push(`source-missing:${relative}`)
      continue
    }
    if (current !== digest) faults.push(`source-drift:${relative}`)
  }
  return faults
}

export function planSteps(entries) {
  const steps = []
  for (const entry of entries) {
    steps.push({ index: steps.length, role: 'reviewer', fixtureId: entry.id })
    steps.push({ index: steps.length, role: 'judge', fixtureId: entry.id })
  }
  return steps
}

function manifestEntries(manifest) {
  return manifest.fixtures.map((fixture) => ({
    id: fixture.id,
    file: fixture.file,
    lang: fixture.lang,
    expected: fixture.expected,
    scorer: fixture.scorer,
  }))
}

/**
 * Validate the sealed manifest's structure and canonical claims BEFORE any path it carries is
 * used. Ids are checked by `protocol.manifestFaults` (which rejects traversal and pins
 * `eval/fixtures/<id>.md`) before this function joins anything to the repository root.
 */
export function manifestValidationFaults(root, manifest, seal, deps) {
  const faults = []
  if (typeof seal !== 'string' || protocol.sealOf(manifest) !== seal) faults.push('manifest-seal-mismatch')
  if (manifest.version !== MANIFEST_VERSION) faults.push(`manifest-version:${manifest.version}`)

  for (const [field, expected] of [
    ['method', protocol.METHOD],
    ['model', protocol.MODEL],
    ['effort', protocol.EFFORT],
    ['cliVersion', protocol.CLI_VERSION],
    ['perCallBudgetUsd', PER_CALL_BUDGET_USD],
    ['perCallTimeoutMs', PER_CALL_TIMEOUT_MS],
    ['postKillGraceMs', POST_KILL_GRACE_MS],
    ['maxAggregateUsd', MAX_AGGREGATE_USD],
    ['activationVerified', false],
    ['requestedPermissionMode', protocol.REQUESTED_PERMISSION_MODE],
    ['observedPermissionMode', protocol.OBSERVED_PERMISSION_MODE],
  ]) {
    if (manifest[field] !== expected) faults.push(`manifest-${field}:${String(manifest[field])}`)
  }

  // Exact equality against the frozen one-key constant IS the boundary: an added, removed or
  // mutated key fails here, so no key-name filtering is needed or wanted.
  if (protocol.canonicalJson(manifest.childEnvOverrides ?? null) !== protocol.canonicalJson(protocol.CHILD_ENV_OVERRIDES)) {
    faults.push('manifest-child-env-overrides')
  }

  // The CLI block is consumed as a path and a command; check its shape before that happens.
  const cli = manifest.cli
  if (cli === null || typeof cli !== 'object' || Array.isArray(cli)) faults.push('manifest-cli-shape')
  else {
    for (const key of ['command', 'commandRealPath', 'commandSha256', 'observedVersion']) {
      if (typeof cli[key] !== 'string' || cli[key] === '') faults.push(`manifest-cli-${key}`)
    }
    if (typeof cli.commandSha256 === 'string' && cli.commandSha256.length !== 64) faults.push('manifest-cli-digest-shape')
    if (cli.observedVersion !== protocol.CLI_VERSION) faults.push(`manifest-cli-observed-version:${String(cli.observedVersion)}`)
  }
  try {
    if (manifest.root !== fs.realpathSync(root)) faults.push('manifest-root-mismatch')
  } catch {
    faults.push('manifest-root-mismatch')
  }

  if (!Array.isArray(manifest.fixtures)) return [...faults, 'manifest-fixtures-shape']
  const entries = manifestEntries(manifest)
  faults.push(...protocol.manifestFaults(entries))
  if (faults.length > 0) return faults

  if (protocol.canonicalJson(planSteps(entries)) !== protocol.canonicalJson(manifest.steps)) {
    faults.push('manifest-plan-mismatch')
  }
  const expectedSources = [...sourceRelativePaths(entries)].sort()
  const declaredSources = Object.keys(manifest.sources ?? {}).sort()
  if (protocol.canonicalJson(expectedSources) !== protocol.canonicalJson(declaredSources)) {
    faults.push('manifest-source-list')
  }

  faults.push(...rootFaults(root, { workspaceRoot: deps.workspaceRoot, tmpdir: deps.tmpdir }))
  faults.push(...manifestRootFaults(root, manifest))
  if (faults.length > 0) return faults

  // Internal consistency is not enough: a reordered index reseals cleanly. Compare element by
  // element, in order, against the canonical `eval/manifest.yaml`.
  let canonicalEntries
  try {
    canonicalEntries = protocol.parseManifest(readText(path.join(manifest.repoRoot, protocol.MANIFEST_RELATIVE_PATH)))
  } catch {
    return [...faults, 'canonical-manifest-unreadable']
  }
  if (protocol.canonicalJson(entries) !== protocol.canonicalJson(canonicalEntries)) {
    faults.push('manifest-index-not-canonical')
  }

  // The digests pin the fixture FILES; this pins the ground truth the manifest itself carries,
  // which a source-digest check alone would not catch.
  for (const fixture of manifest.fixtures) {
    let parsed
    try {
      parsed = protocol.parseFixture(readText(path.join(manifest.repoRoot, fixture.file)))
    } catch {
      faults.push(`manifest-fixture-unreadable:${fixture.id}`)
      continue
    }
    for (const key of ['id', 'lang', 'expected', 'defect', 'intent', 'code']) {
      if (fixture[key] !== parsed[key]) faults.push(`manifest-fixture-${key}:${fixture.id}`)
    }
    if (fixture.snippetName !== protocol.snippetNameFor(parsed.lang)) {
      faults.push(`manifest-fixture-snippet:${fixture.id}`)
    }
  }
  return faults
}

/** Load and validate everything the manifest asserts. Returns faults or a usable context. */
export function loadContext(root, deps) {
  const shallow = rootFaults(root, { workspaceRoot: deps.workspaceRoot, tmpdir: deps.tmpdir })
  if (shallow.length > 0) return { ok: false, faults: shallow, manifest: null }
  if (!fs.existsSync(manifestPath(root)) || !fs.existsSync(manifestSealPath(root))) {
    return { ok: false, faults: ['manifest-or-seal-missing'], manifest: null }
  }
  let manifest
  try {
    manifest = readJson(manifestPath(root))
  } catch {
    return { ok: false, faults: ['manifest-unreadable'], manifest: null }
  }
  const seal = readText(manifestSealPath(root)).trim()
  const structural = manifestValidationFaults(root, manifest, seal, deps)
  if (structural.length > 0) return { ok: false, faults: structural, manifest: null }

  const drift = [
    ...sourceDriftFaults(manifest.repoRoot, manifest.sources),
    ...cliDriftFaults(manifest.cli, deps),
  ]
  if (drift.length > 0) return { ok: false, faults: drift, manifest }
  return { ok: true, faults: [], manifest }
}

// --- shared derivation ---------------------------------------------------------------------------

/**
 * The single place a call's outcome is computed, used both at dispatch and when re-deriving a
 * recorded step. There is deliberately no second checker implementation: a divergent verifier
 * would drift from the writer.
 *
 * `processFacts` cannot be derived from the transcript. At re-derivation they are read back
 * from the record, so an edit that changes a process fact AND its consequences consistently is
 * not detectable here — that is the stated limit of edit-integrity checking.
 */
export function evaluateCall({ role, expected, requestedSessionId, stdoutText, processFacts, priorSpendUsd, capUsd }) {
  const faults = []
  if (processFacts.spawnError) faults.push('spawn-error')
  if (processFacts.timedOut) faults.push('timeout')
  if (processFacts.exitConfirmed !== true) faults.push('exit-unconfirmed')
  if (processFacts.exitCode !== 0) faults.push(`exit-code:${String(processFacts.exitCode)}`)

  const record = parseStream(stdoutText)
  faults.push(...record.faults.map((fault) => `stream:${fault}`))

  const initProblems = initFaults(record, {
    model: protocol.MODEL,
    tools: expectedToolsFor(role),
    permissionMode: protocol.OBSERVED_PERMISSION_MODE,
  })
  faults.push(...initProblems)

  const strict = strictZeroChildFaults(record, { expectedModel: protocol.MODEL })
  faults.push(...strict)

  if (record.sessionId !== null && record.sessionId !== requestedSessionId) faults.push('session-id-not-requested')

  const totalCostUsd = record.result ? record.result.totalCostUsd : null
  // An unknown cost is a hard stop, from step 0 onward: it breaks the only spend control there is.
  if (record.result && totalCostUsd === null) faults.push('cost-unknown')
  if (typeof totalCostUsd === 'number' && totalCostUsd > PER_CALL_BUDGET_USD) {
    faults.push(`per-call-overshoot:${totalCostUsd}`)
  }
  // The call that crosses the aggregate cap faults on ITSELF, not only in a later summary. The
  // prior spend is the prefix sum over completed steps, computed identically at write and at
  // re-read, so a legitimate overshoot never shows up as a derivation mismatch.
  if (typeof capUsd === 'number' && typeof totalCostUsd === 'number' && typeof priorSpendUsd === 'number') {
    const aggregate = priorSpendUsd + totalCostUsd
    if (aggregate > capUsd) faults.push(`aggregate-overshoot:${aggregate}`)
  }

  let grade = null
  let gradeProblems = []
  if (role === 'judge') {
    const { events } = splitJsonLines(stdoutText)
    const structured = protocol.extractStructuredOutput(events)
    if (!structured.ok) {
      gradeProblems = [structured.fault]
    } else {
      grade = structured.value
      gradeProblems = protocol.gradeFaults(grade, expected)
    }
    faults.push(...gradeProblems)
  }

  return {
    record,
    initFaults: initProblems,
    strictFaults: strict,
    grade,
    gradeFaults: gradeProblems,
    totalCostUsd,
    sessionId: record.sessionId,
    faults,
    ok: faults.length === 0,
  }
}

function derivationMismatches(final, derived) {
  const out = []
  if (final.totalCostUsd !== derived.totalCostUsd) out.push('totalCostUsd')
  if (final.ok !== derived.ok) out.push('ok')
  if (protocol.canonicalJson([...(final.faults ?? [])].sort()) !== protocol.canonicalJson([...derived.faults].sort())) {
    out.push('faults')
  }
  if (protocol.canonicalJson(final.grade ?? null) !== protocol.canonicalJson(derived.grade ?? null)) out.push('grade')
  if (protocol.canonicalJson(final.stream ?? null) !== protocol.canonicalJson(derived.record)) out.push('stream')
  // Session identity is not compared here: the recorded id is the REQUESTED one, and a
  // transcript that reports a different session already surfaces as `session-id-not-requested`
  // inside the compared fault list, plus the start/final and uniqueness checks.
  return out
}

// --- budget ------------------------------------------------------------------------------------------

/** Structural validation of the sealed budget sidecar. Never trusts the stored amount. */
export function readBudget(root) {
  const file = budgetPath(root)
  const sealFile = budgetSealPath(root)
  const hasFile = fs.existsSync(file)
  const hasSeal = fs.existsSync(sealFile)
  if (!hasFile && !hasSeal) return { present: false, budget: null, seal: null, faults: [] }
  if (!hasFile || !hasSeal) return { present: true, budget: null, seal: null, faults: ['budget-seal-missing'] }

  let budget
  try {
    budget = readJson(file)
  } catch {
    return { present: true, budget: null, seal: null, faults: ['budget-unreadable'] }
  }
  const seal = readText(sealFile).trim()
  const faults = []
  if (protocol.sealOf(budget) !== seal) faults.push('budget-seal-mismatch')
  if (typeof budget.amountUsd !== 'number' || !Number.isFinite(budget.amountUsd)) faults.push('budget-not-finite')
  else {
    if (!(budget.amountUsd > 0)) faults.push('budget-not-positive')
    if (budget.amountUsd > MAX_AGGREGATE_USD) faults.push(`budget-above-ceiling:${budget.amountUsd}`)
    if (typeof budget.spentAtSet !== 'number' || !(budget.amountUsd > budget.spentAtSet)) {
      faults.push('budget-not-above-spent')
    }
  }
  return { present: true, budget, seal, faults }
}

/** Dispatch gate. The aggregate ceiling is set once, after the first pair, from what it cost. */
export function budgetGateFaults(history, budgetInfo) {
  const faults = []
  if (history.nextIndex >= FIRST_PAIR_STEPS && !budgetInfo.present) faults.push('budget-not-set')
  if (budgetInfo.present) {
    faults.push(...budgetInfo.faults)
    if (budgetInfo.budget && history.spentUsd >= budgetInfo.budget.amountUsd) {
      faults.push(`budget-exhausted:${history.spentUsd}`)
    }
  }
  if (history.unknownCostSteps > 0) faults.push(`budget-unknown-cost-steps:${history.unknownCostSteps}`)
  return faults
}

export function setBudgetFaults({ history, budgetInfo, amountUsd }) {
  const faults = []
  if (budgetInfo.present) faults.push('budget-already-set')
  if (history.nextIndex !== FIRST_PAIR_STEPS) faults.push(`budget-not-exactly-first-pair:${history.nextIndex}`)
  if (history.unknownCostSteps > 0) faults.push(`budget-unknown-cost-steps:${history.unknownCostSteps}`)
  if (typeof amountUsd !== 'number' || !Number.isFinite(amountUsd)) faults.push('budget-not-finite')
  else {
    if (!(amountUsd > history.spentUsd)) faults.push(`budget-not-above-spent:${history.spentUsd}`)
    if (amountUsd > MAX_AGGREGATE_USD) faults.push(`budget-above-ceiling:${amountUsd}`)
  }
  return faults
}

// --- canonical input regeneration -------------------------------------------------------------------

/** The system prompt this role must have received, recomputed from source. */
export function canonicalSystemDigest(manifest, role) {
  if (role !== 'reviewer') return protocol.sha256Hex(protocol.JUDGE_SYSTEM_PROMPT)
  try {
    const agent = readText(path.join(manifest.repoRoot, protocol.AGENT_RELATIVE_PATH))
    return protocol.sha256Hex(protocol.splitFrontmatter(agent).body)
  } catch {
    return null
  }
}

/**
 * The user prompt this step must have carried, rebuilt from already-known inputs: the frozen
 * fixture and shared contract for a reviewer step, and for a judge step the same fixture plus
 * the prior step's RAW reviewer response (whose bytes are digest-checked separately).
 */
export function canonicalUserPrompt(root, manifest, step, sharedContract) {
  const fixture = manifest.fixtures.find((candidate) => candidate.id === step.fixtureId)
  if (!fixture || sharedContract === null) return null
  if (step.role === 'reviewer') {
    return protocol.buildReviewerPrompt({
      intent: fixture.intent,
      lang: fixture.lang,
      code: fixture.code,
      sharedContract,
      snippetName: fixture.snippetName,
    })
  }
  const priorRaw = rawPath(root, step.index - 1, 'stdout')
  if (!fs.existsSync(priorRaw)) return null
  const { events } = splitJsonLines(readText(priorRaw))
  const extracted = protocol.extractResultText(events)
  if (!extracted.ok) return null
  return protocol.buildJudgePrompt({
    intent: fixture.intent,
    lang: fixture.lang,
    code: fixture.code,
    expected: fixture.expected,
    defect: fixture.defect,
    reviewText: extracted.value,
  })
}

// --- history ------------------------------------------------------------------------------------------

/**
 * Validate the complete recorded history and locate the next dispatchable step. Every consumed
 * value is re-derived from the raw transcript; the record's own numbers, grade and `ok` are
 * treated as claims to check, never as sources.
 *
 * A start marker with no completed record is terminal-blocking: there is no implicit retry and
 * no overwrite, so a crashed attempt halts the batch and yields no baseline.
 */
export function readHistory(root, manifest, budgetInfo) {
  const faults = []
  const steps = []
  const sessionIds = new Set()
  let sawGap = false
  // Prefix-derived context, identical to what the dispatcher held when it wrote each record.
  let priorSpendUsd = 0
  const capUsd = budgetInfo.present && budgetInfo.budget ? budgetInfo.budget.amountUsd : MAX_AGGREGATE_USD
  let sharedContract = null
  try {
    sharedContract = protocol.extractSharedContract(
      readText(path.join(manifest.repoRoot, protocol.REVIEW_PACKET_RELATIVE_PATH)),
    )
  } catch {
    faults.push('shared-contract-unreadable')
  }

  for (const step of manifest.steps) {
    const startFile = attemptPath(root, step.index, 'start')
    const finalFile = attemptPath(root, step.index, 'final')
    const hasStart = fs.existsSync(startFile)
    const hasFinal = fs.existsSync(finalFile)

    if (!hasStart && !hasFinal) {
      sawGap = true
      continue
    }
    if (sawGap) faults.push(`out-of-order:${step.index}`)
    if (!hasStart) {
      faults.push(`record-without-start:${step.index}`)
      continue
    }
    if (!hasFinal) {
      faults.push(`incomplete-attempt:${step.index}`)
      continue
    }

    let start
    let final
    try {
      start = readJson(startFile)
      final = readJson(finalFile)
    } catch {
      faults.push(`record-unreadable:${step.index}`)
      continue
    }

    for (const [label, record] of [['start', start], ['record', final]]) {
      if (record.step !== step.index || record.role !== step.role || record.fixtureId !== step.fixtureId) {
        faults.push(`${label}-plan-mismatch:${step.index}`)
      }
    }
    if (final.sessionId !== start.sessionId) faults.push(`session-mismatch:${step.index}`)
    if (typeof start.sessionId !== 'string' || start.sessionId === '') faults.push(`session-missing:${step.index}`)
    else if (sessionIds.has(start.sessionId)) faults.push(`session-reused:${step.index}`)
    sessionIds.add(start.sessionId)

    for (const stream of ['stdout', 'stderr']) {
      const file = rawPath(root, step.index, stream)
      if (!fs.existsSync(file)) {
        faults.push(`raw-missing:${stepTag(step.index)}.${stream}`)
        continue
      }
      if (sha256File(file) !== final[`${stream}Sha256`]) {
        faults.push(`raw-digest-mismatch:${stepTag(step.index)}.${stream}`)
      }
    }

    // Every prompt this step was built from is REGENERATED from inputs we already know — the
    // frozen fixture, the shared contract, the agent body, and (for a judge step) the prior raw
    // reviewer response — and compared against both the stored bytes and the start claim. A
    // matching edit to the prompt file and its own recorded hash therefore still fails.
    const systemFile = systemPromptPath(root, step.role)
    const userFile = promptPath(root, step.index)
    const canonicalSystem = canonicalSystemDigest(manifest, step.role)
    const frozenSystem = step.role === 'reviewer'
      ? manifest.digests.reviewerSystemPrompt
      : manifest.digests.judgeSystemPrompt
    if (canonicalSystem !== frozenSystem) faults.push(`system-prompt-not-canonical:${step.role}`)
    if (!fs.existsSync(systemFile)) faults.push(`system-prompt-missing:${step.index}`)
    else if (sha256File(systemFile) !== canonicalSystem) faults.push(`system-prompt-drift:${step.index}`)
    if (start.systemPromptSha256 !== canonicalSystem) faults.push(`system-prompt-claim-mismatch:${step.index}`)

    const expectedPrompt = canonicalUserPrompt(root, manifest, step, sharedContract)
    if (expectedPrompt === null) faults.push(`user-prompt-unrederivable:${step.index}`)
    if (!fs.existsSync(userFile)) faults.push(`user-prompt-missing:${step.index}`)
    else if (expectedPrompt !== null && readText(userFile) !== expectedPrompt) {
      faults.push(`user-prompt-not-canonical:${step.index}`)
    }
    if (expectedPrompt !== null && start.userPromptSha256 !== protocol.sha256Hex(expectedPrompt)) {
      faults.push(`user-prompt-claim-mismatch:${step.index}`)
    }
    if (start.cliCommandSha256 !== manifest.cli.commandSha256) faults.push(`cli-binding-mismatch:${step.index}`)
    if (start.childEnvSha256 !== protocol.sealOf(protocol.CHILD_ENV_OVERRIDES)) {
      faults.push(`child-env-binding-mismatch:${step.index}`)
    }

    if (fs.existsSync(systemFile) && typeof start.sessionId === 'string') {
      const build = step.role === 'reviewer' ? protocol.buildReviewerArgv : protocol.buildJudgeArgv
      const argv = build({
        sessionId: start.sessionId,
        systemPrompt: readText(systemFile),
        maxBudgetUsd: PER_CALL_BUDGET_USD,
      })
      // Note: the rebuild uses the RECORDED session id, so it cannot by itself detect a forged
      // one; that weight sits on the raw-session, start-binding and uniqueness checks above.
      if (protocol.sha256Hex(protocol.canonicalJson(argv)) !== start.argvSha256) {
        faults.push(`argv-mismatch:${step.index}`)
      }
    }

    const expectedBudgetSeal = step.index >= FIRST_PAIR_STEPS ? budgetInfo.seal : null
    if ((start.budgetSha256 ?? null) !== expectedBudgetSeal) faults.push(`budget-binding-mismatch:${step.index}`)

    let derived = null
    const stdoutFile = rawPath(root, step.index, 'stdout')
    if (fs.existsSync(stdoutFile)) {
      const fixture = manifest.fixtures.find((candidate) => candidate.id === step.fixtureId)
      derived = evaluateCall({
        role: step.role,
        expected: fixture ? fixture.expected : null,
        requestedSessionId: start.sessionId,
        stdoutText: readText(stdoutFile),
        processFacts: {
          spawnError: final.spawnError ?? null,
          timedOut: final.timedOut === true,
          exitConfirmed: final.exitConfirmed === true,
          exitCode: final.exitCode,
        },
        priorSpendUsd,
        capUsd,
      })
      if (typeof derived.totalCostUsd === 'number') priorSpendUsd += derived.totalCostUsd
      for (const field of derivationMismatches(final, derived)) {
        faults.push(`record-derivation-mismatch:${step.index}:${field}`)
      }
      if (!derived.ok) faults.push(`halted-at:${step.index}`)
    }

    steps.push({ step, start, final, derived })
  }

  const derivedCosts = steps
    .map((entry) => (entry.derived ? entry.derived.totalCostUsd : null))
    .filter((cost) => typeof cost === 'number')
  const spentUsd = derivedCosts.reduce((total, cost) => total + cost, 0)

  if (budgetInfo.present && budgetInfo.budget && steps.length >= FIRST_PAIR_STEPS) {
    const firstPair = steps.slice(0, FIRST_PAIR_STEPS)
    const firstPairSpent = firstPair.reduce(
      (total, entry) => total + (entry.derived && typeof entry.derived.totalCostUsd === 'number' ? entry.derived.totalCostUsd : Number.NaN),
      0,
    )
    if (!(Math.abs(firstPairSpent - budgetInfo.budget.spentAtSet) < 1e-12)) faults.push('budget-first-pair-unbound')
    const recordedPair = protocol.canonicalJson(budgetInfo.budget.firstPairCosts ?? null)
    const derivedPair = protocol.canonicalJson(
      firstPair.map((entry) => ({
        step: entry.step.index,
        role: entry.step.role,
        totalCostUsd: entry.derived ? entry.derived.totalCostUsd : null,
      })),
    )
    if (recordedPair !== derivedPair) faults.push('budget-first-pair-mismatch')
  }

  return {
    faults,
    steps,
    nextIndex: steps.length,
    complete: steps.length === manifest.steps.length,
    spentUsd,
    unknownCostSteps: steps.length - derivedCosts.length,
  }
}

// --- prepare -------------------------------------------------------------------------------------

export function prepare(options, deps = defaultDeps()) {
  const repoRoot = fs.realpathSync(options.repoRoot ?? DEFAULT_REPO_ROOT)

  const entries = protocol.parseManifest(readText(path.join(repoRoot, protocol.MANIFEST_RELATIVE_PATH)))
  const manifestProblems = protocol.manifestFaults(entries)
  if (manifestProblems.length > 0) throw new Error(`prepare refused: ${manifestProblems.join(', ')}`)

  const agentFile = readText(path.join(repoRoot, protocol.AGENT_RELATIVE_PATH))
  const { frontmatter, body } = protocol.splitFrontmatter(agentFile)
  const sharedContract = protocol.extractSharedContract(
    readText(path.join(repoRoot, protocol.REVIEW_PACKET_RELATIVE_PATH)),
  )

  const fixtures = entries.map((entry) => {
    const fixture = protocol.parseFixture(readText(path.join(repoRoot, entry.file)))
    const problems = protocol.fixtureFaults(entry, fixture)
    if (problems.length > 0) throw new Error(`prepare refused: ${problems.join(', ')}`)
    const snippetName = protocol.snippetNameFor(entry.lang)
    const prompt = protocol.buildReviewerPrompt({
      intent: fixture.intent,
      lang: fixture.lang,
      code: fixture.code,
      sharedContract,
      snippetName,
    })
    const leaks = protocol.leakageFaults(prompt, entry, fixture)
    if (leaks.length > 0) throw new Error(`prepare refused: ${leaks.join(', ')}`)
    return { ...fixture, file: entry.file, scorer: entry.scorer, snippetName, prompt }
  })

  const commandRealPath = fs.realpathSync(options.cliCommand)
  const probe = probeCliVersion(commandRealPath, deps)
  if (!probe.ok) throw new Error(`prepare refused: ${probe.fault}`)
  if (probe.version !== protocol.CLI_VERSION) throw new Error(`prepare refused: cli-version-mismatch:${probe.version}`)

  const root = fs.realpathSync(fs.mkdtempSync(path.join(fs.realpathSync(deps.tmpdir()), ROOT_PREFIX)))
  const rootProblems = rootFaults(root, { workspaceRoot: repoRoot, tmpdir: deps.tmpdir })
  if (rootProblems.length > 0) throw new Error(`prepare refused: ${rootProblems.join(', ')}`)

  const steps = planSteps(entries)
  if (steps.length !== TOTAL_STEPS) throw new Error(`prepare refused: step-count:${steps.length}`)

  const manifest = {
    version: MANIFEST_VERSION,
    createdAt: deps.now(),
    root,
    repoRoot,
    method: protocol.METHOD,
    model: protocol.MODEL,
    effort: protocol.EFFORT,
    cliVersion: protocol.CLI_VERSION,
    activationVerified: false,
    perCallBudgetUsd: PER_CALL_BUDGET_USD,
    perCallTimeoutMs: PER_CALL_TIMEOUT_MS,
    postKillGraceMs: POST_KILL_GRACE_MS,
    maxAggregateUsd: MAX_AGGREGATE_USD,
    // Only the forced override is recorded; the inherited environment is never persisted.
    childEnvOverrides: { ...protocol.CHILD_ENV_OVERRIDES },
    requestedPermissionMode: protocol.REQUESTED_PERMISSION_MODE,
    observedPermissionMode: protocol.OBSERVED_PERMISSION_MODE,
    cli: {
      command: options.cliCommand,
      commandRealPath,
      commandSha256: sha256File(commandRealPath),
      observedVersion: probe.version,
    },
    digests: {
      agentFrontmatter: protocol.sha256Hex(frontmatter),
      reviewerSystemPrompt: protocol.sha256Hex(body),
      sharedContract: protocol.sha256Hex(sharedContract),
      judgeSystemPrompt: protocol.sha256Hex(protocol.JUDGE_SYSTEM_PROMPT),
      judgeSchema: protocol.sha256Hex(JSON.stringify(protocol.JUDGE_SCHEMA)),
    },
    sources: hashSources(repoRoot, sourceRelativePaths(entries)),
    steps,
    fixtures: fixtures.map((fixture) => ({
      id: fixture.id,
      file: fixture.file,
      lang: fixture.lang,
      expected: fixture.expected,
      scorer: fixture.scorer,
      defect: fixture.defect,
      intent: fixture.intent,
      code: fixture.code,
      snippetName: fixture.snippetName,
      promptSha256: protocol.sha256Hex(fixture.prompt),
    })),
  }

  // Grader data (expected + defect) lives only here, in the output root. The reviewer runs in
  // a separate work directory under --restricted with no --add-dir, so it cannot reach it.
  writeExclusive(manifestPath(root), `${JSON.stringify(manifest, null, 2)}\n`)
  writeExclusive(manifestSealPath(root), `${protocol.sealOf(manifest)}\n`)
  writeExclusive(systemPromptPath(root, 'reviewer'), body)
  writeExclusive(systemPromptPath(root, 'judge'), protocol.JUDGE_SYSTEM_PROMPT)
  for (const step of steps) {
    if (step.role !== 'reviewer') continue
    const fixture = fixtures.find((candidate) => candidate.id === step.fixtureId)
    writeExclusive(promptPath(root, step.index), fixture.prompt)
  }

  return { root, manifest }
}

// --- dispatch --------------------------------------------------------------------------------------

/**
 * Node's `timeout` option only sends a signal; it does not bound how long we wait for `close`.
 * This owns an explicit deadline plus a finite post-kill grace, and resolves either way. When
 * the grace expires we record `exitConfirmed: false` and make no claim that the process — or
 * any descendant — actually died.
 */
export function childEnv() {
  // Overlay only, on a COPY: the parent environment is never mutated, and nothing inherited is
  // ever recorded. Only the override map itself is persisted.
  return { ...process.env, ...protocol.CHILD_ENV_OVERRIDES }
}

export function runCall({ command, argv, cwd, stdinText, stdoutFile, stderrFile, timeoutMs, graceMs, spawnFn }) {
  fs.mkdirSync(path.dirname(stdoutFile), { recursive: true })
  const out = fs.openSync(stdoutFile, 'wx')
  const err = fs.openSync(stderrFile, 'wx')
  const startedAt = Date.now()
  return new Promise((resolve) => {
    let settled = false
    let deadline = null
    let grace = null
    let killSignalSent = null
    const finish = (value) => {
      if (settled) return
      settled = true
      if (deadline) clearTimeout(deadline)
      if (grace) clearTimeout(grace)
      fs.closeSync(out)
      fs.closeSync(err)
      resolve({ killSignalSent, ...value, elapsedMs: Date.now() - startedAt })
    }

    let child
    try {
      child = spawnFn(command, argv, { cwd, env: childEnv(), shell: false, windowsHide: true, stdio: ['pipe', out, err] })
    } catch (error) {
      finish({ code: null, signal: null, spawnError: String(error && error.message ? error.message : error), exitConfirmed: false, timedOut: false })
      return
    }

    deadline = setTimeout(() => {
      killSignalSent = 'SIGKILL'
      try {
        child.kill('SIGKILL')
      } catch {
        /* recorded via exitConfirmed:false below */
      }
      grace = setTimeout(() => {
        finish({ code: null, signal: null, spawnError: null, exitConfirmed: false, timedOut: true })
      }, graceMs)
    }, timeoutMs)

    child.on('error', (error) => finish({ code: null, signal: null, spawnError: String(error.message), exitConfirmed: false, timedOut: false }))
    child.on('close', (code, signal) => finish({ code, signal, spawnError: null, exitConfirmed: true, timedOut: killSignalSent !== null }))
    if (child.stdin) {
      child.stdin.on('error', () => {})
      child.stdin.end(stdinText)
    }
  })
}

function makeWorkDir(deps) {
  return fs.realpathSync(fs.mkdtempSync(path.join(fs.realpathSync(deps.tmpdir()), WORK_PREFIX)))
}

export async function runOneNext(root, deps = defaultDeps()) {
  const context = loadContext(root, deps)
  if (!context.ok) return { ok: false, faults: context.faults }
  const manifest = context.manifest

  const budgetInfo = readBudget(root)
  const history = readHistory(root, manifest, budgetInfo)
  if (history.faults.length > 0) return { ok: false, faults: history.faults }
  if (history.complete) return { ok: true, done: true, faults: [], nextIndex: null }

  const gate = budgetGateFaults(history, budgetInfo)
  if (gate.length > 0) return { ok: false, faults: gate }

  const step = manifest.steps[history.nextIndex]
  const fixture = manifest.fixtures.find((candidate) => candidate.id === step.fixtureId)
  const sessionId = deps.uuid()
  const isReviewer = step.role === 'reviewer'

  let userPrompt
  if (isReviewer) {
    userPrompt = readText(promptPath(root, step.index))
    if (protocol.sha256Hex(userPrompt) !== fixture.promptSha256) {
      return { ok: false, faults: [`prompt-drift:${step.index}`] }
    }
  } else {
    const { events } = splitJsonLines(readText(rawPath(root, step.index - 1, 'stdout')))
    const extracted = protocol.extractResultText(events)
    if (!extracted.ok) return { ok: false, faults: [extracted.fault] }
    if (
      extracted.value.includes(protocol.REVIEW_OPEN_DELIMITER) ||
      extracted.value.includes(protocol.REVIEW_CLOSE_DELIMITER)
    ) {
      return { ok: false, faults: ['review-text-delimiter-collision'] }
    }
    userPrompt = protocol.buildJudgePrompt({
      intent: fixture.intent,
      lang: fixture.lang,
      code: fixture.code,
      expected: fixture.expected,
      defect: fixture.defect,
      reviewText: extracted.value,
    })
  }

  const systemPrompt = readText(systemPromptPath(root, step.role))
  const expectedDigest = isReviewer ? manifest.digests.reviewerSystemPrompt : manifest.digests.judgeSystemPrompt
  if (protocol.sha256Hex(systemPrompt) !== expectedDigest) {
    return { ok: false, faults: [`system-prompt-drift:${step.role}`] }
  }

  const build = isReviewer ? protocol.buildReviewerArgv : protocol.buildJudgeArgv
  const argv = build({ sessionId, systemPrompt, maxBudgetUsd: manifest.perCallBudgetUsd })
  const argvProblems = protocol.argvFaults(argv, {
    isAbsolute: path.isAbsolute,
    resolveWithin: (parent, candidate) => isWithin(parent, path.resolve(candidate)),
    workspaceRoot: manifest.repoRoot,
  })
  if (argvProblems.length > 0) return { ok: false, faults: argvProblems }

  // A fresh work directory per attempt: nothing from the previous fixture is visible.
  const workDir = makeWorkDir(deps)
  if (isReviewer) {
    fs.writeFileSync(path.join(workDir, fixture.snippetName), protocol.snippetBytesFor(fixture.code), { flag: 'wx' })
  }

  const startRecord = {
    step: step.index,
    role: step.role,
    fixtureId: step.fixtureId,
    sessionId,
    startedAt: deps.now(),
    workDir,
    argvSha256: protocol.sha256Hex(protocol.canonicalJson(argv)),
    systemPromptSha256: expectedDigest,
    userPromptSha256: protocol.sha256Hex(userPrompt),
    cliCommandSha256: manifest.cli.commandSha256,
    childEnvSha256: protocol.sealOf(protocol.CHILD_ENV_OVERRIDES),
    budgetSha256: step.index >= FIRST_PAIR_STEPS ? budgetInfo.seal : null,
  }
  writeExclusive(attemptPath(root, step.index, 'start'), `${JSON.stringify(startRecord, null, 2)}\n`)
  // Judge prompts are derived, so they are persisted after the start marker: a crash before
  // the marker leaves nothing to collide with, and a crash after it leaves a terminal-blocking
  // incomplete attempt rather than a half-written prompt a retry could silently reuse.
  if (!isReviewer) writeExclusive(promptPath(root, step.index), userPrompt)

  const stdoutFile = rawPath(root, step.index, 'stdout')
  const stderrFile = rawPath(root, step.index, 'stderr')
  const outcome = await runCall({
    command: manifest.cli.commandRealPath,
    argv,
    cwd: workDir,
    stdinText: userPrompt,
    stdoutFile,
    stderrFile,
    timeoutMs: deps.timeoutMs ?? manifest.perCallTimeoutMs,
    graceMs: deps.graceMs ?? manifest.postKillGraceMs,
    spawnFn: deps.spawn,
  })

  const derived = evaluateCall({
    role: step.role,
    expected: fixture.expected,
    requestedSessionId: sessionId,
    stdoutText: fs.existsSync(stdoutFile) ? readText(stdoutFile) : '',
    processFacts: {
      spawnError: outcome.spawnError,
      timedOut: outcome.timedOut,
      exitConfirmed: outcome.exitConfirmed,
      exitCode: outcome.code,
    },
    priorSpendUsd: history.spentUsd,
    capUsd: budgetInfo.present && budgetInfo.budget ? budgetInfo.budget.amountUsd : MAX_AGGREGATE_USD,
  })

  const finalRecord = {
    step: step.index,
    role: step.role,
    fixtureId: step.fixtureId,
    sessionId,
    endedAt: deps.now(),
    exitCode: outcome.code,
    signal: outcome.signal,
    spawnError: outcome.spawnError ?? null,
    timedOut: outcome.timedOut,
    exitConfirmed: outcome.exitConfirmed,
    killSignalSent: outcome.killSignalSent,
    descendantsKilled: 'unverified',
    elapsedMs: outcome.elapsedMs,
    stdoutSha256: fs.existsSync(stdoutFile) ? sha256File(stdoutFile) : null,
    stdoutBytes: fs.existsSync(stdoutFile) ? fs.statSync(stdoutFile).size : null,
    stderrSha256: fs.existsSync(stderrFile) ? sha256File(stderrFile) : null,
    stderrBytes: fs.existsSync(stderrFile) ? fs.statSync(stderrFile).size : null,
    totalCostUsd: derived.totalCostUsd,
    costBasis: 'cli-bundled-price-table-estimate; not provider billing',
    stream: derived.record,
    strictFaults: derived.strictFaults,
    initFaults: derived.initFaults,
    grade: derived.grade,
    gradeFaults: derived.gradeFaults,
    ok: derived.ok,
    faults: derived.faults,
  }
  writeExclusive(attemptPath(root, step.index, 'final'), `${JSON.stringify(finalRecord, null, 2)}\n`)

  return { ok: derived.ok, done: false, faults: derived.faults, step: step.index, role: step.role, record: finalRecord }
}

// --- budget command and summary ------------------------------------------------------------------------

export function setBudget(root, amountUsd, deps = defaultDeps()) {
  const context = loadContext(root, deps)
  if (!context.ok) return { ok: false, faults: context.faults }
  const budgetInfo = readBudget(root)
  const history = readHistory(root, context.manifest, budgetInfo)
  if (history.faults.length > 0) return { ok: false, faults: history.faults }

  const problems = setBudgetFaults({ history, budgetInfo, amountUsd })
  if (problems.length > 0) return { ok: false, faults: problems }

  const record = {
    amountUsd,
    setAt: deps.now(),
    spentAtSet: history.spentUsd,
    ceilingUsd: MAX_AGGREGATE_USD,
    firstPairCosts: history.steps.slice(0, FIRST_PAIR_STEPS).map((entry) => ({
      step: entry.step.index,
      role: entry.step.role,
      totalCostUsd: entry.derived.totalCostUsd,
    })),
  }
  try {
    writeExclusive(budgetPath(root), `${JSON.stringify(record, null, 2)}\n`)
    writeExclusive(budgetSealPath(root), `${protocol.sealOf(record)}\n`)
  } catch {
    return { ok: false, faults: ['budget-already-set'] }
  }
  return { ok: true, faults: [], budget: record }
}

export function summarize(root, deps = defaultDeps()) {
  const context = loadContext(root, deps)
  if (!context.ok) return { ok: false, faults: context.faults }
  const manifest = context.manifest

  const budgetInfo = readBudget(root)
  const history = readHistory(root, manifest, budgetInfo)
  const faults = [...history.faults]
  if (!history.complete) faults.push(`incomplete:${history.nextIndex}/${manifest.steps.length}`)
  if (!budgetInfo.present) faults.push('budget-not-set')
  faults.push(...budgetInfo.faults)
  if (history.unknownCostSteps > 0) faults.push(`unknown-cost-steps:${history.unknownCostSteps}`)
  // Aggregate overshoot is faulted on the call that crosses the cap (see `evaluateCall`), which
  // makes that record non-ok and halts the history — so it is not re-raised here as a duplicate.
  if (faults.length > 0) return { ok: false, faults }

  const rows = history.steps
    .filter((entry) => entry.step.role === 'judge')
    .map((entry) => {
      const fixture = manifest.fixtures.find((candidate) => candidate.id === entry.step.fixtureId)
      return {
        id: entry.step.fixtureId,
        lang: fixture.lang,
        expected: fixture.expected,
        result: entry.derived.grade.result,
        pass: entry.derived.grade.pass,
        rationale: entry.derived.grade.rationale,
      }
    })

  const costs = history.steps.map((entry) => ({
    step: entry.step.index,
    role: entry.step.role,
    fixtureId: entry.step.fixtureId,
    totalCostUsd: entry.derived.totalCostUsd,
    elapsedMs: entry.final.elapsedMs,
    exitConfirmed: entry.final.exitConfirmed,
    descendantsKilled: entry.final.descendantsKilled,
    usage: entry.derived.record.result ? entry.derived.record.result.usage : null,
    modelUsage: entry.derived.record.result ? entry.derived.record.result.modelUsage : null,
    subagent: entry.derived.record.result ? entry.derived.record.result.subagent : null,
    stdoutPath: rawPath(root, entry.step.index, 'stdout'),
    stdoutSha256: entry.final.stdoutSha256,
    stderrPath: rawPath(root, entry.step.index, 'stderr'),
    stderrSha256: entry.final.stderrSha256,
  }))

  return {
    ok: true,
    faults: [],
    root,
    method: manifest.method,
    activationVerified: manifest.activationVerified,
    model: manifest.model,
    effort: manifest.effort,
    cli: { observedVersion: manifest.cli.observedVersion, commandSha256: manifest.cli.commandSha256 },
    childEnvOverrides: manifest.childEnvOverrides,
    permissionMode: { requested: manifest.requestedPermissionMode, observed: manifest.observedPermissionMode },
    digests: manifest.digests,
    scores: protocol.summarizeGrades(rows),
    rows,
    costs,
    aggregate: {
      estimatedTotalUsd: history.spentUsd,
      unknownCostSteps: history.unknownCostSteps,
      budget: budgetInfo.budget,
      costBasis: 'cli-bundled-price-table-estimate; not provider billing; comparable only within this pinned CLI',
    },
    disclosures: [
      'Constrained-excerpt code-reviewer baseline; not a workflow, quality or safety baseline.',
      'System-prompt replay of the shipped code-reviewer body; --system-prompt replaces the entire default prompt; native plugin activation not verified.',
      'Reviewer surface was closed to Read/Grep/Glob by --tools with no Bash, unlike the shipped agent contract.',
      'Fixture Intent lines state the contract precisely and may make the defect easier to find than unhinted review; direction plausibly optimistic, magnitude unmeasured.',
      'One judge call per fixture over 5 hit fixtures and 2 clean controls: each fixture moves a rate by 1/5 or 1/2.',
      'Repeating one prefix across 14 sequential calls may produce cache reads attributable to the harness rather than the product; no causal attribution measured.',
      'clean control acceptance is not a true precision.',
      'CLI version is a self-report from --version plus a file hash: drift evidence, not authenticity.',
      'One environment override is forced onto the child (CLAUDE_CODE_DISABLE_TERMINAL_TITLE=1); no inherited environment is recorded.',
      'The requested permission mode is the alias `manual`; the canonical mode the runtime reports is `default`. Same mode, two names.',
      'Seals detect accidental edits and corruption only; they are not signatures and not authentication.',
    ],
  }
}

// --- CLI ---------------------------------------------------------------------------------------------

// Narrow per-command allow-lists. Since every override was removed, an unknown flag must be
// REFUSED: silently ignoring `--model other` while running the pinned model would let an
// operator believe an override applied. This is a fixed table, not an option system.
export const COMMAND_OPTIONS = Object.freeze({
  prepare: ['repo', 'cliCommand'],
  'run-one-next': ['root'],
  'set-budget': ['root', 'amount'],
  summarize: ['root'],
})

export function parseArgs(argv) {
  const [command, ...rest] = argv
  const options = {}
  const allowed = Object.prototype.hasOwnProperty.call(COMMAND_OPTIONS, command)
    ? COMMAND_OPTIONS[command]
    : null
  for (let index = 0; index < rest.length; index += 1) {
    const token = rest[index]
    if (!token.startsWith('--')) throw new Error(`unexpected argument: ${token}`)
    const flag = token.slice(2)
    const value = rest[index + 1]
    if (value === undefined || value.startsWith('--')) throw new Error(`missing value for --${flag}`)
    const key = flag.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase())
    if (allowed === null) throw new Error(`unknown command: ${String(command)}`)
    if (!allowed.includes(key)) throw new Error(`unknown option --${flag} for ${command}`)
    if (Object.prototype.hasOwnProperty.call(options, key)) throw new Error(`duplicate option --${flag}`)
    options[key] = value
    index += 1
  }
  return { command, options }
}

const USAGE = `Usage (frozen method: Opus 5 / xhigh / CLI ${protocol.CLI_VERSION}; no other configuration):
  node eval/efficiency/l1b-driver.mjs prepare --cli-command <path> [--repo <path>]
  node eval/efficiency/l1b-driver.mjs run-one-next --root <experiment root>
  node eval/efficiency/l1b-driver.mjs set-budget --root <experiment root> --amount <usd>
  node eval/efficiency/l1b-driver.mjs summarize --root <experiment root>`

export async function main(argv, depsOverrides = {}) {
  const deps = defaultDeps(depsOverrides)
  const { command, options } = parseArgs(argv)
  switch (command) {
    case 'prepare': {
      const { root } = prepare({ repoRoot: options.repo, cliCommand: options.cliCommand }, deps)
      deps.log(JSON.stringify({ ok: true, command, root }, null, 2))
      return 0
    }
    case 'run-one-next': {
      const outcome = await runOneNext(options.root, deps)
      deps.log(JSON.stringify(outcome, null, 2))
      return outcome.ok ? 0 : 1
    }
    case 'set-budget': {
      const outcome = setBudget(options.root, Number(options.amount), deps)
      deps.log(JSON.stringify(outcome, null, 2))
      return outcome.ok ? 0 : 1
    }
    case 'summarize': {
      const outcome = summarize(options.root, deps)
      deps.log(JSON.stringify(outcome, null, 2))
      return outcome.ok ? 0 : 1
    }
    default:
      deps.log(USAGE)
      return 2
  }
}

/**
 * Pure entry-point test: string comparison only, no filesystem call, so importing this module
 * performs no I/O. A non-matching invocation path (for example a symlinked launcher) simply
 * does not run `main` — it does not print usage and does not fail.
 */
export function isDirectInvocation(argv1, moduleUrl) {
  if (typeof argv1 !== 'string' || argv1 === '') return false
  try {
    return pathToFileURL(argv1).href === moduleUrl
  } catch {
    return false
  }
}

if (isDirectInvocation(process.argv[1], import.meta.url)) {
  main(process.argv.slice(2)).then((code) => {
    process.exitCode = code
  })
}
