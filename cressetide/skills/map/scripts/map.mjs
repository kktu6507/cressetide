#!/usr/bin/env node
import fs from "node:fs";
import crypto from "node:crypto";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const SECTION_NAMES = [
  "System overview", "Repository structure", "Architecture boundaries", "Execution flows", "Data flows",
  "External integrations", "Runtime and operations", "Risk and uncertainty",
];
// Ops Profile fields (operational-readiness.md) remaining after "System overview" merged into
// SECTION_NAMES above. These carry the profile's own compact inline trust-marker shape rather than
// the heavier per-section provenance block the canonical sections use (see docs/map-contract.md).
const OPS_PROFILE_SECTIONS = [
  "Access inventory", "Rollback", "Feature flags & kill switches", "Backups",
  "Breach readiness", "Observability inventory", "Run in isolation",
  "External dependencies", "Approvals map",
];
const OPS_PROFILE_SKELETON = {
  "Access inventory": [
    "| What | Where / how to read it | Runnable by | Trust |",
    "| --- | --- | --- | --- |",
    "| UNVERIFIED | UNVERIFIED | UNVERIFIED | UNVERIFIED <!-- CTIDE:TRUST:unverified --> |",
    "UNVERIFIED: access inventory entries require Cartographer confirmation. <!-- CTIDE:HEURISTIC-PLACEHOLDER -->",
  ],
  "Rollback": [
    "- UNVERIFIED: rollback steps, schema-migration history, and new-format data require Cartographer confirmation. <!-- CTIDE:HEURISTIC-PLACEHOLDER --> <!-- CTIDE:TRUST:unverified -->",
  ],
  "Feature flags & kill switches": [
    "- UNVERIFIED: feature flags and kill switches require Cartographer confirmation. <!-- CTIDE:HEURISTIC-PLACEHOLDER --> <!-- CTIDE:TRUST:unverified -->",
  ],
  "Backups": [
    "- UNVERIFIED: backup existence and restore-drill status require Cartographer confirmation. <!-- CTIDE:HEURISTIC-PLACEHOLDER -->",
  ],
  "Breach readiness": [
    "- UNVERIFIED: secure evidence store, out-of-band comms, legal/privacy owner, and notification threshold require Cartographer confirmation. <!-- CTIDE:HEURISTIC-PLACEHOLDER -->",
  ],
  "Observability inventory": [
    "- UNVERIFIED: observability inventory (logs, metrics, alerts) requires Cartographer confirmation. <!-- CTIDE:HEURISTIC-PLACEHOLDER -->",
  ],
  "Run in isolation": [
    "- UNVERIFIED: how to run the system in isolation requires Cartographer confirmation. <!-- CTIDE:HEURISTIC-PLACEHOLDER -->",
  ],
  "External dependencies": [
    "- UNVERIFIED: external dependencies and their health/status locations require Cartographer confirmation. <!-- CTIDE:HEURISTIC-PLACEHOLDER -->",
  ],
  "Approvals map": [
    "- UNVERIFIED: the approvals map (rollback, maintenance mode, data repair) requires Cartographer confirmation. <!-- CTIDE:HEURISTIC-PLACEHOLDER -->",
  ],
};
const MANUAL_START = "<!-- CTIDE:MANUAL-NOTES:START -->";
const MANUAL_END = "<!-- CTIDE:MANUAL-NOTES:END -->";
const FINGERPRINT_PATTERN = /^sha256:[a-f0-9]{64}$/;
const HEURISTIC_PLACEHOLDER = /<!-- CTIDE:HEURISTIC-PLACEHOLDER -->/;
// Each of the 3 trust-marker fields (Access inventory / Rollback / Feature flags & kill switches)
// carries its trust marker as BOTH the existing human-readable inline prose
// ("verified: <date>" | "dry-run-verified: <date>" | "UNVERIFIED") AND a machine-parseable HTML comment
// tag appended after it, e.g. "<!-- CTIDE:TRUST:verified:2026-07-01 -->" or
// "<!-- CTIDE:TRUST:unverified -->". `map verify`'s malformed-marker detection reads ONLY this tag; it
// never again parses, anchors to, or pattern-matches the surrounding free-form prose for that purpose.
// This decouples machine-checking from how a human formats their prose (case, whitespace, dash style,
// table style, multi-clause sentences, line span -- none of it matters, because verify isn't looking at
// any of it), the same robustness the canonical sections' invisible HEURISTIC_PLACEHOLDER comment
// already has against arbitrary prose editing. Prior rounds of prose-heuristic point-patching
// (fixed-string prefix matching, Unicode-dash counting, paren-group anchoring, pipe-bounded table
// columns) never converged: each one anchored detection to a single markdown-formatting convention
// within unbounded free-form prose, and was defeated in turn by an equally legitimate alternative
// convention. This tag mechanism replaces that machinery entirely, rather than adding another layer on
// top of it.
//
// A field's block can carry more than one entry needing its own marker (multiple Feature-flags
// bullets, multiple Access-inventory rows); OPS_TRUST_TAG_ATTEMPT finds every "<!-- CTIDE:TRUST:...
// -->"-shaped comment in a block -- deliberately loose (it matches even a garbled tier word or a missing
// date), so a malformed tag is never invisible to the scan the way an out-of-shape string would be --
// and each match is validated independently by opsTrustTagIsWellFormed, so a well-formed tag anywhere in
// the block can never mask a separately malformed tag elsewhere (the old mechanism's dual-marker gap,
// where a single whole-string well-formed match cleared an entire line/field, has no analogue here).
const OPS_TRUST_TAG_ATTEMPT = /<!--\s*CTIDE:TRUST:[^>]*-->/g;
// The tier/date separator tolerates optional whitespace on both sides of its colon (mirroring the
// tolerance already given around the outer "<!--"/"-->" delimiters), because the adjacent human-readable
// prose on the same line conventionally writes "verified: <date>" WITH a space after the colon -- a
// good-faith author formatting the tag the same way must not be flagged malformed for it.
const OPS_TRUST_TAG_WELLFORMED = /^<!--\s*CTIDE:TRUST:(verified|dry-run-verified|unverified)(?:\s*:\s*(\S+))?\s*-->$/;

