// Tests for doctor.mjs's opt-in `--project`/`--cwd` flags (docs/superpowers/specs/2026-07-23-doctor-
// project-health-design.md): two additive checks (failure-memory-health, incident-journals) layered on
// top of the existing 14 plugin-health checks, plus a KNOWN_FLAGS-guarded argument() fix covering the
// pre-existing --plugin-root flag too. Sibling to, not an extension of, test/doctor-security.test.mjs
// (that file is scoped to plugin-health tamper-resistance -- a different concern). Mirrors
// test/failure-consolidate.test.mjs's synthetic-fixture style: temp directories, synthetic
// FAILURE_MEMORY.md / incident-journal content, cleanup.
import assert from "node:assert/strict";
import cp from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test, { before, after } from "node:test";
import { diagnose, summarizeMemoryHealth, KNOWN_FLAGS } from "../cressetide/skills/doctor/scripts/doctor.mjs";
import { consolidationReport, tagRecurrenceCandidates } from "../cressetide/skills/vigil/scripts/failure-consolidate.mjs";
import { parseEntries, defaultLedgerPath } from "../cressetide/skills/vigil/scripts/failure-retrieve.mjs";
import { root, temporary, write } from "./helpers.mjs";
import { isolatedHome } from "./support.mjs";

const pluginRoot = path.join(root, "cressetide");
const doctorScript = path.join(pluginRoot, "skills", "doctor", "scripts", "doctor.mjs");
const DAY = 86400000;

// --- File-scope HOME/USERPROFILE isolation (closes the WHOLE "real global FAILURE_MEMORY.md" leak class
// structurally, not per test site) ---------------------------------------------------------------------
//
// failure-retrieve.mjs's resolveMemoryFile() (imported transitively by doctor.mjs's
// checkFailureMemoryHealth, via a lazy import()) has a THIRD candidate tier --
// path.join(os.homedir(), ".claude", "FAILURE_MEMORY.md") -- fs.statSync()-checked whenever a project has
// neither of the first two (project-local) tiers. Roughly a dozen test sites in this file exercise
// --project against a fixture with no project-local memory file; a PER-CALL-SITE isolation helper only
// protects the sites that remember to use it, and a source grep for "homedir"/"node:os" literal text
// cannot see a site that reaches the real path purely through this transitive, unmodified import -- there
// is no literal token in this file's own source to grep for. Fixed structurally instead: mutate
// process.env.HOME/USERPROFILE ONCE, before ANY test in this file runs, via node:test's top-level
// before()/after() hooks -- every current and future test in this file is covered automatically, with no
// per-site opt-in required.
//
// This works because (each independently verified with a throwaway probe before committing to this
// approach, not assumed):
//  (a) node:test runs each test FILE in its own OS process: a two-file probe (one file mutates
//      process.env and prints its own process.pid; a second file asserts neither the mutation nor the PID
//      leaked across) showed distinct PIDs and zero leakage. Mutating process.env here cannot affect
//      sibling test files or the real environment outside this process.
//  (b) every os.homedir() call anywhere in THIS file's process -- including one made from inside the
//      imported, unmodified resolveMemoryFile -- re-reads process.env.HOME/USERPROFILE at CALL time, not
//      at process start or import time: a before()-hook mutation was observed by a LATER os.homedir()
//      call made from inside an imported module's exported function, and by the real, unmodified
//      resolveMemoryFile itself dynamically imported from inside a test body -- exactly how doctor.mjs's
//      checkFailureMemoryHealth actually imports and calls it. So this ONE mutation covers every one of
//      this file's in-process diagnose() call sites automatically.
//  (c) every cp.spawnSync call in this file either omits `env` entirely (Node then defaults options.env to
//      process.env) or builds its env via `{ ...process.env, ... }` -- both read process.env at the
//      spawnSync CALL, which happens during a test body, i.e. after before() has already mutated it. Every
//      spawned child process in this file inherits the isolated HOME/USERPROFILE too, with no per-call-site
//      changes needed.
//  (d) top-level test() calls in one file run sequentially, in declaration order, by default (verified: a
//      test that awaits a delay then sets a flag, followed immediately by a test asserting the flag is
//      already true, passed) -- so the single shared isolatedHomeDir below (unlike the old per-call fresh
//      directory) cannot race between tests; only one test (the AC2 test below) ever writes into it, and it
//      cleans up after itself.
const REAL_HOME = os.homedir(); // captured at file-load time, BEFORE the before() hook below ever runs
let isolatedHomeDir;
let previousHomeEnv;
let previousUserProfileEnv;

before(() => {
  const { home } = isolatedHome();
  isolatedHomeDir = home;
  previousHomeEnv = process.env.HOME;
  previousUserProfileEnv = process.env.USERPROFILE;
  process.env.HOME = home;
  process.env.USERPROFILE = home;
  // Circuit breaker, not a duplicate of the "structural proof" test below: node:test does NOT stop the
  // OTHER top-level tests in this file from running just because one named test fails -- so if a future
  // edit ever silently breaks the mutation above (e.g. the two lines are accidentally deleted or
  // reordered), the named test alone would go red while every OTHER test in this file still executes
  // against the real, unisolated home before anyone notices. A throw HERE, as the last statement inside
  // before() itself, is different in kind: node:test attributes it as a hook failure to every test in the
  // file (failureType: 'hookFailed'), so none of their bodies ever run against a broken environment --
  // verified directly (a scratch two-file comparison): with this assertion removed and isolation broken,
  // 17/18 sibling tests still reported "ok"; with this assertion present under the same broken isolation,
  // all 18 reported failureType 'hookFailed' and none of their bodies executed. Kept in ADDITION to (not
  // instead of) the named test below, which exists purely for a clear, readable failure message.
  assert.notStrictEqual(os.homedir(), REAL_HOME, "before() hook circuit breaker: isolation must be in effect before any test body in this file runs");
});

after(() => {
  // Env restoration happens first, on these two lines, before the cleanup rmSync below is even attempted --
  // so wrapping only that rmSync in try/catch cannot mask a failure to restore the real HOME/USERPROFILE.
  if (previousHomeEnv === undefined) delete process.env.HOME; else process.env.HOME = previousHomeEnv;
  if (previousUserProfileEnv === undefined) delete process.env.USERPROFILE; else process.env.USERPROFILE = previousUserProfileEnv;
  // try/catch matches the sibling convention in test/plan-gate-guards.test.mjs and
  // test/session-memory-hooks.test.mjs: a transient Windows file lock, or isolatedHomeDir being left
  // undefined (if isolatedHome() itself threw inside before()), would otherwise throw here and fail this
  // whole file at the hook level even though env restoration already succeeded above.
  try { fs.rmSync(isolatedHomeDir, { recursive: true, force: true }); } catch (e) {}
});

// Structural proof, not a grep: round 3's own "grep for homedir/node:os, no matches outside comments"
// check could not see a transitive touch through imported production code. This proves the invariant by
// construction instead -- for the whole duration of this file's test run, os.homedir() cannot return the
// real machine home, so no code path (present or future, including one reached only transitively) can
// observe it.
test("structural proof: os.homedir() cannot observe the real machine home for the duration of this file's tests (file-scope isolation is actually in effect, not merely assumed)", () => {
  assert.notStrictEqual(os.homedir(), REAL_HOME, "os.homedir() must resolve to the isolated fake home, never the real one, anywhere in this file's tests");
  assert.strictEqual(os.homedir(), isolatedHomeDir);
});

