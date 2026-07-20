// Tests for run-reconcile.mjs — scan (read-only candidate-rework detection) / close / expire (the only two
// append paths) over the run ledger. The load-bearing properties: scan NEVER writes (byte-identical
// snapshot before/after); an ambiguous overlap prints a DISTINCT "needs human review" line rather than
// resolving silently to clean or to an expire candidate; overlap always outranks window status (a
// past-window run with real overlap is never silently auto-closed); close/expire are append-only and
// close never invents its own disposition reason. Commit dates are pinned via GIT_AUTHOR_DATE /
// GIT_COMMITTER_DATE so `--since` filtering is fully deterministic (no reliance on real wall-clock timing).
import { test } from "node:test";
import assert from "node:assert";
import cp from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runRecords, closedHeadSet, parseCommitLog, overlapFiles, classifyRun, KNOWN_FLAGS } from "../cressetide/skills/vigil/scripts/run-reconcile.mjs";
import { ensureLedgerDir, runsLedgerPath, readRunsLedger, buildRunRecord } from "../cressetide/skills/vigil/scripts/run-ledger.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SCRIPT = path.join(root, "cressetide", "skills", "vigil", "scripts", "run-reconcile.mjs");
const DAY = 86400000;

function temporary(prefix) { return fs.mkdtempSync(path.join(os.tmpdir(), prefix)); }

function git(cwd, ...args) {
  return cp.execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

// A commit with a FULLY deterministic author/committer date, so `git log --since=<iso>` filtering never
// depends on real elapsed wall-clock time (flake-proof, matches this repo's own deterministic-test ethos).
function commitAt(cwd, isoDate, message) {
  cp.execFileSync("git", ["commit", "-q", "-m", message], {
    cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, GIT_AUTHOR_DATE: isoDate, GIT_COMMITTER_DATE: isoDate },
  });
}

function runReconcile(cwd, args) {
  return cp.execFileSync("node", [SCRIPT, ...args], { cwd, encoding: "utf8" });
}

// A plain repo with one commit and no ledger content at all.
function bareRepository() {
  const dir = temporary("ctide-rr-bare-");
  git(dir, "init", "-q", "--initial-branch=main");
  git(dir, "config", "user.email", "rr@example.invalid");
  git(dir, "config", "user.name", "Run Reconcile Test");
  fs.writeFileSync(path.join(dir, "a.txt"), "a\n", "utf8");
  git(dir, "add", ".");
  git(dir, "commit", "-q", "-m", "initial");
  return dir;
}

// A genuine SHA-256 object-format repo (`git init --object-format=sha256`) — its HEAD is a real 64-hex-char
// ref, not the familiar 40-char SHA-1, exercising the SHA_RE widened bound with a real git-computed hash
// rather than a synthetic string.
function sha256Repository() {
  const dir = temporary("ctide-rr-sha256-");
  git(dir, "init", "-q", "--object-format=sha256", "--initial-branch=main");
  git(dir, "config", "user.email", "rr@example.invalid");
  git(dir, "config", "user.name", "Run Reconcile Test");
  fs.writeFileSync(path.join(dir, "a.txt"), "a\n", "utf8");
  git(dir, "add", ".");
  git(dir, "commit", "-q", "-m", "initial");
  return dir;
}