// A tag is well-formed only if its tier is exactly one of the 3 literal words -- an unrecognized tier
// word makes OPS_TRUST_TAG_WELLFORMED fail to match at all, which is itself treated as malformed -- and,
// for the 2 dated tiers, only if the trailing date passes the same isValidIsoDate check every other Map
// provenance date is held to (reused, not reinvented). "unverified" carries no date, so its
// well-formedness never depends on one.
function opsTrustTagIsWellFormed(tag) {
  const match = OPS_TRUST_TAG_WELLFORMED.exec(tag);
  if (!match) return false;
  const [, tier, date] = match;
  return tier === "unverified" || isValidIsoDate(date);
}

// Detects a malformed CTIDE:TRUST tag anywhere in one Ops Profile field's block. Unlike the
// prose-heuristic mechanism this replaces, the scan is uniform across all 9 fields -- no per-field
// designated-line prefix, no em-dash shape count, no table-row pipe-boundary special case -- because the
// tag is an unambiguous machine sentinel ordinary prose never produces by accident, so there is nothing
// left for a field-scoped allowlist to protect against; Access inventory's table Trust cell, Rollback's
// "Exact steps:" bullet, and Feature flags' per-flag bullets are all found the exact same way.
function opsProfileMalformedTrustMarker(block) {
  const tags = block.match(OPS_TRUST_TAG_ATTEMPT) || [];
  return tags.some(tag => !opsTrustTagIsWellFormed(tag));
}

// The fixed set of fields whose OPS_PROFILE_SKELETON template line(s) actually carry a CTIDE:TRUST tag
// placeholder -- i.e. the fields operational-readiness.md documents a trust-marker convention for at
// all. Derived directly from the skeleton (the single source of truth), not hardcoded separately, so it
// can never drift from OPS_PROFILE_SKELETON itself. Evaluates to exactly Access inventory / Rollback /
// Feature flags & kill switches.
const OPS_TRUST_TAG_FIELDS = OPS_PROFILE_SECTIONS.filter(name =>
  OPS_PROFILE_SKELETON[name].some(line => (line.match(OPS_TRUST_TAG_ATTEMPT) || []).length > 0));