function writeIncident(dir, filename, body) {
  write(path.join(dir, ".ctide", "incidents", filename), body);
}

// A handful of tests below cp.spawnSync a brand-new CHILD PROCESS to immediately load a scratch doctor.mjs
// this same test just wrote/copied moments earlier. Plain fs.writeFileSync()/fs.cpSync() return once their
// write() syscall completes but before fsync() -- durable and visible to a freshly-spawned sibling process
// immediately on Windows and CI's ubuntu-latest, but NOT reliably on CI's macos-latest (ARM64) runner, where
// this raced (real CI failure: the child saw an empty/incomplete file and either printed nothing -- a spawned
// JSON.parse of empty stdout throws "Unexpected end of JSON input" -- or silently ran the pre-mutation
// source). fsyncPath()/writeFileSyncDurable() force the write durable BEFORE the spawn starts; do not
// "simplify" either back to a plain fs.writeFileSync/fs.cpSync call.
function fsyncPath(filePath) {
  // "r+" (read-write, existing file), not "r": Windows' FlushFileBuffers (what fsyncSync calls under the
  // hood there) needs write access on the handle and throws EPERM on a read-only-opened fd -- confirmed
  // directly (this repo's own local Windows run) rather than assumed.
  const fd = fs.openSync(filePath, "r+");
  try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
}

function writeFileSyncDurable(filePath, content) {
  fs.writeFileSync(filePath, content, "utf8");
  fsyncPath(filePath);
}

// --- AC-1 / item (g): default (no --project) output stays byte-for-byte the shipped baseline -----------

const BASELINE_CHECK_NAMES = [
  "manifest", "node", "hook-wiring",
  "hook:plan-gate.js", "hook:destructive-guard.js", "hook:contract-guard.js",
  "hook:load-failure-memory.js", "hook:compact-fidelity.js", "hook:orchestration-check.js",
  "hook-debug", "runtime-probes", "skills", "agents", "telemetry",
];
const BASELINE_GUIDANCE = [
  "claude plugin marketplace add kktu6507/plugins",
  "claude plugin install ctide@kktu",
  "Restart Claude Code after enablement changes",
];

test("regression guard: diagnose(pluginRoot) with no options (today's shipped call shape) still returns exactly the 14 baseline checks, in order, and exactly the 3 baseline guidance lines", async () => {
  const report = await diagnose(pluginRoot);
  assert.strictEqual(report.status, "pass", JSON.stringify(report, null, 2));
  assert.deepStrictEqual(report.checks.map((c) => c.name), BASELINE_CHECK_NAMES);
  assert.deepStrictEqual(report.guidance, BASELINE_GUIDANCE);
});

test("regression guard: diagnose(pluginRoot, { project: false }) is identical to the omitted-options call (explicit false is not a new code path)", async () => {
  const withoutOptions = await diagnose(pluginRoot);
  const withExplicitFalse = await diagnose(pluginRoot, { project: false });
  assert.deepStrictEqual(withExplicitFalse.checks.map((c) => c.name), withoutOptions.checks.map((c) => c.name));
  assert.deepStrictEqual(withExplicitFalse.guidance, withoutOptions.guidance);
});

test("regression guard: the real CLI, spawned with no --project flag, prints the same 14-check/3-guidance-line baseline", () => {
  const r = cp.spawnSync(process.execPath, [doctorScript, "--plugin-root", pluginRoot, "--json"], { encoding: "utf8" });
  assert.strictEqual(r.status, 0, r.stderr);
  const report = JSON.parse(r.stdout);
  assert.deepStrictEqual(report.checks.map((c) => c.name), BASELINE_CHECK_NAMES);
  assert.deepStrictEqual(report.guidance, BASELINE_GUIDANCE);
});

// --- item (a): no .ctide/ at all -> both new checks unverified, no crash ---------------------------------

test("--project with nothing under cwd (no .ctide/ at all, and no global FAILURE_MEMORY.md) adds failure-memory-health: unverified and incident-journals: unverified, without disturbing the 14 baseline checks", async () => {
  // No per-call isolation wrapper needed here: the file-scope before()/after() hook above already isolates
  // HOME/USERPROFILE for every test in this file, and this test never seeds anything into that shared
  // isolated home -- it only needs the isolation to already be in effect (which it structurally is).
  const dir = temporary("ctide-doctor-empty-");
  const report = await diagnose(pluginRoot, { project: true, cwd: dir });
  assert.deepStrictEqual(
    report.checks.filter((c) => BASELINE_CHECK_NAMES.includes(c.name)).map((c) => c.name),
    BASELINE_CHECK_NAMES,
    "the 14 plugin-health checks still all run, unchanged",
  );
  const memory = report.checks.find((c) => c.name === "failure-memory-health");
  const incidents = report.checks.find((c) => c.name === "incident-journals");
  assert.strictEqual(memory?.status, "unverified");
  assert.match(memory.detail, /no FAILURE_MEMORY\.md found/);
  assert.strictEqual(incidents?.status, "unverified");
  assert.match(incidents.detail, /no \.ctide\/incidents\/ directory found/);
  assert.strictEqual(report.status, "unverified");
  assert.deepStrictEqual(report.guidance, BASELINE_GUIDANCE, "no actionable finding -> no new guidance lines");
});

// Fix 1 (AC2 regression guard; rewritten across two rounds -- see FAILURE_MEMORY.md 2026-07-23 "a shipped
// test's real/non-isolated ~/.claude/FAILURE_MEMORY.md guard test clobbered THIS machine's actual global
// failure-memory file"): the "nothing under cwd" test above proves the unverified/no-leak outcome only
// under an ISOLATED home, which also isolates away any global FAILURE_MEMORY.md on the host machine -- so
// by itself it cannot distinguish "correctly scoped to project-local tiers" from "just got lucky because
// this machine happens to have no global file." An EARLIER version of this test proved the distinction
// against the REAL, non-isolated os.homedir() path (backing up/overwriting/restoring the genuine
// ~/.claude/FAILURE_MEMORY.md) -- unsafe under ANY concurrent sibling process touching the same real path
// (a parallel review panel, CI matrix, another local run): two racing restores can clobber each other,
// which is exactly what corrupted the real file on this machine. This version proves the IDENTICAL
// guarantee by seeding the canary inside the file-scope isolatedHomeDir instead -- a global file genuinely
// exists (for resolveMemoryFile to find, if it were ever consulted), but it is a synthetic fixture under a
// throwaway temp directory, never the real os.homedir() path. Never touches, reads from, or writes to the
// real, non-isolated os.homedir()-derived path. isolatedHomeDir is shared across every test in this file
// (set once by the before() hook above, not fresh per test) -- this is the only test that writes into it,
// so it cleans up its own write in a finally block, keeping the shared home pristine for every other test.
test("--project --cwd <genuinely empty dir> reports failure-memory-health: unverified even with a global FAILURE_MEMORY.md present inside the file-scope ISOLATED fake home's own ~/.claude/ (AC2: --project must only consider project-local tiers; resolveMemoryFile's global-fallback tier must never leak in)", async () => {
  const globalDir = path.join(isolatedHomeDir, ".claude");
  fs.mkdirSync(globalDir, { recursive: true });
  fs.writeFileSync(path.join(globalDir, "FAILURE_MEMORY.md"),
    "# FM\n\n### 2026-06-01 — REAL-GLOBAL-SCOPE-LEAK-CANARY\n- **Prevention rule**: r.\n- **Tags**: x.\n", "utf8");
  try {
    const dir = temporary("ctide-doctor-isolatedglobal-empty-");
    const report = await diagnose(pluginRoot, { project: true, cwd: dir });
    const memory = report.checks.find((c) => c.name === "failure-memory-health");
    assert.strictEqual(memory?.status, "unverified",
      "a genuinely empty project directory must stay unverified even though a global FAILURE_MEMORY.md exists in the (isolated, fake) home");
    assert.match(memory.detail, /no FAILURE_MEMORY\.md found/);
    assert.doesNotMatch(JSON.stringify(report), /REAL-GLOBAL-SCOPE-LEAK-CANARY/,
      "the global file's content must never leak into a project-scoped report");
  } finally {
    fs.rmSync(globalDir, { recursive: true, force: true });
  }
});

