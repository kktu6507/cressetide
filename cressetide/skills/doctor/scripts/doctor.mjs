#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

// Cross-skill dependency (doctor -> vigil, one-directional; vigil never imports from doctor): the
// --project failure-memory-health check below reuses vigil's own FAILURE_MEMORY.md consolidation logic
// directly (resolveMemoryFile/defaultLedgerPath/parseEntries from failure-retrieve.mjs;
// consolidationReport/tagRecurrenceCandidates/readLedger from failure-consolidate.mjs -- confirmed by
// reading both files' real export lists, not assumed from a single combined statement) instead of
// reimplementing it. Loaded via a LAZY `import()` inside checkFailureMemoryHealth below, deliberately NOT
// a static top-level import: a static import ties vigil's entire module graph to doctor.mjs's own load,
// so any load failure over there (a missing file, a syntax error, a renamed export doctor.mjs doesn't
// even use) would crash the WHOLE doctor.mjs module -- including a plain, flagless `/ctide:doctor` run
// that has nothing to do with --project (reproduced directly before this fix: a missing
// failure-consolidate.mjs crashed even a flagless, --project-less invocation with an uncaught
// ERR_MODULE_NOT_FOUND). The dynamic import only ever executes on the --project code path, wrapped in
// try/catch, so a load failure surfaces as this check's own reported `fail`, matching every other failure
// source in diagnose(), never a process crash.
const VIGIL_RETRIEVE_MODULE = "../../vigil/scripts/failure-retrieve.mjs";
const VIGIL_CONSOLIDATE_MODULE = "../../vigil/scripts/failure-consolidate.mjs";

const expectedHooks = [
  "plan-gate.js", "destructive-guard.js", "contract-guard.js",
  "load-failure-memory.js", "compact-fidelity.js", "orchestration-check.js",
];
const expectedSkills = ["doctor", "map", "salvage", "ship", "vigil"];
const SEMVER = /^\d+\.\d+\.\d+(?:[-+].+)?$/;
const expectedAgents = [
  "navigator", "implementer", "intent-reviewer", "test-reviewer", "code-reviewer",
  "security-reviewer", "architecture-reviewer", "operability-reviewer",
  "ui-ux-reviewer", "arbiter", "cartographer",
];
const bundledPluginRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

// Every flag token this file's argument() helper is ever queried with, PLUS the boolean --project/--json
// flags (read via process.argv.includes, not argument() -- they carry no value of their own, but are
// still recognized flag NAMES that must never be swallowed as some OTHER flag's value, e.g.
// `--plugin-root --project` silently reading plugin-root="--project") -- this file's own complete
// recognized-flag set. Mirrors run-consolidate.mjs's / failure-consolidate.mjs's / failure-retrieve.mjs's
// identical KNOWN_FLAGS guard, each over its own file's complete flag set. Exported so the test suite can
// drive the SAME list argument() guards against (no hardcoded duplicate list to drift out of sync).
export const KNOWN_FLAGS = ["--plugin-root", "--cwd", "--project", "--json"];

// The one shared flag-value lookup EVERY value-bearing flag in this file goes through. Guards the swallow
// at its single root: if the token immediately following `name` is itself one of KNOWN_FLAGS (this file's
// own complete recognized-flag set, above), the value is treated as omitted -- undefined is returned
// instead of the neighboring flag's own name. Fixes every flag uniformly, not per-call-site -- the exact
// "next-token swallow" bug class this helper previously carried unguarded (confirmed by direct read
// before this fix: `const index = process.argv.indexOf(name); return index >= 0 ? process.argv[index + 1]
// : undefined;`), the same class already fixed this session in run-reconcile.mjs / run-consolidate.mjs /
// failure-consolidate.mjs / failure-retrieve.mjs.
function argument(name) {
  const index = process.argv.indexOf(name);
  const value = index >= 0 ? process.argv[index + 1] : undefined;
  return value && !KNOWN_FLAGS.includes(value) ? value : undefined;
}

function resolvePluginRoot() {
  return path.resolve(
    argument("--plugin-root") ||
    process.env.CLAUDE_PLUGIN_ROOT ||
    bundledPluginRoot,
  );
}

// Project-root resolution for the opt-in --project checks below: --cwd override, then
// CLAUDE_PROJECT_DIR (the same env var hooks/load-failure-memory.js and
// failure-consolidate.mjs/run-consolidate.mjs already anchor on), then process.cwd() -- the identical
// 3-tier precedence those sibling scripts already establish, reused here rather than inventing a new
// order.
function resolveProjectCwd() {
  return path.resolve(
    argument("--cwd") ||
    process.env.CLAUDE_PROJECT_DIR ||
    process.cwd(),
  );
}

