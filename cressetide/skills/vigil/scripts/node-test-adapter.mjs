// The node-test-v1 executable adapter component.
//
// SCOPE: this is the executable component behind ONE implementationId, and nothing else. It
// analyses a module the caller has ALREADY captured into an immutable content view and reports
// declarations, their structuralId, their attached tag, their canonical declaration bytes and their
// effective-oracle dependency closure. It does not enumerate a worktree, read the live filesystem,
// run adapter discovery or selection, build a ChangedTestInventory, compute or accept a populated
// inventory, touch the provenance store, or lift the unsupported-populated-inventory gate. A green
// run of this file does not mean the producer, the consumer freshness recomputation, AC136, AC137,
// AC138, a populated inventory or Phase 2 is ready.
//
// AUTHORITY: approved test-provenance v1.8 (section 2 tag grammar, 11b.2-11b.9f, 11b.11-11b.12) and
// approved intent-scan v1.10 section 8 for the canonical ULID grammar. The parser comes from
// parseModuleSource() in the vendored-dependency wrapper -- the vendored Acorn is never imported
// here, no parser is added, and no construct below is recognised by regex standing in for an AST.
// The lexical rules that ARE line-oriented (the directive-intent predicate and the exact @src/@tid
// forms) are line-oriented because 11b.8c defines them on physical lines, not as a shortcut around
// the tree.
//
// FAIL-CLOSED: every path that cannot be classified under the closed v1 profile throws. Silence is
// never an answer here: an unclassified call, an unattached directive or an unresolvable helper
// makes the whole module fail, because a missing oracle edge is exactly the failure this model
// exists to prevent.
import crypto from "node:crypto";

import { parseModuleSource } from "./parser-ignore-wrapper.mjs";
import { canonicalJson, compareCodePoint } from "./provenance-store.mjs";

export class NodeTestAdapterError extends Error {
  constructor(code, message, detail) {
    super(message);
    this.name = "NodeTestAdapterError";
    this.code = code;
    if (detail !== undefined) this.detail = detail;
  }
}

const fail = (code, message, detail) => new NodeTestAdapterError(code, message, detail);

export const NODE_TEST_V1_IMPLEMENTATION_ID = "node-test-v1";

// --- closed vocabulary --------------------------------------------------------------------------

// 11b.6: exactly these seventeen names, written out rather than elided. A name Node adds in a later
// release is unsupported until this list is amended under its own authority.
const ASSERTION_NAMES = new Set([
  "ok", "equal", "notEqual",
  "strictEqual", "notStrictEqual", "deepEqual",
  "notDeepEqual", "deepStrictEqual", "notDeepStrictEqual",
  "throws", "doesNotThrow", "rejects",
  "doesNotReject", "match", "doesNotMatch",
  "fail", "ifError",
]);

const TEST_SPECIFIER = "node:test";
const ASSERT_SPECIFIERS = new Set(["node:assert", "node:assert/strict"]);
// 11b.9 snapshot-golden: readFileSync comes from node:fs only; readFile from either specifier.
const FS_API = {
  "node:fs": new Set(["readFileSync", "readFile"]),
  "node:fs/promises": new Set(["readFile"]),
};
const HOOK_NAMES = new Set(["before", "after", "beforeEach", "afterEach"]);
const MODIFIERS = new Set(["only", "skip", "todo"]);

// intent-scan approved v1.10 section 8. Twenty-six ASCII bytes, Crockford uppercase, first byte
// 0-7 because 26 x 5 = 130 bits carry a 128-bit value. Referenced, never redefined: this build
// implements the upstream grammar and does not case-fold, trim or repair a near miss.
const ULID = "[0-7][0-9A-HJKMNP-TV-Z]{25}";
const CLAUSE_REF = new RegExp(`^(REQ|DEC|ASSUM)-(${ULID})$`);
const DP_REF = new RegExp(`^DP-(${ULID})$`);
// 11b.7 stable-ID grammar. Unrelated to ULID, and deliberately not validated against it.
const TID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

const SRC_PREFIX = "// @src ";
const TID_PREFIX = "// @tid ";

// --- canonical paths ----------------------------------------------------------------------------

// depRef.path and every view key: repo-relative, "/" separated, no dot segment, no drive prefix,
// case taken verbatim. Windows and Linux only agree if nothing here is normalised by the OS.
function requireCanonicalPath(value, what) {
  if (typeof value !== "string" || value === "") throw fail("E_PATH", `${what} must be a non-empty string`);
  if (value.includes("\\")) throw fail("E_PATH", `${what} must use POSIX separators: ${value}`);
  if (/^[A-Za-z]:/.test(value)) throw fail("E_PATH", `${what} must not carry a drive prefix: ${value}`);
  if (value.startsWith("/")) throw fail("E_PATH", `${what} must be repository-relative: ${value}`);
  if (value.endsWith("/")) throw fail("E_PATH", `${what} must not end with a separator: ${value}`);
  for (const segment of value.split("/")) {
    if (segment === "") throw fail("E_PATH", `${what} contains an empty segment: ${value}`);
    if (segment === "." || segment === "..") throw fail("E_PATH", `${what} contains a ${segment} segment: ${value}`);
  }
  return value;
}

const dirnameOf = (p) => {
  const cut = p.lastIndexOf("/");
  return cut < 0 ? "" : p.slice(0, cut);
};

// 11b.9f "Relative specifier lexical normalization", the one algorithm: POSIX text, no URL parsing,
// no percent decoding, "%" rejected outright so one string cannot have two readings, empty segments
// rejected, "." and ".." resolved on a segment stack, and any pop past the repo root fatal.
//
// It is also the only algorithm this document gives for turning a relative literal into a canonical
// repo-relative path, so the snapshot-golden path argument goes through it too. That is an applied
// reading, not a rule invented here, and it is the strictly fail-closed side: every specifier this
// accepts, a WHATWG-URL reading accepts identically, and the two only differ where this one refuses.
function resolveRelativeLexically(fromDir, specifier, what) {
  if (typeof specifier !== "string" || specifier === "") throw fail("E_SPECIFIER", `${what} must be a non-empty string`);
  if (specifier.includes("%")) throw fail("E_SPECIFIER", `${what} contains "%", which has two readings and is unsupported: ${specifier}`);
  if (specifier.includes("\\")) throw fail("E_SPECIFIER", `${what} contains a backslash: ${specifier}`);
  if (specifier.includes("?") || specifier.includes("#")) throw fail("E_SPECIFIER", `${what} carries a query or fragment: ${specifier}`);
  if (specifier.startsWith("/")) throw fail("E_SPECIFIER", `${what} is absolute: ${specifier}`);

  const stack = fromDir === "" ? [] : fromDir.split("/");
  const parts = specifier.split("/");
  for (let i = 0; i < parts.length; i += 1) {
    const segment = parts[i];
    if (segment === "") throw fail("E_SPECIFIER", `${what} contains an empty segment: ${specifier}`);
    if (segment === ".") continue;
    if (segment === "..") {
      if (stack.length === 0) throw fail("E_SPECIFIER", `${what} escapes the repository root: ${specifier}`);
      stack.pop();
      continue;
    }
    stack.push(segment);
  }
  if (stack.length === 0) throw fail("E_SPECIFIER", `${what} does not name a file: ${specifier}`);
  return requireCanonicalPath(stack.join("/"), what);
}

// --- content view -------------------------------------------------------------------------------