test("--project with neither --cwd nor CLAUDE_PROJECT_DIR set falls back to process.cwd() (the child process's own working directory) without erroring", () => {
  const dir = temporary("ctide-doctor-cwd-fallback-");
  writeIncident(dir, "INCIDENT-20260601-cwdfallbackcanary.md", "# INCIDENT-20260601-cwdfallbackcanary\n\n- Status: open\n");
  const env = { ...process.env };
  delete env.CLAUDE_PROJECT_DIR;
  const r = cp.spawnSync(process.execPath, [doctorScript, "--project", "--json"], { cwd: dir, encoding: "utf8", env });
  assert.strictEqual(typeof r.status, "number", `must exit cleanly, not crash: ${r.stderr}`);
  const report = JSON.parse(r.stdout);
  const canary = report.checks.find((c) => c.name === "incident:cwdfallbackcanary");
  assert.ok(canary, "with neither --cwd nor CLAUDE_PROJECT_DIR set, the child process's own process.cwd() must be used, finding the seeded canary");
  assert.strictEqual(canary.status, "pass");
});

test("--project with a .ctide/incidents/ path that is a FILE, not a directory, degrades to unverified rather than crashing", async () => {
  const dir = temporary("ctide-doctor-incidents-not-dir-");
  fs.mkdirSync(path.join(dir, ".ctide"), { recursive: true });
  fs.writeFileSync(path.join(dir, ".ctide", "incidents"), "not a directory", "utf8");
  const report = await diagnose(pluginRoot, { project: true, cwd: dir });
  const incidents = report.checks.find((c) => c.name === "incident-journals");
  assert.strictEqual(incidents?.status, "unverified");
});

// --- item (b): known expire-candidate / tag-recurrence fixture -> pass, correct summary, reusing real ----
// --- failure-consolidate.mjs output (never hand-computed independently of what that module returns) -----

const NOW = Date.UTC(2026, 5, 30); // 2026-06-30, mirrors test/failure-consolidate.test.mjs's own fixed NOW
const MEM_FIXTURE = `# FM

### 2026-06-25 — fresh node ci lesson doctor variant
- **Prevention rule**: r.
- **Tags**: node / ci / testing.

### 2026-01-01 — old python lesson doctor variant
- **Prevention rule**: r.
- **Tags**: node / ci / docs.

### 2025-12-01 — retired go lesson doctor variant (superseded by 2026-06-01)
- **Prevention rule**: r.
- **Tags**: go / maps.
`;

function mkMemoryProject(dir, memory, ledgerLines) {
  const memFile = path.join(dir, ".ctide", "memory", "FAILURE_MEMORY.md");
  write(memFile, memory);
  if (ledgerLines) fs.writeFileSync(defaultLedgerPath(memFile), ledgerLines.map((l) => JSON.stringify(l)).join("\n") + "\n", "utf8");
  return memFile;
}

test("--project against a FAILURE_MEMORY.md with a real expire candidate, a real tag-recurrence pair, and a retired entry reports pass with a detail line built from failure-consolidate.mjs's OWN consolidationReport()/tagRecurrenceCandidates() output", async () => {
  const dir = temporary("ctide-doctor-memfixture-");
  // Seeds >=60d of ledger history (consolidationReport's own sufficientHistory gate) with zero hits for
  // the old entry, so it becomes a real expire candidate; the fresh entry is too young (5d old) to
  // qualify regardless of hits.
  mkMemoryProject(dir, MEM_FIXTURE, [{ ts: NOW - 90 * DAY, key: "seed-old-history" }]);

  const report = await diagnose(pluginRoot, { project: true, cwd: dir, now: NOW });
  const check = report.checks.find((c) => c.name === "failure-memory-health");
  assert.strictEqual(check?.status, "pass");

  // Independently call the REAL vigil functions the same way doctor.mjs's own checkFailureMemoryHealth
  // does, then feed their real output through doctor.mjs's OWN exported summarizer -- proves the detail
  // is derived from failure-consolidate.mjs's real report, never a parallel reimplementation.
  const entries = parseEntries(MEM_FIXTURE);
  const records = [{ ts: NOW - 90 * DAY, key: "seed-old-history" }];
  const expectedReport = consolidationReport(entries, records, { now: NOW });
  const expectedTagCandidates = tagRecurrenceCandidates(entries);
  assert.strictEqual(expectedReport.expireCandidates.length, 1, "fixture sanity: exactly one real expire candidate");
  assert.strictEqual(expectedTagCandidates.length, 1, "fixture sanity: exactly one real tag-recurrence pair");
  assert.strictEqual(expectedReport.retired.length, 1, "fixture sanity: exactly one real retired entry");
  assert.strictEqual(check.detail, summarizeMemoryHealth(expectedReport, expectedTagCandidates));
  assert.match(check.detail, /3 entries/);
  assert.match(check.detail, /1 expire candidate/);
  assert.match(check.detail, /1 tag-recurrence pair/);
  assert.match(check.detail, /1 retired entry/);

  // Fix 6 (AC5 guidance truth table): this fixture has real actionable memory findings AND no
  // .ctide/incidents/ directory at all (mkMemoryProject never creates one) -- the memory-only-actionable
  // combination the truth table was missing. Only the vigil hand-off line must appear, never the salvage
  // one (there is no incident to hand off).
  assert.ok(report.guidance.some((line) => /vigil run/.test(line)), "vigil hand-off guidance line present for the actionable memory findings");
  assert.ok(!report.guidance.some((line) => /salvage/i.test(line)), "no salvage guidance line when there is no incidents directory at all");
});

