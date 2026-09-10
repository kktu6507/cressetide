#!/usr/bin/env node
// Judge negative-response probe: four fixed, frozen judge-only calls.
//
// It answers one narrow question — given a fixture's ground truth, does the live judge assign
// the grade the case expects, including the two NEGATIVE grades it has never produced in a real
// run? Two cases carry actual captured reviewer output (positive controls) and two are
// Codex-authored constructions derived from an observed `[unverified]` lead. That is
// **negative-response evidence on four constructed cases**: it excludes a constant-pass and a
// constant-fail grader on these inputs and nothing more. It is not statistical calibration, not
// general judge accuracy, and it does not on its own unlock drift detection.
//
// No reviewer role runs here. The judge prompt, schema, system prompt and argv all come from the
// accepted L1b protocol unchanged, and the process/telemetry helpers are imported from the L1b
// driver rather than copied. `expectedGrade` is grader-only and never reaches a prompt.
//
// Import-safe: importing this module performs no I/O and starts no process.

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawn, spawnSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { fileURLToPath } from 'node:url'

import * as protocol from './protocol.mjs'
import { splitJsonLines } from './stream-usage.mjs'
import {
  evaluateCall,
  isDirectInvocation,
  isWithin,
  probeCliVersion,
  rootFaults,
  runCall,
  POST_KILL_GRACE_MS,
  PER_CALL_TIMEOUT_MS,
} from './l1b-driver.mjs'

export const CAL_ROOT_PREFIX = 'ctide-eff-cal-'
export const CAL_WORK_PREFIX = 'ctide-eff-cal-work-'
export const CAL_PER_CALL_USD = 0.25
export const CAL_TOTAL_USD = 1
export const TOTAL_CASES = 4
export const MANIFEST_VERSION = 1

export const CASES_RELATIVE_PATH = 'eval/efficiency/judge-calibration-cases.json'
export const CASES_SHA256 = 'f973d46f83f37f8d4526bd3ba17c9e27ab2ca9a699f2c89f628d6e8d814a1cad'

// The canonical four. Never trusted from the manifest or the cases file — both are checked
// against this table, in this order.
export const CANONICAL_CASES = Object.freeze([
  Object.freeze({ id: 'case-01', fixtureId: '01-js-missing-return', result: 'hit', pass: true }),
  Object.freeze({ id: 'case-02', fixtureId: '01-js-missing-return', result: 'miss', pass: false }),
  Object.freeze({ id: 'case-03', fixtureId: '06-clean-js-guard', result: 'clean-ok', pass: true }),
  Object.freeze({ id: 'case-04', fixtureId: '06-clean-js-guard', result: 'false-positive', pass: false }),
])

export const SOURCE_PATHS = Object.freeze([
  'eval/efficiency/stream-usage.mjs',
  'eval/efficiency/protocol.mjs',
  'eval/efficiency/l1b-driver.mjs',
  'eval/efficiency/judge-calibration.mjs',
  CASES_RELATIVE_PATH,
  'eval/fixtures/01-js-missing-return.md',
  'eval/fixtures/06-clean-js-guard.md',
])

const MODULE_PATH = fileURLToPath(import.meta.url)
const DEFAULT_REPO_ROOT = path.resolve(path.dirname(MODULE_PATH), '..', '..')

// --- paths and small helpers -------------------------------------------------------------------

const readText = (file) => fs.readFileSync(file, 'utf8')
const readJson = (file) => JSON.parse(readText(file))
const sha256File = (file) => protocol.sha256Hex(fs.readFileSync(file))
const stepTag = (index) => `step-${String(index).padStart(2, '0')}`

function writeExclusive(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, data, { flag: 'wx' })
}

