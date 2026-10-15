// Binding test for cressetide/lib/ (acceptance criterion 9): each shared utility exists once, in lib/,
// and each script that uses one is bound to it. No exceptions.
//
//  (1) Single copy, bound: for each of the eight plugin scripts, .github/scripts/publish-release.mjs and the
//      structure validator's core, every lib name it uses is imported by name from the right cressetide/lib/
//      module (the import specifier, resolved from the script's own directory), is used in code, and is not
//      declared locally under that name. Only code counts: a name that appears only in a comment, inside a
//      string, in a template literal's text (its ${} expressions are code) or inside a regular expression is
//      not a use (and a commented-out import is not an import).
//  (2) Signatures: the tell-tale text of each utility appears exactly once under cressetide/lib/ — in its
//      module — and nowhere else in the repository's code; the two eliminated constructs (the hand-rolled
//      flag list, the per-script entry-point function) appear nowhere at all. Scope: tracked and
//      untracked-but-not-ignored .mjs/.js/.cjs files outside test/ (test fixtures run git and name these
//      utilities on purpose), and, until the phase that moves them, outside cressetide/hooks/orchestration-check.js
//      (P6: the Stop hook keeps its own debug switch and stdin reader until then, owner decision I-5) and
//      eval/ (P10).
//  (3) child_process: no product code loads node:child_process (an import, a require() or an import()) except
//      the allowlist below, so a script cannot run git — or anything else — beside lib/git. Same file scope
//      as (2), cressetide/hooks/ included; comments do not count.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { git, root, test } from "./helpers.mjs";

const SHIP = "cressetide/skills/ship/scripts/ship.mjs";
const MAP = "cressetide/skills/map/scripts/map.mjs";
const DOCTOR = "cressetide/skills/doctor/scripts/doctor.mjs";
const CONTRACT_CHECK = "cressetide/skills/vigil/scripts/contract-check.mjs";
const PACK_REVIEW_DIFF = "cressetide/skills/vigil/scripts/pack-review-diff.mjs";
const REGRESSION_DELTA = "cressetide/skills/vigil/scripts/regression-delta.mjs";
const FAILURE_RETRIEVE = "cressetide/skills/vigil/scripts/failure-retrieve.mjs";
const FAILURE_CONSOLIDATE = "cressetide/skills/vigil/scripts/failure-consolidate.mjs";
const PUBLISH_RELEASE = ".github/scripts/publish-release.mjs";
const VALIDATOR_CORE = ".github/scripts/validate-structure-core.mjs";

// (1) What each script takes from lib/: { module: [export, ...] }. An inner array lists alternatives, any
// one of which satisfies the requirement (a script may run git raw or through gitOrThrow).
const BINDINGS = {
  [SHIP]: { cli: ["isMain", "parseCli"], git: [["git", "gitOrThrow"], "parseCount", "headState"], "map-trust": ["trustTagAttempts", "OPS_TRUST_TAG_WELLFORMED", "opsTrustTagIsWellFormed"] },
  [MAP]: { cli: ["isMain", "parseCli"], git: [["git", "gitOrThrow"], "headState"], "map-trust": ["OPS_TRUST_TAG_ATTEMPT", "trustTagAttempts", "opsTrustTagIsWellFormed", "isValidIsoDate"] },
  [DOCTOR]: { cli: ["isMain", "parseCli"], debug: ["LOG_NAME"], "read-capped": ["readCapped"], redact: ["redactDiagnostic"] },
  [CONTRACT_CHECK]: { cli: ["isMain", "parseCli"], git: [["git", "gitOrThrow"]] },
  [PACK_REVIEW_DIFF]: { cli: ["isMain", "parseCli"] },
  [REGRESSION_DELTA]: { cli: ["isMain", "parseCli"] },
  [FAILURE_RETRIEVE]: { cli: ["isMain", "parseCli"], "read-capped": ["readCapped"] },
  [FAILURE_CONSOLIDATE]: { cli: ["isMain", "parseCli"], "read-capped": ["readCapped"] },
  [PUBLISH_RELEASE]: { cli: ["isMain", "parseCli"], git: [["git", "gitOrThrow"]], redact: ["redactDiagnostic"] },
  [VALIDATOR_CORE]: { git: [["git", "gitOrThrow"]] },
};