// round-3 Fix 7: the original bug this session fixed was the naive `${count} entries` template producing
// "N retired entrys" for N>=2 (correct English plural is "entries"). Fix 4 above (line ~377) already covers
// the N=1 singular case ("1 entry"/"1 retired entry"); this is the first test asserting the COMPOSED "N
// retired entries" phrase at N>=2 -- the literal originally-reported symptom -- rather than just the bare,
// non-composed "N entries" total-count phrase already covered elsewhere.
test("--project against a FAILURE_MEMORY.md with TWO retired entries states the composed 'N retired entries' phrase correctly (N>=2 plural, not the naive '2 retired entrys')", async () => {
  const dir = temporary("ctide-doctor-tworetired-");
  mkMemoryProject(dir, `# FM

### 2026-06-25 — first retired lesson (expired)
- **Prevention rule**: r.
- **Tags**: a / b.

### 2026-06-20 — second retired lesson (superseded by 2026-06-25)
- **Prevention rule**: r.
- **Tags**: c / d.
`);
  const report = await diagnose(pluginRoot, { project: true, cwd: dir, now: NOW });
  const check = report.checks.find((c) => c.name === "failure-memory-health");
  assert.strictEqual(check?.status, "pass");
  assert.match(check.detail, /\b2 retired entries\b/, `expected the composed "2 retired entries" phrase in: ${check.detail}`);
  assert.doesNotMatch(check.detail, /retired entrys/);
});

test("--project against a FAILURE_MEMORY.md that parses to zero entries reports pass with the zero-entry count stated explicitly, never a bare 'clean'", async () => {
  const dir = temporary("ctide-doctor-memempty-");
  mkMemoryProject(dir, "# FM\n\nno entries here, just prose.\n");
  const report = await diagnose(pluginRoot, { project: true, cwd: dir, now: NOW });
  const check = report.checks.find((c) => c.name === "failure-memory-health");
  assert.strictEqual(check?.status, "pass");
  assert.strictEqual(check.detail, "FAILURE_MEMORY.md found, 0 entries");
});

// round-3 Fix 3: projectLocalMemoryCandidates(cwd) hand-mirrors resolveMemoryFile's first TWO candidates
// (.ctide/memory/FAILURE_MEMORY.md, then the legacy ai/FAILURE_MEMORY.md) as a literal duplicated array.
// Every fixture above (mkMemoryProject) only ever plants the FIRST tier -- the second, legacy tier had zero
// coverage. This proves the second mirrored candidate actually resolves and reports correctly on its own,
// with no .ctide/memory/ present at all (so a pass here cannot be explained by silently falling through to
// the first tier instead).
test("--project resolves and reports on the SECOND project-local tier (legacy ai/FAILURE_MEMORY.md) when no .ctide/memory/ file is present", async () => {
  const dir = temporary("ctide-doctor-legacy-ai-tier-");
  write(path.join(dir, "ai", "FAILURE_MEMORY.md"), "# FM\n\n### 2026-06-20 — solo legacy-tier entry\n- **Prevention rule**: r.\n- **Tags**: solo.\n");
  assert.strictEqual(fs.existsSync(path.join(dir, ".ctide", "memory", "FAILURE_MEMORY.md")), false,
    "fixture sanity: no first-tier file exists, so a pass here can only come from the second tier");
  const report = await diagnose(pluginRoot, { project: true, cwd: dir, now: NOW });
  const check = report.checks.find((c) => c.name === "failure-memory-health");
  assert.strictEqual(check?.status, "pass");
  assert.strictEqual(check.detail, "1 entry, no usage data recorded yet (run failure-retrieve.mjs --log during planning) — no staleness claim, 0 tag-recurrence pairs");
});

// Fix 5(a): the genuine-read-error branch (FAILURE_MEMORY.md found, but a real filesystem error prevents
// reading it) has no coverage today -- every existing memory-health test hits either "not found" or a
// successfully-read file. POSIX-only (chmod 0o000 has no equivalent on win32); mirrors the win32-skip
// precedent established in test/plan-gate-guards.test.mjs and test/session-memory-hooks.test.mjs.
test("--project against a FAILURE_MEMORY.md found but unreadable (permissions) reports fail with the read error named, distinct from the 0-entries case", async (t) => {
  if (process.platform === "win32") return t.skip("POSIX permission bits do not apply on win32");
  const dir = temporary("ctide-doctor-memory-permdenied-");
  const memFile = mkMemoryProject(dir, "# FM\n\n### 2026-06-20 — unreadable entry\n- **Prevention rule**: r.\n- **Tags**: x.\n");
  fs.chmodSync(memFile, 0o000);
  try {
    let readableAnyway = false;
    try { fs.readFileSync(memFile); readableAnyway = true; } catch (e) {}
    if (readableAnyway) return t.skip("running with privileges that bypass file permission bits (e.g. root) -- cannot simulate a read failure here");
    // The await is INSIDE the try block (not a bare `return someAsyncCall()`), so the finally below only
    // restores permissions after diagnose()'s real read attempt has actually executed -- the same
    // async/finally-ordering care the AC2 test above needs for its own cleanup, applied here to
    // fs.chmodSync instead of a file-scope directory removal.
    const report = await diagnose(pluginRoot, { project: true, cwd: dir, now: NOW });
    const check = report.checks.find((c) => c.name === "failure-memory-health");
    assert.strictEqual(check?.status, "fail");
    assert.match(check.detail, /FAILURE_MEMORY\.md found but read failed/);
  } finally {
    fs.chmodSync(memFile, 0o644);
  }
});

// --- item (c) + (d): mixed open/mitigated/closed/unknown-status incident journals ------------------------

test("--project against a mix of open/mitigated/closed/missing-Status journals produces one incident:<slug> entry per NON-closed journal (correct age-in-days, correct case naming), and the closed journal produces no entry of its own", async () => {
  const dir = temporary("ctide-doctor-incidents-mixed-");
  writeIncident(dir, "INCIDENT-20260601-open-one.md", "# INCIDENT-20260601-open-one\n\n- Status: open\n- Severity: SEV2\n");
  writeIncident(dir, "INCIDENT-20260701-mitigated-one.md", "# INCIDENT-20260701-mitigated-one\n\n- Status: mitigated\n- Severity: SEV3\n");
  writeIncident(dir, "INCIDENT-20260101-closed-one.md", "# INCIDENT-20260101-closed-one\n\n- Status: closed\n- Severity: SEV3\n");
  writeIncident(dir, "INCIDENT-20260615-unknown-one.md", "# INCIDENT-20260615-unknown-one\n\n- Severity: SEV1\n");

  const fixedNow = Date.UTC(2026, 6, 23); // 2026-07-23
  const report = await diagnose(pluginRoot, { project: true, cwd: dir, now: fixedNow });

  assert.strictEqual(report.checks.find((c) => c.name === "incident-journals"), undefined,
    "per-item entries replace the collapsed summary once any journal is non-closed");
  assert.strictEqual(report.checks.find((c) => c.name === "incident:closed-one"), undefined,
    "a confirmed-closed journal gets no entry of its own");

  const openCheck = report.checks.find((c) => c.name === "incident:open-one");
  assert.strictEqual(openCheck?.status, "pass");
  assert.strictEqual(openCheck.detail, "status=open, opened 52 days ago");

  const mitigatedCheck = report.checks.find((c) => c.name === "incident:mitigated-one");
  assert.strictEqual(mitigatedCheck?.status, "pass");
  assert.strictEqual(mitigatedCheck.detail, "status=mitigated, opened 22 days ago");

  const unknownCheck = report.checks.find((c) => c.name === "incident:unknown-one");
  assert.strictEqual(unknownCheck?.status, "unverified", "a missing Status: line is not confirmed closed, and doctor cannot verify its true state");
  assert.strictEqual(unknownCheck.detail, "status unknown — Status: line missing or unparseable");
});