// The immutable view the caller captured. Bytes are copied in once, so a caller that mutates its
// own buffer afterwards changes nothing here, and nothing below ever touches the live filesystem.
export function createContentView(entries) {
  if (arguments.length > 1) throw fail("E_API_ARGUMENTS", "createContentView takes exactly one argument");
  const source = entries instanceof Map ? entries.entries()
    : Array.isArray(entries) ? entries
      : entries !== null && typeof entries === "object" ? Object.entries(entries)
        : null;
  if (source === null) throw fail("E_VIEW_INPUT", "createContentView expects a Map, an array of [path, bytes] pairs, or a plain object");

  const files = new Map();
  for (const pair of source) {
    if (!Array.isArray(pair) || pair.length !== 2) throw fail("E_VIEW_INPUT", "each view entry must be a [path, bytes] pair");
    const [path, bytes] = pair;
    requireCanonicalPath(path, "view entry path");
    if (!(bytes instanceof Uint8Array)) throw fail("E_VIEW_INPUT", `view entry ${path} must carry Buffer or Uint8Array bytes`);
    if (files.has(path)) throw fail("E_VIEW_INPUT", `duplicate view entry: ${path}`);
    files.set(path, Buffer.from(bytes));
  }
  return Object.freeze({
    size: files.size,
    has: (path) => files.has(path),
    // A copy per read: a caller cannot reach into the view and edit what the next read returns.
    read: (path) => {
      const found = files.get(path);
      if (found === undefined) throw fail("E_MODULE_MISSING", `the captured view holds no blob at ${path}`);
      return Buffer.from(found);
    },
    paths: () => Object.freeze([...files.keys()].sort(compareCodePoint)),
  });
}

function requireView(view, what) {
  if (view === null || typeof view !== "object" || typeof view.has !== "function" || typeof view.read !== "function") {
    throw fail("E_VIEW_INPUT", `${what} must be a view built by createContentView`);
  }
  return view;
}

// --- module format ------------------------------------------------------------------------------

// 11b.9f package boundary. The search starts at the directory of the module in question -- not the
// importer's, not the test's -- walks up inside the SAME captured view, and takes the first
// manifest it finds. A nearer manifest overrides the root one; anything less than a parseable
// object with type exactly "module" makes the .js unsupported.
function requireEsm(view, path, what) {
  if (path.endsWith(".mjs")) return "mjs";
  if (!path.endsWith(".js")) throw fail("E_MODULE_FORMAT", `${what} ${path} is neither .mjs nor .js; this profile is ESM only`);

  let dir = dirnameOf(path);
  for (;;) {
    const manifestPath = dir === "" ? "package.json" : `${dir}/package.json`;
    if (view.has(manifestPath)) {
      let manifest;
      try { manifest = JSON.parse(view.read(manifestPath).toString("utf8")); } catch (e) {
        throw fail("E_PACKAGE_BOUNDARY", `${manifestPath} is not valid JSON, so ${path} cannot be shown to be ESM: ${e.message}`);
      }
      if (manifest === null || typeof manifest !== "object" || Array.isArray(manifest)) {
        throw fail("E_PACKAGE_BOUNDARY", `${manifestPath} root is not an object, so ${path} cannot be shown to be ESM`);
      }
      if (typeof manifest.type !== "string") {
        throw fail("E_PACKAGE_BOUNDARY", `${manifestPath} declares no string "type", so ${path} cannot be shown to be ESM`);
      }
      if (manifest.type !== "module") {
        throw fail("E_PACKAGE_BOUNDARY", `${manifestPath} declares type ${JSON.stringify(manifest.type)}, so ${path} is CommonJS and unsupported`);
      }
      return manifestPath;
    }
    if (dir === "") throw fail("E_PACKAGE_BOUNDARY", `no ancestor package.json in the captured view can show ${path} is ESM`);
    dir = dirnameOf(dir);
  }
}

// --- physical lines -----------------------------------------------------------------------------

// 11b.8b step 0 has already happened inside the wrapper: the bytes below are UTF-8 without BOM and
// LF only, so every range, line number and span here is defined on the normalised bytes.
function indexLines(normalized) {
  const starts = [0];
  for (let i = 0; i < normalized.length; i += 1) if (normalized[i] === 0x0a) starts.push(i + 1);
  const lines = starts.map((start, i) => {
    const nextStart = i + 1 < starts.length ? starts[i + 1] : normalized.length + 1;
    const end = Math.min(nextStart - 1, normalized.length);
    return { start, end, text: normalized.toString("utf8", start, end) };
  });
  return lines;
}

function lineIndexAt(lines, byteOffset) {
  let low = 0;
  let high = lines.length - 1;
  while (low < high) {
    const mid = (low + high + 1) >> 1;
    if (lines[mid].start <= byteOffset) low = mid; else high = mid - 1;
  }
  return low;
}

// --- directive lexing ---------------------------------------------------------------------------

// 11b.8c directive-intent predicate, step for step. Indentation is stripped, "//" must come next,
// the payload's own leading blanks are stripped FOR THE INTENT TEST ONLY, and a payload that then
// begins with @src or @tid is a candidate. The trimmed text is never what gets accepted.
function directiveIntent(text) {
  let i = 0;
  while (i < text.length && (text[i] === " " || text[i] === "\t")) i += 1;
  if (text.charCodeAt(i) !== 0x2f || text.charCodeAt(i + 1) !== 0x2f) return null;
  let payload = text.slice(i + 2);
  let j = 0;
  while (j < payload.length && (payload[j] === " " || payload[j] === "\t")) j += 1;
  const rest = payload.slice(j);
  if (rest.startsWith("@src")) return "src";
  if (rest.startsWith("@tid")) return "tid";
  return null;
}

// Section 2 canonical tag grammar. EXPL carries no ULID; a clauseRef may carry exactly one DP
// qualifier, and DEC/ASSUM may never carry one -- that rejection is structural and needs no store.
// Whether a REQ is genuinely exception-backed is the pipeline's call against captured store
// pre-state, and this layer neither answers nor pre-empts it.
function parseTagToken(token, where) {
  if (token === "EXPL") return { expl: true };
  const at = token.indexOf("@");
  const left = at < 0 ? token : token.slice(0, at);
  const right = at < 0 ? null : token.slice(at + 1);
  if (right !== null && right.includes("@")) {
    throw fail("E_DIRECTIVE_MALFORMED", `${where}: tag token carries more than one qualifier: ${token}`);
  }
  const clause = CLAUSE_REF.exec(left);
  if (clause === null) {
    throw fail("E_DIRECTIVE_MALFORMED", `${where}: ${JSON.stringify(left)} is not REQ-/DEC-/ASSUM- followed by a canonical ULID`);
  }
  if (right === null) return { clauseRef: left };
  if (clause[1] !== "REQ") {
    throw fail("E_DIRECTIVE_MALFORMED", `${where}: ${clause[1]} may never carry a @DP qualifier: ${token}`);
  }
  if (DP_REF.exec(right) === null) {
    throw fail("E_DIRECTIVE_MALFORMED", `${where}: ${JSON.stringify(right)} is not DP- followed by a canonical ULID`);
  }
  return { clauseRef: left, dpRef: right };
}

// The exact lexical form: indentation, then "//", one U+0020, the keyword, one U+0020, then the
// token and nothing else. Everything after the fixed prefix is the token, so a trailing space or a
// second comment simply is not a token and is rejected by the grammar rather than by a scan.
function parseDirectiveLine(text, kind, where) {
  let i = 0;
  while (i < text.length && (text[i] === " " || text[i] === "\t")) i += 1;
  const body = text.slice(i);
  const prefix = kind === "src" ? SRC_PREFIX : TID_PREFIX;
  if (!body.startsWith(prefix)) {
    throw fail("E_DIRECTIVE_MALFORMED", `${where}: @${kind} must be written exactly ${JSON.stringify(prefix.trimStart())} with one space at each separator`);
  }
  const token = body.slice(prefix.length);
  if (kind === "tid") {
    if (!TID.test(token)) throw fail("E_DIRECTIVE_MALFORMED", `${where}: ${JSON.stringify(token)} is not a legal @tid ID or the line carries extra content`);
    return { kind, id: token };
  }
  return { kind, tag: parseTagToken(token, where) };
}

// --- scopes -------------------------------------------------------------------------------------

const FUNCTIONS = new Set(["FunctionDeclaration", "FunctionExpression", "ArrowFunctionExpression"]);
const CLASSES = new Set(["ClassDeclaration", "ClassExpression"]);