// The 4-bucket fixture (validated against a live scan during implementation):
//   heads.rework -> candidate-rework (a.txt touched by a later "fix:" commit)
//   heads.review -> needs-human-review (b.txt touched by a later neutral-subject commit)
//   heads.clean  -> open, silent (c.txt never touched again, still within its window)
//   heads.expire -> expire-candidate (e.txt never touched again, past its window)
// Baseline commit predates every run's `ts`, so it never itself counts as "overlap" for any run.
function buildScanFixture() {
  const dir = temporary("ctide-rr-scan-");
  git(dir, "init", "-q", "--initial-branch=main");
  git(dir, "config", "user.email", "rr@example.invalid");
  git(dir, "config", "user.name", "Run Reconcile Test");
  for (const f of ["a.txt", "b.txt", "c.txt", "d.txt", "e.txt"]) fs.writeFileSync(path.join(dir, f), f + "\n", "utf8");
  git(dir, "add", ".");
  commitAt(dir, "2025-01-01T00:00:00Z", "initial baseline");

  const tRecent = Date.parse("2026-01-01T00:00:00Z"); // run1/2/3's ts: still within a 14d window of `now`
  const tOld = Date.parse("2025-06-01T00:00:00Z");    // run4's ts: far past a 14d window of `now`
  const now = Date.parse("2026-01-05T00:00:00Z");
  const heads = {
    rework: "head1rework00000000000000000000000000",
    review: "head2review00000000000000000000000000",
    clean: "head3clean0000000000000000000000000000",
    expire: "head4expire000000000000000000000000000",
  };
  ensureLedgerDir(dir);
  const lines = [
    buildRunRecord({ ts: tRecent, head: heads.rework, files: ["a.txt"] }),
    buildRunRecord({ ts: tRecent, head: heads.review, files: ["b.txt"] }),
    buildRunRecord({ ts: tRecent, head: heads.clean, files: ["c.txt"] }),
    buildRunRecord({ ts: tOld, head: heads.expire, files: ["e.txt"] }),
  ].map((r) => JSON.stringify(r));
  fs.writeFileSync(runsLedgerPath(dir), lines.join("\n") + "\n", "utf8");

  fs.appendFileSync(path.join(dir, "a.txt"), "a2\n");
  git(dir, "add", ".");
  commitAt(dir, "2026-01-02T00:00:00Z", "fix: correct bug in a.txt");

  fs.appendFileSync(path.join(dir, "b.txt"), "b2\n");
  git(dir, "add", ".");
  commitAt(dir, "2026-01-02T01:00:00Z", "chore: tidy up b.txt");

  fs.appendFileSync(path.join(dir, "d.txt"), "d2\n");
  git(dir, "add", ".");
  commitAt(dir, "2026-01-02T02:00:00Z", "unrelated touch to d only");

  return { dir, now, heads };
}

function repoWithOneOpenRun(head) {
  const dir = bareRepository();
  ensureLedgerDir(dir);
  fs.writeFileSync(
    runsLedgerPath(dir),
    JSON.stringify(buildRunRecord({ ts: 1, head, files: ["a.txt"] })) + "\n",
    "utf8",
  );
  return dir;
}

// --- unit: runRecords / closedHeadSet ---

test("runRecords keeps only type:run records with a non-empty string head", () => {
  const recs = [
    { type: "run", head: "h1" },
    { type: "run", head: "" },
    { type: "run" },
    { type: "close", ref: "h1" },
    { type: "run", head: "h2" },
  ];
  assert.deepStrictEqual(runRecords(recs).map((r) => r.head), ["h1", "h2"]);
});

test("closedHeadSet collects every close event's ref regardless of `as` value", () => {
  const recs = [
    { type: "close", ref: "h1", as: "escaped" },
    { type: "run", head: "h2" },
    { type: "close", ref: "h3", as: "survived" },
  ];
  const set = closedHeadSet(recs);
  assert.ok(set.has("h1") && set.has("h3") && !set.has("h2"));
});

// --- unit: parseCommitLog (pinned against `git log --name-only --pretty=format:"%H%x01%s"`'s REAL shape) ---

test("parseCommitLog parses the %H\\x01%s + --name-only shape (blank-separated commits, no trailing blank on the last one)", () => {
  const sample =
    "2b4d5b7d0e9c8dda9aee2daa34e0f6f427663c88\x01unrelated change\n" +
    "c.txt\n" +
    "\n" +
    "31a489c245f6617844229bc73f89cf29d5d8ca9d\x01fix: correct bug in a\n" +
    "a.txt\n" +
    "\n" +
    "1fb9362291e7ef29622fe5d1a6e96d19dca35d6b\x01initial\n" +
    "a.txt\n" +
    "b.txt\n";
  const commits = parseCommitLog(sample);
  assert.strictEqual(commits.length, 3);
  assert.deepStrictEqual(commits[0], { sha: "2b4d5b7d0e9c8dda9aee2daa34e0f6f427663c88", subject: "unrelated change", files: ["c.txt"] });
  assert.deepStrictEqual(commits[1], { sha: "31a489c245f6617844229bc73f89cf29d5d8ca9d", subject: "fix: correct bug in a", files: ["a.txt"] });
  assert.deepStrictEqual(commits[2], { sha: "1fb9362291e7ef29622fe5d1a6e96d19dca35d6b", subject: "initial", files: ["a.txt", "b.txt"] });
});