// Access inventory's heuristic-placeholder DATA is a table row where at least one of the non-Trust
// cells (What / Where / Runnable by) still reads "UNVERIFIED" (optionally backtick-wrapped, matching
// this repo's own inline-code markdown convention elsewhere) -- not only when every cell in the row
// does. "UNVERIFIED" is itself a legitimate, honest final Trust-column value (operational-readiness.md's
// own worked example uses it there), so only the Trust cell is exempted from this check; the other
// three cells must always carry real content once a row is genuinely enriched, so any one of them still
// reading UNVERIFIED means the row has not actually been filled in yet -- decoupled from whether the
// trailing <!-- CTIDE:HEURISTIC-PLACEHOLDER --> marker line survives. This "still unenriched" concern is
// unchanged by, and independent of, the trust-marker-tag mechanism above.
const OPS_ACCESS_INVENTORY_UNVERIFIED_CELL = /^\s*`?UNVERIFIED`?\s*$/;
// Every non-table Ops Profile field's own heuristic-placeholder sentence, split into its individual
// skeleton lines (both the HEURISTIC-PLACEHOLDER marker comment and, where present, the CTIDE:TRUST tag
// stripped from each line), derived once from OPS_PROFILE_SKELETON (the single source of truth for each
// field's placeholder text) -- so "still unenriched" detection is anchored to each field's own actual
// placeholder content, not solely to a marker comment surviving untouched (an invisible HTML comment is
// trivially strippable while the boilerplate sentence itself stays fully intact). Checking containment
// per-line, rather than requiring the field's entire joined skeleton to survive as one contiguous
// substring, keeps this correct even if a future field's skeleton ever grows past one line and only some
// of its lines are edited. Access inventory is table-shaped and excluded here; it keeps its own
// row-based check above instead of being forced through sentence-containment.
const OPS_PROFILE_CORE_PLACEHOLDER_LINES = Object.fromEntries(
  OPS_PROFILE_SECTIONS.filter(name => name !== "Access inventory").map(name => [
    name,
    OPS_PROFILE_SKELETON[name].map(line => line
      .replaceAll("<!-- CTIDE:HEURISTIC-PLACEHOLDER -->", "")
      .replace(OPS_TRUST_TAG_ATTEMPT, "")
      .trim()),
  ]),
);

function isValidIsoDate(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{3}))?Z)?$/.exec(value || "");
  if (!match) return false;
  const [, yearText, monthText, dayText, hourText, minuteText, secondText, millisecondText] = match;
  const expected = [yearText, monthText, dayText, hourText || "00", minuteText || "00", secondText || "00", millisecondText || "000"].map(Number);
  const parsed = new Date(0);
  parsed.setUTCFullYear(expected[0], expected[1] - 1, expected[2]);
  parsed.setUTCHours(expected[3], expected[4], expected[5], expected[6]);
  return Number.isFinite(parsed.getTime()) && [
    parsed.getUTCFullYear(), parsed.getUTCMonth() + 1, parsed.getUTCDate(),
    parsed.getUTCHours(), parsed.getUTCMinutes(), parsed.getUTCSeconds(), parsed.getUTCMilliseconds(),
  ].every((part, index) => part === expected[index]);
}

function git(root, args) {
  return spawnSync("git", ["-C", root, ...args], {
    encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 10000,
  });
}

function repositoryRoot(input) {
  const resolved = path.resolve(input || process.cwd());
  const result = git(resolved, ["rev-parse", "--show-toplevel"]);
  if (result.status !== 0 || !result.stdout.trim()) throw new Error(`Map requires a readable Git repository: ${result.stderr.trim() || "git rev-parse failed"}`);
  return fs.realpathSync.native(result.stdout.trim());
}

function repositoryCommit(root) {
  const head = git(root, ["rev-parse", "--verify", "HEAD"]);
  if (head.status === 0 && /^[a-f0-9]{40,64}$/i.test(head.stdout.trim())) return head.stdout.trim();
  const count = git(root, ["rev-list", "--all", "--count"]);
  if (count.status === 0 && count.stdout.trim() === "0") return "UNBORN";
  throw new Error(`Cannot establish repository commit provenance: ${head.stderr.trim() || count.stderr.trim() || "Git state is unreadable"}`);
}

function containment(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative));
}

function assertContainedPath(root, candidate, label) {
  const absolute = path.resolve(candidate);
  if (!containment(root, absolute)) throw new Error(`${label} is outside repository: ${candidate}`);
  const relative = path.relative(root, absolute);
  let current = root;
  for (const segment of relative.split(path.sep).filter(Boolean)) {
    current = path.join(current, segment);
    if (!fs.existsSync(current)) continue;
    const stat = fs.lstatSync(current);
    if (stat.isSymbolicLink()) throw new Error(`${label} crosses a symbolic link or junction: ${current}`);
    const real = fs.realpathSync.native(current);
    if (!containment(root, real)) throw new Error(`${label} resolves outside repository: ${current}`);
  }
  return absolute;
}

function walk(root, relative = "", result = []) {
  for (const entry of fs.readdirSync(path.join(root, relative), { withFileTypes: true })) {
    if ([".git", ".ctide", "node_modules", "dist", "build", "coverage", "vendor"].includes(entry.name)) continue;
    const rel = path.join(relative, entry.name);
    const absolute = path.join(root, rel);
    const stat = fs.lstatSync(absolute);
    if (stat.isSymbolicLink()) continue;
    if (stat.isDirectory()) walk(root, rel, result);
    else if (stat.isFile()) result.push(rel.replaceAll("\\", "/"));
  }
  return result;
}