function patternNames(node, out) {
  if (node === null || typeof node !== "object") return out;
  switch (node.type) {
    case "Identifier": out.push(node); break;
    case "ObjectPattern": for (const p of node.properties) patternNames(p.type === "Property" ? p.value : p.argument, out); break;
    case "ArrayPattern": for (const e of node.elements) patternNames(e, out); break;
    case "AssignmentPattern": patternNames(node.left, out); break;
    case "RestElement": patternNames(node.argument, out); break;
    default: break;
  }
  return out;
}

class Scope {
  constructor(parent, functionLike) {
    this.parent = parent;
    this.functionLike = functionLike;
    this.names = new Map();
  }
  declare(name, descriptor) {
    const list = this.names.get(name);
    if (list === undefined) this.names.set(name, [descriptor]); else list.push(descriptor);
  }
  functionScope() {
    let scope = this;
    while (!scope.functionLike && scope.parent !== null) scope = scope.parent;
    return scope;
  }
  lookup(name) {
    for (let scope = this; scope !== null; scope = scope.parent) {
      const found = scope.names.get(name);
      if (found !== undefined) return { scope, declarations: found };
    }
    return null;
  }
}

const CHILD_SKIP = new Set(["type", "start", "end", "range", "loc", "nodeId", "byteStart", "byteEnd"]);

function children(node) {
  const out = [];
  for (const key of Object.keys(node)) {
    if (CHILD_SKIP.has(key)) continue;
    const value = node[key];
    if (Array.isArray(value)) {
      for (const item of value) if (item !== null && typeof item === "object" && typeof item.type === "string") out.push(item);
    } else if (value !== null && typeof value === "object" && typeof value.type === "string") {
      out.push(value);
    }
  }
  return out;
}

// One pre-pass builds parent links and the lexical scope every node sits in. Import bindings are
// module scoped, so a name shadowed anywhere below resolves to the shadow and never to the import.
function buildScopes(program, bindings) {
  const parentOf = new Map();
  const scopeOf = new Map();
  const moduleScope = new Scope(null, true);
  for (const [name, info] of bindings) moduleScope.declare(name, { kind: "import", info });

  const declareVariable = (declaration, scope) => {
    const target = declaration.kind === "var" ? scope.functionScope() : scope;
    for (const d of declaration.declarations) {
      for (const id of patternNames(d.id, [])) {
        const simple = d.id.type === "Identifier";
        target.declare(id.name, { kind: declaration.kind === "const" && simple ? "const" : "other", init: simple ? d.init : null, node: d });
      }
    }
  };

  const visit = (node, parent, scope) => {
    parentOf.set(node, parent);
    let inner = scope;
    if (FUNCTIONS.has(node.type)) {
      inner = new Scope(scope, true);
      for (const param of node.params) for (const id of patternNames(param, [])) inner.declare(id.name, { kind: "param", node: param });
    } else if (node.type === "BlockStatement" && (parent === null || !FUNCTIONS.has(parent.type))) {
      inner = new Scope(scope, false);
    } else if (node.type === "ForStatement" || node.type === "ForOfStatement" || node.type === "ForInStatement" || node.type === "CatchClause") {
      inner = new Scope(scope, false);
      if (node.type === "CatchClause" && node.param !== null && node.param !== undefined) {
        for (const id of patternNames(node.param, [])) inner.declare(id.name, { kind: "param", node: node.param });
      }
    } else if (CLASSES.has(node.type)) {
      inner = new Scope(scope, false);
    }
    scopeOf.set(node, inner);

    // Hoist what the body declares before descending, so a call written above its helper still
    // resolves: an ECMAScript function declaration is visible across its whole scope. Only the
    // scope-carrying node hoists -- a function's own body block does not open a second scope, so
    // its declarations land in the function scope exactly once.
    const body = node.type === "Program" || node.type === "BlockStatement" ? node.body : null;
    if (body !== null) {
      const target = inner;
      for (const statement of body) {
        if (statement.type === "FunctionDeclaration" && statement.id !== null) target.declare(statement.id.name, { kind: "function", node: statement });
        else if (statement.type === "ClassDeclaration" && statement.id !== null) target.declare(statement.id.name, { kind: "class", node: statement });
        else if (statement.type === "VariableDeclaration") declareVariable(statement, target);
        else if (statement.type === "ExportNamedDeclaration" && statement.declaration !== null && statement.declaration !== undefined) {
          const inner2 = statement.declaration;
          if (inner2.type === "FunctionDeclaration" && inner2.id !== null) target.declare(inner2.id.name, { kind: "function", node: inner2 });
          else if (inner2.type === "ClassDeclaration" && inner2.id !== null) target.declare(inner2.id.name, { kind: "class", node: inner2 });
          else if (inner2.type === "VariableDeclaration") declareVariable(inner2, target);
        } else if (statement.type === "ExportDefaultDeclaration") {
          const inner2 = statement.declaration;
          if (inner2.type === "FunctionDeclaration" && inner2.id !== null) target.declare(inner2.id.name, { kind: "function", node: inner2 });
        }
      }
    }
    if (node.type === "ForStatement" && node.init !== null && node.init !== undefined && node.init.type === "VariableDeclaration") declareVariable(node.init, inner);
    if ((node.type === "ForOfStatement" || node.type === "ForInStatement") && node.left.type === "VariableDeclaration") declareVariable(node.left, inner);

    for (const child of children(node)) visit(child, node, inner);
  };
  visit(program, null, moduleScope);
  return { parentOf, scopeOf, moduleScope };
}

// 11b.9f puts any binding that is reassigned outside the callable subset, and a declaration alone
// does not show that: `function helper() {}` followed by `helper = other` still declares a
// function. This marks every binding an assignment or update targets, so the callable resolver can
// refuse one whose meaning is not fixed by its declaration.
function markReassignments(scopeOf, program) {
  const mark = (node, name) => {
    const scope = scopeOf.get(node);
    if (scope === undefined) return;
    const found = scope.lookup(name);
    if (found === null) return;
    for (const declaration of found.declarations) declaration.reassigned = true;
  };
  const targets = (node) => {
    for (const id of patternNames(node, [])) mark(id, id.name);
  };
  const walk = (node) => {
    if (node.type === "AssignmentExpression") targets(node.left);
    if (node.type === "UpdateExpression" && node.argument.type === "Identifier") mark(node.argument, node.argument.name);
    if ((node.type === "ForOfStatement" || node.type === "ForInStatement") && node.left.type !== "VariableDeclaration") targets(node.left);
    for (const child of children(node)) walk(child);
  };
  walk(program);
}

// --- import bindings ----------------------------------------------------------------------------

