// Binding test for cressetide/lib/ (acceptance criterion 9): each shared utility exists once, in lib/,
// and each script that uses one is bound to it. No exceptions.
//
//  (1) Single copy, bound: for each of the eight plugin scripts, .github/scripts/publish-release.mjs and the
//      structure validator's core, every lib name it uses is imported by name from the right cressetide/lib/
//      module (the import specifier, resolved from the script's own directory), is used in code, and is not
//      declared locally under that name. Comments do not count: a name that appears only in a comment is
//      not a use (and a commented-out import is not an import).
//  (2) Signatures: the tell-tale text of each utility appears exactly once under cressetide/lib/ — in its
//      module — and nowhere else in the repository's code; the two eliminated constructs (the hand-rolled
//      flag list, the per-script entry-point function) appear nowhere at all. Scope: tracked and
//      untracked-but-not-ignored .mjs/.js/.cjs files outside test/ (test fixtures run git and name these
//      utilities on purpose), and, until the phase that moves them, outside cressetide/hooks/ (P5) and
//      eval/ (P10).
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
  [DOCTOR]: { cli: ["isMain", "parseCli"], "read-capped": ["readCapped"], redact: ["redactDiagnostic"] },
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
];

// Until the phase named, these trees keep their own copies and are outside the signature scope.
const NOT_YET_IN_SCOPE = [["cressetide/hooks/", "P5"], ["eval/", "P10"]];

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

// `source` with every comment replaced by spaces (line breaks kept). A small lexer: string, template-literal
// (with ${} nesting) and regular-expression literals are copied intact, so a "//" or "/*" inside one does
// not start a comment. A "/" starts a regular expression after an operator, an opening bracket, a comma,
// a semicolon or one of the keywords below, and is division otherwise (after a name, a number, ")" or "]").
const REGEX_AFTER_WORD = new Set(["return", "typeof", "instanceof", "in", "of", "new", "delete", "void", "throw", "case", "do", "else", "yield", "await"]);
function withoutComments(source) {
  let out = "";
  let i = 0;
  let lastCode = "";
  let lastWord = "";
  let braces = 0;
  const templateDepths = [];
  const n = source.length;
  const copyTo = (end) => { out += source.slice(i, end); i = end; };
  const blankTo = (end) => { out += source.slice(i, end).replace(/[^\r\n]/g, " "); i = end; };
  // A template literal's text, from just past its "`" (or a "}" closing one of its ${}) to the closing "`"
  // or the next "${".
  const templateText = () => {
    let j = i;
    while (j < n && source[j] !== "`" && !(source[j] === "$" && source[j + 1] === "{")) j += source[j] === "\\" ? 2 : 1;
    if (j >= n) return copyTo(n);
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
      copyTo(Math.min(j + 1, n)); lastCode = c; lastWord = ""; continue;
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
      j++;
      while (j < n && /[A-Za-z]/.test(source[j])) j++;
      copyTo(Math.min(j, n)); lastCode = "/"; lastWord = ""; continue;
    }
    if (c === "{") braces++;
    else if (c === "}") braces--;
    if (/[\w$]/.test(c)) lastWord = /[\w$]/.test(source[i - 1] ?? "") ? lastWord + c : c;
    else if (!/\s/.test(c)) lastWord = "";
    if (!/\s/.test(c)) lastCode = c;
    copyTo(i + 1);
  }
  return out;
}

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

// Why `script` is not bound to lib export `name` of `module`, or null when it is. Everything is read with
// comments blanked out.
function bindingProblem(script, module, name, source) {
  const libFile = `cressetide/lib/${module}.mjs`;
  const code = withoutComments(source);
  const binding = [...namedImports(code)].find(([, { imported, specifier }]) => imported === name && resolvesTo(script, specifier) === libFile);
  if (!binding) return `does not import ${name} from ${libFile}`;
  const local = binding[0];
  const body = code.replace(IMPORT_STATEMENT, "");
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