test("--project against an unparseable Status: value (present but not open/mitigated/closed) is reported as unknown, never guessed toward open or closed", async () => {
  const dir = temporary("ctide-doctor-incidents-unparseable-");
  writeIncident(dir, "INCIDENT-20260601-garbled.md", "# INCIDENT-20260601-garbled\n\n- Status: open | mitigated | closed\n");
  const report = await diagnose(pluginRoot, { project: true, cwd: dir, now: Date.UTC(2026, 6, 23) });
  const check = report.checks.find((c) => c.name === "incident:garbled");
  assert.strictEqual(check?.status, "unverified");
  assert.strictEqual(check.detail, "status unknown — Status: line missing or unparseable");
});

test("--project against all-closed incident journals collapses to a single incident-journals: pass, 0 open summary instead of per-item noise", async () => {
  const dir = temporary("ctide-doctor-incidents-allclosed-");
  writeIncident(dir, "INCIDENT-20260101-closed-one.md", "# INCIDENT-20260101-closed-one\n\n- Status: closed\n");
  writeIncident(dir, "INCIDENT-20260102-closed-two.md", "# INCIDENT-20260102-closed-two\n\n- Status: Closed\n");
  const report = await diagnose(pluginRoot, { project: true, cwd: dir, now: Date.UTC(2026, 6, 23) });
  const check = report.checks.find((c) => c.name === "incident-journals");
  assert.strictEqual(check?.status, "pass");
  assert.strictEqual(check.detail, "0 open");
  assert.strictEqual(report.checks.filter((c) => c.name.startsWith("incident:")).length, 0);
});

test("--project against a journal whose filename does not match INCIDENT-<YYYYMMDD>-<slug>.md still gets classified (never dropped), with age reported as unknown", async () => {
  const dir = temporary("ctide-doctor-incidents-badname-");
  writeIncident(dir, "random-notes.md", "# random notes\n\n- Status: open\n");
  const report = await diagnose(pluginRoot, { project: true, cwd: dir, now: Date.UTC(2026, 6, 23) });
  const check = report.checks.find((c) => c.name === "incident:random-notes");
  assert.strictEqual(check?.status, "pass");
  assert.strictEqual(check.detail, "status=open, age unknown (unparseable filename date)");
});

// Fix 3: two incident journals with different filename dates but the same descriptive slug must not
// collapse onto one identically-named incident:<slug> check -- a name-keyed lookup (.find(c => c.name ===
// X), the idiom this whole file uses throughout) would silently see only the first. Both colliding
// entries are renamed to their full filename stem, symmetrically (neither date looks like the "extra" one).
test("--project with two same-slug, different-date incident journals disambiguates both check entries by filename stem instead of colliding on one incident:<slug> name", async () => {
  const dir = temporary("ctide-doctor-incidents-slug-collision-");
  writeIncident(dir, "INCIDENT-20260601-db-migration-failure.md", "# INCIDENT-20260601-db-migration-failure\n\n- Status: open\n");
  writeIncident(dir, "INCIDENT-20260701-db-migration-failure.md", "# INCIDENT-20260701-db-migration-failure\n\n- Status: open\n");
  const report = await diagnose(pluginRoot, { project: true, cwd: dir, now: Date.UTC(2026, 6, 23) });

  assert.strictEqual(report.checks.find((c) => c.name === "incident:db-migration-failure"), undefined,
    "the colliding plain slug name must not be used for either entry once a collision is detected");
  const first = report.checks.find((c) => c.name === "incident:INCIDENT-20260601-db-migration-failure");
  const second = report.checks.find((c) => c.name === "incident:INCIDENT-20260701-db-migration-failure");
  assert.ok(first, "the older-dated colliding journal must still be visible under its own distinguishing name");
  assert.ok(second, "the newer-dated colliding journal must still be visible under its own distinguishing name");
  assert.notStrictEqual(first.name, second.name, "the two colliding entries must be distinguishable from each other in the checks array");
  assert.strictEqual(first.status, "pass");
  assert.strictEqual(second.status, "pass");
  assert.match(first.detail, /status=open/);
  assert.match(second.detail, /status=open/);
});

// round-3 Fix 6: slug-COUNT disambiguation (immediately above) is not sufficient on its own -- a crafted
// filename's own slug can be shaped exactly like another finding's disambiguated FULL STEM, producing a
// residual collision the slug-count check alone cannot see. Here: A ("INCIDENT-20260601-foo.md") and B
// ("INCIDENT-20260701-foo.md") share slug "foo" (count 2) and disambiguate to their own filename stems,
// "INCIDENT-20260601-foo" and "INCIDENT-20260701-foo". D's filename is crafted so its OWN slug (once its
// own INCIDENT-<date>- prefix is stripped) is the literal string "INCIDENT-20260601-foo" -- textually
// identical to A's disambiguated stem -- while D's own slug count is 1 (nothing else shares IT), so the
// slug-count path alone would silently reuse A's already-emitted name.
test("--project against a crafted filename whose own slug collides with another finding's disambiguated full-stem name still produces uniquely-named checks[] entries (residual collision beyond simple slug-count disambiguation)", async () => {
  const dir = temporary("ctide-doctor-incidents-residual-collision-");
  writeIncident(dir, "INCIDENT-20260601-foo.md", "# a\n\n- Status: open\n");
  writeIncident(dir, "INCIDENT-20260701-foo.md", "# b\n\n- Status: open\n");
  writeIncident(dir, "INCIDENT-20260610-INCIDENT-20260601-foo.md", "# d\n\n- Status: open\n");
  const report = await diagnose(pluginRoot, { project: true, cwd: dir, now: Date.UTC(2026, 6, 23) });
  const incidentChecks = report.checks.filter((c) => c.name.startsWith("incident:"));
  assert.strictEqual(incidentChecks.length, 3, "all three non-closed journals must produce their own check entry");
  const names = incidentChecks.map((c) => c.name);
  assert.strictEqual(new Set(names).size, names.length,
    `no two checks[] entries may share a name, but got: ${JSON.stringify(names)}`);
});

// Fix 5(b): the per-file journal-read-error branch (readdirSync lists the file, but readFileSync/statSync
// then fails on it) has no coverage today -- a broken symlink (dangling target) reproduces a genuine
// filesystem error at read time while still being listed by readdirSync. Mirrors the symlink-attempt/
// t.skip(e.code) precedent established in test/plan-gate-guards.test.mjs and
// test/session-memory-hooks.test.mjs (create in a try/catch, skip gracefully if this environment cannot
// create symlinks, e.g. Windows without Developer Mode/admin).
test("--project against an INCIDENT-*.md path that is a broken symlink reports incident:<slug> as unverified with the read failure named", async (t) => {
  const dir = temporary("ctide-doctor-incidents-brokenlink-");
  fs.mkdirSync(path.join(dir, ".ctide", "incidents"), { recursive: true });
  const target = path.join(dir, "nonexistent-target.md");
  const link = path.join(dir, ".ctide", "incidents", "INCIDENT-20260601-brokenlink.md");
  try {
    fs.symlinkSync(target, link, "file");
  } catch (e) {
    return t.skip("cannot create a file symlink here: " + (e && e.code));
  }
  const report = await diagnose(pluginRoot, { project: true, cwd: dir, now: Date.UTC(2026, 6, 23) });
  const check = report.checks.find((c) => c.name === "incident:brokenlink");
  assert.strictEqual(check?.status, "unverified");
  assert.match(check.detail, /journal read failed/);
});