test("parseCommitLog is empty/garbage tolerant", () => {
  assert.deepStrictEqual(parseCommitLog(""), []);
  assert.deepStrictEqual(parseCommitLog(null), []);
  assert.deepStrictEqual(parseCommitLog("stray line with no header\nmore stray\n"), []);
});

// --- unit: overlapFiles ---

test("overlapFiles finds shared paths and normalizes backslashes on both sides", () => {
  assert.deepStrictEqual(overlapFiles(["a.txt", "b.txt"], ["b.txt", "c.txt"]), ["b.txt"]);
  assert.deepStrictEqual(overlapFiles(["src\\a.ts"], ["src/a.ts"]), ["src/a.ts"]);
  assert.deepStrictEqual(overlapFiles(["a.txt"], ["b.txt"]), []);
});

// --- unit: classifyRun ---

test("classifyRun: candidate-rework when an overlapping commit's subject matches fix/revert/hotfix/regress", () => {
  const record = { ts: 1000, files: ["a.txt"], window: { days: 14 } };
  const c = classifyRun(record, [{ sha: "s1", subject: "fix: bug", files: ["a.txt"] }], 2000);
  assert.strictEqual(c.status, "candidate-rework");
  assert.strictEqual(c.overlap.commit.sha, "s1");
  assert.deepStrictEqual(c.overlap.files, ["a.txt"]);
});

test("classifyRun: needs-human-review when overlap exists but no commit subject matches the rework pattern", () => {
  const record = { ts: 1000, files: ["b.txt"], window: { days: 14 } };
  const c = classifyRun(record, [{ sha: "s2", subject: "chore: tidy", files: ["b.txt"] }], 2000);
  assert.strictEqual(c.status, "needs-human-review");
});

test("classifyRun: open (silent) when still within window and no overlap", () => {
  const record = { ts: 1000, files: ["c.txt"], window: { days: 14 } };
  const c = classifyRun(record, [{ sha: "s3", subject: "chore: unrelated", files: ["d.txt"] }], 1000 + DAY);
  assert.strictEqual(c.status, "open");
});

test("classifyRun: expire-candidate when past window and no overlap detected at all", () => {
  const record = { ts: 0, files: ["e.txt"], window: { days: 14 } };
  assert.strictEqual(classifyRun(record, [], 20 * DAY).status, "expire-candidate");
});

test("classifyRun: overlap ALWAYS outranks window status — a past-window run with real overlap is never silently folded into expire-candidate", () => {
  const record = { ts: 0, files: ["a.txt"], window: { days: 14 } };
  const c = classifyRun(record, [{ sha: "s4", subject: "chore: touch a", files: ["a.txt"] }], 20 * DAY);
  assert.strictEqual(c.status, "needs-human-review", "past-window but overlap exists -> NOT expire-candidate");
});

test("classifyRun defaults window.days to 14 when the record's window field is missing", () => {
  const record = { ts: 0, files: ["x"] };
  assert.strictEqual(classifyRun(record, [], 10 * DAY).status, "open");
  assert.strictEqual(classifyRun(record, [], 20 * DAY).status, "expire-candidate");
});

// --- e2e: scan ---

test("scan: a recorded run + a later overlapping commit with a fix: subject prints a candidate-rework line naming the file/commit", () => {
  const { dir, now, heads } = buildScanFixture();
  const out = runReconcile(dir, ["scan", "--now", String(now)]);
  assert.match(out, /candidate rework:/);
  const line = out.split("\n").find((l) => l.includes(heads.rework));
  assert.ok(line, "rework head must be named");
  assert.match(line, /a\.txt/);
  assert.match(line, /fix: correct bug in a\.txt/);
});