export const manifestPath = (root) => path.join(root, 'manifest.json')
export const manifestSealPath = (root) => path.join(root, 'manifest.seal')
export const systemPromptPath = (root) => path.join(root, 'prompts', 'judge.system.txt')
export const promptPath = (root, index) => path.join(root, 'prompts', `${stepTag(index)}.user.txt`)
export const attemptPath = (root, index, kind) => path.join(root, 'attempts', `${stepTag(index)}.${kind}.json`)
export const rawPath = (root, index, stream) =>
  path.join(root, 'raw', `${stepTag(index)}.${stream === 'stdout' ? 'stdout.jsonl' : 'stderr.txt'}`)

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

// --- frozen case data ----------------------------------------------------------------------------

/**
 * Load the read-only Codex-authored cases and validate them against the frozen digest and the
 * canonical table. A manifest copy is never trusted in place of this.
 */
export function loadCases(repoRoot) {
  const file = path.join(repoRoot, CASES_RELATIVE_PATH)
  const digest = sha256File(file)
  if (digest !== CASES_SHA256) return { ok: false, faults: [`cases-digest:${digest}`], cases: null }

  let parsed
  try {
    parsed = JSON.parse(readText(file))
  } catch {
    return { ok: false, faults: ['cases-unreadable'], cases: null }
  }
  const faults = casesFaults(parsed)
  if (faults.length > 0) return { ok: false, faults, cases: null }
  return { ok: true, faults: [], cases: parsed.cases, meta: parsed }
}

export function casesFaults(parsed) {
  const faults = []
  if (parsed === null || typeof parsed !== 'object' || !Array.isArray(parsed.cases)) return ['cases-shape']
  if (parsed.cases.length !== TOTAL_CASES) faults.push(`cases-count:${parsed.cases.length}`)
  for (const [index, canonical] of CANONICAL_CASES.entries()) {
    const entry = parsed.cases[index]
    if (!entry || typeof entry !== 'object') {
      faults.push(`cases-entry-shape:${index}`)
      continue
    }
    if (entry.id !== canonical.id) faults.push(`cases-id:${index}:${String(entry.id)}`)
    if (entry.fixtureId !== canonical.fixtureId) faults.push(`cases-fixture:${canonical.id}`)
    if (typeof entry.origin !== 'string' || entry.origin === '') faults.push(`cases-origin:${canonical.id}`)
    if (typeof entry.reviewText !== 'string' || entry.reviewText.trim() === '') {
      faults.push(`cases-review-empty:${canonical.id}`)
    }
    const grade = entry.expectedGrade
    if (!grade || grade.result !== canonical.result || grade.pass !== canonical.pass) {
      faults.push(`cases-expected-grade:${canonical.id}`)
    }
  }
  return faults
}

/** Build the four judge prompts from the frozen cases plus the two fixture files. */
export function buildSteps(repoRoot, cases) {
  const fixtureCache = new Map()
  return cases.map((entry, index) => {
    if (!fixtureCache.has(entry.fixtureId)) {
      const problems = protocol.idFaults(entry.fixtureId)
      if (problems.length > 0) throw new Error(`calibration refused: ${problems.join(', ')}`)
      fixtureCache.set(
        entry.fixtureId,
        protocol.parseFixture(readText(path.join(repoRoot, `eval/fixtures/${entry.fixtureId}.md`))),
      )
    }
    const fixture = fixtureCache.get(entry.fixtureId)
    // Only these five fields reach the judge. `expectedGrade`, `id` and `origin` never do.
    const prompt = protocol.buildJudgePrompt({
      intent: fixture.intent,
      lang: fixture.lang,
      code: fixture.code,
      expected: fixture.expected,
      defect: fixture.defect,
      reviewText: entry.reviewText,
    })
    return {
      index,
      caseId: entry.id,
      fixtureId: entry.fixtureId,
      origin: entry.origin,
      lang: fixture.lang,
      expected: fixture.expected,
      expectedGrade: { result: entry.expectedGrade.result, pass: entry.expectedGrade.pass },
      prompt,
      promptSha256: protocol.sha256Hex(prompt),
    }
  })
}