// --- item (e): guidance lines present only when actionable, absent entirely on a clean --project run -----

test("--project run with a clean memory file (no retired/expire/tag findings) and no incidents directory adds no new guidance lines", async () => {
  const dir = temporary("ctide-doctor-clean-");
  mkMemoryProject(dir, "# FM\n\n### 2026-06-20 — solo unrelated entry\n- **Prevention rule**: r.\n- **Tags**: solo.\n");
  const report = await diagnose(pluginRoot, { project: true, cwd: dir, now: NOW });
  const memory = report.checks.find((c) => c.name === "failure-memory-health");
  assert.strictEqual(memory?.status, "pass");
  // Fix 4 (pluralization): this is the file's one single-entry fixture -- must read "1 entry", never the
  // "1 entries" the old naive `${count} entries` template literal produced.
  assert.strictEqual(memory.detail, "1 entry, no usage data recorded yet (run failure-retrieve.mjs --log during planning) — no staleness claim, 0 tag-recurrence pairs");
  const incidents = report.checks.find((c) => c.name === "incident-journals");
  assert.strictEqual(incidents?.status, "unverified");
  assert.deepStrictEqual(report.guidance, BASELINE_GUIDANCE);
});

test("--project run with FAILURE_MEMORY.md findings AND a non-closed incident adds BOTH hand-off guidance lines, naming vigil and salvage respectively", async () => {
  const dir = temporary("ctide-doctor-actionable-");
  mkMemoryProject(dir, MEM_FIXTURE, [{ ts: NOW - 90 * DAY, key: "seed-old-history" }]);
  writeIncident(dir, "INCIDENT-20260601-open-one.md", "# INCIDENT-20260601-open-one\n\n- Status: open\n");
  const report = await diagnose(pluginRoot, { project: true, cwd: dir, now: NOW });
  assert.strictEqual(report.guidance.length, BASELINE_GUIDANCE.length + 2);
  assert.ok(report.guidance.slice(0, 3).every((line, i) => line === BASELINE_GUIDANCE[i]), "existing 3 guidance lines untouched");
  assert.ok(report.guidance.some((line) => /vigil run/.test(line) && /FAILURE_MEMORY/.test(line)), "vigil hand-off line present");
  assert.ok(report.guidance.some((line) => /salvage/i.test(line) && /closure flow/.test(line)), "salvage hand-off line present");
});

test("--project run with ONLY a non-closed incident (clean memory file) adds ONLY the salvage guidance line, not the vigil one", async () => {
  const dir = temporary("ctide-doctor-incident-only-actionable-");
  mkMemoryProject(dir, "# FM\n\n### 2026-06-20 — solo unrelated entry\n- **Prevention rule**: r.\n- **Tags**: solo.\n");
  writeIncident(dir, "INCIDENT-20260601-open-one.md", "# INCIDENT-20260601-open-one\n\n- Status: open\n");
  const report = await diagnose(pluginRoot, { project: true, cwd: dir, now: NOW });
  assert.strictEqual(report.guidance.length, BASELINE_GUIDANCE.length + 1);
  assert.ok(!report.guidance.some((line) => /vigil run/.test(line)), "no vigil line when memory is clean");
  assert.ok(report.guidance.some((line) => /salvage/i.test(line)), "salvage line present for the open incident");
});

// --- item (f): KNOWN_FLAGS swallow-prevention (must cover --plugin-root too, not just the two new flags) -

test("KNOWN_FLAGS is exactly the complete recognized-flag set: 2 value-bearing (--plugin-root, --cwd) + 2 boolean (--project, --json)", () => {
  assert.deepStrictEqual([...KNOWN_FLAGS].sort(), ["--cwd", "--json", "--plugin-root", "--project"]);
});

test("KNOWN_FLAGS guard, literal task example: --cwd --project treats --project as an omitted value for --cwd (not swallowed), falling back to CLAUDE_PROJECT_DIR", () => {
  const dir = temporary("ctide-doctor-literal-swallow-");
  writeIncident(dir, "INCIDENT-20260601-literalcanary.md", "# INCIDENT-20260601-literalcanary\n\n- Status: open\n");
  const env = { ...process.env, CLAUDE_PROJECT_DIR: dir };
  const r = cp.spawnSync(process.execPath, [doctorScript, "--cwd", "--project", "--json"], { cwd: dir, encoding: "utf8", env });
  // Exit code (not asserted as exactly 0): this temp dir seeds an incident canary but no project-local
  // FAILURE_MEMORY.md, so --project's failure-memory-health check correctly reports "unverified" (Fix
  // 1/AC2: it must never fall through to the machine-global tier just to manufacture a "pass"), which
  // rolls the overall report status to "unverified" and the CLI exit code to 1 -- expected, not a crash.
  // Only "exited cleanly, not signal-killed" is asserted here; the actual swallow-guard signal under test
  // is the canary check below.
  assert.strictEqual(typeof r.status, "number", `must exit cleanly, not crash: ${r.stderr}`);
  const report = JSON.parse(r.stdout);
  const canary = report.checks.find((c) => c.name === "incident:literalcanary");
  assert.ok(canary, "--cwd must fall back to CLAUDE_PROJECT_DIR, not resolve to the bogus literal path '--project'");
  assert.strictEqual(canary.status, "pass");
  assert.match(canary.detail, /status=open/);
});