// 11b.6 legal imports, read from the binding rather than from the written name, so `test as it`
// is still the test binding and a local named `test` from anywhere else is not.
function collectBindings(program, modulePath) {
  const bindings = new Map();
  const declare = (local, descriptor) => {
    if (bindings.has(local)) throw fail("E_UNSUPPORTED_IMPORT", `${modulePath}: ${JSON.stringify(local)} is imported more than once, so the binding is ambiguous`);
    bindings.set(local, descriptor);
  };

  for (const statement of program.body) {
    if (statement.type !== "ImportDeclaration") continue;
    const specifier = statement.source.value;
    if (statement.attributes !== undefined && statement.attributes !== null && statement.attributes.length > 0) {
      throw fail("E_UNSUPPORTED_IMPORT", `${modulePath}: import attributes are unsupported in this profile`);
    }
    const relative = specifier.startsWith("./") || specifier.startsWith("../");
    if (!relative && specifier !== TEST_SPECIFIER && !ASSERT_SPECIFIERS.has(specifier) && !Object.prototype.hasOwnProperty.call(FS_API, specifier)) {
      // The profile is a chosen subset. A bare "test", another assertion library and any other
      // package alike are unsupported here; unlisted syntax is fail-closed, not tolerated.
      throw fail("E_UNSUPPORTED_IMPORT", `${modulePath}: specifier ${JSON.stringify(specifier)} is outside the node-test-v1 profile`);
    }
    // A relative import must name a helper module outright: 11b.9f allows only an explicit .mjs or
    // .js, and external-expected-data was removed as an edge kind, so a static .json import is an
    // unsupported edge rather than data that gets read quietly. The check lands here, at the
    // binding, so an unsupported import fails whether or not anything calls it.
    if (relative && !/\.(mjs|js)$/.test(specifier)) {
      throw fail("E_UNSUPPORTED_IMPORT", `${modulePath}: relative specifier ${JSON.stringify(specifier)} must name a .mjs or .js module; extension probing, directory index resolution and data imports are unsupported`);
    }

    for (const s of statement.specifiers) {
      const local = s.local.name;
      if (specifier === TEST_SPECIFIER) {
        if (s.type === "ImportDefaultSpecifier") { declare(local, { kind: "test", role: "test" }); continue; }
        if (s.type !== "ImportSpecifier" || s.imported.type !== "Identifier") {
          throw fail("E_UNSUPPORTED_IMPORT", `${modulePath}: only default and named imports of ${TEST_SPECIFIER} are supported`);
        }
        const imported = s.imported.name;
        if (imported === "test") declare(local, { kind: "test", role: "test" });
        else if (imported === "describe") declare(local, { kind: "test", role: "describe" });
        else if (HOOK_NAMES.has(imported)) declare(local, { kind: "test", role: "hook", hook: imported });
        else throw fail("E_UNSUPPORTED_IMPORT", `${modulePath}: ${TEST_SPECIFIER} export ${JSON.stringify(imported)} is outside the profile`);
        continue;
      }
      if (ASSERT_SPECIFIERS.has(specifier)) {
        if (s.type === "ImportDefaultSpecifier") { declare(local, { kind: "assert", form: "object", directlyCallable: true, specifier }); continue; }
        if (s.type === "ImportNamespaceSpecifier") { declare(local, { kind: "assert", form: "object", directlyCallable: false, specifier }); continue; }
        if (s.imported.type !== "Identifier") throw fail("E_UNSUPPORTED_IMPORT", `${modulePath}: string-named imports are unsupported`);
        if (s.imported.name === "strict") declare(local, { kind: "assert", form: "object", directlyCallable: false, specifier });
        else declare(local, { kind: "assert", form: "function", imported: s.imported.name, specifier });
        continue;
      }
      if (Object.prototype.hasOwnProperty.call(FS_API, specifier)) {
        if (s.type === "ImportDefaultSpecifier" || s.type === "ImportNamespaceSpecifier") { declare(local, { kind: "fs", form: "object", specifier }); continue; }
        if (s.imported.type !== "Identifier") throw fail("E_UNSUPPORTED_IMPORT", `${modulePath}: string-named imports are unsupported`);
        declare(local, { kind: "fs", form: "function", imported: s.imported.name, specifier });
        continue;
      }
      // Relative helper module. 11b.9f supports named (with alias) and default imports only.
      if (s.type === "ImportNamespaceSpecifier") { declare(local, { kind: "helper-unsupported", reason: "namespace import", specifier }); continue; }
      if (s.type === "ImportDefaultSpecifier") { declare(local, { kind: "helper", specifier, imported: "default" }); continue; }
      if (s.imported.type !== "Identifier") { declare(local, { kind: "helper-unsupported", reason: "string-named import", specifier }); continue; }
      declare(local, { kind: "helper", specifier, imported: s.imported.name });
    }
  }
  return bindings;
}

// --- module parsing and caching -------------------------------------------------------------------

async function loadModule(session, path, what) {
  const cached = session.modules.get(path);
  if (cached !== undefined) return cached;
  requireCanonicalPath(path, what);
  if (!session.view.has(path)) throw fail("E_MODULE_MISSING", `${what} ${path} is not in the captured view`);
  const manifestPath = requireEsm(session.view, path, what);

  const parsed = await parseModuleSource(session.view.read(path));
  const normalized = parsed.normalizedSourceBytes;
  const lines = indexLines(normalized);
  const bindings = collectBindings(parsed.ast, path);
  const { parentOf, scopeOf, moduleScope } = buildScopes(parsed.ast, bindings);
  markReassignments(scopeOf, parsed.ast);
  const module = { path, manifestPath, ast: parsed.ast, normalized, lines, bindings, parentOf, scopeOf, moduleScope, identity: parsed.identity };
  session.modules.set(path, module);
  return module;
}

// Resolves an identifier through the lexical scope chain. More than one declaration in the winning
// scope is ambiguous, and ambiguity is fatal rather than resolved by a tie-break.
function resolveIdentifier(module, node, name, what) {
  const scope = module.scopeOf.get(node);
  if (scope === undefined) throw fail("E_ORACLE_BINDING", `${module.path}: ${what} is not inside any known scope`);
  const found = scope.lookup(name);
  if (found === null) return null;
  if (found.declarations.length !== 1) {
    throw fail("E_ORACLE_BINDING", `${module.path}: ${JSON.stringify(name)} has ${found.declarations.length} declarations in one scope, so the binding is ambiguous`);
  }
  return found.declarations[0];
}

function importInfo(module, node, name) {
  const declaration = resolveIdentifier(module, node, name, `reference to ${JSON.stringify(name)}`);
  return declaration !== null && declaration.kind === "import" ? declaration.info : null;
}

// --- declaration recognition ----------------------------------------------------------------------

// 11b.6b callback profile, applied identically to test, container and hook callbacks.
function requireCallback(module, node, where) {
  if (!FUNCTIONS.has(node.type) || node.type === "FunctionDeclaration") {
    throw fail("E_ARGUMENTS", `${module.path}:${where}: the callback must be a function or arrow expression`);
  }
  if (node.body.type !== "BlockStatement") {
    throw fail("E_ARGUMENTS", `${module.path}:${where}: a concise arrow expression body is unsupported`);
  }
  if (node.generator === true) throw fail("E_ARGUMENTS", `${module.path}:${where}: a generator callback is unsupported`);
  for (const param of node.params) {
    if (param.type !== "Identifier") throw fail("E_ARGUMENTS", `${module.path}:${where}: default, rest and destructuring parameters are unsupported`);
  }
  return node;
}

function requireLiteralName(module, node, where) {
  if (node === undefined) throw fail("E_ARGUMENTS", `${module.path}:${where}: the declaration name argument is missing`);
  if (node.type === "Literal" && typeof node.value === "string") return node.value;
  if (node.type === "TemplateLiteral" && node.expressions.length === 0 && node.quasis.length === 1) {
    const cooked = node.quasis[0].value.cooked;
    if (typeof cooked !== "string") throw fail("E_ARGUMENTS", `${module.path}:${where}: the template literal has no cooked value`);
    return cooked;
  }
  throw fail("E_ARGUMENTS", `${module.path}:${where}: the first argument must be a string literal or an uninterpolated template literal`);
}

function noSpread(module, call, where) {
  for (const argument of call.arguments) {
    if (argument.type === "SpreadElement") throw fail("E_ARGUMENTS", `${module.path}:${where}: a spread argument is unsupported`);
  }
}

// Which node:test binding, if any, a call targets -- directly or through exactly one legal
// modifier member. Anything else on a node:test binding is unsupported rather than ignored.
function testCallTarget(module, call) {
  const callee = call.callee;
  if (callee.type === "Identifier") {
    const info = importInfo(module, callee, callee.name);
    return info !== null && info.kind === "test" ? { info, modifier: null, identifier: callee } : null;
  }
  if (callee.type === "MemberExpression" && callee.object.type === "Identifier") {
    const info = importInfo(module, callee.object, callee.object.name);
    if (info === null || info.kind !== "test") return null;
    if (callee.computed === true || callee.property.type !== "Identifier") {
      throw fail("E_UNSUPPORTED_SYNTAX", `${module.path}: a computed member on a ${TEST_SPECIFIER} binding is unsupported`);
    }
    return { info, modifier: callee.property.name, identifier: callee.object };
  }
  return null;
}