/**
 * The prompt must never leak the grader-only fields. The four grade WORDS are deliberately not
 * checked: `hit` / `miss` / `clean-ok` / `false-positive` are the judge rubric's own vocabulary and
 * appear in every prompt by design. What must not appear is the case identity, its origin
 * annotation, or the expected grade as a labelled datum.
 */
export function promptLeakFaults(prompt, step) {
  const faults = []
  if (prompt.includes(step.caseId)) faults.push(`leak-case-id:${step.caseId}`)
  if (prompt.includes(step.origin)) faults.push(`leak-origin:${step.caseId}`)
  for (const label of ['expectedGrade', 'Codex-authored', 'handcrafted', 'near-miss']) {
    if (prompt.includes(label)) faults.push(`leak-label:${label}`)
  }
  return faults
}

// --- wrapper cost rules ----------------------------------------------------------------------------

/**
 * `evaluateCall` derives its per-call rule from the L1b constant (2 USD), which is far looser than
 * this probe allows, so the tighter per-call rule lives here. The 1 USD aggregate rule is enforced
 * by passing `CAL_TOTAL_USD` as `evaluateCall`'s cap. Both are recomputed identically at readback
 * from the same prefix-spend walk, so a legitimate overshoot never reads as a derivation mismatch.
 */
export function wrapperCostFaults(totalCostUsd) {
  if (typeof totalCostUsd !== 'number') return []
  return totalCostUsd > CAL_PER_CALL_USD ? [`cal-per-call-overshoot:${totalCostUsd}`] : []
}

export function deriveStep({ step, stdoutText, processFacts, requestedSessionId, priorSpendUsd }) {
  const derived = evaluateCall({
    role: 'judge',
    expected: step.expected,
    requestedSessionId,
    stdoutText,
    processFacts,
    priorSpendUsd,
    capUsd: CAL_TOTAL_USD,
  })
  const faults = [...derived.faults, ...wrapperCostFaults(derived.totalCostUsd)]
  // A miss or a false positive with pass:false is the CALIBRATION TARGET for two of these cases,
  // not a transport failure. Semantic agreement is judged separately and never faults the record.
  const gradeMatch =
    derived.grade !== null &&
    derived.grade.result === step.expectedGrade.result &&
    derived.grade.pass === step.expectedGrade.pass
  return { ...derived, faults, ok: faults.length === 0, gradeMatch }
}

// --- manifest ---------------------------------------------------------------------------------------

