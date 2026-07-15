#!/usr/bin/env node
import fs from "node:fs";
import crypto from "node:crypto";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const SECTION_NAMES = [
  "Repository structure", "Architecture boundaries", "Execution flows", "Data flows",
  "External integrations", "Runtime and operations", "Risk and uncertainty",
];
const MANUAL_START = "<!-- CTIDE:MANUAL-NOTES:START -->";
const MANUAL_END = "<!-- CTIDE:MANUAL-NOTES:END -->";
const FINGERPRINT_PATTERN = /^sha256:[a-f0-9]{64}$/;
const HEURISTIC_PLACEHOLDER = /<!-- CTIDE:HEURISTIC-PLACEHOLDER -->/;

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

function packageFacts(root) {
  const file = path.join(root, "package.json");
  if (!fs.existsSync(file)) return { scripts: [], dependencies: [] };
  try {
    const value = JSON.parse(fs.readFileSync(file, "utf8"));
    return {
      scripts: Object.keys(value.scripts || {}).sort(),
      dependencies: [...new Set([...Object.keys(value.dependencies || {}), ...Object.keys(value.devDependencies || {})])].sort(),
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
  const entries = files.filter(file => /(^|\/)(main|index|app|program|server)\.[^.]+$/i.test(file));
  const dataFiles = files.filter(file => /(schema|migration|database|store|cache)/i.test(file));
  const integrationFiles = files.filter(file => /(client|integration|adapter|connector|api)/i.test(file));
  const operationFiles = files.filter(file => /(^|\/)(Dockerfile|docker-compose[^/]*|\.github\/workflows|deploy|infra|helm|k8s)/i.test(file));
  const source = files[0] ? files[0] + ":1" : "UNVERIFIED";
  const codeList = (values, empty = "UNVERIFIED") => values.length ? values.slice(0, 20).join(", ") : empty;
  const sections = [
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
    const marker = `## ${section}`;
    const start = text.indexOf(marker);
    const end = start < 0 ? -1 : text.indexOf("\n## ", start + marker.length);
    const block = start < 0 ? "" : text.slice(start + marker.length, end < 0 ? text.length : end);
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