function recogniseDeclaration(module, call, where) {
  const target = testCallTarget(module, call);
  if (target === null) return null;
  const { info, modifier } = target;
  if (modifier !== null) {
    if (info.role === "hook") throw fail("E_UNSUPPORTED_SYNTAX", `${module.path}:${where}: hooks take no modifier`);
    if (!MODIFIERS.has(modifier)) throw fail("E_UNSUPPORTED_SYNTAX", `${module.path}:${where}: ${JSON.stringify(modifier)} is not one of only/skip/todo`);
  }
  noSpread(module, call, where);
  if (info.role === "hook") {
    if (call.arguments.length !== 1) throw fail("E_ARGUMENTS", `${module.path}:${where}: a hook takes exactly one argument, got ${call.arguments.length}`);
    return { role: "hook", hook: info.hook, callback: requireCallback(module, call.arguments[0], where), call, modifier };
  }
  if (call.arguments.length !== 2) {
    throw fail("E_ARGUMENTS", `${module.path}:${where}: a ${info.role} declaration takes exactly two arguments, got ${call.arguments.length}`);
  }
  return {
    role: info.role,
    name: requireLiteralName(module, call.arguments[0], where),
    callback: requireCallback(module, call.arguments[1], where),
    call,
    modifier,
  };
}

// 11b.6b placement. Declarations are gathered top-down from Program.body and from recognised
// container callbacks only; a node:test call the top-down walk never reaches is a placement
// violation, never a call that is quietly skipped.
function collectDeclarations(module) {
  const reachedCalls = new Set();
  const declarations = [];
  const containers = [];
  const hooks = [];

  const walkBody = (statements, chain, containerNode) => {
    for (const statement of statements) {
      if (statement.type !== "ExpressionStatement") continue;
      const call = statement.expression;
      if (call.type !== "CallExpression") continue;
      const line = lineIndexAt(module.lines, statement.byteStart) + 1;
      const recognised = recogniseDeclaration(module, call, line);
      if (recognised === null) continue;
      reachedCalls.add(call);
      const record = { ...recognised, statement, chain, container: containerNode, line };
      if (recognised.role === "test") declarations.push(record);
      else if (recognised.role === "hook") hooks.push(record);
      else {
        containers.push(record);
        walkBody(recognised.callback.body.body, [...chain, recognised.name], record);
      }
    }
  };
  walkBody(module.ast.body, [], null);

  // Second sweep: every call anywhere in the tree that targets a node:test binding must be one of
  // the calls the structured walk already accepted.
  const sweep = (node) => {
    if (node.type === "CallExpression" && !reachedCalls.has(node)) {
      if (testCallTarget(module, node) !== null) {
        throw fail("E_PLACEMENT", `${module.path}:${lineIndexAt(module.lines, node.byteStart) + 1}: a ${TEST_SPECIFIER} declaration must be a top-level ExpressionStatement or a direct element of a container callback body`);
      }
    }
    for (const child of children(node)) sweep(child);
  };
  sweep(module.ast);

  return { declarations, containers, hooks };
}

// A node:test, node:assert or node:fs binding may only stand where the profile puts it: as a call
// target, directly or through one non-computed member. Any other reference -- an alias, an
// argument, a reassignment -- is a way to smuggle a declaration or an assertion past the analysis,
// so it is unsupported rather than ignored. The test is purely positional, so an assertion inside a
// helper nobody calls is still legal syntax; whether it counts as an oracle edge is decided later.
function auditCapabilityReferences(module) {
  const walk = (node) => {
    if (node.type === "Identifier") {
      const info = importInfo(module, node, node.name);
      if (info !== null && (info.kind === "test" || info.kind === "assert" || info.kind === "fs")) {
        const parent = module.parentOf.get(node);
        let ok = parent !== undefined && parent !== null && parent.type === "CallExpression" && parent.callee === node;
        if (!ok && parent !== undefined && parent !== null && parent.type === "MemberExpression" && parent.object === node && parent.computed !== true) {
          const grand = module.parentOf.get(parent);
          ok = grand !== undefined && grand !== null && grand.type === "CallExpression" && grand.callee === parent;
        }
        if (!ok) {
          throw fail("E_UNSUPPORTED_SYNTAX", `${module.path}:${lineIndexAt(module.lines, node.byteStart) + 1}: ${JSON.stringify(node.name)} is a ${info.kind} capability binding used outside its supported call position`);
        }
      }
    }
    for (const child of children(node)) {
      // Names that are not references to a binding: import specifier locals, non-computed member
      // properties, non-computed object/class keys, and labels.
      if (node.type === "ImportSpecifier" || node.type === "ImportDefaultSpecifier" || node.type === "ImportNamespaceSpecifier") continue;
      if (node.type === "MemberExpression" && child === node.property && node.computed !== true) continue;
      if ((node.type === "Property" || node.type === "PropertyDefinition" || node.type === "MethodDefinition") && child === node.key && node.computed !== true) continue;
      if ((node.type === "LabeledStatement" || node.type === "BreakStatement" || node.type === "ContinueStatement") && child === node.label) continue;
      walk(child);
    }
  };
  walk(module.ast);
}

// --- attachment ---------------------------------------------------------------------------------

// 11b.8c attachment scan: from the declaration's own physical line, backwards, while every line is
// nothing but optional SP/HTAB and one "//" comment, stopping at a blank line, a non-comment line
// or the start of file. What is left is the maximal block nearest the declaration.
function attachmentBlock(module, declarationLine) {
  let first = declarationLine;
  while (first > 0) {
    const text = module.lines[first - 1].text;
    let i = 0;
    while (i < text.length && (text[i] === " " || text[i] === "\t")) i += 1;
    if (text.charCodeAt(i) !== 0x2f || text.charCodeAt(i + 1) !== 0x2f) break;
    first -= 1;
  }
  return { first, end: declarationLine };
}

function attachDirectives(module, records) {
  const owners = new Map();
  for (const record of records) {
    record.block = attachmentBlock(module, record.line - 1);
    for (let i = record.block.first; i < record.block.end; i += 1) {
      const list = owners.get(i);
      if (list === undefined) owners.set(i, [record]); else list.push(record);
    }
  }

  // Directive accounting: every candidate line in the file gets exactly one attribution, or the
  // module fails. A directive that missed its declaration is never demoted to a normal comment.
  for (let i = 0; i < module.lines.length; i += 1) {
    const text = module.lines[i].text;
    const intent = directiveIntent(text);
    if (intent === null) continue;
    const where = `${module.path}:${i + 1}`;
    const parsed = parseDirectiveLine(text, intent, where);
    const holders = owners.get(i) || [];
    if (holders.length === 0) throw fail("E_DIRECTIVE_UNATTACHED", `${where}: this @${intent} is not inside any declaration's attachment block`);
    if (holders.length > 1) throw fail("E_DIRECTIVE_AMBIGUOUS", `${where}: this @${intent} could attach to ${holders.length} declarations`);
    const owner = holders[0];
    if (owner.role !== "test") {
      throw fail("E_DIRECTIVE_BORROWED", `${where}: a ${owner.role} declaration may never carry @${intent}`);
    }
    if (parsed.kind === "src") {
      // Section 2 and 11b.5: exactly one @src, and a byte-identical repeat is still a second tag.
      if (owner.tag !== undefined) throw fail("E_TAG_CARDINALITY", `${where}: this declaration already carries an @src; exactly one is allowed`);
      owner.tag = parsed.tag;
      owner.tagLine = i;
    } else {
      if (owner.stableId !== undefined) throw fail("E_TID_CARDINALITY", `${where}: this declaration already carries a @tid`);
      owner.stableId = parsed.id;
      owner.tidLines = [i];
    }
  }
  for (const record of records) {
    if (record.tag === undefined) record.tag = null;
    if (record.stableId === undefined) record.stableId = null;
    if (record.tidLines === undefined) record.tidLines = [];
  }
}

// --- canonical bytes ------------------------------------------------------------------------------