export function manifestValidationFaults(root, manifest, seal, deps) {
  const faults = []
  if (typeof seal !== 'string' || protocol.sealOf(manifest) !== seal) faults.push('manifest-seal-mismatch')
  for (const [field, expected] of [
    ['version', MANIFEST_VERSION],
    ['model', protocol.MODEL],
    ['effort', protocol.EFFORT],
    ['cliVersion', protocol.CLI_VERSION],
    ['perCallUsd', CAL_PER_CALL_USD],
    ['totalUsd', CAL_TOTAL_USD],
    ['casesSha256', CASES_SHA256],
    ['requestedPermissionMode', protocol.REQUESTED_PERMISSION_MODE],
    ['observedPermissionMode', protocol.OBSERVED_PERMISSION_MODE],
    // Pinned against the computed constants, in the same encoding `prepare` records, so a
    // resealed manifest cannot publish a fabricated identity for the artifacts that produced the
    // grades. `summarize` copies these only after this check has passed.
    ['judgeSystemPromptSha256', protocol.sha256Hex(protocol.JUDGE_SYSTEM_PROMPT)],
    ['judgeSchemaSha256', protocol.sha256Hex(JSON.stringify(protocol.JUDGE_SCHEMA))],
  ]) {
    if (manifest[field] !== expected) faults.push(`manifest-${field}:${String(manifest[field])}`)
  }
  if (protocol.canonicalJson(manifest.childEnvOverrides ?? null) !== protocol.canonicalJson(protocol.CHILD_ENV_OVERRIDES)) {
    faults.push('manifest-child-env-overrides')
  }
  const cli = manifest.cli
  if (cli === null || typeof cli !== 'object' || Array.isArray(cli)) faults.push('manifest-cli-shape')
  else {
    for (const key of ['command', 'commandRealPath', 'commandSha256', 'observedVersion']) {
      if (typeof cli[key] !== 'string' || cli[key] === '') faults.push(`manifest-cli-${key}`)
    }
    if (cli.observedVersion !== protocol.CLI_VERSION) faults.push(`manifest-cli-observed-version:${String(cli.observedVersion)}`)
  }
  try {
    if (manifest.root !== fs.realpathSync(root)) faults.push('manifest-root-mismatch')
  } catch {
    faults.push('manifest-root-mismatch')
  }
  if (protocol.canonicalJson([...SOURCE_PATHS].sort()) !== protocol.canonicalJson(Object.keys(manifest.sources ?? {}).sort())) {
    faults.push('manifest-source-list')
  }
  // The plan is re-checked against the canonical table, never accepted from the manifest.
  const declared = (manifest.steps ?? []).map((step) => ({
    id: step.caseId,
    fixtureId: step.fixtureId,
    result: step.expectedGrade?.result,
    pass: step.expectedGrade?.pass,
  }))
  if (protocol.canonicalJson(declared) !== protocol.canonicalJson(CANONICAL_CASES.map((c) => ({ ...c })))) {
    faults.push('manifest-plan-not-canonical')
  }
  faults.push(...rootFaults(root, { workspaceRoot: deps.workspaceRoot, tmpdir: deps.tmpdir }))
  if (!path.basename(root).startsWith(CAL_ROOT_PREFIX)) faults.push('root-prefix')
  try {
    const repo = fs.realpathSync(manifest.repoRoot)
    if (isWithin(repo, fs.realpathSync(root))) faults.push('root-workspace-nesting')
  } catch {
    faults.push('manifest-repo-root-missing')
  }
  return faults
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
  const structural = manifestValidationFaults(root, manifest, readText(manifestSealPath(root)).trim(), deps)
  if (structural.length > 0) return { ok: false, faults: structural, manifest: null }

  const drift = [
    ...sourceDriftFaults(manifest.repoRoot, manifest.sources),
    ...cliDriftFaults(manifest.cli, deps),
  ]
  if (drift.length > 0) return { ok: false, faults: drift, manifest }
  return { ok: true, faults: [], manifest }
}

// --- history ------------------------------------------------------------------------------------------

/**
 * Re-derive every consumed value from the raw transcript and the frozen cases. The records' own
 * numbers, grade and `ok` are claims to check, never sources. Prompts are regenerated from the
 * cases file and the fixture files, so an edited prompt plus an edited start digest still fails.
 */