function fingerprint(parts) {
  const hash = crypto.createHash("sha256");
  for (const part of parts) {
    const value = Buffer.isBuffer(part) ? part : Buffer.from(String(part), "utf8");
    hash.update(String(value.length));
    hash.update(":");
    hash.update(value);
    hash.update(";");
  }
  return "sha256:" + hash.digest("hex");
}

function workingTreeFingerprint(root, files = walk(root).sort()) {
  const parts = [];
  for (const relative of files) {
    const normalized = relative.replaceAll("\\", "/");
    const source = assertContainedPath(root, path.resolve(root, relative), "Working-tree source");
    parts.push(normalized, fs.readFileSync(source));
  }
  return fingerprint(parts);
}

// True when `relative`'s first 2 bytes are the shebang marker "#!" -- a filename-independent
// entry-point signal (e.g. a CLI script with no main/index/app/program/server name). The path goes
// through the same assertContainedPath containment check as every other per-file read in this file
// (see workingTreeFingerprint above); a containment violation is a security-relevant condition and
// propagates uncaught (fail-closed). The read itself is a bounded 2-byte prefix (open fd, fixed
// offset, try/finally close -- mirroring failure-retrieve.mjs's readCapped) rather than a full-file
// read; any I/O failure at that stage (the file vanished or changed between walk() and this call, a
// permission race, a 0-1 byte file) is an ordinary I/O race, not a security condition, so it fails
// open to false rather than aborting Map generation.
function hasShebang(root, relative) {
  const absolute = assertContainedPath(root, path.resolve(root, relative), "Entry-point candidate");
  try {
    const fd = fs.openSync(absolute, "r");
    try {
      const buffer = Buffer.alloc(2);
      const bytesRead = fs.readSync(fd, buffer, 0, 2, 0);
      return bytesRead === 2 && buffer[0] === 0x23 && buffer[1] === 0x21;
    } finally {
      try { fs.closeSync(fd); } catch { /* close failure does not change the result */ }
    }
  } catch {
    return false;
  }
}

function sourceEvidence(root, citation) {
  const match = citation.match(/^(.+):([1-9]\d*)(?:-([1-9]\d*))?$/);
  if (!match) throw new Error("invalid source citation: " + citation);
  const relative = match[1];
  const start = Number(match[2]);
  const end = Number(match[3] || match[2]);
  if (end < start) throw new Error("invalid source line range: " + citation);
  const source = assertContainedPath(root, path.resolve(root, relative), "Map source");
  if (!fs.existsSync(source) || !fs.statSync(source).isFile()) throw new Error("missing source: " + relative);
  const text = fs.readFileSync(source, "utf8");
  const lines = text.length ? text.split(/\r\n|\n|\r/) : [];
  if (lines.at(-1) === "") lines.pop();
  if (start > lines.length || end > lines.length) {
    throw new Error(`invalid source line range: ${citation} (file has ${lines.length} lines)`);
  }
  return { citation, content: lines.slice(start - 1, end).join("\n") };
}

function sourceFingerprint(root, citations) {
  if (!citations.length || citations.includes("UNVERIFIED")) return "UNVERIFIED";
  try {
    const evidence = citations.map(citation => sourceEvidence(root, citation));
    return fingerprint(evidence.flatMap(item => [item.citation, item.content]));
  } catch {
    return "UNVERIFIED";
  }
}

function firstSource(root, candidates) {
  const found = candidates.find(candidate => fs.existsSync(path.join(root, candidate)));
  return found ? found + ":1" : "UNVERIFIED";
}

function languages(files) {
  const names = new Map([
    [".js", "JavaScript"], [".mjs", "JavaScript"], [".cjs", "JavaScript"],
    [".ts", "TypeScript"], [".tsx", "TypeScript"], [".py", "Python"],
    [".cs", "C#"], [".java", "Java"], [".go", "Go"], [".rs", "Rust"],
    [".rb", "Ruby"], [".php", "PHP"], [".swift", "Swift"], [".kt", "Kotlin"],
  ]);
  return [...new Set(files.map(file => names.get(path.extname(file).toLowerCase())).filter(Boolean))].sort();
}

function metadata(root, commit, source, confidence) {
  const citations = Array.isArray(source) ? source : [source];
  return [
    "Verified at commit: " + commit,
    "Last updated: " + new Date().toISOString(),
    "Confidence: " + confidence,
    "Source fingerprint: " + sourceFingerprint(root, citations),
    "Sources:",
    ...citations.map(citation => "- " + citation),
  ].join("\n");
}