test("scan: an overlapping commit with a neutral subject prints a DISTINCT needs-human-review line, not silently dropped", () => {
  const { dir, now, heads } = buildScanFixture();
  const out = runReconcile(dir, ["scan", "--now", String(now)]);
  assert.match(out, /needs human review:/);
  const line = out.split("\n").find((l) => l.includes(heads.review));
  assert.ok(line);
  assert.match(line, /b\.txt/);
  assert.match(line, /chore: tidy up b\.txt/);
  const reworkSection = out.slice(0, out.indexOf("needs human review:"));
  assert.ok(!reworkSection.includes(heads.review), "must not ALSO appear under candidate rework");
});

test("scan: a run with no overlapping commit at all prints nothing for it (still open, clean — never resolved to a bucket)", () => {
  const { dir, now, heads } = buildScanFixture();
  const out = runReconcile(dir, ["scan", "--now", String(now)]);
  assert.ok(!out.includes(heads.clean));
});

test("scan: a past-window run with no overlap is printed under expire candidates", () => {
  const { dir, now, heads } = buildScanFixture();
  const out = runReconcile(dir, ["scan", "--now", String(now)]);
  assert.match(out, /expire candidates/);
  assert.ok(out.includes(heads.expire));
});

test("scan writes NOTHING to the ledger — byte-identical snapshot before and after", () => {
  const { dir, now } = buildScanFixture();
  const before = fs.readFileSync(runsLedgerPath(dir));
  runReconcile(dir, ["scan", "--now", String(now)]);
  const after = fs.readFileSync(runsLedgerPath(dir));
  assert.ok(before.equals(after), "scan must never write to the ledger");
});

test("scan discloses history-truncated when a shallow clone is detected", () => {
  const { dir, now } = buildScanFixture();
  fs.writeFileSync(path.join(dir, ".git", "shallow"), "", "utf8");
  const out = runReconcile(dir, ["scan", "--now", String(now)]);
  assert.match(out, /history truncated — weak-signal only/);
});

test("scan on a non-git cwd prints the no-claim line and exits 0", () => {
  const dir = temporary("ctide-rr-nongit-");
  const out = runReconcile(dir, ["scan"]);
  assert.match(out, /no git history available — scan produced no candidates/);
});

test("scan with no run records recorded prints a 'nothing to reconcile' line", () => {
  const dir = bareRepository();
  const out = runReconcile(dir, ["scan"]);
  assert.match(out, /no run records found/);
});

// --- e2e: expire ---

test("expire closes exactly the window-expired, no-overlap run with {as:'survived'}, leaving the others untouched", () => {
  const { dir, now, heads } = buildScanFixture();
  const out = runReconcile(dir, ["expire", "--now", String(now)]);
  assert.match(out, /expired 1 run\(s\)/);
  const recs = readRunsLedger(fs.readFileSync(runsLedgerPath(dir), "utf8"));
  const closes = recs.filter((r) => r.type === "close");
  assert.strictEqual(closes.length, 1);
  assert.strictEqual(closes[0].ref, heads.expire);
  assert.strictEqual(closes[0].as, "survived");
  assert.match(closes[0].reason, /window expired with no detected overlap/);
  for (const h of [heads.rework, heads.review, heads.clean]) {
    assert.ok(!closes.some((c) => c.ref === h), "expire must never auto-close a run with any detected overlap");
  }
});

test("expire on a non-git cwd prints a no-claim line and exits 0 without writing", () => {
  const dir = temporary("ctide-rr-expire-nongit-");
  const out = runReconcile(dir, ["expire"]);
  assert.match(out, /no git history available/);
});

// --- e2e: close ---

test("close --as escaped --reason appends exactly that event, verbatim", () => {
  const dir = repoWithOneOpenRun("deadbeef");
  const out = runReconcile(dir, [
    "close", "--ref", "deadbeef", "--as", "escaped", "--reason", "regressed in prod, see incident-42", "--now", "9999",
  ]);
  assert.match(out, /closed deadbeef as escaped/);
  const recs = readRunsLedger(fs.readFileSync(runsLedgerPath(dir), "utf8"));
  const closes = recs.filter((r) => r.type === "close");
  assert.strictEqual(closes.length, 1);
  assert.deepStrictEqual(closes[0], {
    v: 1, type: "close", ts: 9999, ref: "deadbeef", as: "escaped", reason: "regressed in prod, see incident-42",
  });
});