export function readHistory(root, manifest, steps) {
  const faults = []
  const entries = []
  const sessionIds = new Set()
  let priorSpendUsd = 0
  let sawGap = false

  const systemDigest = protocol.sha256Hex(protocol.JUDGE_SYSTEM_PROMPT)

  for (const step of steps) {
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
      if (record.step !== step.index || record.caseId !== step.caseId || record.fixtureId !== step.fixtureId) {
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

    const systemFile = systemPromptPath(root)
    if (!fs.existsSync(systemFile)) faults.push(`system-prompt-missing:${step.index}`)
    else if (sha256File(systemFile) !== systemDigest) faults.push(`system-prompt-drift:${step.index}`)
    if (start.systemPromptSha256 !== systemDigest) faults.push(`system-prompt-claim-mismatch:${step.index}`)

    const userFile = promptPath(root, step.index)
    if (!fs.existsSync(userFile)) faults.push(`user-prompt-missing:${step.index}`)
    else if (readText(userFile) !== step.prompt) faults.push(`user-prompt-not-canonical:${step.index}`)
    if (start.userPromptSha256 !== step.promptSha256) faults.push(`user-prompt-claim-mismatch:${step.index}`)
    if (start.cliCommandSha256 !== manifest.cli.commandSha256) faults.push(`cli-binding-mismatch:${step.index}`)
    if (start.childEnvSha256 !== protocol.sealOf(protocol.CHILD_ENV_OVERRIDES)) {
      faults.push(`child-env-binding-mismatch:${step.index}`)
    }
    if (typeof start.sessionId === 'string' && fs.existsSync(systemFile)) {
      const argv = protocol.buildJudgeArgv({
        sessionId: start.sessionId,
        systemPrompt: readText(systemFile),
        maxBudgetUsd: CAL_PER_CALL_USD,
      })
      if (protocol.sha256Hex(protocol.canonicalJson(argv)) !== start.argvSha256) faults.push(`argv-mismatch:${step.index}`)
    }

    let derived = null
    const stdoutFile = rawPath(root, step.index, 'stdout')
    if (fs.existsSync(stdoutFile)) {
      derived = deriveStep({
        step,
        stdoutText: readText(stdoutFile),
        requestedSessionId: start.sessionId,
        priorSpendUsd,
        processFacts: {
          spawnError: final.spawnError ?? null,
          timedOut: final.timedOut === true,
          exitConfirmed: final.exitConfirmed === true,
          exitCode: final.exitCode,
        },
      })
      if (typeof derived.totalCostUsd === 'number') priorSpendUsd += derived.totalCostUsd
      if (final.totalCostUsd !== derived.totalCostUsd) faults.push(`record-derivation-mismatch:${step.index}:totalCostUsd`)
      if (final.ok !== derived.ok) faults.push(`record-derivation-mismatch:${step.index}:ok`)
      if (final.gradeMatch !== derived.gradeMatch) faults.push(`record-derivation-mismatch:${step.index}:gradeMatch`)
      for (const [field, left, right] of [
        ['faults', final.faults ?? [], derived.faults],
        ['grade', final.grade ?? null, derived.grade ?? null],
        ['stream', final.stream ?? null, derived.record],
      ]) {
        const a = Array.isArray(left) ? [...left].sort() : left
        const b = Array.isArray(right) ? [...right].sort() : right
        if (protocol.canonicalJson(a) !== protocol.canonicalJson(b)) {
          faults.push(`record-derivation-mismatch:${step.index}:${field}`)
        }
      }
      // Only an infrastructure/telemetry fault halts. A semantic mismatch is retained and reported.
      if (!derived.ok) faults.push(`halted-at:${step.index}`)
    }
    entries.push({ step, start, final, derived })
  }

  const known = entries.map((e) => (e.derived ? e.derived.totalCostUsd : null)).filter((c) => typeof c === 'number')
  return {
    faults,
    entries,
    nextIndex: entries.length,
    complete: entries.length === steps.length,
    spentUsd: known.reduce((total, cost) => total + cost, 0),
    unknownCostSteps: entries.length - known.length,
  }
}

// --- commands -------------------------------------------------------------------------------------------

export function prepare(options, deps = defaultDeps()) {
  const repoRoot = fs.realpathSync(options.repoRoot ?? DEFAULT_REPO_ROOT)
  const loaded = loadCases(repoRoot)
  if (!loaded.ok) throw new Error(`calibration refused: ${loaded.faults.join(', ')}`)

  const steps = buildSteps(repoRoot, loaded.cases)
  for (const step of steps) {
    const leaks = promptLeakFaults(step.prompt, step)
    if (leaks.length > 0) throw new Error(`calibration refused: ${leaks.join(', ')}`)
  }

  const commandRealPath = fs.realpathSync(options.cliCommand)
  const probe = probeCliVersion(commandRealPath, deps)
  if (!probe.ok) throw new Error(`calibration refused: ${probe.fault}`)
  if (probe.version !== protocol.CLI_VERSION) throw new Error(`calibration refused: cli-version-mismatch:${probe.version}`)

  const root = fs.realpathSync(fs.mkdtempSync(path.join(fs.realpathSync(deps.tmpdir()), CAL_ROOT_PREFIX)))
  if (isWithin(repoRoot, root)) throw new Error('calibration refused: root-workspace-nesting')

  const sources = {}
  for (const relative of SOURCE_PATHS) sources[relative] = sha256File(path.join(repoRoot, relative))

  const manifest = {
    version: MANIFEST_VERSION,
    createdAt: deps.now(),
    root,
    repoRoot,
    scope: 'judge negative-response probe; four constructed cases; not statistical calibration',
    model: protocol.MODEL,
    effort: protocol.EFFORT,
    cliVersion: protocol.CLI_VERSION,
    perCallUsd: CAL_PER_CALL_USD,
    totalUsd: CAL_TOTAL_USD,
    casesSha256: CASES_SHA256,
    childEnvOverrides: { ...protocol.CHILD_ENV_OVERRIDES },
    requestedPermissionMode: protocol.REQUESTED_PERMISSION_MODE,
    observedPermissionMode: protocol.OBSERVED_PERMISSION_MODE,
    cli: {
      command: options.cliCommand,
      commandRealPath,
      commandSha256: sha256File(commandRealPath),
      observedVersion: probe.version,
    },
    judgeSystemPromptSha256: protocol.sha256Hex(protocol.JUDGE_SYSTEM_PROMPT),
    judgeSchemaSha256: protocol.sha256Hex(JSON.stringify(protocol.JUDGE_SCHEMA)),
    sources,
    steps: steps.map((step) => ({
      step: step.index,
      caseId: step.caseId,
      fixtureId: step.fixtureId,
      origin: step.origin,
      lang: step.lang,
      expected: step.expected,
      expectedGrade: step.expectedGrade,
      promptSha256: step.promptSha256,
    })),
  }

  writeExclusive(manifestPath(root), `${JSON.stringify(manifest, null, 2)}\n`)
  writeExclusive(manifestSealPath(root), `${protocol.sealOf(manifest)}\n`)
  writeExclusive(systemPromptPath(root), protocol.JUDGE_SYSTEM_PROMPT)
  for (const step of steps) writeExclusive(promptPath(root, step.index), step.prompt)

  return { root, manifest }
}

export async function runOneNext(root, deps = defaultDeps()) {
  const context = loadContext(root, deps)
  if (!context.ok) return { ok: false, faults: context.faults }
  const manifest = context.manifest

  const loaded = loadCases(manifest.repoRoot)
  if (!loaded.ok) return { ok: false, faults: loaded.faults }
  const steps = buildSteps(manifest.repoRoot, loaded.cases)

  const history = readHistory(root, manifest, steps)
  if (history.faults.length > 0) return { ok: false, faults: history.faults }
  if (history.unknownCostSteps > 0) return { ok: false, faults: [`unknown-cost-steps:${history.unknownCostSteps}`] }
  if (history.complete) return { ok: true, done: true, faults: [], nextIndex: null }
  if (history.spentUsd >= CAL_TOTAL_USD) return { ok: false, faults: [`cal-budget-exhausted:${history.spentUsd}`] }

  const step = steps[history.nextIndex]

  // Validate the frozen input artifacts BEFORE the start marker and the spawn, for every call
  // including the first. `readHistory` only inspects steps that already have records, so without
  // this the first dispatch would send whatever is on disk: the system file is passed straight
  // into `--system-prompt`, so a tampered one both consumes budget AND produces an unreliable
  // provisional grade that only a later readback rejects.
  const systemFile = systemPromptPath(root)
  const userFile = promptPath(root, step.index)
  const preDispatch = []
  if (!fs.existsSync(systemFile)) preDispatch.push(`system-prompt-missing:${step.index}`)
  else if (sha256File(systemFile) !== protocol.sha256Hex(protocol.JUDGE_SYSTEM_PROMPT)) {
    preDispatch.push(`system-prompt-drift:${step.index}`)
  }
  if (!fs.existsSync(userFile)) preDispatch.push(`user-prompt-missing:${step.index}`)
  else if (sha256File(userFile) !== step.promptSha256) preDispatch.push(`user-prompt-not-canonical:${step.index}`)
  if (preDispatch.length > 0) return { ok: false, faults: preDispatch }

  const systemPrompt = readText(systemFile)
  const sessionId = deps.uuid()
  const argv = protocol.buildJudgeArgv({ sessionId, systemPrompt, maxBudgetUsd: CAL_PER_CALL_USD })
  const argvProblems = protocol.argvFaults(argv, {
    isAbsolute: path.isAbsolute,
    resolveWithin: (parent, candidate) => isWithin(parent, path.resolve(candidate)),
    workspaceRoot: manifest.repoRoot,
  })
  if (argvProblems.length > 0) return { ok: false, faults: argvProblems }

  const workDir = fs.realpathSync(fs.mkdtempSync(path.join(fs.realpathSync(deps.tmpdir()), CAL_WORK_PREFIX)))
  const startRecord = {
    step: step.index,
    caseId: step.caseId,
    fixtureId: step.fixtureId,
    sessionId,
    startedAt: deps.now(),
    workDir,
    argvSha256: protocol.sha256Hex(protocol.canonicalJson(argv)),
    systemPromptSha256: protocol.sha256Hex(systemPrompt),
    userPromptSha256: step.promptSha256,
    cliCommandSha256: manifest.cli.commandSha256,
    childEnvSha256: protocol.sealOf(protocol.CHILD_ENV_OVERRIDES),
  }
  writeExclusive(attemptPath(root, step.index, 'start'), `${JSON.stringify(startRecord, null, 2)}\n`)

  const stdoutFile = rawPath(root, step.index, 'stdout')
  const stderrFile = rawPath(root, step.index, 'stderr')
  const outcome = await runCall({
    command: manifest.cli.commandRealPath,
    argv,
    cwd: workDir,
    stdinText: step.prompt,
    stdoutFile,
    stderrFile,
    timeoutMs: deps.timeoutMs ?? PER_CALL_TIMEOUT_MS,
    graceMs: deps.graceMs ?? POST_KILL_GRACE_MS,
    spawnFn: deps.spawn,
  })

  const derived = deriveStep({
    step,
    stdoutText: fs.existsSync(stdoutFile) ? readText(stdoutFile) : '',
    requestedSessionId: sessionId,
    priorSpendUsd: history.spentUsd,
    processFacts: {
      spawnError: outcome.spawnError,
      timedOut: outcome.timedOut,
      exitConfirmed: outcome.exitConfirmed,
      exitCode: outcome.code,
    },
  })

  const finalRecord = {
    step: step.index,
    caseId: step.caseId,
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
    stderrSha256: fs.existsSync(stderrFile) ? sha256File(stderrFile) : null,
    totalCostUsd: derived.totalCostUsd,
    costBasis: 'cli-bundled-price-table-estimate; not provider billing',
    stream: derived.record,
    grade: derived.grade,
    expectedGrade: step.expectedGrade,
    gradeMatch: derived.gradeMatch,
    ok: derived.ok,
    faults: derived.faults,
  }
  writeExclusive(attemptPath(root, step.index, 'final'), `${JSON.stringify(finalRecord, null, 2)}\n`)

  return { ok: derived.ok, done: false, faults: derived.faults, step: step.index, caseId: step.caseId, record: finalRecord }
}

export function summarize(root, deps = defaultDeps()) {
  const context = loadContext(root, deps)
  if (!context.ok) return { ok: false, faults: context.faults }
  const manifest = context.manifest

  const loaded = loadCases(manifest.repoRoot)
  if (!loaded.ok) return { ok: false, faults: loaded.faults }
  const steps = buildSteps(manifest.repoRoot, loaded.cases)

  const history = readHistory(root, manifest, steps)
  const faults = [...history.faults]
  if (!history.complete) faults.push(`incomplete:${history.nextIndex}/${steps.length}`)
  if (history.unknownCostSteps > 0) faults.push(`unknown-cost-steps:${history.unknownCostSteps}`)
  if (history.spentUsd > CAL_TOTAL_USD) faults.push(`cal-aggregate-overshoot:${history.spentUsd}`)

  const rows = history.entries.map((entry) => ({
    caseId: entry.step.caseId,
    fixtureId: entry.step.fixtureId,
    origin: entry.step.origin,
    fixtureExpected: entry.step.expected,
    expectedGrade: entry.step.expectedGrade,
    actualGrade: entry.derived ? entry.derived.grade : null,
    rationale: entry.derived && entry.derived.grade ? entry.derived.grade.rationale : null,
    match: entry.derived ? entry.derived.gradeMatch : false,
    sessionId: entry.start.sessionId,
    estimatedCostUsd: entry.derived ? entry.derived.totalCostUsd : null,
    stdoutSha256: entry.final.stdoutSha256,
  }))
  // Retained explicitly, never edited away: a mismatch blocks acceptance and gets discussed.
  for (const row of rows) if (!row.match) faults.push(`semantic-mismatch:${row.caseId}`)

  return {
    ok: faults.length === 0,
    faults,
    root,
    model: manifest.model,
    effort: manifest.effort,
    cli: { observedVersion: manifest.cli.observedVersion, commandSha256: manifest.cli.commandSha256 },
    permissionMode: { requested: manifest.requestedPermissionMode, observed: manifest.observedPermissionMode },
    childEnvOverrides: manifest.childEnvOverrides,
    casesSha256: manifest.casesSha256,
    judgeSystemPromptSha256: manifest.judgeSystemPromptSha256,
    judgeSchemaSha256: manifest.judgeSchemaSha256,
    sources: manifest.sources,
    matched: `${rows.filter((row) => row.match).length}/${steps.length}`,
    rows,
    aggregate: {
      estimatedTotalUsd: history.spentUsd,
      unknownCostSteps: history.unknownCostSteps,
      perCallUsd: CAL_PER_CALL_USD,
      totalUsd: CAL_TOTAL_USD,
      costBasis: 'cli-bundled-price-table-estimate; not provider billing',
    },
    sourcePaths: { cases: CASES_RELATIVE_PATH, rawRoot: root },
    claim: [
      'Negative-response evidence on four constructed cases only.',
      'Two positive controls are actual captured reviewer outputs; two negatives are handcrafted constructions derived from an observed [unverified] lead and are not model output.',
      'Measures grade assignment given fixture ground truth, not blind defect detection.',
      'Excludes a constant-pass and a constant-fail grader on these inputs; establishes no statistical calibration, no general judge accuracy, and does not by itself unlock drift detection.',
    ],
  }
}

// --- CLI ------------------------------------------------------------------------------------------------

export const COMMAND_OPTIONS = Object.freeze({
  prepare: ['repo', 'cliCommand'],
  'run-one-next': ['root'],
  summarize: ['root'],
})

export function parseArgs(argv) {
  const [command, ...rest] = argv
  const options = {}
  const allowed = Object.prototype.hasOwnProperty.call(COMMAND_OPTIONS, command) ? COMMAND_OPTIONS[command] : null
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

const USAGE = `Usage (frozen: Opus 5 / xhigh / CLI ${protocol.CLI_VERSION}; 4 fixed cases; no other configuration):
  node eval/efficiency/judge-calibration.mjs prepare --cli-command <path> [--repo <path>]
  node eval/efficiency/judge-calibration.mjs run-one-next --root <root>
  node eval/efficiency/judge-calibration.mjs summarize --root <root>`

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

if (isDirectInvocation(process.argv[1], import.meta.url)) {
  main(process.argv.slice(2)).then((code) => {
    process.exitCode = code
  })
}