test("doctor: for EVERY value-bearing flag in KNOWN_FLAGS, a value slot occupied by any OTHER known flag's own name (including the boolean --project/--json) is treated as omitted, never as a literal value -- --plugin-root falls back to the real bundled plugin root (manifest still passes) and --cwd falls back to CLAUDE_PROJECT_DIR (the seeded canary incident is still found), proving the swallow never silently misdirects either resolution to a bogus '<flag-name>'-shaped path", () => {
  const VALUE_FLAGS = KNOWN_FLAGS.filter((f) => f !== "--project" && f !== "--json");
  const BOOL_FLAGS = KNOWN_FLAGS.filter((f) => f === "--project" || f === "--json");
  for (const F of VALUE_FLAGS) {
    for (const G of KNOWN_FLAGS) {
      if (G === F) continue;
      const dir = temporary("ctide-doctor-swallow-");
      writeIncident(dir, "INCIDENT-20260601-sweepcanary.md", "# INCIDENT-20260601-sweepcanary\n\n- Status: open\n");
      const values = { "--plugin-root": pluginRoot, "--cwd": dir };

      // Order: G's own legitimate occurrence FIRST, then every other flag, then F LAST with its value
      // slot occupied by the literal token G -- keeps every flag's indexOf lookup unambiguous (mirrors
      // test/run-consolidate.test.mjs's / test/failure-consolidate.test.mjs's identical loop-test
      // ordering discipline).
      const order = [G, ...KNOWN_FLAGS.filter((x) => x !== F && x !== G), F];
      const argv = [];
      for (const flagName of order) {
        if (flagName === F) argv.push(F, G); // F's own value slot swallowed by G's literal name
        else if (BOOL_FLAGS.includes(flagName)) argv.push(flagName); // bare boolean, no value slot
        else argv.push(flagName, values[flagName]);
      }

      const env = { ...process.env, CLAUDE_PROJECT_DIR: dir };
      delete env.CLAUDE_PLUGIN_ROOT; // hermetic: --plugin-root's fallback, if swallowed, must reach bundledPluginRoot
      const r = cp.spawnSync(process.execPath, [doctorScript, ...argv], { cwd: dir, encoding: "utf8", env });
      // Exit code (not asserted as exactly 0): same reasoning as the literal-example test above -- this
      // temp dir has no project-local FAILURE_MEMORY.md, so failure-memory-health correctly reports
      // "unverified" post-Fix-1, rolling the exit code to 1. Only "exited cleanly" (fail-open, not a
      // crash) is asserted here; the swallow-guard signal under test is the manifest/canary checks below.
      assert.strictEqual(typeof r.status, "number", `${F} swallowed by ${G} must still exit cleanly (fail-open): ${r.stderr}`);
      const report = JSON.parse(r.stdout);

      const manifest = report.checks.find((c) => c.name === "manifest");
      assert.strictEqual(manifest?.status, "pass",
        `${F} swallowed by ${G}: --plugin-root must still resolve to the real bundled plugin root, not a bogus '${G}'-shaped path`);

      const canary = report.checks.find((c) => c.name === "incident:sweepcanary");
      assert.ok(canary,
        `${F} swallowed by ${G}: --cwd must still resolve to the real seeded project dir, not a bogus '${G}'-shaped path`);
      assert.match(canary.detail, /status=open/);
    }
  }
});

// --- red-before/green-after proof that the swallow-prevention test above actually catches the bug it -----
// --- targets, not just a smoke test that happens to pass either way ---------------------------------------

test("red->green proof: the literal --cwd --project swallow example fails against the pre-fix unguarded argument() and passes against the shipped guarded one", () => {
  const scratchDir = temporary("ctide-doctor-redgreen-");
  const scratchPlugin = path.join(scratchDir, "cressetide");
  fs.cpSync(pluginRoot, scratchPlugin, { recursive: true });
  const scratchDoctor = path.join(scratchPlugin, "skills", "doctor", "scripts", "doctor.mjs");
  const source = fs.readFileSync(scratchDoctor, "utf8");

  // Reproduce the exact pre-fix unguarded helper (confirmed by direct read before this task's fix):
  // `const index = process.argv.indexOf(name); return index >= 0 ? process.argv[index + 1] : undefined;`
  const guardedFunction = /function argument\(name\) \{[\s\S]*?\n\}/;
  assert.match(source, guardedFunction, "fixture sanity: the guarded argument() function must be present to revert");
  const unguarded = source.replace(guardedFunction,
    'function argument(name) {\n  const index = process.argv.indexOf(name);\n  return index >= 0 ? process.argv[index + 1] : undefined;\n}');
  assert.notStrictEqual(unguarded, source, "fixture sanity: the revert must actually change the source");
  writeFileSyncDurable(scratchDoctor, unguarded);

  const dir = temporary("ctide-doctor-redgreen-project-");
  writeIncident(dir, "INCIDENT-20260601-redgreencanary.md", "# INCIDENT-20260601-redgreencanary\n\n- Status: open\n");
  const env = { ...process.env, CLAUDE_PROJECT_DIR: dir };
  const argv = [scratchDoctor, "--cwd", "--project", "--json"];

  // Exit CODE is not the signal under test here (an --project run's overall status/exit code also
  // depends on ambient facts unrelated to this bug, e.g. whether this machine happens to have a global
  // ~/.claude/FAILURE_MEMORY.md) -- only assert the process exited cleanly (not signal-killed) and
  // printed valid JSON; the actual red/green signal is whether the canary check is present.
  const red = cp.spawnSync(process.execPath, argv, { cwd: dir, encoding: "utf8", env });
  assert.strictEqual(typeof red.status, "number", `unguarded run must exit cleanly, not crash: ${red.stderr}`);
  const redReport = JSON.parse(red.stdout);
  assert.strictEqual(redReport.checks.find((c) => c.name === "incident:redgreencanary"), undefined,
    "RED: against the pre-fix unguarded argument(), --cwd's value is swallowed by the literal '--project' token, so the canary must NOT be found");

  const green = cp.spawnSync(process.execPath, [doctorScript, "--cwd", "--project", "--json"], { cwd: dir, encoding: "utf8", env });
  assert.strictEqual(typeof green.status, "number", `guarded run must exit cleanly, not crash: ${green.stderr}`);
  const greenReport = JSON.parse(green.stdout);
  assert.ok(greenReport.checks.find((c) => c.name === "incident:redgreencanary"),
    "GREEN: against the shipped guarded argument(), --cwd correctly falls back to CLAUDE_PROJECT_DIR and the canary IS found");
});

// --- round-3 Fix 2: persisted proof of the "--project must never crash under a broken/missing vigil -------
// --- module" invariant (doctor.mjs's own header comment on VIGIL_RETRIEVE_MODULE/VIGIL_CONSOLIDATE_MODULE, ---
// --- checkFailureMemoryHealth's lazy dynamic import()) -- manually verified before, never persisted --------

// Reuses this file's own established scratch-copy pattern (the red->green proof test directly above): copy
// the whole plugin root elsewhere and mutate ONLY the copy, never the real reviewed tree.
test("--project degrades to a reported failure-memory-health: fail (never a process crash) when vigil's own consolidate module is missing from a scratch plugin copy, and a flagless run against that same broken copy is completely unaffected", () => {
  const scratchDir = temporary("ctide-doctor-vigilbroken-");
  try {
    const scratchPlugin = path.join(scratchDir, "cressetide");
    fs.cpSync(pluginRoot, scratchPlugin, { recursive: true });
    const scratchDoctor = path.join(scratchPlugin, "skills", "doctor", "scripts", "doctor.mjs");
    // Same write-then-cross-process-read race as writeFileSyncDurable's own call sites above, but via
    // fs.cpSync instead of fs.writeFileSync: this test's flagless spawn below is the FIRST read of
    // scratchDoctor by any process since the copy, with no in-process readFileSync to warm it first.
    // Confirmed against this exact test's own real macos-latest CI failure log (an empty spawned stdout,
    // "Unexpected end of JSON input" at the JSON.parse below) -- not a hypothetical.
    fsyncPath(scratchDoctor);
    const brokenVigilFile = path.join(scratchPlugin, "skills", "vigil", "scripts", "failure-consolidate.mjs");
    assert.ok(fs.existsSync(brokenVigilFile), "fixture sanity: the file this test breaks must actually exist in the scratch copy first");
    fs.rmSync(brokenVigilFile);

    // (a) flagless (no --project at all): checkFailureMemoryHealth's dynamic import must never even be
    // reached, so a broken vigil module must not affect this run at all -- same 14 baseline checks, no
    // crash. This is the literal historical repro named in doctor.mjs's own header comment: a missing
    // failure-consolidate.mjs used to crash even a flagless, --project-less invocation with an uncaught
    // ERR_MODULE_NOT_FOUND, before the lazy-import fix.
    const flagless = cp.spawnSync(process.execPath, [scratchDoctor, "--plugin-root", scratchPlugin, "--json"], { encoding: "utf8" });
    assert.strictEqual(flagless.status, 0, `flagless run must still exit 0 against a scratch copy with a broken vigil module, never crash: ${flagless.stderr}`);
    const flaglessReport = JSON.parse(flagless.stdout);
    assert.deepStrictEqual(flaglessReport.checks.map((c) => c.name), BASELINE_CHECK_NAMES,
      "the 14 baseline checks must be completely unaffected by a vigil module that only --project would ever need");

    // (b) --project against the SAME broken copy: the dynamic import fails, and that failure must surface as
    // this check's own reported `fail` (naming the module-load error), never an uncaught exception or empty
    // stdout.
    const projectCwd = temporary("ctide-doctor-vigilbroken-project-");
    const project = cp.spawnSync(process.execPath,
      [scratchDoctor, "--plugin-root", scratchPlugin, "--project", "--cwd", projectCwd, "--json"],
      { encoding: "utf8" });
    assert.strictEqual(typeof project.status, "number", `--project run must exit cleanly (not signal-killed/crashed) against a broken vigil module: ${project.stderr}`);
    assert.ok(project.stdout && project.stdout.trim().length > 0, "must produce real JSON output, not empty stdout");
    const projectReport = JSON.parse(project.stdout);
    const memory = projectReport.checks.find((c) => c.name === "failure-memory-health");
    assert.strictEqual(memory?.status, "fail", "a broken vigil module must surface as this check's own reported fail, not a crash");
    assert.match(memory.detail, /vigil module load failed/);
  } finally {
    fs.rmSync(scratchDir, { recursive: true, force: true });
  }
});