test("each of the 4 valid --as values is accepted verbatim", () => {
  for (const as of ["escaped", "survived", "superseded", "building-upon"]) {
    const dir = repoWithOneOpenRun("deadbeef");
    runReconcile(dir, ["close", "--ref", "deadbeef", "--as", as, "--reason", "r", "--now", "1"]);
    const recs = readRunsLedger(fs.readFileSync(runsLedgerPath(dir), "utf8"));
    assert.strictEqual(recs.find((r) => r.type === "close").as, as);
  }
});

test("an invalid --as value is rejected WITHOUT writing (byte-compare unchanged), and still exits 0", () => {
  const dir = repoWithOneOpenRun("h1");
  const before = fs.readFileSync(runsLedgerPath(dir));
  const result = cp.spawnSync(
    "node", [SCRIPT, "close", "--ref", "h1", "--as", "bogus-value", "--reason", "x"], { cwd: dir, encoding: "utf8" },
  );
  assert.strictEqual(result.status, 0);
  const after = fs.readFileSync(runsLedgerPath(dir));
  assert.ok(before.equals(after), "an invalid --as must never write");
});

test("close with no --ref is rejected without writing", () => {
  const dir = repoWithOneOpenRun("h1");
  const before = fs.readFileSync(runsLedgerPath(dir));
  const result = cp.spawnSync("node", [SCRIPT, "close", "--as", "escaped", "--reason", "x"], { cwd: dir, encoding: "utf8" });
  assert.strictEqual(result.status, 0);
  assert.ok(before.equals(fs.readFileSync(runsLedgerPath(dir))));
});

test("close --ref --as escaped ... (missing --ref VALUE) is rejected without writing -- the flag parser must never silently swallow '--as' as the ref", () => {
  const dir = repoWithOneOpenRun("deadbeef");
  const before = fs.readFileSync(runsLedgerPath(dir));
  const result = cp.spawnSync(
    "node", [SCRIPT, "close", "--ref", "--as", "escaped", "--reason", "x"], { cwd: dir, encoding: "utf8" },
  );
  assert.strictEqual(result.status, 0);
  const after = fs.readFileSync(runsLedgerPath(dir));
  assert.ok(before.equals(after), "a missing --ref value must never write a phantom close event using '--as' as the ref");
});

test("close --ref with an obviously non-SHA-shaped value is rejected without writing (SHA-shape guard)", () => {
  const dir = repoWithOneOpenRun("deadbeef");
  const before = fs.readFileSync(runsLedgerPath(dir));
  const result = cp.spawnSync(
    "node", [SCRIPT, "close", "--ref", "not-a-sha!", "--as", "escaped", "--reason", "x"], { cwd: dir, encoding: "utf8" },
  );
  assert.strictEqual(result.status, 0);
  const after = fs.readFileSync(runsLedgerPath(dir));
  assert.ok(before.equals(after), "a non-hex-looking --ref must never write, even though it is non-empty and --as is valid");
});

// --- e2e: close --ref SHA-shape bound (MAJOR-1: SHA_RE widened from {7,40} to {7,64}) ---

test("close --ref accepts a real 40-char SHA-1 ref (existing upper bound preserved after widening to 64)", () => {
  const dir = bareRepository();
  const head = git(dir, "rev-parse", "HEAD");
  assert.strictEqual(head.length, 40, "sanity: a normal git repo emits a 40-char SHA-1 HEAD");
  const out = runReconcile(dir, ["close", "--ref", head, "--as", "escaped", "--reason", "r", "--now", "1"]);
  assert.match(out, new RegExp("closed " + head + " as escaped"));
  const recs = readRunsLedger(fs.readFileSync(runsLedgerPath(dir), "utf8"));
  const closes = recs.filter((r) => r.type === "close");
  assert.strictEqual(closes.length, 1);
  assert.strictEqual(closes[0].ref, head);
});

test("close --ref accepts a real 64-char SHA-256 ref (the MAJOR-1 fix: a repo initialized with `git init --object-format=sha256` has a 64-char HEAD, previously rejected by the old {7,40} bound)", () => {
  const dir = sha256Repository();
  const head = git(dir, "rev-parse", "HEAD");
  assert.strictEqual(head.length, 64, "sanity: a sha256-format repo emits a 64-char HEAD");
  const out = runReconcile(dir, ["close", "--ref", head, "--as", "escaped", "--reason", "r", "--now", "1"]);
  assert.match(out, new RegExp("closed " + head + " as escaped"));
  const recs = readRunsLedger(fs.readFileSync(runsLedgerPath(dir), "utf8"));
  const closes = recs.filter((r) => r.type === "close");
  assert.strictEqual(closes.length, 1);
  assert.strictEqual(closes[0].ref, head);
  assert.strictEqual(closes[0].as, "escaped");
});