// 11b.8c canonical declaration range plus 11b.8b's @tid removal. The range starts at the line-start
// byte of the block's first line when there is a block, and always ends at the outermost
// ExpressionStatement's end -- so a semicolon is inside and a trailing comment is not.
function canonicalDeclarationBytes(module, record) {
  const statement = record.statement;
  const hasBlock = record.block.first < record.block.end;
  const start = hasBlock ? module.lines[record.block.first].start : statement.byteStart;
  const end = statement.byteEnd;

  const pieces = [];
  let cursor = start;
  for (const lineIndex of record.tidLines) {
    const line = module.lines[lineIndex];
    // The line and its LF go together; the last line of a file has no terminator to remove.
    const drop = Math.min(line.end + 1, module.normalized.length);
    if (line.start < cursor || drop > end) continue;
    pieces.push(module.normalized.subarray(cursor, line.start));
    cursor = drop;
  }
  pieces.push(module.normalized.subarray(cursor, end));
  return { bytes: Buffer.concat(pieces), range: { startInclusive: start, endExclusive: end }, syntacticRange: { startInclusive: statement.byteStart, endExclusive: statement.byteEnd } };
}

const sha256 = (bytes) => crypto.createHash("sha256").update(bytes).digest("hex");
const sha256Text = (text) => crypto.createHash("sha256").update(Buffer.from(text, "utf8")).digest("hex");

// Section 6 canonical bytes for any blob in the view: UTF-8 without BOM, LF, nothing trimmed.
function canonicalFileBytes(view, path) {
  const raw = view.read(path);
  let text;
  try { text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(raw); } catch {
    throw fail("E_DEP_BYTES", `${path} is not valid UTF-8, so it has no canonical bytes`);
  }
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  return Buffer.from(text.replace(/\r\n/g, "\n").replace(/\r/g, "\n"), "utf8");
}

// --- oracle closure -------------------------------------------------------------------------------

function assertionCall(module, call) {
  const callee = call.callee;
  if (callee.type === "Identifier") {
    const info = importInfo(module, callee, callee.name);
    if (info === null || info.kind !== "assert") return false;
    // (c) the default binding is itself callable; (b) a named function binding is callable when
    // its ORIGINAL name is on the allowlist; a namespace object is not callable at all.
    if (info.form === "object") {
      if (info.directlyCallable !== true) {
        throw fail("E_ORACLE_UNCLASSIFIED", `${module.path}:${lineIndexAt(module.lines, call.byteStart) + 1}: this assert binding is not directly callable`);
      }
      return true;
    }
    if (!ASSERTION_NAMES.has(info.imported)) {
      throw fail("E_ORACLE_UNCLASSIFIED", `${module.path}:${lineIndexAt(module.lines, call.byteStart) + 1}: ${JSON.stringify(info.imported)} is not on the closed assertion allowlist`);
    }
    return true;
  }
  if (callee.type === "MemberExpression" && callee.object.type === "Identifier") {
    const info = importInfo(module, callee.object, callee.object.name);
    if (info === null || info.kind !== "assert") return false;
    const where = `${module.path}:${lineIndexAt(module.lines, call.byteStart) + 1}`;
    if (callee.computed === true) throw fail("E_ORACLE_UNCLASSIFIED", `${where}: a computed member on an assert binding is unsupported`);
    if (info.form !== "object") throw fail("E_ORACLE_UNCLASSIFIED", `${where}: an assertion-function binding may only be called directly`);
    if (callee.property.type !== "Identifier" || !ASSERTION_NAMES.has(callee.property.name)) {
      throw fail("E_ORACLE_UNCLASSIFIED", `${where}: ${JSON.stringify(callee.property.name)} is not on the closed assertion allowlist`);
    }
    return true;
  }
  return false;
}

// 11b.9 snapshot-golden: one of two fs APIs, path argument at index 0, and only the
// new URL(<string literal>, import.meta.url) form -- which resolves against the module itself and
// therefore does not depend on anyone's working directory.
function snapshotCall(module, call) {
  const callee = call.callee;
  let allowed = null;
  const where = `${module.path}:${lineIndexAt(module.lines, call.byteStart) + 1}`;
  if (callee.type === "Identifier") {
    const info = importInfo(module, callee, callee.name);
    if (info === null || info.kind !== "fs") return null;
    if (info.form !== "function") throw fail("E_SNAPSHOT_FORM", `${where}: an fs namespace or default object must be called through a member`);
    allowed = FS_API[info.specifier].has(info.imported) ? info.imported : null;
    if (allowed === null) throw fail("E_SNAPSHOT_FORM", `${where}: ${JSON.stringify(info.imported)} from ${info.specifier} is not on the snapshot-golden allowlist`);
  } else if (callee.type === "MemberExpression" && callee.object.type === "Identifier") {
    const info = importInfo(module, callee.object, callee.object.name);
    if (info === null || info.kind !== "fs") return null;
    if (callee.computed === true) throw fail("E_SNAPSHOT_FORM", `${where}: a computed member on an fs binding is unsupported`);
    if (info.form !== "object") throw fail("E_SNAPSHOT_FORM", `${where}: an fs function binding may only be called directly`);
    if (callee.property.type !== "Identifier" || !FS_API[info.specifier].has(callee.property.name)) {
      throw fail("E_SNAPSHOT_FORM", `${where}: ${JSON.stringify(callee.property && callee.property.name)} from ${info.specifier} is not on the snapshot-golden allowlist`);
    }
    allowed = callee.property.name;
  } else {
    return null;
  }

  noSpread(module, call, where);
  const first = call.arguments[0];
  if (first === undefined || first.type !== "NewExpression" || first.callee.type !== "Identifier" || first.callee.name !== "URL") {
    throw fail("E_SNAPSHOT_FORM", `${where}: the path argument must be new URL(<string literal>, import.meta.url)`);
  }
  if (resolveIdentifier(module, first.callee, "URL", "URL") !== null) {
    throw fail("E_SNAPSHOT_FORM", `${where}: URL is shadowed by a local binding, so the path form cannot be trusted`);
  }
  if (first.arguments.length !== 2) throw fail("E_SNAPSHOT_FORM", `${where}: new URL takes exactly the literal and import.meta.url`);
  const literal = first.arguments[0];
  if (literal.type !== "Literal" || typeof literal.value !== "string") {
    throw fail("E_SNAPSHOT_FORM", `${where}: the snapshot path must be a plain string literal, not a variable, template or expression`);
  }
  const base = first.arguments[1];
  if (base.type !== "MemberExpression" || base.computed === true || base.object.type !== "MetaProperty"
    || base.property.type !== "Identifier" || base.property.name !== "url") {
    throw fail("E_SNAPSHOT_FORM", `${where}: the resolution root must be import.meta.url`);
  }
  const resolved = resolveRelativeLexically(dirnameOf(module.path), literal.value, `${where}: snapshot path`);
  return { api: allowed, path: resolved };
}

// 11b.9f callable subset: a direct identifier call resolving to a function declaration, or to a
// const bound to a block-bodied function or arrow expression. Nothing else, in either module.
function callableFromDeclaration(declaration, path, name, where) {
  if (declaration.reassigned === true) {
    throw fail("E_ORACLE_BINDING", `${where}: ${JSON.stringify(name)} is reassigned somewhere in its module, so its declaration does not fix what it calls`);
  }
  if (declaration.kind === "function") {
    const node = declaration.node;
    if (node.generator === true) throw fail("E_ORACLE_BINDING", `${where}: ${JSON.stringify(name)} is a generator, which is unsupported`);
    if (node.body.type !== "BlockStatement") throw fail("E_ORACLE_BINDING", `${where}: ${JSON.stringify(name)} has no block body`);
    return { path, node, body: node.body };
  }
  if (declaration.kind === "const") {
    const init = declaration.init;
    if (init === null || init === undefined || !FUNCTIONS.has(init.type) || init.type === "FunctionDeclaration") {
      throw fail("E_ORACLE_BINDING", `${where}: ${JSON.stringify(name)} is a const that is not bound to a function or arrow expression`);
    }
    if (init.generator === true) throw fail("E_ORACLE_BINDING", `${where}: ${JSON.stringify(name)} is a generator, which is unsupported`);
    if (init.body.type !== "BlockStatement") throw fail("E_ORACLE_BINDING", `${where}: ${JSON.stringify(name)} has a concise body, which is unsupported`);
    return { path, node: init, body: init.body };
  }
  throw fail("E_ORACLE_BINDING", `${where}: ${JSON.stringify(name)} is bound by ${declaration.kind}, which is outside the supported callable subset`);
}