// (2) Each utility's tell-tale text and its one home under cressetide/lib/ (null: eliminated, so no home).
const SIGNATURES = [
  { name: "the entry-point realpath check", pattern: /realpathSync\(process\.argv\[1\]\)/g, home: "cressetide/lib/cli.mjs" },
  { name: "the hand-rolled flag list", pattern: /KNOWN_FLAGS/g, home: null },
  { name: "the per-script entry-point function", pattern: /isInvokedDirectly/g, home: null },
  { name: "a direct git spawn", pattern: /(?:spawnSync|execFileSync)\(\s*["']git["']/g, home: "cressetide/lib/git.mjs" },
  { name: "the private-key redaction regex", pattern: /-----BEGIN \[\^-\\r\\n\]\*PRIVATE KEY-----/g, home: "cressetide/lib/redact.mjs" },
  { name: "the well-formed trust-tag grammar", pattern: /CTIDE:TRUST:\(verified/g, home: "cressetide/lib/map-trust.mjs" },
  // P5: what each of the six old hooks carried its own copy of.
  { name: "the debug switch's on values", pattern: /\(1\|true\|yes\|on\)\$\/i/g, home: "cressetide/lib/debug.mjs" },
  { name: "the ctide-hook.log file name", pattern: /["'`]ctide-hook\.log["'`]/g, home: "cressetide/lib/debug.mjs" },
  { name: "the 5 MiB stdin cap", pattern: /5 \* 1024 \* 1024/g, home: "cressetide/lib/hook-io.mjs" },
  { name: "the quote stripper", pattern: /\/'\[\^'\]\*'\|"\[\^"\]\*"\/g/g, home: "cressetide/lib/guards/shell.mjs" },
  { name: "the dd of= write regex", pattern: /dd\\s\(\?=/g, home: "cressetide/lib/guards/shell.mjs" },
  { name: "the settings-file precedence list", pattern: /\[\s*["']settings\.local\.json["']\s*,\s*["']settings\.json["']\s*\]/g, home: "cressetide/lib/settings.mjs" },
  { name: "the failure-memory entry-heading regex", pattern: /\/\^###\\s/g, home: "cressetide/lib/failure-memory.mjs" },
];

// Until the phase named, these trees keep their own copies and are outside the signature scope.
const NOT_YET_IN_SCOPE = [["cressetide/hooks/orchestration-check.js", "P6"], ["eval/", "P10"]];

// (3) The only product code that may load node:child_process: lib/git.mjs (the one git runner), doctor (runs
// node to probe the hooks), the validator's core (`node --check`), publish-release (gh and the release
// commands) and, until P10 removes it, eval/. No hook under cressetide/hooks/ loads it. Known limits, accepted:
// the detector does not see `createRequire(import.meta.url)("child_process")` or a computed `import(…)` path.
const CHILD_PROCESS_ALLOWED = ["cressetide/lib/git.mjs", DOCTOR, VALIDATOR_CORE, PUBLISH_RELEASE];
const CHILD_PROCESS_ALLOWED_TREES = [["eval/", "P10"]];
const CHILD_PROCESS_LOAD = /(?:\bfrom\s*|\bimport\s*\(?\s*|\brequire\s*\(\s*)(["'`])(?:node:)?child_process\1/g;

// --- reading the repository ---

let cachedFiles = null;
function codeFiles() {
  if (!cachedFiles) {
    cachedFiles = git(root, ["ls-files", "-z", "-co", "--exclude-standard"]).split("\0").filter(Boolean)
      .filter((rel) => /\.(?:mjs|js|cjs)$/.test(rel) && fs.existsSync(path.join(root, rel)));
  }
  return cachedFiles;
}
const readSource = (rel) => fs.readFileSync(path.join(root, rel), "utf8");
const escapeRegExp = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// `source` with every comment replaced by spaces (line breaks kept, so offsets and lines do not move). With
// `blankLiterals`, the contents of every string, every template literal's text and every regular-expression
// literal are blanked the same way — their delimiters, a regular expression's flags and a template's ${}
// expressions stay — leaving only code. A small lexer: a "//" or "/*" inside a literal does not start a
// comment. A "/" starts a regular expression after an operator, an opening bracket, a comma, a semicolon or
// one of the keywords below, and is division otherwise (after a name, a number, ")", "]", or a postfix "++"
// or "--", which ends a value). Known limits, accepted: a "/" after the ")" of `if (…)` / `while (…)` is read as
// division, and an object key (`{ headState: 1 }`) or a parameter that shadows the import counts as a use.
const REGEX_AFTER_WORD = new Set(["return", "typeof", "instanceof", "in", "of", "new", "delete", "void", "throw", "case", "do", "else", "yield", "await"]);
function lex(source, { blankLiterals = false } = {}) {
  let out = "";
  let i = 0;
  let lastCode = "";
  let lastWord = "";
  let braces = 0;
  const templateDepths = [];
  const n = source.length;
  const copyTo = (end) => { out += source.slice(i, end); i = end; };
  const blankTo = (end) => { out += source.slice(i, end).replace(/[^\r\n]/g, " "); i = end; };
  const literalTo = (end) => (blankLiterals ? blankTo(end) : copyTo(end));
  // A template literal's text, from just past its "`" (or a "}" closing one of its ${}) to the closing "`"
  // or the next "${".
  const templateText = () => {
    let j = i;
    while (j < n && source[j] !== "`" && !(source[j] === "$" && source[j + 1] === "{")) j += source[j] === "\\" ? 2 : 1;
    if (j >= n) return literalTo(n);
    literalTo(j);
    if (source[j] === "`") { copyTo(j + 1); lastCode = "`"; lastWord = ""; return; }
    copyTo(j + 2);
    templateDepths.push(braces++);
    lastCode = "{"; lastWord = "";
  };
  while (i < n) {
    const c = source[i];
    const next = source[i + 1];
    if (c === "/" && next === "/") { const end = source.indexOf("\n", i); blankTo(end < 0 ? n : end); continue; }
    if (c === "/" && next === "*") { const end = source.indexOf("*/", i + 2); blankTo(end < 0 ? n : end + 2); continue; }
    if (c === "\"" || c === "'") {
      let j = i + 1;
      while (j < n && source[j] !== c && source[j] !== "\n") j += source[j] === "\\" ? 2 : 1;
      copyTo(i + 1); literalTo(Math.min(j, n)); copyTo(Math.min(j + 1, n));
      lastCode = c; lastWord = ""; continue;
    }
    if (c === "`") { copyTo(i + 1); templateText(); continue; }
    if (c === "}" && templateDepths.length && braces - 1 === templateDepths[templateDepths.length - 1]) {
      templateDepths.pop(); braces--; copyTo(i + 1); templateText(); continue;
    }
    if (c === "/" && (lastCode === "" || "(,=:[!&|?{};+-*%<>~^".includes(lastCode) || REGEX_AFTER_WORD.has(lastWord))) {
      let j = i + 1;
      let inClass = false;
      while (j < n && source[j] !== "\n") {
        if (source[j] === "\\") { j += 2; continue; }
        if (source[j] === "[") inClass = true;
        else if (source[j] === "]") inClass = false;
        else if (source[j] === "/" && !inClass) break;
        j++;
      }
      const close = Math.min(j, n);
      j++;
      while (j < n && /[A-Za-z]/.test(source[j])) j++;
      copyTo(i + 1); literalTo(close); copyTo(Math.min(j, n));
      lastCode = "/"; lastWord = ""; continue;
    }
    if (c === "{") braces++;
    else if (c === "}") braces--;
    if (/[\w$]/.test(c)) lastWord = /[\w$]/.test(source[i - 1] ?? "") ? lastWord + c : c;
    else if (!/\s/.test(c)) lastWord = "";
    // A postfix "++" / "--" ends a value: recorded as ")", so a "/" after it is division.
    if (!/\s/.test(c)) lastCode = (c === "+" || c === "-") && source[i - 1] === c && lastCode === c ? ")" : c;
    copyTo(i + 1);
  }
  return out;
}
const withoutComments = (source) => lex(source);
const codeOnly = (source) => lex(source, { blankLiterals: true });

// Named imports: local name -> { imported, specifier }. Namespace and default imports are not bindings here.
const IMPORT_STATEMENT = /^[ \t]*import\s*\{([^}]*)\}\s*from\s*["']([^"']+)["'][ \t]*;?/gm;
function namedImports(source) {
  const imports = new Map();
  for (const [, list, specifier] of source.matchAll(IMPORT_STATEMENT)) {
    for (const part of list.split(",")) {
      const parsed = /^\s*([A-Za-z_$][\w$]*)(?:\s+as\s+([A-Za-z_$][\w$]*))?\s*$/.exec(part);
      if (parsed) imports.set(parsed[2] || parsed[1], { imported: parsed[1], specifier });
    }
  }
  return imports;
}
function resolvesTo(script, specifier) {
  if (!specifier.startsWith("./") && !specifier.startsWith("../")) return null;
  return path.posix.normalize(path.posix.join(path.posix.dirname(script), specifier));
}

// Why `script` is not bound to lib export `name` of `module`, or null when it is. The imports are read with
// comments blanked out (the specifier is a string); the declaration and the use are looked for in code only,
// with every literal's contents blanked too.
function bindingProblem(script, module, name, source) {
  const libFile = `cressetide/lib/${module}.mjs`;
  const binding = [...namedImports(withoutComments(source))].find(([, { imported, specifier }]) => imported === name && resolvesTo(script, specifier) === libFile);
  if (!binding) return `does not import ${name} from ${libFile}`;
  const local = binding[0];
  const body = codeOnly(source).replace(IMPORT_STATEMENT, "");
  const id = escapeRegExp(local);
  const declared = new RegExp(`(?:^|[^\\w$.])(?:function\\s*\\*?\\s*${id}\\s*\\(|(?:const|let|var|class)\\s+${id}(?![\\w$])|(?:const|let|var)\\s*\\{[^}]*(?<![\\w$])${id}(?![\\w$])[^}]*\\}\\s*=)`, "m");
  if (declared.test(body)) return `imports ${name} from ${libFile} but also declares ${local} itself`;
  if (!new RegExp(`(?<![\\w$.])${id}(?![\\w$])`).test(body)) return `imports ${name} from ${libFile} but never uses it`;
  return null;
}
function requirementProblem(script, module, requirement, source) {
  const alternatives = Array.isArray(requirement) ? requirement : [requirement];
  const problems = alternatives.map((name) => bindingProblem(script, module, name, source));
  return problems.every(Boolean) ? problems.join("; and ") : null;
}

// --- (1) bindings ---

test("the binding table names only exports cressetide/lib actually has", async () => {
  for (const [script, modules] of Object.entries(BINDINGS)) {
    for (const [module, requirements] of Object.entries(modules)) {
      const exports = await import(pathToFileURL(path.join(root, "cressetide", "lib", `${module}.mjs`)).href);
      for (const name of requirements.flat()) assert.ok(name in exports, `${script}: cressetide/lib/${module}.mjs exports ${name}`);
    }
  }
});

for (const [script, modules] of Object.entries(BINDINGS)) {
  test(`binding: ${script} takes every shared utility it uses from cressetide/lib`, () => {
    const source = readSource(script);
    const failures = [];
    for (const [module, requirements] of Object.entries(modules)) {
      for (const requirement of requirements) {
        const problem = requirementProblem(script, module, requirement, source);
        if (problem) failures.push(`${script} ${problem}`);
      }
    }
    assert.deepEqual(failures, []);
  });
}

test("binding: a name that appears only in a comment is not a use, and a commented-out import is not an import", () => {
  const script = "cressetide/skills/demo/scripts/demo.mjs";
  const bound = 'import { headState } from "../../../lib/git.mjs";\nconst state = headState(root);\n';
  assert.equal(bindingProblem(script, "git", "headState", bound), null, "control: imported and called");
  assert.match(bindingProblem(script, "git", "headState", 'import { headState } from "../../../lib/git.mjs";\n// headState(root) is what this calls\nconst url = "https://example.invalid/"; /* headState */ const n = 1; // headState\n')
    ?? "", /never uses it/, "mentioned in comments only");
  assert.match(bindingProblem(script, "git", "headState", '// import { headState } from "../../../lib/git.mjs";\nconst state = headState(root);\n') ?? "",
    /does not import/, "a line-commented import");
  assert.match(bindingProblem(script, "git", "headState", '/*\nimport { headState } from "../../../lib/git.mjs";\n*/\nconst state = headState(root);\n') ?? "",
    /does not import/, "a block-commented import");
  assert.equal(bindingProblem(script, "git", "headState", 'import { headState } from "../../../lib/git.mjs";\nconst re = /\\/\\//; const s = "/* not a comment */"; const t = `${headState(root)} // not one either`;\n'),
    null, "a use after a regex, a string and inside a template literal that hold comment-like text still counts");
});

// P4 review C-9 and the test review's lexer finding: each of these mentions headState only outside code, and
// each read as a use before P5 (a script could keep a local copy and name the lib export this way).
const IMPORTS_HEAD_STATE = 'import { headState } from "../../../lib/git.mjs";\n';
for (const [shape, code] of [
  ["a double-quoted string", 'const label = "headState(root)";\n'],
  ["a single-quoted string", "const label = 'headState';\n"],
  ["a template literal's text", "const label = `headState(root)`;\n"],
  ["a template literal's text beside a ${} expression", "const label = `${root}: headState(root)`;\n"],
  ["a regular-expression literal", "const pattern = /headState\\(/u;\n"],
  ["a comment after a postfix ++ and a division", "let i = 0;\ni++ / 1; // headState(root)\n"],
  ["a comment after a postfix -- and a division", "let i = 1;\ni-- / 1; // headState(root)\n"],
]) {
  test(`binding: a name that appears only in ${shape} is not a use`, () => {
    assert.match(bindingProblem("cressetide/skills/demo/scripts/demo.mjs", "git", "headState", IMPORTS_HEAD_STATE + code) ?? "", /never uses it/);
  });
}

test("binding: code around literals still counts — a ${} expression, a division after a postfix ++, a call after a string", () => {
  const script = "cressetide/skills/demo/scripts/demo.mjs";
  for (const [where, code] of [
    ["a ${} expression", "const label = `state: ${headState(root)}`;\n"],
    ["a ${} expression after template text and a string inside it", "const label = `a ${\"b\" + headState(root)} c`;\n"],
    ["a division after a postfix ++", "let i = 0;\nconst half = i++ / headState(root).length;\n"],
    ["a call after a string and a regular expression", "const s = \"x\"; const re = /y/g; headState(root);\n"],
  ]) {
    assert.equal(bindingProblem(script, "git", "headState", IMPORTS_HEAD_STATE + code), null, where);
  }
  assert.equal(bindingProblem(script, "git", "headState", IMPORTS_HEAD_STATE + 'const note = "function headState() {}"; headState(root);\n'), null,
    "a declaration-shaped string is not a declaration");
});

// --- (2) signatures ---

for (const signature of SIGNATURES) {
  const where = signature.home ? `exactly once under cressetide/lib (${signature.home}) and nowhere else` : "nowhere";
  test(`signature: ${signature.name} appears ${where}`, () => {
    const counts = new Map();
    for (const rel of codeFiles()) {
      if (rel.startsWith("test/") || NOT_YET_IN_SCOPE.some(([prefix]) => rel.startsWith(prefix))) continue;
      const count = (readSource(rel).match(signature.pattern) || []).length;
      if (count) counts.set(rel, count);
    }
    const inLib = [...counts].filter(([rel]) => rel.startsWith("cressetide/lib/"));
    assert.deepEqual(inLib, signature.home ? [[signature.home, 1]] : [], signature.home
      ? "exactly one occurrence under cressetide/lib/, in its home module"
      : "eliminated: no occurrence under cressetide/lib/ either");
    const failures = [];
    for (const [rel, count] of counts) {
      if (rel.startsWith("cressetide/lib/")) continue;
      failures.push(`${rel} carries ${signature.name} ${count}x outside cressetide/lib/${signature.home ? ` — import it from ${signature.home} instead` : ""}`);
    }
    assert.deepEqual(failures, []);
  });
}

// --- (3) child_process ---

// How many times `source` loads node:child_process (or child_process) by an import, a require() or an
// import(), comments not counted.
const childProcessLoads = (source) => (withoutComments(source).match(CHILD_PROCESS_LOAD) || []).length;

test("child_process: every way of loading it is found, with or without the node: prefix; a comment or a plain string is not", () => {
  for (const form of [
    'import cp from "node:child_process";',
    "import { spawnSync } from 'child_process';",
    'import * as cp from "node:child_process";',
    'import cp, { execFileSync } from "child_process";',
    'export { spawnSync } from "node:child_process";',
    'import "node:child_process";',
    'const cp = require("child_process");',
    "const { spawnSync } = require( 'node:child_process' );",
    'const cp = await import("node:child_process");',
    "const cp = await import(`child_process`);",
  ]) {
    assert.equal(childProcessLoads(`${form}\n`), 1, form);
  }
  for (const form of [
    '// import cp from "node:child_process";',
    '/* const cp = require("child_process"); */',
    'const name = "node:child_process";',
    'import fs from "node:fs";',
    'import cp from "node:child_processes";',
  ]) {
    assert.equal(childProcessLoads(`${form}\n`), 0, form);
  }
});

test("child_process: no product code loads it except the allowlist (lib/git, doctor, the validator core, publish-release, eval/ until P10)", () => {
  for (const rel of CHILD_PROCESS_ALLOWED) {
    assert.ok(childProcessLoads(readSource(rel)) >= 1, `allowlisted ${rel} does load it (else drop it from the allowlist)`);
  }
  const failures = [];
  for (const rel of codeFiles()) {
    if (rel.startsWith("test/") || CHILD_PROCESS_ALLOWED.includes(rel) || CHILD_PROCESS_ALLOWED_TREES.some(([prefix]) => rel.startsWith(prefix))) continue;
    const count = childProcessLoads(readSource(rel));
    if (count) failures.push(`${rel} loads child_process ${count}x — run git through cressetide/lib/git.mjs`);
  }
  assert.deepEqual(failures, []);
});