test("close --ref normalizes an UPPERCASE hex ref to lowercase before storage (git always emits lowercase SHAs; an uppercase-but-real ref must still correlate against a run record's lowercase head)", () => {
  const dir = repoWithOneOpenRun("deadbeef");
  const out = runReconcile(dir, ["close", "--ref", "DEADBEEF", "--as", "escaped", "--reason", "r", "--now", "1"]);
  assert.match(out, /closed deadbeef as escaped/);
  const recs = readRunsLedger(fs.readFileSync(runsLedgerPath(dir), "utf8"));
  const closes = recs.filter((r) => r.type === "close");
  assert.strictEqual(closes.length, 1);
  assert.strictEqual(closes[0].ref, "deadbeef", "the stored ref must be lowercased so it correlates against the always-lowercase run head");
});

// --- e2e: close --reason enforcement (MAJOR-2: --reason must be genuinely supplied, not silently optional) ---

test("close with --reason OMITTED entirely is rejected without writing", () => {
  const dir = repoWithOneOpenRun("deadbeef");
  const before = fs.readFileSync(runsLedgerPath(dir));
  const result = cp.spawnSync("node", [SCRIPT, "close", "--ref", "deadbeef", "--as", "escaped"], { cwd: dir, encoding: "utf8" });
  assert.strictEqual(result.status, 0);
  const after = fs.readFileSync(runsLedgerPath(dir));
  assert.ok(before.equals(after), "a missing --reason flag must never write");
});

test("close with an EMPTY --reason value is rejected without writing", () => {
  const dir = repoWithOneOpenRun("deadbeef");
  const before = fs.readFileSync(runsLedgerPath(dir));
  const result = cp.spawnSync(
    "node", [SCRIPT, "close", "--ref", "deadbeef", "--as", "escaped", "--reason", ""], { cwd: dir, encoding: "utf8" },
  );
  assert.strictEqual(result.status, 0);
  const after = fs.readFileSync(runsLedgerPath(dir));
  assert.ok(before.equals(after), "an empty --reason must never write");
});

test("close with a WHITESPACE-ONLY --reason is rejected without writing", () => {
  const dir = repoWithOneOpenRun("deadbeef");
  const before = fs.readFileSync(runsLedgerPath(dir));
  const result = cp.spawnSync(
    "node", [SCRIPT, "close", "--ref", "deadbeef", "--as", "escaped", "--reason", "   "], { cwd: dir, encoding: "utf8" },
  );
  assert.strictEqual(result.status, 0);
  const after = fs.readFileSync(runsLedgerPath(dir));
  assert.ok(before.equals(after), "a whitespace-only --reason must never write");
});

// --- e2e: close --reason flag-swallow guard (the --reason analogue of the --ref swallow guard above: `get()`
// blindly hands back whatever token follows a flag, even when that token is itself a recognized flag name) ---

test("close --ref <sha> --as escaped --reason --now <ts> (missing --reason VALUE, swallowed by --now's own name) is rejected without writing", () => {
  const dir = repoWithOneOpenRun("deadbeef");
  const before = fs.readFileSync(runsLedgerPath(dir));
  const result = cp.spawnSync(
    "node", [SCRIPT, "close", "--ref", "deadbeef", "--as", "escaped", "--reason", "--now", "9999"], { cwd: dir, encoding: "utf8" },
  );
  assert.strictEqual(result.status, 0);
  const after = fs.readFileSync(runsLedgerPath(dir));
  assert.ok(before.equals(after), "a missing --reason value must never write a phantom close event using '--now' as the reason");
});