// round-3 Fix 8: the code that runs AFTER a successful vigil module load inside diagnose()'s `if (project)
// { ... }` block was previously NOT try/catch-wrapped, unlike every other check in diagnose() and unlike
// the vigil module-LOAD path itself. No concrete throwing input was known -- this proves the NEW safety net
// actually catches an injected one, using this file's own established scratch-copy source-mutation
// technique (same technique the red->green proof test above already uses) rather than resting on manual
// verification alone.
test("--project: an unexpected exception inside the project-health block is caught and reported as a project-health: fail check, never an uncaught crash", () => {
  const scratchDir = temporary("ctide-doctor-fix8-");
  try {
    const scratchPlugin = path.join(scratchDir, "cressetide");
    fs.cpSync(pluginRoot, scratchPlugin, { recursive: true });
    const scratchDoctor = path.join(scratchPlugin, "skills", "doctor", "scripts", "doctor.mjs");
    const baseSource = fs.readFileSync(scratchDoctor, "utf8");

    const throwMarker = 'function checkIncidentJournals(cwd, checks, now) {\n  const dir = path.join(cwd, ".ctide", "incidents");';
    assert.ok(baseSource.includes(throwMarker), "fixture sanity: checkIncidentJournals's exact opening lines must be present to inject a throw");
    const withThrow = baseSource.replace(throwMarker,
      'function checkIncidentJournals(cwd, checks, now) {\n  throw new Error("FIX8_INJECTED_THROW_PROOF");\n  const dir = path.join(cwd, ".ctide", "incidents");');
    assert.notStrictEqual(withThrow, baseSource, "fixture sanity: the throw injection must actually change the source");

    // The exact shipped try/catch-wrapped block (byte-identical to the real doctor.mjs at the time this
    // test was written) vs. its pre-Fix-8 unwrapped equivalent.
    const wrappedBlock = `  if (project) {
    try {
      const memoryFinding = await checkFailureMemoryHealth(cwd, checks, now);
      const incidentFinding = checkIncidentJournals(cwd, checks, now);
      if (memoryFinding.actionable) {
        guidance.push("FAILURE_MEMORY.md has findings (expire candidates, retired entries, or tag-recurrence pairs) — hand this to a vigil run to consolidate (or edit directly for a trivial single-entry cleanup)");
      }
      if (incidentFinding.actionable) {
        guidance.push("An incident journal is not confirmed closed — re-enter salvage's closure flow to close it properly");
      }
    } catch (error) {
      checks.push(result("project-health", "fail", \`--project checks failed unexpectedly (\${safeErrorCode(error)})\`));
    }
  }`;
    assert.ok(withThrow.includes(wrappedBlock), "fixture sanity: the shipped try/catch-wrapped project-health block must be present verbatim");
    const unwrappedBlock = `  if (project) {
    const memoryFinding = await checkFailureMemoryHealth(cwd, checks, now);
    const incidentFinding = checkIncidentJournals(cwd, checks, now);
    if (memoryFinding.actionable) {
      guidance.push("FAILURE_MEMORY.md has findings (expire candidates, retired entries, or tag-recurrence pairs) — hand this to a vigil run to consolidate (or edit directly for a trivial single-entry cleanup)");
    }
    if (incidentFinding.actionable) {
      guidance.push("An incident journal is not confirmed closed — re-enter salvage's closure flow to close it properly");
    }
  }`;

    // RED: the pre-Fix-8 unwrapped shape, with the throw injected -- must crash (uncaught exception /
    // unhandled rejection at the top-level `await diagnose(...)` call), not produce a clean report.
    const redSource = withThrow.replace(wrappedBlock, unwrappedBlock);
    assert.notStrictEqual(redSource, withThrow, "fixture sanity: the unwrap revert must actually change the source");
    writeFileSyncDurable(scratchDoctor, redSource);
    const projectCwd = temporary("ctide-doctor-fix8-project-");
    const red = cp.spawnSync(process.execPath,
      [scratchDoctor, "--plugin-root", scratchPlugin, "--project", "--cwd", projectCwd, "--json"],
      { encoding: "utf8" });
    assert.notStrictEqual(red.status, 0,
      "RED: against the pre-Fix-8 unwrapped block, an injected throw must crash the process (non-zero exit), not produce a clean report");
    assert.strictEqual(red.stdout.trim(), "",
      "RED: an uncaught exception must produce no stdout output at all (the crash happens before any console.log), not a valid report");

    // GREEN: the shipped try/catch-wrapped block, with the same throw injected -- must degrade to a
    // reported project-health: fail check instead.
    writeFileSyncDurable(scratchDoctor, withThrow);
    const green = cp.spawnSync(process.execPath,
      [scratchDoctor, "--plugin-root", scratchPlugin, "--project", "--cwd", projectCwd, "--json"],
      { encoding: "utf8" });
    assert.strictEqual(typeof green.status, "number", `GREEN: must exit cleanly, not crash: ${green.stderr}`);
    assert.ok(green.stdout && green.stdout.trim().length > 0, "GREEN: must produce real JSON output, not empty stdout");
    const greenReport = JSON.parse(green.stdout);
    const projectHealth = greenReport.checks.find((c) => c.name === "project-health");
    assert.ok(projectHealth, "GREEN: the injected throw must surface as its own project-health check");
    assert.strictEqual(projectHealth.status, "fail");
    assert.match(projectHealth.detail, /--project checks failed unexpectedly/);
  } finally {
    fs.rmSync(scratchDir, { recursive: true, force: true });
  }
});