// 11b.9f target export forms, resolved inside the captured view only.
function exportedCallable(target, name, where) {
  const matches = [];
  for (const statement of target.ast.body) {
    if (statement.type === "ExportDefaultDeclaration" && name === "default") {
      matches.push({ local: null, node: statement.declaration });
      continue;
    }
    if (statement.type !== "ExportNamedDeclaration") continue;
    if (statement.source !== null && statement.source !== undefined) {
      throw fail("E_ORACLE_RESOLVE", `${where}: ${target.path} re-exports with a source, which is unsupported`);
    }
    if (statement.declaration !== null && statement.declaration !== undefined) {
      const declaration = statement.declaration;
      if (declaration.type === "FunctionDeclaration" && declaration.id !== null && declaration.id.name === name) matches.push({ local: name, node: null });
      else if (declaration.type === "VariableDeclaration") {
        for (const d of declaration.declarations) if (d.id.type === "Identifier" && d.id.name === name) matches.push({ local: name, node: null });
      }
      continue;
    }
    for (const s of statement.specifiers) {
      const exported = s.exported.type === "Identifier" ? s.exported.name : null;
      if (exported === name) matches.push({ local: s.local.name, node: null });
    }
  }
  if (matches.length === 0) throw fail("E_ORACLE_RESOLVE", `${where}: ${target.path} exports no ${JSON.stringify(name)}`);
  if (matches.length > 1) throw fail("E_ORACLE_RESOLVE", `${where}: ${target.path} exports ${JSON.stringify(name)} more than once`);
  const match = matches[0];
  if (match.local === null) {
    const node = match.node;
    if (FUNCTIONS.has(node.type) && node.type !== "FunctionDeclaration") {
      if (node.generator === true || node.body.type !== "BlockStatement") throw fail("E_ORACLE_RESOLVE", `${where}: the default export is not a block-bodied non-generator function`);
      return { path: target.path, node, body: node.body };
    }
    if (node.type === "FunctionDeclaration") {
      if (node.generator === true || node.body.type !== "BlockStatement") throw fail("E_ORACLE_RESOLVE", `${where}: the default export is not a block-bodied non-generator function`);
      return { path: target.path, node, body: node.body };
    }
    throw fail("E_ORACLE_RESOLVE", `${where}: the default export of ${target.path} is not a function`);
  }
  const declaration = target.moduleScope.names.get(match.local);
  if (declaration === undefined) throw fail("E_ORACLE_RESOLVE", `${where}: ${target.path} exports ${JSON.stringify(name)} but declares no such binding`);
  if (declaration.length !== 1) throw fail("E_ORACLE_RESOLVE", `${where}: ${target.path} declares ${JSON.stringify(match.local)} more than once`);
  return callableFromDeclaration(declaration[0], target.path, match.local, where);
}

const callableKey = (callable) => `${callable.path}#${callable.node.nodeId}`;

// Section 6: every node, root or not, expands under this same rule. Nested functions that nobody
// calls are not entered; every reachable CallExpression must land in one of the four classes, and
// anything else fails rather than being read as "not an oracle".
async function expandBody(session, module, body, closure, ownerKey) {
  // One walk collects every reachable call, arguments included -- assert.ok(helper()) really does
  // call the helper -- and stops at any function or class that nothing here calls.
  const pending = [];
  const walk = (node) => {
    if (FUNCTIONS.has(node.type) || CLASSES.has(node.type)) return;
    if (node.type === "CallExpression") pending.push(node);
    for (const child of children(node)) walk(child);
  };
  for (const child of children(body)) walk(child);

  for (const call of pending) {
    const where = `${module.path}:${lineIndexAt(module.lines, call.byteStart) + 1}`;
    if (assertionCall(module, call)) {
      closure.hasAssertion.add(ownerKey);
      continue;
    }
    const snapshot = snapshotCall(module, call);
    if (snapshot !== null) {
      if (!session.view.has(snapshot.path)) throw fail("E_SNAPSHOT_PATH", `${where}: ${snapshot.path} is not a blob in the captured view`);
      closure.snapshots.add(snapshot.path);
      continue;
    }
    if (call.callee.type !== "Identifier") {
      throw fail("E_ORACLE_UNCLASSIFIED", `${where}: this call target is not a direct identifier, so it cannot be classified`);
    }
    noSpread(module, call, where);

    const declaration = resolveIdentifier(module, call.callee, call.callee.name, `call to ${JSON.stringify(call.callee.name)}`);
    if (declaration === null) throw fail("E_ORACLE_UNCLASSIFIED", `${where}: ${JSON.stringify(call.callee.name)} resolves to no binding in this module`);
    let callable;
    if (declaration.kind === "import") {
      const info = declaration.info;
      if (info.kind !== "helper") throw fail("E_ORACLE_UNCLASSIFIED", `${where}: ${JSON.stringify(call.callee.name)} is a ${info.kind === "helper-unsupported" ? info.reason : info.kind} binding and cannot be a local callable`);
      callable = await resolveHelper(session, module, info, where);
    } else {
      callable = callableFromDeclaration(declaration, module.path, call.callee.name, where);
    }
    closure.edges.push([ownerKey, callableKey(callable)]);
    await visitCallable(session, callable, closure);
  }
}

async function resolveHelper(session, module, info, where) {
  const specifier = info.specifier;
  if (!/\.(mjs|js)$/.test(specifier)) {
    throw fail("E_ORACLE_RESOLVE", `${where}: ${JSON.stringify(specifier)} must name a .mjs or .js file; extension probing and directory index resolution are unsupported`);
  }
  const path = resolveRelativeLexically(dirnameOf(module.path), specifier, `${where}: helper specifier`);
  const target = await loadModule(session, path, `${where}: helper module`);
  return exportedCallable(target, info.imported, where);
}

async function visitCallable(session, callable, closure) {
  const key = callableKey(callable);
  if (closure.visited.has(key)) return;
  closure.visited.add(key);
  closure.callables.set(key, callable);
  const module = session.modules.get(callable.path);
  await expandBody(session, module, callable.body, closure, key);
}

// 11b.9e applicability: Program scope, then every ancestor container scope from the outside in,
// then the current container. Siblings, descendants and hooks inside ordinary functions never
// apply, and a hook's lexical position relative to the test changes nothing.
function applicableHooks(hooks, record) {
  const chain = new Set();
  for (let node = record.container; node !== null && node !== undefined; node = node.container) chain.add(node);
  return hooks.filter((hook) => (hook.container === null ? true : chain.has(hook.container)));
}

// Encoded as a JSON tuple rather than joined with a delimiter: with no separator there is no
// separator to smuggle, so two different depRefs can never collide into one key.
function depRefKey(ref) {
  return canonicalJson([ref.path, ref.span]);
}

function sortDepRefs(refs) {
  const unique = new Map();
  for (const ref of refs) unique.set(depRefKey(ref), ref);
  return [...unique.values()].sort((a, b) => compareCodePoint(a.path, b.path) || compareCodePoint(canonicalJson(a.span), canonicalJson(b.span)));
}