test("close --ref <sha> --as escaped --reason --cwd <dir> (missing --reason VALUE, swallowed by a different flag's name) is rejected without writing", () => {
  const dir = repoWithOneOpenRun("deadbeef");
  const before = fs.readFileSync(runsLedgerPath(dir));
  const result = cp.spawnSync(
    "node", [SCRIPT, "close", "--ref", "deadbeef", "--as", "escaped", "--reason", "--cwd", dir], { cwd: dir, encoding: "utf8" },
  );
  assert.strictEqual(result.status, 0);
  const after = fs.readFileSync(runsLedgerPath(dir));
  assert.ok(before.equals(after), "a missing --reason value must never write a phantom close event using '--cwd' as the reason");
});

// --- e2e: close whole-class flag-swallow guard (get() itself now guards EVERY flag in KNOWN_FLAGS -- the
// shared-mechanism fix that generalizes the --ref/--reason point patches above. Proven here across every
// (flag, swallower) pair in this file's own complete flag set, not just the 2 previously patched flags) ---

test("close: for EVERY flag in KNOWN_FLAGS, a value slot occupied by any OTHER known flag's own name is treated as omitted, never as a literal value -- required flags (--ref/--as/--reason) reject cleanly without writing; optional flags (--cwd/--now) fall back to their sensible default and the close still succeeds; --cwd's fallback never creates a stray directory named after a flag token (this reproduces and closes the exact `close --cwd --ref <sha> --as escaped --reason <text>` bug report)", () => {
  const REQUIRED_NO_DEFAULT = ["--ref", "--as", "--reason"];
  const values = { "--ref": "deadbeef", "--as": "escaped", "--reason": "swallow-guard regression check", "--now": "123456" };
  for (const F of KNOWN_FLAGS) {
    for (const G of KNOWN_FLAGS) {
      if (G === F) continue;
      const dir = temporary("ctide-rr-swallow-");
      // Order: G's own legitimate occurrence FIRST, then every other flag, then F LAST with its value slot
      // occupied by the literal token G. This keeps every flag's `indexOf` lookup unambiguous -- G's real
      // pair is always the FIRST occurrence of that token, so a later reuse of the same string as F's fake
      // value can never shadow it.
      const order = [G, ...KNOWN_FLAGS.filter((x) => x !== F && x !== G), F];
      const argv = ["close"];
      for (const flagName of order) {
        if (flagName === F) argv.push(F, G); // F's own value slot swallowed by G's literal name
        else if (flagName === "--cwd") argv.push("--cwd", dir);
        else argv.push(flagName, values[flagName]);
      }
      // Hermetic: strip CLAUDE_PROJECT_DIR so --cwd's fallback resolves to the spawned process's own cwd
      // (this temp dir), never a developer's ambient project dir (test/helpers.mjs's own convention).
      const env = { ...process.env };
      delete env.CLAUDE_PROJECT_DIR;
      const result = cp.spawnSync("node", [SCRIPT, ...argv], { cwd: dir, encoding: "utf8", env });
      assert.strictEqual(result.status, 0, `close ${F} swallowed by ${G} must still exit 0 (fail-open): ${result.stderr}`);
      if (REQUIRED_NO_DEFAULT.includes(F)) {
        assert.ok(!fs.existsSync(runsLedgerPath(dir)), `${F} swallowed by ${G} (required, no safe default) must be rejected without writing`);
      } else {
        assert.ok(fs.existsSync(runsLedgerPath(dir)), `${F} swallowed by ${G} has a sensible default -- close must still succeed and write`);
        const recs = readRunsLedger(fs.readFileSync(runsLedgerPath(dir), "utf8"));
        const close = recs.find((r) => r.type === "close");
        assert.ok(close, `${F} swallowed by ${G}: a close event must be appended`);
        assert.strictEqual(close.ref, "deadbeef", `${F} swallowed by ${G}: ref must be unaffected`);
        assert.strictEqual(close.as, "escaped", `${F} swallowed by ${G}: as must be unaffected`);
        assert.strictEqual(close.reason, "swallow-guard regression check", `${F} swallowed by ${G}: reason must be unaffected`);
        if (F === "--cwd") {
          assert.ok(
            !fs.existsSync(path.join(dir, G)),
            `${F} swallowed by ${G} must never create a stray '${G}' directory (the exact --cwd/--ref bug report)`,
          );
        }
      }
    }
  }
});