function replaceSensitivePath(text, sensitivePath, replacement) {
  if (!sensitivePath) return text;
  const escaped = sensitivePath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return text.replace(new RegExp(escaped, process.platform === "win32" ? "gi" : "g"), replacement);
}
function sanitizeDiagnostic(value, limit = 2000) {
  let text = String(value ?? "")
    .replace(/-----BEGIN [^-\r\n]*PRIVATE KEY-----[\s\S]*?-----END [^-\r\n]*PRIVATE KEY-----/gi, "[redacted private key]")
    .replace(/[\r\n\t]+/g, " ").trim()
    .replace(/(["']?\bauthorization\b["']?\s*[:=]\s*)(?:"[^"]*"|'[^']*'|[^,;|]+)/gi, "$1[redacted]")
    .replace(/(["']?\b(?:api(?:[_-]|\s+)?key|private(?:[_-]|\s+)?key|gh(?:[_-]|\s+)?token|token|secret|password)\b["']?\s*[:=]\s*)(?:"[^"]*"|'[^']*'|[^,;|]+)/gi, "$1[redacted]")
    .replace(/\bbearer\s+["']?[A-Za-z0-9._~+/=-]+["']?/gi, "Bearer [redacted]")
    .replace(/\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})\b/g, "[redacted]");
  text = replaceSensitivePath(text, os.tmpdir(), "<temp>");
  text = replaceSensitivePath(text, os.homedir(), "~");
  return text.slice(0, limit);
}
function result(name, status, detail) { return { name, status, detail: sanitizeDiagnostic(detail) }; }
export function probeFailureDetail(label, probe) {
  const metadata = [];
  const stderrBytes = Buffer.byteLength(String(probe?.stderr ?? ""), "utf8");
  if (stderrBytes) metadata.push(`stderr=${Math.min(stderrBytes, 999999)} bytes`);
  const errorCode = String(probe?.error?.code || "").trim();
  if (/^[A-Za-z0-9_.-]{1,40}$/.test(errorCode)) metadata.push(`error=${errorCode}`);
  else if (probe?.error) metadata.push("error=present");
  return `${label}=${probe?.status}${metadata.length ? `(${metadata.join(" ")})` : ""}`;
}
function safeErrorCode(error) {
  const code = String(error?.code || "UNKNOWN");
  return /^[A-Z0-9_.-]{1,40}$/.test(code) ? code : "UNKNOWN";
}
function safeJson(file) {
  let source;
  try { source = fs.readFileSync(file, "utf8"); }
  catch (error) {
    const failure = new Error("JSON read failed");
    failure.code = safeErrorCode(error);
    throw failure;
  }
  try { return JSON.parse(source); }
  catch {
    const failure = new Error("Invalid JSON");
    failure.code = "INVALID_JSON";
    throw failure;
  }
}
function canonical(file) {
  try { return fs.realpathSync.native(file); } catch { return null; }
}
function sameCanonicalPath(left, right) {
  if (!left || !right) return false;
  return process.platform === "win32" ? left.toLowerCase() === right.toLowerCase() : left === right;
}

function harmlessEvent(name, probeRoot) {
  const common = { cwd: probeRoot };
  if (name === "plan-gate.js") return { ...common, hook_event_name: "PreToolUse", permission_mode: "default", tool_name: "Write", tool_input: { file_path: path.join(probeRoot, "doctor-note.txt"), content: "doctor" } };
  if (name === "destructive-guard.js") return { ...common, hook_event_name: "PreToolUse", tool_name: "Bash", tool_input: { command: "echo ctide-doctor" } };
  if (name === "contract-guard.js") return { ...common, hook_event_name: "PreToolUse", tool_name: "Write", tool_input: { file_path: path.join(probeRoot, ".ctide", "output", "contract.md"), content: "doctor" } };
  if (name === "load-failure-memory.js") return { ...common, hook_event_name: "SessionStart", source: "startup" };
  if (name === "compact-fidelity.js") return { ...common, hook_event_name: "SessionStart", source: "compact" };
  return { ...common, hook_event_name: "Stop", transcript_path: path.join(probeRoot, "doctor-transcript.jsonl") };
}

function observedHookSignal(name, probe) {
  const stem = name.replace(/\.js$/, "");
  if (!String(probe?.stderr || "").includes(`[ctide ${stem}]`)) return false;
  if (!["load-failure-memory.js", "compact-fidelity.js"].includes(name)) return true;
  try {
    const output = JSON.parse(probe.stdout || "{}");
    return output?.hookSpecificOutput?.hookEventName === "SessionStart" &&
      typeof output?.hookSpecificOutput?.additionalContext === "string" &&
      output.hookSpecificOutput.additionalContext.length > 0;
  } catch { return false; }
}

export function runtimeProbePassed(name, { syntax, valid, malformed }) {
  return syntax?.status === 0 && valid?.status === 0 && malformed?.status === 0 && observedHookSignal(name, valid);
}

function registrations(configuration) {
  const values = [];
  for (const [event, groups] of Object.entries(configuration?.hooks || {})) {
    for (const group of Array.isArray(groups) ? groups : []) {
      for (const hook of Array.isArray(group?.hooks) ? group.hooks : []) {
        const command = String(hook?.command || "");
        const name = command.match(/hooks\/([a-z0-9-]+\.js)/i)?.[1] ||
          (Array.isArray(hook?.args) ? String(hook.args.find(value => /hooks[\\/][a-z0-9-]+\.js/i.test(value)) || "").match(/hooks[\\/]([a-z0-9-]+\.js)/i)?.[1] : "");
        values.push([event, group.matcher || "", hook?.type || "", name || ""].join("|"));
      }
    }
  }
  return values.sort();
}

const expectedRegistrations = [
  ["PreToolUse", "Write|Edit|MultiEdit|NotebookEdit|Bash|PowerShell", "command", "plan-gate.js"],
  ["PreToolUse", "Bash|PowerShell", "command", "destructive-guard.js"],
  ["PreToolUse", "Write|Edit|MultiEdit", "command", "contract-guard.js"],
  ["SessionStart", "startup|resume|clear|compact", "command", "load-failure-memory.js"],
  ["SessionStart", "compact", "command", "compact-fidelity.js"],
  ["Stop", "", "command", "orchestration-check.js"],
].map(parts => parts.join("|")).sort();

// --- Project health checks (--project flag; additive, opt-in, layered on top of the plugin-health checks
// above -- never a replacement, and never run unless explicitly requested). ---

const DAY_MS = 86400000;
const PROJECT_READ_CAP = 4 * 1024 * 1024; // mirrors failure-consolidate.mjs's own tail-capped read discipline

// Read at most PROJECT_READ_CAP bytes from the END of `file` (the newest content). Throws on a genuine
// filesystem error (missing/permissions/I-O) so the caller decides, per file, whether "could not read" is
// an expected case (the usage ledger is normally absent -- fail-open, mirroring failure-consolidate.mjs's
// own readCapped) or a surprising one worth naming specifically (the memory file itself, once resolved to
// exist by resolveMemoryFile's own stat check).
function readCappedTail(file) {
  const size = fs.statSync(file).size;
  if (size <= PROJECT_READ_CAP) return fs.readFileSync(file, "utf8");
  const fd = fs.openSync(file, "r");
  try {
    const buf = Buffer.alloc(PROJECT_READ_CAP);
    const n = fs.readSync(fd, buf, 0, PROJECT_READ_CAP, Math.max(0, size - PROJECT_READ_CAP));
    return buf.toString("utf8", 0, n);
  } finally { try { fs.closeSync(fd); } catch (e) {} }
}

// Naive "+s" pluralization mishandles this file's own "entry" word (e.g. "2 retired entrys"); the
// correct English plural is "entries". A small suffix-aware branch, not a general pluralizer -- the
// other words this file pluralizes ("expire candidate", "tag-recurrence pair", "day") are all regular.
function pluralize(count, word) {
  if (count === 1) return `1 ${word}`;
  return `${count} ${/entry$/.test(word) ? word.replace(/entry$/, "entries") : `${word}s`}`;
}

// One compact detail line summarizing failure-consolidate.mjs's own real consolidationReport() /
// tagRecurrenceCandidates() output -- never a bare "clean" that hides whether the file actually parsed
// (report.total === 0 is stated explicitly), and never a reimplementation of that module's honesty
// guards (report.staleClaim carries the "no usage data" / "insufficient history" cases verbatim, in the
// module's own words). Exported so the test suite can call this SAME function doctor.mjs uses rather than
// hand-duplicating its exact phrasing.
export function summarizeMemoryHealth(report, tagCandidates) {
  if (report.total === 0) return "FAILURE_MEMORY.md found, 0 entries";
  const expirePart = report.staleClaim === "ok"
    ? pluralize(report.expireCandidates.length, "expire candidate")
    : report.staleClaim;
  const parts = [pluralize(report.total, "entry"), expirePart, pluralize(tagCandidates.length, "tag-recurrence pair")];
  if (report.retired.length) parts.push(pluralize(report.retired.length, "retired entry"));
  return parts.join(", ");
}

// Project-local-only mirror of failure-retrieve.mjs's own resolveMemoryFile() candidate list (same
// literal path.join() calls, same order) MINUS its final machine-global tier
// (~/.claude/FAILURE_MEMORY.md) -- confirmed by reading resolveMemoryFile's actual 3-candidate loop
// before writing this, not guessed. --project's failure-memory-health check must report on the PROJECT's
// own state only (AC2): a project with no .ctide/ or ai/ memory file of its own must never silently
// report on whatever happens to sit in the machine-global file instead. resolveMemoryFile() itself has no
// way to report which tier it matched, so checkFailureMemoryHealth (below) compares its returned path
// against this project-local-only list and treats a resolution landing outside it (i.e. the global tier)
// as equivalent to "not found", scoped to this check alone. resolveMemoryFile/failure-retrieve.mjs stay
// read-only and unmodified; both candidates are built with the SAME cwd this check itself received, so a
// plain string-membership check is exact (no realpath/canonicalization needed -- resolveMemoryFile
// returns one of its own candidate strings verbatim, never a resolved/symlink-followed path).
function projectLocalMemoryCandidates(cwd) {
  return [
    path.join(cwd, ".ctide", "memory", "FAILURE_MEMORY.md"),
    path.join(cwd, "ai", "FAILURE_MEMORY.md"),
  ];
}

// Resolves the project's FAILURE_MEMORY.md (reusing failure-retrieve.mjs's own resolveMemoryFile, not a
// reimplemented search order, but scoped to its project-local tiers only -- see
// projectLocalMemoryCandidates above) and summarizes failure-consolidate.mjs's real
// consolidationReport() / tagRecurrenceCandidates() output -- the same assembly shape as that file's own
// main(): resolve the file, parse entries, read the sibling ledger, build the report. No project-local
// file found => unverified (fail-open: no claim about a project that has none, and never a claim about
// the unrelated machine-global file either, even when one exists on this machine). A genuine read error
// on a FOUND file (permissions, I/O) is named specifically and reported as fail, distinct from the
// "0 entries" case; the sibling usage ledger, by contrast, is normally absent (no usage data yet is
// expected, not exceptional) and stays fail-open like failure-consolidate.mjs's own CLI. Status is pass
// whenever the check itself completed, regardless of what it found -- this measures successful diagnosis,
// not a grade on the project's memory file. vigil's modules are loaded lazily here (see
// VIGIL_RETRIEVE_MODULE/VIGIL_CONSOLIDATE_MODULE above) so a load failure over there reports as this
// check's own fail, never a crash of the whole doctor.mjs run.
async function checkFailureMemoryHealth(cwd, checks, now) {
  let vigilRetrieve, vigilConsolidate;
  try {
    [vigilRetrieve, vigilConsolidate] = await Promise.all([
      import(VIGIL_RETRIEVE_MODULE),
      import(VIGIL_CONSOLIDATE_MODULE),
    ]);
  } catch (error) {
    checks.push(result("failure-memory-health", "fail", `vigil module load failed (${safeErrorCode(error)})`));
    return { actionable: false };
  }
  const { resolveMemoryFile, defaultLedgerPath, parseEntries } = vigilRetrieve;
  const { consolidationReport, tagRecurrenceCandidates, readLedger } = vigilConsolidate;

  const resolved = resolveMemoryFile(cwd);
  const file = resolved && projectLocalMemoryCandidates(cwd).includes(resolved) ? resolved : null;
  if (!file) {
    checks.push(result("failure-memory-health", "unverified", "no FAILURE_MEMORY.md found"));
    return { actionable: false };
  }
  let raw;
  try {
    raw = readCappedTail(file);
  } catch (error) {
    checks.push(result("failure-memory-health", "fail", `FAILURE_MEMORY.md found but read failed (${safeErrorCode(error)})`));
    return { actionable: false };
  }
  const entries = parseEntries(raw);
  let ledgerRaw = "";
  try { ledgerRaw = readCappedTail(defaultLedgerPath(file)); } catch (error) { ledgerRaw = ""; }
  const records = readLedger(ledgerRaw);
  const report = consolidationReport(entries, records, { now });
  const tagCandidates = tagRecurrenceCandidates(entries);
  checks.push(result("failure-memory-health", "pass", summarizeMemoryHealth(report, tagCandidates)));
  const actionable = report.retired.length > 0 || report.expireCandidates.length > 0 || tagCandidates.length > 0;
  return { actionable };
}

// INCIDENT-<YYYYMMDD>-<slug>.md -- salvage's own naming convention (references/reentry-and-closure.md).
const INCIDENT_FILENAME = /^INCIDENT-(\d{4})(\d{2})(\d{2})-(.+)\.md$/i;
// salvage's own journal schema field, same file: "- Status: open | mitigated | closed".
const INCIDENT_STATUS_LINE = /^[ \t]*-[ \t]*Status:[ \t]*(.+?)[ \t]*$/mi;

function parseIncidentFilename(filename) {
  const match = filename.match(INCIDENT_FILENAME);
  if (!match) return { slug: filename.replace(/\.md$/i, ""), dateOrdinal: null };
  const [, y, m, d, slug] = match;
  return { slug, dateOrdinal: Number(y) * 10000 + Number(m) * 100 + Number(d) };
}

function incidentAgeDays(dateOrdinal, now) {
  if (!dateOrdinal) return null;
  const y = Math.floor(dateOrdinal / 10000), m = Math.floor((dateOrdinal % 10000) / 100), d = dateOrdinal % 100;
  return Math.floor((now - Date.UTC(y, m - 1, d)) / DAY_MS);
}

// One unified rule, not two separate code paths: "confirmed closed" only when Status: is present and
// reads exactly "closed" (case-insensitive); every other case -- open, mitigated, a missing line, or one
// that does not parse -- is NOT confirmed closed. Never guesses a missing/malformed line toward either
// open or closed -- naming it "unknown" avoids both hiding a real problem and manufacturing a false one.
function classifyIncidentJournal(text, dateOrdinal, now) {
  const match = text.match(INCIDENT_STATUS_LINE);
  const value = match ? match[1].trim().toLowerCase() : null;
  if (value === "closed") return { kind: "closed" };
  const ageDays = incidentAgeDays(dateOrdinal, now);
  const ageText = ageDays == null ? "age unknown (unparseable filename date)" : `opened ${pluralize(ageDays, "day")} ago`;
  if (value === "open") return { kind: "open", detail: `status=open, ${ageText}` };
  if (value === "mitigated") return { kind: "mitigated", detail: `status=mitigated, ${ageText}` };
  return { kind: "unknown", detail: "status unknown — Status: line missing or unparseable" };
}

const INCIDENT_READ_CAP = 64 * 1024; // generous fixed cap for a single journal file

// Read at most INCIDENT_READ_CAP bytes from the START of `file`. Unlike readCappedTail (tail-biased,
// correct for a memory file's newest-entries-last shape), an incident journal's Status: line sits near
// its TOP (right after the title) -- a head-capped read is the correct shape here, bounding a
// pathologically large journal without needing the whole file. Throws on a genuine filesystem error
// (missing/permissions/I-O/broken symlink), same discipline as readCappedTail -- the caller decides how
// to report it.
function readCappedHead(file) {
  const size = fs.statSync(file).size;
  if (size <= INCIDENT_READ_CAP) return fs.readFileSync(file, "utf8");
  const fd = fs.openSync(file, "r");
  try {
    const buf = Buffer.alloc(INCIDENT_READ_CAP);
    const n = fs.readSync(fd, buf, 0, INCIDENT_READ_CAP, 0);
    return buf.toString("utf8", 0, n);
  } finally { try { fs.closeSync(fd); } catch (e) {} }
}

// Scans .ctide/incidents/*.md under the resolved project cwd. No directory => unverified (fail-open: no
// claim about a project with no incident history at all); a genuine access error on a directory that DOES
// exist (permissions) is named specifically and reported as fail instead, mirroring
// checkFailureMemoryHealth's own found-but-unreadable distinction. Per journal, classifies its Status:
// line via the one unified rule above; every non-confirmed-closed journal gets its own incident:<slug>
// entry (mirroring the existing hook:<name> per-item pattern), naming which case applies and the age in
// days derived from the filename date. Two journals can independently settle on the same slug (different
// filename dates, same descriptive suffix) -- disambiguated by filename stem on an actual collision only,
// see the comment below. Zero non-closed journals collapse to a single summary entry instead of per-item
// noise.
function checkIncidentJournals(cwd, checks, now) {
  const dir = path.join(cwd, ".ctide", "incidents");
  let filenames;
  try {
    filenames = fs.readdirSync(dir).filter(name => name.toLowerCase().endsWith(".md")).sort();
  } catch (error) {
    const code = safeErrorCode(error);
    if (code === "EACCES" || code === "EPERM") {
      checks.push(result("incident-journals", "fail", `.ctide/incidents/ found but could not be read (${code})`));
    } else {
      checks.push(result("incident-journals", "unverified", "no .ctide/incidents/ directory found"));
    }
    return { actionable: false };
  }

  const findings = [];
  for (const filename of filenames) {
    const { slug, dateOrdinal } = parseIncidentFilename(filename);
    let text;
    try {
      text = readCappedHead(path.join(dir, filename));
    } catch (error) {
      findings.push({ filename, slug, status: "unverified", detail: `status unknown — journal read failed (${safeErrorCode(error)})` });
      continue;
    }
    const classification = classifyIncidentJournal(text, dateOrdinal, now);
    if (classification.kind === "closed") continue;
    findings.push({ filename, slug, status: classification.kind === "unknown" ? "unverified" : "pass", detail: classification.detail });
  }

  if (findings.length === 0) {
    checks.push(result("incident-journals", "pass", "0 open"));
    return { actionable: false };
  }

  // Disambiguate a repeated slug (e.g. INCIDENT-20260601-db-migration-failure.md and
  // INCIDENT-20260701-db-migration-failure.md both parse to slug "db-migration-failure"): pushing both as
  // an identically-named incident:<slug> check would collide, and this test suite's own name-keyed
  // `.find(c => c.name === X)` idiom (used throughout) would silently see only the first. Detected as a
  // slug seen more than once across this run's findings, and disambiguated with the full filename stem
  // (unique by construction -- two files cannot share a name in the same directory -- and works even for
  // a non-INCIDENT-<date>-shaped filename, unlike a date-ordinal suffix, which an undated slug has none
  // of). Every entry sharing a colliding slug is renamed, not just the second one seen, so neither date
  // looks like the "extra" one; the common non-colliding case keeps the plain incident:<slug> name.
  const slugCounts = new Map();
  for (const finding of findings) slugCounts.set(finding.slug, (slugCounts.get(finding.slug) || 0) + 1);
  // Residual collision, beyond the slug-count disambiguation above: a crafted filename's own SLUG (once its
  // own INCIDENT-<date>- prefix is stripped) can itself be shaped exactly like another finding's
  // disambiguated FULL STEM (e.g. a file literally named "INCIDENT-<date>-INCIDENT-<date>-<slug>.md"), so
  // slug-count uniqueness alone does not guarantee the FINAL emitted names are unique. Re-verified here
  // against the set of names actually about to be emitted -- on a residual collision, append a numeric
  // index suffix until unique, so no two checks[] entries can ever share a name. Not reachable from
  // salvage's own normal slug convention; cheap hardening for an adversarial/malformed filename.
  const emittedNames = new Set();
  for (const finding of findings) {
    let name = slugCounts.get(finding.slug) > 1 ? finding.filename.replace(/\.md$/i, "") : finding.slug;
    if (emittedNames.has(name)) {
      let suffix = 2;
      while (emittedNames.has(`${name}-${suffix}`)) suffix++;
      name = `${name}-${suffix}`;
    }
    emittedNames.add(name);
    checks.push(result(`incident:${name}`, finding.status, finding.detail));
  }
  return { actionable: true };
}

export async function diagnose(pluginRoot = resolvePluginRoot(), options = {}) {
  const checks = [];
  const project = options.project === true;
  const cwd = project ? (options.cwd ?? resolveProjectCwd()) : undefined;
  const now = Number.isFinite(options.now) ? options.now : Date.now();
  let manifest;
  let manifestIdentityValid = false;
  try {
    manifest = safeJson(path.join(pluginRoot, ".claude-plugin", "plugin.json"));
    manifestIdentityValid = manifest.name === "ctide" && SEMVER.test(manifest.version);
    checks.push(result("manifest", manifestIdentityValid ? "pass" : "fail", manifestIdentityValid ? `ctide@${manifest.version}` : `expected ctide@<semver>, got ${manifest.name}@${manifest.version}`));
  } catch (error) { checks.push(result("manifest", "fail", `manifest check failed (${safeErrorCode(error)})`)); }

  const nodeMajor = Number.parseInt(process.versions.node.split(".")[0], 10);
  checks.push(result("node", nodeMajor >= 20 ? "pass" : "fail", `${process.execPath} ${process.version}`));

  let hookConfiguration;
  let hookWiringExact = false;
  try {
    hookConfiguration = safeJson(path.join(pluginRoot, "hooks", "hooks.json"));
    const actualScripts = fs.readdirSync(path.join(pluginRoot, "hooks")).filter(name => name.endsWith(".js")).sort();
    hookWiringExact = JSON.stringify(registrations(hookConfiguration)) === JSON.stringify(expectedRegistrations) &&
      JSON.stringify(actualScripts) === JSON.stringify([...expectedHooks].sort());
    checks.push(result("hook-wiring", hookWiringExact ? "pass" : "fail", `${expectedHooks.length} expected hooks`));
  } catch (error) { checks.push(result("hook-wiring", "fail", `hook wiring check failed (${safeErrorCode(error)})`)); }

  const staticHookChecks = expectedHooks.map(name => {
    const hook = path.join(pluginRoot, "hooks", name);
    const syntax = spawnSync(process.execPath, ["--check", hook], { encoding: "utf8", timeout: 5000 });
    return { hook, name, syntax };
  });
  const trustedCanonicalRoot = sameCanonicalPath(canonical(pluginRoot), canonical(bundledPluginRoot));
  const runtimeEligible = manifestIdentityValid && hookWiringExact && trustedCanonicalRoot;
  if (runtimeEligible) {
    const probeRoot = fs.mkdtempSync(path.join(os.tmpdir(), "ctide-doctor-"));
    try {
      fs.writeFileSync(path.join(probeRoot, "doctor-transcript.jsonl"), "", "utf8");
      fs.mkdirSync(path.join(probeRoot, ".ctide", "memory"), { recursive: true });
      fs.writeFileSync(path.join(probeRoot, ".ctide", "memory", "FAILURE_MEMORY.md"), "Doctor runtime probe memory\n", "utf8");
      const probeEnv = {
        ...process.env,
        CLAUDE_PROJECT_DIR: probeRoot,
        CTIDE_HOOK_DEBUG: "1",
        TEMP: probeRoot,
        TMP: probeRoot,
        TMPDIR: probeRoot,
      };
      let runtimePassed = true;
      for (const { hook, name, syntax } of staticHookChecks) {
        const valid = spawnSync(process.execPath, [hook], { input: JSON.stringify(harmlessEvent(name, probeRoot)), encoding: "utf8", timeout: 5000, cwd: probeRoot, env: probeEnv });
        const malformed = spawnSync(process.execPath, [hook], { input: "{", encoding: "utf8", timeout: 5000, cwd: probeRoot });
        const processed = observedHookSignal(name, valid);
        const passed = runtimeProbePassed(name, { syntax, valid, malformed });
        runtimePassed &&= passed;
        const summary = `syntax=${syntax.status} valid=${valid.status} processed=${processed ? 1 : 0} malformed=${malformed.status}`;
        const detail = passed ? summary : `${summary} ${[probeFailureDetail("syntax", syntax), probeFailureDetail("valid", valid), probeFailureDetail("malformed", malformed)].join(" ")}`;
        checks.push(result(`hook:${name}`, passed ? "pass" : "fail", detail));
      }

      const debug = spawnSync(process.execPath, [path.join(pluginRoot, "hooks", "plan-gate.js")], {
        input: "{", encoding: "utf8", timeout: 5000, cwd: probeRoot,
        env: { ...process.env, CLAUDE_PROJECT_DIR: probeRoot, CTIDE_HOOK_DEBUG: "1", TEMP: probeRoot, TMP: probeRoot, TMPDIR: probeRoot },
      });
      const debugLog = path.join(probeRoot, "ctide-hook.log");
      const debugLogText = fs.existsSync(debugLog) ? fs.readFileSync(debugLog, "utf8") : "";
      const debugSafe = debug.status === 0 && debug.stderr.includes("[ctide plan-gate]") && debugLogText.includes("[plan-gate]") && !debugLogText.includes("CTIDE_HOOK_DEBUG=1");
      runtimePassed &&= debugSafe;
      checks.push(result("hook-debug", debugSafe ? "pass" : "fail", debugSafe ? "isolated prefix and log probe" : probeFailureDetail("debug", debug)));
      checks.push(result("runtime-probes", runtimePassed ? "pass" : "fail", "trusted canonical plugin root"));
    } finally { fs.rmSync(probeRoot, { recursive: true, force: true }); }
  } else {
    for (const { name, syntax } of staticHookChecks) {
      checks.push(result(`hook:${name}`, syntax.status === 0 ? "pass" : "fail", syntax.status === 0 ? `syntax=${syntax.status} runtime=skipped` : `${probeFailureDetail("syntax", syntax)} runtime=skipped`));
    }
    const reasons = [
      !manifestIdentityValid && "manifest identity",
      !hookWiringExact && "exact hook wiring",
      !trustedCanonicalRoot && "trusted canonical root",
    ].filter(Boolean).join(", ");
    checks.push(result("runtime-probes", "unverified", `requires ${reasons}`));
  }

  const skillsPresent = expectedSkills.every(name => fs.existsSync(path.join(pluginRoot, "skills", name, "SKILL.md")));
  checks.push(result("skills", skillsPresent ? "pass" : "fail", `${expectedSkills.length} public skills`));
  try {
    const expectedAgentPaths = expectedAgents.map(name => `./agents/${name}.agent.md`).sort();
    const manifestAgentPaths = Array.isArray(manifest?.agents) ? [...manifest.agents].sort() : [];
    const filesystemAgentPaths = fs.readdirSync(path.join(pluginRoot, "agents")).map(name => `./agents/${name}`).sort();
    const agentsExact = JSON.stringify(manifestAgentPaths) === JSON.stringify(expectedAgentPaths) &&
      JSON.stringify(filesystemAgentPaths) === JSON.stringify(expectedAgentPaths);
    checks.push(result("agents", agentsExact ? "pass" : "fail", `${manifestAgentPaths.length} manifest paths; ${filesystemAgentPaths.length} filesystem entries`));
  } catch (error) { checks.push(result("agents", "fail", `agent inventory check failed (${safeErrorCode(error)})`)); }
  checks.push(result("telemetry", "pass", "No network or telemetry probe performed"));

  // --project: additive only, layered on top of the 14 plugin-health checks above, which have already
  // run unconditionally by this point regardless of `project`. Guidance lines are appended only when the
  // corresponding check found something actionable -- omitted entirely (never an empty-string placeholder)
  // when --project was not passed, or was passed but found nothing actionable.
  const guidance = ["claude plugin marketplace add kktu6507/plugins", "claude plugin install ctide@kktu", "Restart Claude Code after enablement changes"];
  // Structural safety net, mirroring every other check in diagnose() (each already individually
  // try/catch-wrapped): the vigil module-LOAD path inside checkFailureMemoryHealth is already
  // try/catch-wrapped (see that function's own header comment), but nothing previously guarded the code
  // that runs AFTER a successful load (parseEntries/consolidationReport/tagRecurrenceCandidates/
  // summarizeMemoryHealth, and checkIncidentJournals's own body) -- so the "--project must never crash"
  // invariant rested on "this code happens not to throw" rather than being structurally guaranteed like
  // every other check here. No concrete throwing input is known today; this is defense in depth, not a fix
  // for an observed bug. A residual exception is converted into its own reported `fail` check
  // (project-health) rather than an uncaught rejection, matching diagnose()'s existing per-check pattern.
  if (project) {
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
      checks.push(result("project-health", "fail", `--project checks failed unexpectedly (${safeErrorCode(error)})`));
    }
  }

  return {
    pluginRoot: trustedCanonicalRoot ? "<bundled-plugin-root>" : "<plugin-root>",
    status: checks.some(check => check.status === "fail")
      ? "fail"
      : checks.some(check => check.status === "unverified")
        ? "unverified"
        : "pass",
    checks,
    guidance,
  };
}

function isInvokedDirectly() {
  if (!process.argv[1]) return false;
  try {
    return fs.realpathSync(process.argv[1]) === fileURLToPath(import.meta.url);
  } catch {
    return false;
  }
}

if (isInvokedDirectly()) {
  const report = await diagnose(undefined, { project: process.argv.includes("--project") });
  if (process.argv.includes("--json")) console.log(JSON.stringify(report, null, 2));
  else {
    console.log(`Cressetide doctor: ${report.status}`);
    for (const check of report.checks) console.log(`${check.status.toUpperCase()} ${check.name}: ${check.detail}`);
    console.log(report.guidance.join("\n"));
  }
  if (report.status !== "pass") process.exitCode = 1;
}