async function oracleClosure(session, module, record, hooks) {
  const closure = { visited: new Set(), callables: new Map(), edges: [], hasAssertion: new Set(), snapshots: new Set() };
  const applicable = applicableHooks(hooks, record);

  // Traversal-root keys. Neither can collide with a callable key, which always carries a "#".
  const ROOT = "@root";
  await expandBody(session, module, record.callback.body, closure, ROOT);
  const refs = [];
  for (const hook of applicable) {
    const key = `@hook:${hook.callback.body.nodeId}`;
    refs.push({ path: module.path, span: { kind: "byte-range", startInclusive: hook.callback.body.byteStart, endExclusive: hook.callback.body.byteEnd } });
    await expandBody(session, module, hook.callback.body, closure, key);
  }

  // Contributor = a callable whose own body, or anything it reaches, holds an allowlisted
  // assertion. Reachability is computed over the whole graph so a cycle terminates without either
  // erroring or losing the assertion that lives on the far side of it.
  const outgoing = new Map();
  for (const [from, to] of closure.edges) {
    const list = outgoing.get(from);
    if (list === undefined) outgoing.set(from, [to]); else list.push(to);
  }
  const assertionReachable = (start) => {
    const seen = new Set([start]);
    const stack = [start];
    while (stack.length > 0) {
      const key = stack.pop();
      if (closure.hasAssertion.has(key)) return true;
      for (const next of outgoing.get(key) || []) if (!seen.has(next)) { seen.add(next); stack.push(next); }
    }
    return false;
  };
  for (const [key, callable] of closure.callables) {
    if (assertionReachable(key)) refs.push({ path: callable.path, span: { kind: "whole-file" } });
  }
  for (const path of closure.snapshots) refs.push({ path, span: { kind: "whole-file" } });
  return sortDepRefs(refs);
}

// --- analysis -------------------------------------------------------------------------------------

function structuralIds(module, records) {
  const derived = records.map((record) => `s:${canonicalJson([...record.chain, record.name])}`);
  const groups = new Map();
  derived.forEach((key, i) => {
    const list = groups.get(key);
    if (list === undefined) groups.set(key, [i]); else list.push(i);
  });
  for (const [key, indexes] of groups) {
    if (indexes.length < 2) continue;
    for (const i of indexes) {
      if (records[i].stableId === null) {
        throw fail("E_STRUCTURAL_DUPLICATE", `${module.path}:${records[i].line}: ${indexes.length} declarations share the derived key ${key}; every member of a duplicate group needs its own @tid`);
      }
    }
  }
  const seenTid = new Map();
  for (const record of records) {
    if (record.stableId === null) continue;
    const previous = seenTid.get(record.stableId);
    if (previous !== undefined) throw fail("E_TID_DUPLICATE", `${module.path}: @tid ${JSON.stringify(record.stableId)} is used by two declarations (lines ${previous} and ${record.line})`);
    seenTid.set(record.stableId, record.line);
  }
  return records.map((record, i) => (record.stableId !== null ? `tid:${record.stableId}` : derived[i]));
}

async function analyzeOne(session, path) {
  const module = await loadModule(session, path, "module path");
  const { declarations, containers, hooks } = collectDeclarations(module);
  auditCapabilityReferences(module);
  attachDirectives(module, [...declarations, ...containers, ...hooks]);
  const ids = structuralIds(module, declarations);

  const out = [];
  for (let i = 0; i < declarations.length; i += 1) {
    const record = declarations[i];
    const canonical = canonicalDeclarationBytes(module, record);
    const deps = await oracleClosure(session, module, record, hooks);
    const declarationDigest = sha256(canonical.bytes);
    const oracleEntries = deps.map((ref) => ({
      ref,
      digest: ref.span.kind === "whole-file"
        ? sha256(canonicalFileBytes(session.view, ref.path))
        : sha256(session.modules.get(ref.path).normalized.subarray(ref.span.startInclusive, ref.span.endExclusive)),
    }));
    const effectiveOracleDigest = sha256Text(canonicalJson(oracleEntries));
    out.push(Object.freeze({
      path: module.path,
      structuralId: ids[i],
      containerChain: Object.freeze([...record.chain]),
      declarationName: record.name,
      modifier: record.modifier,
      stableId: record.stableId,
      tag: record.tag === null ? null : Object.freeze({ ...record.tag }),
      declarationLine: record.line,
      canonicalRange: Object.freeze(canonical.range),
      syntacticRange: Object.freeze(canonical.syntacticRange),
      canonicalDeclarationBytes: canonical.bytes,
      declarationDigest,
      effectiveOracleDeps: Object.freeze(deps.map((ref) => Object.freeze({ path: ref.path, span: Object.freeze({ ...ref.span }) }))),
      effectiveOracleDigest,
      bodyDigest: sha256Text(canonicalJson({ declarationDigest, effectiveOracleDigest })),
    }));
  }
  return Object.freeze({
    path: module.path,
    implementationId: NODE_TEST_V1_IMPLEMENTATION_ID,
    identity: Object.freeze({ ...module.identity }),
    declarations: Object.freeze(out),
    containers: Object.freeze(containers.map((c) => Object.freeze({ name: c.name, chain: Object.freeze([...c.chain]), line: c.line }))),
    hooks: Object.freeze(hooks.map((h) => Object.freeze({
      hook: h.hook,
      line: h.line,
      span: Object.freeze({ kind: "byte-range", startInclusive: h.callback.body.byteStart, endExclusive: h.callback.body.byteEnd }),
    }))),
  });
}

const newSession = (view) => ({ view: requireView(view, "view"), modules: new Map() });

// --- public API -------------------------------------------------------------------------------------

function requireRequest(request, name, keys) {
  if (request === null || typeof request !== "object" || Array.isArray(request)) throw fail("E_API_ARGUMENTS", `${name} expects one options object`);
  const actual = Object.keys(request).sort();
  const wanted = [...keys].sort();
  if (actual.length !== wanted.length || actual.some((k, i) => k !== wanted[i])) {
    throw fail("E_API_ARGUMENTS", `${name} expects exactly ${JSON.stringify(wanted)}; got ${JSON.stringify(actual)}`);
  }
  return request;
}

// One module out of an already-captured view. @tid uniqueness is per VIEW (11b.7), and one module
// cannot see the view's whole ID space, so this enforces the module-local half only; analyzeView
// is what closes the cross-file half.
export async function analyzeModule(request) {
  if (arguments.length !== 1) throw fail("E_API_ARGUMENTS", "analyzeModule takes exactly one argument; a parser, a manifest, an implementation module or executable code cannot be supplied");
  requireRequest(request, "analyzeModule", ["view", "path"]);
  return analyzeOne(newSession(request.view), request.path);
}

// The module set is the CALLER's, because deciding which files an adapter covers is discovery and
// discovery is not implemented here. This walks exactly the paths it is handed, in code-point
// order, and never enumerates anything.
export async function analyzeView(request) {
  if (arguments.length !== 1) throw fail("E_API_ARGUMENTS", "analyzeView takes exactly one argument");
  requireRequest(request, "analyzeView", ["view", "modulePaths"]);
  if (!Array.isArray(request.modulePaths)) throw fail("E_API_ARGUMENTS", "analyzeView expects modulePaths to be an array supplied by the caller");
  const session = newSession(request.view);
  const paths = [...request.modulePaths];
  for (const path of paths) requireCanonicalPath(path, "modulePaths[]");
  const seen = new Set();
  for (const path of paths) {
    if (seen.has(path)) throw fail("E_API_ARGUMENTS", `duplicate modulePaths[] entry: ${path}`);
    seen.add(path);
  }
  paths.sort(compareCodePoint);

  const modules = [];
  // 11b.7: a @tid must be unique within the view, across files, and the check has to land BEFORE
  // matching -- a duplicate that survives to matching makes move-only detection unusable.
  const tids = new Map();
  for (const path of paths) {
    const analysis = await analyzeOne(session, path);
    for (const declaration of analysis.declarations) {
      if (declaration.stableId === null) continue;
      const previous = tids.get(declaration.stableId);
      if (previous !== undefined) {
        throw fail("E_TID_DUPLICATE", `@tid ${JSON.stringify(declaration.stableId)} appears in both ${previous} and ${path} within one view`);
      }
      tids.set(declaration.stableId, path);
    }
    modules.push(analysis);
  }
  return Object.freeze({ implementationId: NODE_TEST_V1_IMPLEMENTATION_ID, modules: Object.freeze(modules) });
}

// The shipped component behind implementationId "node-test-v1". The registry resolves this object
// from a closed table; it is never located by turning an implementationId into a module path.
export const nodeTestV1Component = Object.freeze({
  implementationId: NODE_TEST_V1_IMPLEMENTATION_ID,
  createContentView,
  analyzeModule,
  analyzeView,
});