// --- e2e: close --reason cap-before-trim ordering (buildCloseEvent's 300-char cap must apply to the
// ALREADY-TRIMMED reason runClose passes it, not to the raw un-trimmed value) ---

test("close --reason with >300 leading whitespace chars followed by real text is accepted with the real text correctly preserved (trim happens BEFORE the 300-char cap, so the cap never truncates away real content into pure whitespace)", () => {
  const dir = repoWithOneOpenRun("deadbeef");
  const reason = " ".repeat(310) + "keep this text";
  const out = runReconcile(dir, ["close", "--ref", "deadbeef", "--as", "escaped", "--reason", reason, "--now", "1"]);
  assert.match(out, /closed deadbeef as escaped/);
  const recs = readRunsLedger(fs.readFileSync(runsLedgerPath(dir), "utf8"));
  const close = recs.find((r) => r.type === "close");
  assert.strictEqual(close.reason, "keep this text", "the real text must survive trim-then-cap; the old cap-before-trim ordering corrupted it into 300 spaces instead");
});

test("close --reason that is ENTIRELY whitespace and longer than 300 characters is still rejected without writing (trim reduces it to empty, which the existing emptiness check catches regardless of length)", () => {
  const dir = repoWithOneOpenRun("deadbeef");
  const before = fs.readFileSync(runsLedgerPath(dir));
  const reason = " ".repeat(310);
  const result = cp.spawnSync(
    "node", [SCRIPT, "close", "--ref", "deadbeef", "--as", "escaped", "--reason", reason], { cwd: dir, encoding: "utf8" },
  );
  assert.strictEqual(result.status, 0);
  const after = fs.readFileSync(runsLedgerPath(dir));
  assert.ok(before.equals(after), "an entirely-whitespace --reason over the cap length must never write, regardless of length");
});

// --- e2e: execFileSync stdio regression (git's raw stderr must never leak onto this CLI's own stderr) ---

test("scan on a non-git --cwd never leaks git's raw error text onto the CLI's own stderr (regression: execFileSync's internal git calls must stay piped, not inherited)", () => {
  const dir = temporary("ctide-rr-stdio-nongit-");
  const result = cp.spawnSync("node", [SCRIPT, "scan"], { cwd: dir, encoding: "utf8" });
  assert.strictEqual(result.status, 0);
  assert.strictEqual(result.stderr, "", "the CLI's own stderr must stay empty on a non-git cwd");
});

test("scan on a repo with an UNBORN HEAD (no commits yet, so the internal `git log --since` call for a pending run itself fails) never leaks git's raw fatal text onto the CLI's own stderr", () => {
  const dir = temporary("ctide-rr-stdio-unborn-");
  git(dir, "init", "-q", "--initial-branch=main");
  git(dir, "config", "user.email", "rr@example.invalid");
  git(dir, "config", "user.name", "Run Reconcile Test");
  ensureLedgerDir(dir);
  fs.writeFileSync(
    runsLedgerPath(dir),
    JSON.stringify(buildRunRecord({ ts: 1, head: "deadbeef1", files: ["a.txt"] })) + "\n",
    "utf8",
  );
  const result = cp.spawnSync("node", [SCRIPT, "scan"], { cwd: dir, encoding: "utf8" });
  assert.strictEqual(result.status, 0);
  assert.strictEqual(result.stderr, "", "the CLI's own stderr must stay empty even when the internal `git log --since` call fails (unborn HEAD, no commits yet)");
});

// --- e2e: CLI hygiene ---

test("an unrecognized subcommand prints usage and exits 0 without writing", () => {
  const dir = temporary("ctide-rr-badcmd-");
  const result = cp.spawnSync("node", [SCRIPT, "bogus"], { cwd: dir, encoding: "utf8" });
  assert.strictEqual(result.status, 0);
  assert.ok(!fs.existsSync(runsLedgerPath(dir)));
});

test("usage text never prints a bare 'skills/vigil/scripts/...' invocation example", () => {
  const dir = temporary("ctide-rr-usage-");
  const result = cp.spawnSync("node", [SCRIPT, "bogus"], { cwd: dir, encoding: "utf8" });
  assert.ok(!/node\s+(?:\.\/)?skills\/vigil\/scripts\//.test(result.stderr + result.stdout));
});