// Normalizes package.json's "bin" field to a flat string[] of candidate paths, tolerating every
// shape npm allows plus anything malformed -- matching this file's existing defensive `|| {}` style
// for scripts/dependencies, so a malformed bin field can never throw Map generation. npm's own "bin"
// is either a single string (the package's one executable) or an object mapping command names to
// paths; anything else (array, number, null, missing) normalizes to []. Each surviving string entry
// is path-normalized (backslash to forward slash, a single leading "./" stripped) so it is directly
// comparable against `files`, which walk() already normalizes to forward slashes.
function normalizePackageBin(bin) {
  const raw = typeof bin === "string" ? [bin]
    : bin && typeof bin === "object" && !Array.isArray(bin) ? Object.values(bin)
      : [];
  return raw
    .filter(entry => typeof entry === "string")
    .map(entry => entry.replaceAll("\\", "/").replace(/^\.\//, ""));
}

function packageFacts(root) {
  const file = path.join(root, "package.json");
  if (!fs.existsSync(file)) return { scripts: [], dependencies: [], description: "", bin: [] };
  try {
    const value = JSON.parse(fs.readFileSync(file, "utf8"));
    return {
      scripts: Object.keys(value.scripts || {}).sort(),
      dependencies: [...new Set([...Object.keys(value.dependencies || {}), ...Object.keys(value.devDependencies || {})])].sort(),
      description: typeof value.description === "string" ? value.description.replace(/\s+/g, " ").trim() : "",
      bin: normalizePackageBin(value.bin),
    };
  } catch (error) {
    throw new Error(`Cannot parse package.json for Map evidence: ${error.message}`);
  }
}

function defaultManualNotes() {
  return [
    MANUAL_START,
    "## Human-verified operational knowledge",
    "",
    "> This bounded section is preserved verbatim by refresh. Humans may record verified operational facts with current Sources; Cartographer must surface conflicts rather than overwrite them.",
    "",
    "No human-verified operational notes recorded.",
    MANUAL_END,
  ].join("\n");
}

function manualNotes(existing) {
  if (!existing) return defaultManualNotes();
  const start = existing.indexOf(MANUAL_START);
  const end = existing.indexOf(MANUAL_END);
  if (start < 0 && end < 0) {
    if (/^## Human-verified operational knowledge\s*$/m.test(existing)) throw new Error("Manual operational knowledge has no preservation boundary; refusing refresh");
    return defaultManualNotes();
  }
  if (start < 0 || end < start || existing.indexOf(MANUAL_START, start + 1) >= 0 || existing.indexOf(MANUAL_END, end + 1) >= 0) {
    throw new Error("Manual operational knowledge boundary is malformed; refusing refresh");
  }
  return existing.slice(start, end + MANUAL_END.length);
}

function buildMap(root, preservedManualNotes = defaultManualNotes()) {
  const files = walk(root).sort();
  const commit = repositoryCommit(root);
  const top = [...new Set(files.map(file => file.split("/")[0]))].sort();
  const foundLanguages = languages(files);
  const pkg = packageFacts(root);
  const packageSource = firstSource(root, ["package.json", "pyproject.toml", "Cargo.toml", "go.mod"]);
  const configSource = firstSource(root, ["package.json", "pyproject.toml", "Cargo.toml", "go.mod", "Dockerfile", "docker-compose.yml"]);
  const tests = files.filter(file => /(^|\/)(test|tests|spec)(\/|\.|$)/i.test(file));
  // Entry-point candidates union 3 independent signals: the filename convention below, a shebang
  // line (any filename -- catches a CLI script like scripts/publish-release.mjs that a
  // main|index|app|program|server name would miss), and package.json's normalized bin field. A bin
  // path is intersected against `files` -- the same walked set every other candidate list here is
  // drawn from, and the set every Sources citation must resolve against -- rather than trusted
  // unconditionally, so a stale or unreachable bin entry can never surface as an entry-point
  // candidate.
  const filesSet = new Set(files);
  const entries = [...new Set([
    ...files.filter(file => /(^|\/)(main|index|app|program|server)\.[^.]+$/i.test(file)),
    ...files.filter(file => hasShebang(root, file)),
    ...pkg.bin.filter(candidate => filesSet.has(candidate)),
  ])].sort();
  const dataFiles = files.filter(file => /(schema|migration|database|store|cache)/i.test(file));
  const integrationFiles = files.filter(file => /(client|integration|adapter|connector|api)/i.test(file));
  const operationFiles = files.filter(file => /(^|\/)(Dockerfile|docker-compose[^/]*|\.github\/workflows|deploy|infra|helm|k8s)/i.test(file));
  const source = files[0] ? files[0] + ":1" : "UNVERIFIED";
  const codeList = (values, empty = "UNVERIFIED") => values.length ? values.slice(0, 20).join(", ") : empty;
  const sections = [
    ["System overview", metadata(root, commit, packageSource, "unverified"),
      "- " + (pkg.description || "UNVERIFIED: package.json has no description field; Cartographer must state what this system is/does from current repository evidence. <!-- CTIDE:HEURISTIC-PLACEHOLDER -->"),
      "- See Architecture boundaries for components and entry points.",
      "- See External integrations for external dependencies."],
    ["Repository structure", metadata(root, commit, packageSource, packageSource === "UNVERIFIED" ? "unverified" : "verified"),
      "- Top-level entries: " + codeList(top),
      "- Languages: " + (foundLanguages.join(", ") || "UNVERIFIED"),
      "- Tests: " + codeList(tests, "none detected")],
    ["Architecture boundaries", metadata(root, commit, entries[0] ? entries[0] + ":1" : source, "unverified"),
      "- Candidate entry points: " + codeList(entries),
      "- UNVERIFIED: Component responsibilities and public/internal boundaries require concrete Cartographer evidence. <!-- CTIDE:HEURISTIC-PLACEHOLDER -->"],
    ["Execution flows", metadata(root, commit, entries[0] ? entries[0] + ":1" : packageSource, "unverified"),
      "- Candidate entry points: " + codeList(entries),
      "- Package scripts: " + codeList(pkg.scripts, "none detected"),
      "- UNVERIFIED: Cartographer must confirm request, event, job, scheduled-task, CLI, and critical user flows with lean caller/callee evidence. <!-- CTIDE:HEURISTIC-PLACEHOLDER -->"],
    ["Data flows", metadata(root, commit, firstSource(root, dataFiles), "unverified"),
      "- Data-related evidence candidates: " + codeList(dataFiles),
      "- UNVERIFIED: Cartographer must confirm ownership, transactions, caches, serialization, exchange, and trust boundaries. <!-- CTIDE:HEURISTIC-PLACEHOLDER -->"],
    ["External integrations", metadata(root, commit, integrationFiles[0] ? integrationFiles[0] + ":1" : packageSource, "unverified"),
      "- Dependency candidates: " + codeList(pkg.dependencies, "none detected"),
      "- Integration code candidates: " + codeList(integrationFiles, "none detected"),
      "- UNVERIFIED: Cartographer must confirm APIs, identity, brokers, cloud services, file transfer, and health endpoints at call sites. <!-- CTIDE:HEURISTIC-PLACEHOLDER -->"],
    ["Runtime and operations", metadata(root, commit, configSource, "unverified"),
      "- Package scripts: " + codeList(pkg.scripts, "none detected"),
      "- Operations evidence candidates: " + codeList(operationFiles, "none detected"),
      "- UNVERIFIED: Build, run, deploy, health, logs, metrics, traces, rollback, flags, kill switches, backup, restore, and approvals require current repository evidence. <!-- CTIDE:HEURISTIC-PLACEHOLDER -->"],
    ["Risk and uncertainty", metadata(root, commit, source, "unverified"),
      "- UNVERIFIED: Authentication, destructive operations, schema changes, production assumptions, observability, and rollback require repository-specific risk evidence. <!-- CTIDE:HEURISTIC-PLACEHOLDER -->"],
  ];
  return [
    "# System Map", "",
    "> Repository-grounded orientation for Vigil and Salvage. Verify the affected area live; this map is not an authority.",
    "", "Map schema: 1", "Repository root: " + path.basename(root),
    "Verified at commit: " + commit,
    "Working tree fingerprint: " + workingTreeFingerprint(root, files),
    "Last updated: " + new Date().toISOString(), "",
    ...sections.flatMap(([name, meta, ...body]) => ["## " + name, "", meta, "", ...body, ""]),
    ...OPS_PROFILE_SECTIONS.flatMap(name => ["## " + name, "", ...OPS_PROFILE_SKELETON[name], ""]),
    preservedManualNotes, "",
  ].join("\n");
}

function targetPath(root) { return path.join(root, ".ctide", "map", "SYSTEM_MAP.md"); }

export function writeMap(rootInput, options = {}) {
  const root = repositoryRoot(rootInput);
  const target = assertContainedPath(root, targetPath(root), "Map output");
  if (!options.overwrite && fs.existsSync(target)) throw new Error("SYSTEM_MAP.md already exists; use refresh");
  const preserved = options.overwrite && fs.existsSync(target) ? manualNotes(fs.readFileSync(target, "utf8")) : defaultManualNotes();
  fs.mkdirSync(path.dirname(target), { recursive: true });
  assertContainedPath(root, path.dirname(target), "Map output directory");
  fs.writeFileSync(target, buildMap(root, preserved) + "\n", "utf8");
  return target;
}

// Slices a "## <name>" section's body out of a generated SYSTEM_MAP.md, bounded by the next
// "\n## " heading or end-of-file -- and additionally by extraBoundary (e.g. MANUAL_START) when it is
// found after the section's own heading, so a differently-shaped sentinel that is not itself a
// "## " heading (like the preserved Manual Notes boundary) can never be silently swallowed into the
// last iterated section/field's block.
function sliceSection(text, name, extraBoundary) {
  const marker = `## ${name}`;
  const start = text.indexOf(marker);
  if (start < 0) return "";
  const contentStart = start + marker.length;
  let end = text.indexOf("\n## ", contentStart);
  if (extraBoundary) {
    const boundary = text.indexOf(extraBoundary, contentStart);
    if (boundary >= 0 && (end < 0 || boundary < end)) end = boundary;
  }
  return text.slice(contentStart, end < 0 ? text.length : end);
}

// A table row counts as still-placeholder if any of its non-Trust cells (What / Where / Runnable by)
// is still literally "UNVERIFIED" -- see OPS_ACCESS_INVENTORY_UNVERIFIED_CELL above for why the Trust
// cell itself is exempted from this check.
function opsProfileAccessInventoryRowIsPlaceholder(line) {
  if (!/^\s*\|.*\|\s*$/.test(line)) return false;
  const cells = line.split("|").slice(1, -1);
  if (cells.length < 2) return false;
  return cells.slice(0, -1).some(cell => OPS_ACCESS_INVENTORY_UNVERIFIED_CELL.test(cell));
}

export function verifyMap(rootInput) {
  const root = repositoryRoot(rootInput);
  const target = targetPath(root);
  const findings = [];
  try { assertContainedPath(root, target, "Map output"); }
  catch (error) { return { ok: false, findings: [error.message] }; }
  if (!fs.existsSync(target)) return { ok: false, findings: ["missing .ctide/map/SYSTEM_MAP.md"] };
  const text = fs.readFileSync(target, "utf8");
  const firstSection = text.indexOf("\n## ");
  const header = firstSection < 0 ? text : text.slice(0, firstSection);
  const currentCommit = repositoryCommit(root);
  const recorded = header.match(/^Verified at commit:\s*(.+)$/m)?.[1]?.trim();
  if (!recorded) findings.push("missing map commit provenance");
  else if (recorded !== currentCommit) findings.push("stale commit: map=" + recorded + " current=" + currentCommit);
  const recordedTreeFingerprint = header.match(/^Working tree fingerprint:\s*(.+)$/m)?.[1]?.trim();
  if (!recordedTreeFingerprint) findings.push("missing working-tree fingerprint");
  else if (!FINGERPRINT_PATTERN.test(recordedTreeFingerprint)) findings.push("invalid working-tree fingerprint");
  else {
    const currentTreeFingerprint = workingTreeFingerprint(root);
    if (recordedTreeFingerprint !== currentTreeFingerprint) {
      findings.push("working-tree fingerprint drift: map=" + recordedTreeFingerprint + " current=" + currentTreeFingerprint);
    }
  }
  const mapLastUpdated = header.match(/^Last updated:\s*(.+)$/m)?.[1]?.trim();
  if (!mapLastUpdated) findings.push("missing map last updated provenance");
  else if (!isValidIsoDate(mapLastUpdated)) findings.push("invalid map last updated provenance");
  for (const section of SECTION_NAMES) {
    const block = sliceSection(text, section, MANUAL_START);
    if (!block) { findings.push("missing section: " + section); continue; }
    const sectionCommit = block.match(/^Verified at commit:\s*(.+)$/m)?.[1]?.trim();
    const sectionLastUpdated = block.match(/^Last updated:\s*(.+)$/m)?.[1]?.trim();
    const confidence = block.match(/^Confidence:\s*(.+)$/m)?.[1]?.trim();
    const recordedSourceFingerprint = block.match(/^Source fingerprint:\s*(.+)$/m)?.[1]?.trim();
    const sourceBlock = block.match(/^Sources:\s*\r?\n((?:- .*\r?\n?)+)/m)?.[1] || "";
    const citations = sourceBlock.split(/\r?\n/).filter(line => line.startsWith("- ")).map(line => line.slice(2).trim());
    if (!sectionCommit) findings.push("missing section commit provenance: " + section);
    else if (sectionCommit !== currentCommit) findings.push("stale section commit: " + section);
    if (!sectionLastUpdated) findings.push("missing section last updated provenance: " + section);
    else if (!isValidIsoDate(sectionLastUpdated)) findings.push("invalid section last updated provenance: " + section);
    if (!["verified", "derived", "unverified"].includes(confidence)) findings.push("invalid confidence: " + section);
    if (confidence === "unverified") findings.push("unverified section: " + section);
    const placeholder = block.split(/\r?\n/).find(line => HEURISTIC_PLACEHOLDER.test(line));
    if (placeholder) {
      findings.push("heuristic placeholder: " + section);
      if (confidence !== "unverified" || !/^\s*-\s*UNVERIFIED:/i.test(placeholder)) {
        findings.push("conflicting section: " + section + " has a heuristic placeholder without unverified confidence and UNVERIFIED marker");
      }
    }
    if (/^\s*-\s*UNVERIFIED\b|:\s*UNVERIFIED\b/m.test(block)) findings.push("unresolved evidence marker: " + section);
    if (!sourceBlock.trim()) findings.push("missing sources: " + section);
    if (!recordedSourceFingerprint) findings.push("missing source fingerprint: " + section);
    else if (recordedSourceFingerprint !== "UNVERIFIED" && !FINGERPRINT_PATTERN.test(recordedSourceFingerprint)) {
      findings.push("invalid source fingerprint: " + section);
    }
    if (confidence === "verified" && citations.includes("UNVERIFIED")) {
      findings.push("conflicting section: " + section + " is verified without a source");
    }
    const evidence = [];
    let invalidEvidence = false;
    for (const citation of citations) {
      if (citation === "UNVERIFIED") { invalidEvidence = true; continue; }
      try { evidence.push(sourceEvidence(root, citation)); }
      catch (error) { findings.push(error.message); invalidEvidence = true; }
    }
    if (!invalidEvidence && citations.length && recordedSourceFingerprint) {
      const currentSourceFingerprint = fingerprint(evidence.flatMap(item => [item.citation, item.content]));
      if (recordedSourceFingerprint !== currentSourceFingerprint) {
        findings.push("source fingerprint drift: " + section);
      }
    }
  }
  for (const name of OPS_PROFILE_SECTIONS) {
    const block = sliceSection(text, name, MANUAL_START);
    if (!block) { findings.push("missing ops-profile field: " + name); continue; }
    const stillPlaceholder = HEURISTIC_PLACEHOLDER.test(block)
      || (name === "Access inventory" && block.split(/\r?\n/).some(opsProfileAccessInventoryRowIsPlaceholder))
      || (OPS_PROFILE_CORE_PLACEHOLDER_LINES[name] !== undefined && OPS_PROFILE_CORE_PLACEHOLDER_LINES[name].some(coreLine => block.includes(coreLine)));
    if (stillPlaceholder) findings.push("unenriched ops-profile field: " + name);
    if (opsProfileMalformedTrustMarker(block)) findings.push("malformed trust marker: " + name);
    // A field can leave its placeholder state (real prose replaces the skeleton sentence) while its
    // CTIDE:TRUST tag is entirely absent, mis-cased, or buried behind other text inside the same HTML
    // comment -- all three currently match zero OPS_TRUST_TAG_ATTEMPT occurrences, so without this check
    // the field would pass verify with no finding of any kind. This is a pure presence check (tag count
    // === 0), not prose interpretation, so it cannot mask -- nor be masked by -- the malformed-tag check
    // above, which only ever runs against tags that were actually found.
    if (!stillPlaceholder && OPS_TRUST_TAG_FIELDS.includes(name) && (block.match(OPS_TRUST_TAG_ATTEMPT) || []).length === 0) {
      findings.push("missing trust tag: " + name);
    }
  }
  const manualStart = text.indexOf(MANUAL_START);
  const manualEnd = text.indexOf(MANUAL_END);
  if (manualStart < 0 || manualEnd < manualStart) findings.push("missing or malformed manual operational knowledge boundary");
  return { ok: findings.length === 0, findings };
}

function args(argv) {
  let mode = argv[0] || "create";
  if (mode === "map") mode = "create";
  if (!["create", "refresh", "verify"].includes(mode)) throw new Error("usage: map.mjs [create|refresh|verify] [--root PATH]");
  const index = argv.indexOf("--root");
  return { mode, root: index >= 0 ? argv[index + 1] : process.cwd() };
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  try {
    const input = args(process.argv.slice(2));
    if (input.mode === "verify") {
      const result = verifyMap(input.root);
      for (const finding of result.findings) console.error(finding);
      process.exitCode = result.ok ? 0 : 1;
    } else {
      console.log(writeMap(input.root, { overwrite: input.mode === "refresh" }));
    }
  } catch (error) {
    console.error(error.message || error);
    process.exitCode = 1;
  }
}
