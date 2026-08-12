// Coverage for the node-test-v1 executable adapter component:
// cressetide/skills/vigil/scripts/node-test-adapter.mjs, plus the closed implementationId ->
// component mapping wired into adapter-registry.mjs.
//
// SCOPE NOTE: this covers the COMPONENT only -- declaration and hook recognition, tag attachment,
// structuralId, canonical declaration bytes and the effective-oracle closure over one captured
// view. Nothing here runs adapter discovery or selection, builds a ChangedTestInventory, computes
// an inventoryDigest, matches base against head, or touches the provenance store, because none of
// that is implemented. A green run of this file does not mean a producer exists, does not satisfy
// AC136/AC137/AC138, does not lift the unsupported-populated-inventory gate, and does not mean
// Phase 2 is ready.
//
// FIXTURES: every view below is built in memory from string literals, so no fixture is written into
// the repository and none can be. The one case that needs a real directory -- proving the resolver
// reads the captured view and not the live filesystem -- uses a repo-external temporary directory
// and only reads it back to show it was left alone.
import assert from "node:assert";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

import {
  NodeTestAdapterError,
  analyzeModule,
  analyzeView,
  createContentView,
  nodeTestV1Component,
} from "../cressetide/skills/vigil/scripts/node-test-adapter.mjs";
import { loadTestAdapterRegistry, resolveAdapterComponent } from "../cressetide/skills/vigil/scripts/adapter-registry.mjs";
import { loadVendorCapability } from "../cressetide/skills/vigil/scripts/parser-ignore-wrapper.mjs";
import { temporary } from "./helpers.mjs";

const B = (s) => Buffer.from(s, "utf8");
const src = (...lines) => `${lines.join("\n")}\n`;
const viewOf = (files) => createContentView(Object.fromEntries(Object.entries(files).map(([k, v]) => [k, typeof v === "string" ? B(v) : v])));
const analyze = (files, at = "a.test.mjs") => analyzeModule({ view: viewOf(files), path: at });
const only = async (files, at = "a.test.mjs") => {
  const result = await analyze(files, at);
  assert.strictEqual(result.declarations.length, 1, "fixture was expected to hold exactly one declaration");
  return result.declarations[0];
};

// Failures arrive from two layers by design: the vendored-wrapper parse rejects a construct the
// manifest lists as unsupported before the component ever sees a tree. Both are fail-closed, so the
// helper accepts either type and returns the code the assertion actually cares about.
const failureOf = async (fn) => {
  try { await fn(); } catch (e) {
    assert.ok(e && (e.name === "NodeTestAdapterError" || e.name === "ParserIgnoreWrapperError"),
      `expected an adapter or wrapper error, got ${e && e.name}: ${e && e.message}`);
    return e.code;
  }
  return null;
};
const rejects = async (files, at = "a.test.mjs") => failureOf(() => analyze(files, at));

// The canonical ULID grammar lives in intent-scan approved v1.10 section 8 and is referenced here
// by example, never restated as a second regex. These are its two extremes.
const ULID_MIN = "0".repeat(26);
const ULID_MAX = `7${"Z".repeat(25)}`;
const REQ = `REQ-${ULID_MIN}`;
const DEC = `DEC-${ULID_MAX}`;
const DP = `DP-${ULID_MAX}`;

const HEAD = ['import test from "node:test";', 'import assert from "node:assert";'];
const simple = (...body) => ({ "a.test.mjs": src(...HEAD, ...body) });

// ---------------------------------------------------------------------------------------------
// Import binding classification: node:test, node:assert, aliases, modifiers  (AC94, AC95, AC96)
// ---------------------------------------------------------------------------------------------

test("every legal node:test import form and alias resolves by binding, not by written name", async () => {
  const result = await analyze({
    "a.test.mjs": src(
      'import runner, { test as it, describe as group, before, after, beforeEach, afterEach } from "node:test";',
      'import assert from "node:assert";',
      'runner("default binding", () => { assert.ok(1); });',
      'it("named alias", () => { assert.ok(1); });',
      'group("outer", () => {',
      "  before(() => { assert.ok(1); });",
      "  after(() => { assert.ok(1); });",
      "  beforeEach(() => { assert.ok(1); });",
      "  afterEach(() => { assert.ok(1); });",
      '  it("inner", () => { assert.ok(1); });',
      "});",
    ),
  });
  assert.deepStrictEqual(result.declarations.map((d) => d.declarationName), ["default binding", "named alias", "inner"]);
  assert.deepStrictEqual(result.declarations[2].containerChain, ["outer"]);
  assert.deepStrictEqual(result.hooks.map((h) => h.hook), ["before", "after", "beforeEach", "afterEach"]);
});

test("only/skip/todo are the same declaration and never enter identity", async () => {
  const plain = await only(simple('test("n", () => { assert.ok(1); });'));
  for (const modifier of ["only", "skip", "todo"]) {
    const decorated = await only(simple(`test.${modifier}("n", () => { assert.ok(1); });`));
    assert.strictEqual(decorated.modifier, modifier);
    assert.strictEqual(decorated.structuralId, plain.structuralId, `${modifier} must not change structuralId`);
  }
  assert.strictEqual(await rejects(simple('test.foo("n", () => {});')), "E_UNSUPPORTED_SYNTAX");
});

test("all three assertion-object bindings and both callable forms are accepted", async () => {
  const cases = [
    ['import assert from "node:assert";', "assert.ok(1);"],
    ['import assert from "node:assert/strict";', "assert.ok(1);"],
    ['import * as assert from "node:assert";', "assert.deepStrictEqual(1, 1);"],
    ['import { strict as assert } from "node:assert";', "assert.ok(1);"],
    ['import { ok } from "node:assert";', "ok(1);"],
    ['import { ok, deepStrictEqual } from "node:assert/strict";', "deepStrictEqual(1, 1);"],
    ['import assert from "node:assert";', "assert(1);"],
  ];
  for (const [importLine, call] of cases) {
    const declaration = await only({
      "a.test.mjs": src('import test from "node:test";', importLine, `test("n", () => { ${call} });`),
    });
    assert.deepStrictEqual(declaration.effectiveOracleDeps, [], `${importLine} ${call}: an assertion at the root produces no depRef`);
  }
});

test("assertion binding negatives: allowlist, function-binding member call, namespace call, computed member", async () => {
  const head = 'import test from "node:test";';
  const cases = [
    ['import assert from "node:assert";', "assert.partialDeepStrictEqual(1, 1);", "E_ORACLE_UNCLASSIFIED"],
    ['import { ok } from "node:assert";', "ok.strict(1);", "E_ORACLE_UNCLASSIFIED"],
    ['import * as assert from "node:assert";', "assert(1);", "E_ORACLE_UNCLASSIFIED"],
    ['import { strict as assert } from "node:assert";', "assert(1);", "E_ORACLE_UNCLASSIFIED"],
    ['import { partialDeepStrictEqual } from "node:assert";', "partialDeepStrictEqual(1, 1);", "E_ORACLE_UNCLASSIFIED"],
    // A computed member never reaches the component: the manifest lists it as unsupported syntax,
    // so the vendored parse rejects the whole module first. Still fail-closed, one layer earlier.
    ['import assert from "node:assert";', 'const name = "ok"; assert[name](1);', "E_UNSUPPORTED_SYNTAX"],
  ];
  for (const [importLine, call, code] of cases) {
    const actual = await rejects({ "a.test.mjs": src(head, importLine, `test("n", () => { ${call} });`) });
    assert.strictEqual(actual, code, `${importLine} ${call}`);
  }
});

test("unsupported imports: bare specifier, other assertion library, CommonJS, dynamic import", async () => {
  assert.strictEqual(await rejects({ "a.test.mjs": src('import { test } from "test";', 'test("n", () => {});') }), "E_UNSUPPORTED_IMPORT");
  assert.strictEqual(await rejects({ "a.test.mjs": src(...HEAD, 'import { expect } from "chai";', 'test("n", () => { assert.ok(1); });') }), "E_UNSUPPORTED_IMPORT");
  assert.strictEqual(await rejects({ "a.test.mjs": src(...HEAD, 'import * as everything from "node:test";', 'test("n", () => {});') }), "E_UNSUPPORTED_IMPORT");
  assert.strictEqual(await rejects({ "a.test.mjs": src(...HEAD, 'import { run } from "node:test";', 'test("n", () => {});') }), "E_UNSUPPORTED_IMPORT");
  // CommonJS and dynamic import are rejected by the manifest's structural checks during the parse.
  assert.strictEqual(await rejects({ "a.test.mjs": src('const test = require("node:test");', 'test("n", () => {});') }), "E_UNSUPPORTED_SYNTAX");
  assert.strictEqual(await rejects({ "a.test.mjs": src(...HEAD, 'const m = await import("./h.mjs");', 'test("n", () => { assert.ok(1); });') }), "E_UNSUPPORTED_SYNTAX");
});

test("a capability binding used outside its call position is unsupported, not ignored", async () => {
  // Aliasing the binding through a variable would let a declaration exist that the analysis never
  // registers, which is exactly the silent gap this model is built to prevent.
  assert.strictEqual(await rejects(simple("const it = test;", 'test("n", () => { assert.ok(1); });')), "E_UNSUPPORTED_SYNTAX");
  assert.strictEqual(await rejects(simple('test("n", () => { assert.ok(assert); });')), "E_UNSUPPORTED_SYNTAX");
  // A local binding that merely shares the name is not the import binding and is left alone.
  const declaration = await only(simple("function outer(test) { return test; }", 'test("n", () => { assert.ok(1); });'));
  assert.strictEqual(declaration.declarationName, "n");
});

test("ambiguous binding is fatal rather than resolved by a tie-break", async () => {
  // Two lexical declarations of one name are a SyntaxError the parser catches first, so the
  // reachable ambiguity is the var form -- still two declarations in one scope.
  assert.strictEqual(await rejects(simple(
    "var helper = function () { assert.ok(1); };",
    "var helper = function () { assert.ok(2); };",
    'test("n", () => { helper(); });',
  )), "E_ORACLE_BINDING");
});

// ---------------------------------------------------------------------------------------------
// Placement, arguments, callback profile  (AC142, AC97)
// ---------------------------------------------------------------------------------------------

test("callback profile positives: arrow and function, async or not, zero or more simple parameters", async () => {
  for (const callback of ["() => { assert.ok(1); }", "function () { assert.ok(1); }", "async () => { assert.ok(1); }",
    "async function () { assert.ok(1); }", "(t) => { assert.ok(1); }", "(a, b) => { assert.ok(1); }"]) {
    const declaration = await only(simple(`test("n", ${callback});`));
    assert.strictEqual(declaration.declarationName, "n", callback);
  }
  const hookResult = await analyze(simple("before(function () { assert.ok(1); });", 'test("n", () => { assert.ok(1); });'), "a.test.mjs");
  assert.strictEqual(hookResult.hooks.length, 0, "before is not imported in this fixture, so it declares no hook");
});

test("callback profile negatives are each unsupported", async () => {
  const cases = [
    ['test("n", { skip: true }, () => {});', "E_ARGUMENTS"],
    ['test("n");', "E_ARGUMENTS"],
    ['test("n", () => {}, "extra");', "E_ARGUMENTS"],
    ["test(...args);", "E_ARGUMENTS"],
    ['test("n", () => 1);', "E_ARGUMENTS"],
    ['test("n", function* () {});', "E_ARGUMENTS"],
    ['test("n", (t = 1) => {});', "E_ARGUMENTS"],
    ['test("n", (...a) => {});', "E_ARGUMENTS"],
    ['test("n", ({ t }) => {});', "E_ARGUMENTS"],
    ["test(name, () => {});", "E_ARGUMENTS"],
    ['test(`n ${1}`, () => {});', "E_ARGUMENTS"],
    ['test("a" + "b", () => {});', "E_ARGUMENTS"],
  ];
  for (const [line, code] of cases) {
    assert.strictEqual(await rejects(simple("const args = [];", "const name = \"n\";", line)), code, line);
  }
});

test("hook arity is exactly one argument", async () => {
  const head = ['import test, { before } from "node:test";', 'import assert from "node:assert";'];
  const ok = await analyze({ "a.test.mjs": src(...head, "before(() => { assert.ok(1); });", 'test("n", () => { assert.ok(1); });') });
  assert.strictEqual(ok.hooks.length, 1);
  for (const line of ["before({}, () => {});", "before();", "before(() => {}, () => {});"]) {
    assert.strictEqual(await failureOf(() => analyze({ "a.test.mjs": src(...head, line, 'test("n", () => {});') })), "E_ARGUMENTS", line);
  }
  assert.strictEqual(await failureOf(() => analyze({ "a.test.mjs": src(...head, "before.only(() => {});", 'test("n", () => {});') })), "E_UNSUPPORTED_SYNTAX");
});

test("a declaration outside Program body or a container callback is a placement failure", async () => {
  const wrappers = [
    ['if (true) {', "}"],
    ["for (let i = 0; i < 1; i += 1) {", "}"],
    ["try {", "} finally { }"],
    ["function outer() {", "}"],
    ["[1].forEach(() => {", "});"],
    ["while (false) {", "}"],
  ];
  for (const [open, close] of wrappers) {
    assert.strictEqual(await rejects(simple(open, '  test("n", () => { assert.ok(1); });', close)), "E_PLACEMENT", open);
  }
  // A subtest inside another test callback is a container the profile does not recognise.
  assert.strictEqual(await rejects(simple('test("outer", () => { test("inner", () => {}); });')), "E_PLACEMENT");
});

test("uninterpolated template literals are legal declaration names", async () => {
  const declaration = await only(simple("test(`n`, () => { assert.ok(1); });"));
  assert.strictEqual(declaration.declarationName, "n");
});

// ---------------------------------------------------------------------------------------------
// Attachment block, directive accounting, exact lexical form  (AC99, AC100, AC141, and the
// component-local half of AC98)
//
// AC98 has two halves and only one of them is reachable from here. The COMPONENT-LOCAL half is tag
// cardinality: exactly one @src per attachment block, a repeat rejected even when byte-identical,
// and @tid never counting toward it. That is what the cardinality test below covers. The other
// half -- a test still present in HEAD with zero @src failing under INV-B2 -- belongs to the
// inventory pipeline, which knows which view it is looking at; the component does not, reports
// `tag: null`, and enforces nothing about it. Nothing here covers that half, and no pipeline
// enforcement is added. The AC99 claim below is unaffected and stands in full.
// ---------------------------------------------------------------------------------------------

test("the maximal block nearest the declaration attaches, and intervening comments stay inside it", async () => {
  const declaration = await only(simple(
    "// a note above",
    `// @src ${REQ}`,
    "// another note",
    'test("n", () => { assert.ok(1); });',
  ));
  assert.deepStrictEqual(declaration.tag, { clauseRef: REQ });
  assert.ok(declaration.canonicalDeclarationBytes.toString("utf8").startsWith("// a note above\n"),
    "the range starts at the first line of the maximal block");
});

test("a blank line between the block and the declaration breaks attachment", async () => {
  assert.strictEqual(await rejects(simple(`// @src ${REQ}`, "", 'test("n", () => { assert.ok(1); });')), "E_DIRECTIVE_UNATTACHED");
  assert.strictEqual(await rejects(simple(`// @tid alpha`, "", 'test("n", () => { assert.ok(1); });')), "E_DIRECTIVE_UNATTACHED");
});

test("an earlier block separated by a non-comment line is unattached, not a normal comment", async () => {
  assert.strictEqual(await rejects(simple(
    `// @src ${REQ}`,
    "const unrelated = 1;",
    "// still attached to nothing that may carry a tag",
    'test("n", () => { assert.ok(1); });',
  )), "E_DIRECTIVE_UNATTACHED");
});

test("a tag attached to a container or a hook is borrowed", async () => {
  const head = ['import test, { describe, before } from "node:test";', 'import assert from "node:assert";'];
  const container = (directive) => src(...head, directive, 'describe("c", () => {', '  test("n", () => { assert.ok(1); });', "});");
  assert.strictEqual(await failureOf(() => analyze({ "a.test.mjs": container(`// @src ${REQ}`) })), "E_DIRECTIVE_BORROWED");
  assert.strictEqual(await failureOf(() => analyze({ "a.test.mjs": container("// @tid alpha") })), "E_DIRECTIVE_BORROWED");
  assert.strictEqual(await failureOf(() => analyze({
    "a.test.mjs": src(...head, `// @src ${REQ}`, "before(() => { assert.ok(1); });", 'test("n", () => { assert.ok(1); });'),
  })), "E_DIRECTIVE_BORROWED");
});

test("one block that could serve two declarations on the same line is ambiguous", async () => {
  assert.strictEqual(await rejects(simple(
    `// @src ${REQ}`,
    'test("one", () => { assert.ok(1); }); test("two", () => { assert.ok(1); });',
  )), "E_DIRECTIVE_AMBIGUOUS");
});

// Covers the component-local cardinality half of AC98 only -- see the section note above. The
// head-side zero-@src rule (INV-B2) is the pipeline's and is not asserted anywhere in this file.
test("exactly one @src per declaration, whether or not the second one repeats the first", async () => {
  assert.strictEqual(await rejects(simple(`// @src ${REQ}`, `// @src ${DEC}`, 'test("n", () => { assert.ok(1); });')), "E_TAG_CARDINALITY");
  assert.strictEqual(await rejects(simple(`// @src ${REQ}`, `// @src ${REQ}`, 'test("n", () => { assert.ok(1); });')), "E_TAG_CARDINALITY");
  const declaration = await only(simple(`// @src ${REQ}`, "// @tid alpha", 'test("n", () => { assert.ok(1); });'));
  assert.deepStrictEqual(declaration.tag, { clauseRef: REQ });
  assert.strictEqual(declaration.stableId, "alpha");
  // A declaration with no @src reports tag: null and is NOT rejected here. Deciding whether that
  // is legal needs to know whether this view is base or head, which the component cannot know.
  const untagged = await only(simple('test("n", () => { assert.ok(1); });'));
  assert.strictEqual(untagged.tag, null);
});

test("@tid is an identity hint: zero or one per declaration, never a substitute for @src", async () => {
  const untagged = await only(simple("// @tid alpha", 'test("n", () => { assert.ok(1); });'));
  assert.strictEqual(untagged.tag, null, "a @tid alone leaves the declaration untagged at the tag layer");
  assert.strictEqual(untagged.structuralId, "tid:alpha");
  assert.strictEqual(await rejects(simple("// @tid alpha", "// @tid beta", 'test("n", () => { assert.ok(1); });')), "E_TID_CARDINALITY");
  for (const bad of ["// @tid -leading", "// @tid has space", "// @tid ", `// @tid ${"x".repeat(65)}`]) {
    assert.strictEqual(await rejects(simple(bad, 'test("n", () => { assert.ok(1); });')), "E_DIRECTIVE_MALFORMED", bad);
  }
});

test("the directive-intent predicate reads the payload's start, not the whole line", async () => {
  // Each of these is a candidate once leading blanks are dropped from the payload, and none of them
  // matches the exact form, so each is malformed rather than demoted to an ordinary comment.
  const malformed = [
    `//@src ${REQ}`,
    `//  @src ${REQ}`,
    `//\t@src ${REQ}`,
    `// @src  ${REQ}`,
    `// @src ${REQ} `,
    `// @src ${REQ} // note`,
    "//@tid alpha",
    "//  @tid alpha",
    "//\t@tid alpha",
    "// @tid  alpha",
    "// @tid alpha ",
  ];
  for (const line of malformed) {
    assert.strictEqual(await rejects(simple(line, 'test("n", () => { assert.ok(1); });')), "E_DIRECTIVE_MALFORMED", JSON.stringify(line));
  }
  // The counterpart that must NOT fail: the payload starts with "explanation", so there is no
  // directive intent at all. This pair separates "judge intent from the payload's first bytes" from
  // "search the whole line for @src", which is the mistake it is here to catch.
  const declaration = await only(simple("// explanation of @src and @tid usage", `// @src ${REQ}`, 'test("n", () => { assert.ok(1); });'));
  assert.deepStrictEqual(declaration.tag, { clauseRef: REQ });
  // Indentation before "//" is allowed by the exact form itself.
  const indented = await only(simple("const marker = 1;", `  // @src ${REQ}`, '  test("n", () => { assert.ok(marker); });'));
  assert.deepStrictEqual(indented.tag, { clauseRef: REQ });
});

// ---------------------------------------------------------------------------------------------
// Canonical tag grammar and the upstream ULID authority  (AC151, AC148)
// ---------------------------------------------------------------------------------------------

test("AC151 positives: the three accepted tag shapes parse to the expected refs", async () => {
  const expectations = [
    [`@src ${REQ}`, { clauseRef: REQ }],
    [`@src ${DEC}`, { clauseRef: DEC }],
    [`@src ${REQ}@${DP}`, { clauseRef: REQ, dpRef: DP }],
  ];
  for (const [directive, expected] of expectations) {
    const declaration = await only(simple(`// ${directive}`, 'test("n", () => { assert.ok(1); });'));
    assert.deepStrictEqual(declaration.tag, expected, directive);
  }
  const expl = await only(simple("// @src EXPL", 'test("n", () => { assert.ok(1); });'));
  assert.deepStrictEqual(expl.tag, { expl: true });
});

test("AC151 negatives: every non-canonical ULID class is a malformed candidate, never a comment", async () => {
  const lower = `req-${ULID_MIN}`;
  const cases = {
    "clause overflow": `REQ-8${ULID_MIN.slice(1)}`,
    "dpRef overflow": `${REQ}@DP-8${ULID_MAX.slice(1)}`,
    "clause one byte short": `REQ-${ULID_MIN.slice(1)}`,
    "clause one byte long": `REQ-${ULID_MIN}0`,
    "dpRef one byte short": `${REQ}@DP-${ULID_MAX.slice(1)}`,
    "dpRef one byte long": `${REQ}@DP-${ULID_MAX}Z`,
    "lowercase prefix": lower,
    "lowercase body": `REQ-${ULID_MAX.toLowerCase()}`,
    "contains I": `REQ-I${ULID_MIN.slice(1)}`,
    "contains L": `REQ-${ULID_MIN.slice(0, 5)}L${ULID_MIN.slice(6)}`,
    "contains O": `REQ-${ULID_MIN.slice(0, 5)}O${ULID_MIN.slice(6)}`,
    "contains U": `REQ-${ULID_MIN.slice(0, 5)}U${ULID_MIN.slice(6)}`,
    "contains whitespace": `REQ-${ULID_MIN.slice(0, 5)} ${ULID_MIN.slice(6)}`,
    "non-ascii": `REQ-${ULID_MIN.slice(0, 25)}\u03a9`,
    "extra suffix": `${REQ}extra`,
    "prefix only": "REQ-abc",
    "DEC with qualifier": `${DEC}@${DP}`,
    "ASSUM with qualifier": `ASSUM-${ULID_MIN}@${DP}`,
    "two qualifiers": `${REQ}@${DP}@${DP}`,
  };
  for (const [label, token] of Object.entries(cases)) {
    assert.strictEqual(await rejects(simple(`// @src ${token}`, 'test("n", () => { assert.ok(1); });')),
      "E_DIRECTIVE_MALFORMED", `${label}: ${token}`);
  }
  // ASSUM without a qualifier is a perfectly good clauseRef, so the rejection above is about the
  // qualifier and not about the prefix.
  const assum = await only(simple(`// @src ASSUM-${ULID_MIN}`, 'test("n", () => { assert.ok(1); });'));
  assert.deepStrictEqual(assum.tag, { clauseRef: `ASSUM-${ULID_MIN}` });
});

test("REQ@DP is parsed structurally here; whether it is exception-backed is not this layer's call", async () => {
  const declaration = await only(simple(`// @src ${REQ}@${DP}`, 'test("n", () => { assert.ok(1); });'));
  assert.deepStrictEqual(declaration.tag, { clauseRef: REQ, dpRef: DP });
  // The component never opens the provenance store, so it cannot and does not decide exception
  // backing. That check belongs to the inventory pipeline against captured store pre-state, and
  // nothing here weakens it: the end-to-end legal set is unchanged.
  assert.strictEqual(Object.prototype.hasOwnProperty.call(declaration, "exceptionBacked"), false);
});

// ---------------------------------------------------------------------------------------------
// structuralId  (AC102, AC103, AC143, AC99, AC101)
// ---------------------------------------------------------------------------------------------

test("the derived key is the container chain plus the declaration name", async () => {
  const result = await analyze({
    "a.test.mjs": src(
      'import test, { describe } from "node:test";',
      'import assert from "node:assert";',
      'describe("outer", () => {',
      '  describe("inner", () => {',
      '    test("leaf", () => { assert.ok(1); });',
      "  });",
      '  test("mid", () => { assert.ok(1); });',
      "});",
      'test("top", () => { assert.ok(1); });',
    ),
  });
  const byName = Object.fromEntries(result.declarations.map((d) => [d.declarationName, d]));
  assert.strictEqual(byName.leaf.structuralId, 's:["outer","inner","leaf"]');
  assert.strictEqual(byName.mid.structuralId, 's:["outer","mid"]');
  assert.strictEqual(byName.top.structuralId, 's:["top"]');
  assert.deepStrictEqual(byName.leaf.containerChain, ["outer", "inner"]);
});

test("four spellings of one StringValue are one name, and one duplicate group", async () => {
  const spellings = ['test("same", () => {});', "test('same', () => {});", "test(`same`, () => {});", 'test("\\x73ame", () => {});'];
  // Each spelling alone yields the same derived key.
  const ids = [];
  for (const line of spellings) ids.push((await only(simple(line))).structuralId);
  assert.deepStrictEqual(ids, ['s:["same"]', 's:["same"]', 's:["same"]', 's:["same"]']);
  // Together they collide, so every member needs its own @tid.
  assert.strictEqual(await rejects(simple(...spellings)), "E_STRUCTURAL_DUPLICATE");
  const tagged = await analyze(simple(...spellings.flatMap((line, i) => [`// @tid dup-${i}`, line])));
  assert.deepStrictEqual(tagged.declarations.map((d) => d.structuralId), ["tid:dup-0", "tid:dup-1", "tid:dup-2", "tid:dup-3"]);
});

test("names are neither trimmed nor case-folded", async () => {
  const plain = await only(simple('test("same", () => {});'));
  const trailing = await only(simple('test("same ", () => {});'));
  const cased = await only(simple('test("Same", () => {});'));
  assert.notStrictEqual(trailing.structuralId, plain.structuralId);
  assert.notStrictEqual(cased.structuralId, plain.structuralId);
});

test("a duplicate group missing even one @tid is fatal", async () => {
  assert.strictEqual(await rejects(simple("// @tid one", 'test("same", () => {});', 'test("same", () => {});')), "E_STRUCTURAL_DUPLICATE");
});

test("@tid takes priority over the derived key, and reorder or move leave identity alone", async () => {
  const first = await only(simple("// @tid stable", 'test("n", () => { assert.ok(1); });'));
  assert.strictEqual(first.structuralId, "tid:stable");

  const ordered = await analyze(simple('test("alpha", () => {});', 'test("beta", () => {});'));
  const reordered = await analyze(simple('test("beta", () => {});', 'test("alpha", () => {});'));
  assert.deepStrictEqual(
    ordered.declarations.map((d) => d.structuralId).sort(),
    reordered.declarations.map((d) => d.structuralId).sort(),
    "lexical position is not part of the key",
  );

  // path is not in the key either, so a pure move keeps identity.
  const body = src(...HEAD, 'test("n", () => { assert.ok(1); });');
  const here = await analyze({ "a.test.mjs": body });
  const there = await analyze({ "deep/nest/b.test.mjs": body }, "deep/nest/b.test.mjs");
  assert.strictEqual(here.declarations[0].structuralId, there.declarations[0].structuralId);
  assert.strictEqual(here.declarations[0].declarationDigest, there.declarations[0].declarationDigest);
});

test("@tid uniqueness is checked per view, across files, before anything matches", async () => {
  const one = src(...HEAD, "// @tid shared", 'test("n", () => { assert.ok(1); });');
  const view = viewOf({ "a.test.mjs": one, "b.test.mjs": one });
  // Base holding it once and head holding it once is the normal unchanged/moved pair and is legal;
  // this failure is about ONE view holding it twice.
  const code = await failureOf(() => analyzeView({ view, modulePaths: ["a.test.mjs", "b.test.mjs"] }));
  assert.strictEqual(code, "E_TID_DUPLICATE");
  const single = await analyzeView({ view: viewOf({ "a.test.mjs": one }), modulePaths: ["a.test.mjs"] });
  assert.strictEqual(single.modules[0].declarations[0].structuralId, "tid:shared");
  // The same ID in a different view is a matching pair, not a duplicate.
  const moved = await analyzeView({ view: viewOf({ "moved/b.test.mjs": one }), modulePaths: ["moved/b.test.mjs"] });
  assert.strictEqual(moved.modules[0].declarations[0].structuralId, "tid:shared");
  assert.strictEqual(await failureOf(() => analyzeView({ view, modulePaths: ["a.test.mjs", "a.test.mjs"] })), "E_API_ARGUMENTS");
});

test("two declarations in one module cannot share a @tid", async () => {
  assert.strictEqual(await rejects(simple("// @tid same", 'test("a", () => {});', "// @tid same", 'test("b", () => {});')), "E_TID_DUPLICATE");
});

// ---------------------------------------------------------------------------------------------
// Canonical declaration range and bytes  (AC105, AC106, AC139, AC140)
// ---------------------------------------------------------------------------------------------

const digestOfSource = async (...body) => (await only(simple(...body))).declarationDigest;

test("the range is the outermost ExpressionStatement, so a semicolon is inside it", async () => {
  const withSemicolon = await digestOfSource(`// @src ${REQ}`, 'test("n", () => { assert.ok(1); });');
  const without = await digestOfSource(`// @src ${REQ}`, 'test("n", () => { assert.ok(1); })');
  assert.notStrictEqual(withSemicolon, without, "a lone semicolon must move the digest");
});

test("bytes after the statement are outside the range", async () => {
  const bare = await digestOfSource(`// @src ${REQ}`, 'test("n", () => { assert.ok(1); });');
  const commented = await digestOfSource(`// @src ${REQ}`, 'test("n", () => { assert.ok(1); }); // trailing note');
  const spaced = await digestOfSource(`// @src ${REQ}`, 'test("n", () => { assert.ok(1); });   ');
  assert.strictEqual(commented, bare, "a trailing inline comment is not in the range");
  assert.strictEqual(spaced, bare, "trailing whitespace is not in the range");
});

test("with a block the range starts at the block's line-start byte, indentation included", async () => {
  const flush = await digestOfSource(`// @src ${REQ}`, 'test("n", () => { assert.ok(1); });');
  const indented = await digestOfSource(`    // @src ${REQ}`, 'test("n", () => { assert.ok(1); });');
  assert.notStrictEqual(indented, flush, "the block line's own indentation is inside the range");

  const noteA = await digestOfSource("// note A", `// @src ${REQ}`, 'test("n", () => { assert.ok(1); });');
  const noteB = await digestOfSource("// note B", `// @src ${REQ}`, 'test("n", () => { assert.ok(1); });');
  assert.notStrictEqual(noteA, noteB, "an ordinary comment inside the block is inside the range");
});

test("with no block the range starts at the statement, so its own indentation is outside", async () => {
  const flush = await digestOfSource('test("n", () => { assert.ok(1); });');
  const indented = await digestOfSource('   test("n", () => { assert.ok(1); });');
  assert.strictEqual(indented, flush);
});

test("a legally attached @tid line and its terminator leave the canonical bytes", async () => {
  const base = await only(simple(`// @src ${REQ}`, 'test("n", () => { assert.ok(1); });'));
  const withTid = await only(simple(`// @src ${REQ}`, "// @tid alpha", 'test("n", () => { assert.ok(1); });'));
  const swapped = await only(simple("// @tid alpha", `// @src ${REQ}`, 'test("n", () => { assert.ok(1); });'));
  const renamed = await only(simple(`// @src ${REQ}`, "// @tid beta", 'test("n", () => { assert.ok(1); });'));

  assert.strictEqual(withTid.declarationDigest, base.declarationDigest, "@tid does not enter the digest");
  assert.strictEqual(swapped.declarationDigest, withTid.declarationDigest, "swapping @src and @tid removes the same line");
  assert.strictEqual(renamed.declarationDigest, withTid.declarationDigest, "the @tid value does not enter the digest");
  assert.notStrictEqual(renamed.structuralId, withTid.structuralId, "but it does change identity");
  assert.ok(!withTid.canonicalDeclarationBytes.includes(B("@tid")), "no @tid text survives");
  assert.ok(!withTid.canonicalDeclarationBytes.includes(B("\r")), "and no CR is left at the seam");

  // An ordinary comment in the same block is not removed.
  const noted = await only(simple(`// @src ${REQ}`, "// @tid alpha", "// ordinary", 'test("n", () => { assert.ok(1); });'));
  assert.notStrictEqual(noted.declarationDigest, withTid.declarationDigest);
});

test("a malformed or unattached @tid is never quietly removed -- it fails first", async () => {
  assert.strictEqual(await rejects(simple(`// @src ${REQ}`, "// @tid not valid", 'test("n", () => { assert.ok(1); });')), "E_DIRECTIVE_MALFORMED");
  assert.strictEqual(await rejects(simple("// @tid alpha", "", `// @src ${REQ}`, 'test("n", () => { assert.ok(1); });')), "E_DIRECTIVE_UNATTACHED");
});

test("CRLF and LF are the same declaration after normalization, but not the same raw bytes", async () => {
  const text = src(...HEAD, `// @src ${REQ}`, "// @tid alpha", 'test("n", () => { assert.ok(1); });');
  const helper = src('import assert from "node:assert";', "export function helper() { assert.ok(1); }");
  const lfView = viewOf({ "a.test.mjs": text, "h.mjs": helper });
  const crlfView = createContentView({
    "a.test.mjs": B(text.replace(/\n/g, "\r\n")),
    "h.mjs": B(helper.replace(/\n/g, "\r\n")),
  });
  const lf = (await analyzeModule({ view: lfView, path: "a.test.mjs" })).declarations[0];
  const crlf = (await analyzeModule({ view: crlfView, path: "a.test.mjs" })).declarations[0];
  assert.strictEqual(crlf.declarationDigest, lf.declarationDigest);
  assert.strictEqual(crlf.effectiveOracleDigest, lf.effectiveOracleDigest);
  assert.strictEqual(crlf.bodyDigest, lf.bodyDigest);
  assert.ok(!crlf.canonicalDeclarationBytes.includes(B("\r")));
  // The raw bytes really are different: the S1 view digest is taken over raw bytes and would
  // separate these two files. The two layers are deliberately not the same.
  const raw = (s) => crypto.createHash("sha256").update(B(s)).digest("hex");
  assert.notStrictEqual(raw(text.replace(/\n/g, "\r\n")), raw(text));
});

// ---------------------------------------------------------------------------------------------
// Fixture hooks  (AC144)
// ---------------------------------------------------------------------------------------------

const HOOK_HEAD = ['import test, { describe, before, after } from "node:test";', 'import assert from "node:assert";'];

test("a hook depRef is the callback BlockStatement's byte range, braces included", async () => {
  const declaration = await only({
    "a.test.mjs": src(...HOOK_HEAD, "before((ctx) => { assert.ok(ctx); });", 'test("n", () => { assert.ok(1); });'),
  });
  assert.strictEqual(declaration.effectiveOracleDeps.length, 1);
  const span = declaration.effectiveOracleDeps[0].span;
  assert.strictEqual(span.kind, "byte-range");
  const bytes = B(src(...HOOK_HEAD, "before((ctx) => { assert.ok(ctx); });", 'test("n", () => { assert.ok(1); });'));
  const sliced = bytes.subarray(span.startInclusive, span.endExclusive).toString("utf8");
  assert.strictEqual(sliced, "{ assert.ok(ctx); }", "the span covers the block, opening and closing brace included");
});

test("the span is an absolute offset, so an equal-length rename moves nothing and a shorter one shifts both ends", async () => {
  const build = (param) => ({
    "a.test.mjs": src(...HOOK_HEAD, `before((${param}) => { assert.ok(1); });`, 'test("n", () => { assert.ok(1); });'),
  });
  const ctx = (await only(build("ctx"))).effectiveOracleDeps[0].span;
  const arg = (await only(build("arg"))).effectiveOracleDeps[0].span;
  const short = (await only(build("t"))).effectiveOracleDeps[0].span;
  assert.deepStrictEqual(arg, ctx, "ctx and arg are both three bytes, so the body does not move");
  assert.strictEqual(short.startInclusive, ctx.startInclusive - 2);
  assert.strictEqual(short.endExclusive, ctx.endExclusive - 2);
});

test("hook applicability: program scope, ancestors and current container apply; siblings and descendants do not", async () => {
  const result = await analyze({
    "a.test.mjs": src(
      ...HOOK_HEAD,
      "before(() => { assert.ok(1); });",
      'describe("outer", () => {',
      "  before(() => { assert.ok(2); });",
      '  describe("inner", () => {',
      "    before(() => { assert.ok(3); });",
      '    test("leaf", () => { assert.ok(1); });',
      "  });",
      '  describe("sibling", () => {',
      "    before(() => { assert.ok(4); });",
      '    test("cousin", () => { assert.ok(1); });',
      "  });",
      "});",
      'test("top", () => { assert.ok(1); });',
    ),
  });
  const spansFor = (name) => result.declarations.find((d) => d.declarationName === name)
    .effectiveOracleDeps.filter((d) => d.span.kind === "byte-range").map((d) => d.span.startInclusive);
  const hookStart = (n) => result.hooks[n].span.startInclusive;

  assert.deepStrictEqual(spansFor("top"), [hookStart(0)], "a program-scope test sees only the program-scope hook");
  assert.deepStrictEqual(spansFor("leaf").sort((a, b) => a - b), [hookStart(0), hookStart(1), hookStart(2)].sort((a, b) => a - b),
    "program scope plus every ancestor plus the current container");
  assert.ok(!spansFor("leaf").includes(hookStart(3)), "a sibling container's hook does not apply");
  assert.ok(!spansFor("cousin").includes(hookStart(2)), "and neither does the other sibling's");
  // The program-scope test does not pick up any descendant container hook.
  assert.strictEqual(spansFor("top").length, 1);
});

test("a hook placed after the test it applies to is exactly as applicable", async () => {
  const before = await only({ "a.test.mjs": src(...HOOK_HEAD, "after(() => { assert.ok(1); });", 'test("n", () => { assert.ok(1); });') });
  const after = await only({ "a.test.mjs": src(...HOOK_HEAD, 'test("n", () => { assert.ok(1); });', "after(() => { assert.ok(1); });") });
  assert.strictEqual(before.effectiveOracleDeps.length, 1);
  assert.strictEqual(after.effectiveOracleDeps.length, 1);
  assert.strictEqual(before.effectiveOracleDeps[0].span.kind, "byte-range");
  assert.strictEqual(after.effectiveOracleDeps[0].span.kind, "byte-range");
});

test("a hook inside an ordinary function is not a fixture declaration", async () => {
  assert.strictEqual(await failureOf(() => analyze({
    "a.test.mjs": src(...HOOK_HEAD, "function register() { before(() => {}); }", 'test("n", () => { assert.ok(1); });'),
  })), "E_PLACEMENT");
});

test("a hook body is expanded like any other oracle node", async () => {
  const declaration = await only({
    "a.test.mjs": src(
      'import test, { before } from "node:test";',
      'import assert from "node:assert";',
      'import { helper } from "./h.mjs";',
      "before(() => { helper(); });",
      'test("n", () => { assert.ok(1); });',
    ),
    "h.mjs": src('import assert from "node:assert";', "export function helper() { assert.ok(1); }"),
  });
  const paths = declaration.effectiveOracleDeps.map((d) => `${d.path}:${d.span.kind}`);
  assert.deepStrictEqual(paths, ["a.test.mjs:byte-range", "h.mjs:whole-file"]);
});

// ---------------------------------------------------------------------------------------------
// Assertion helpers, cross-module resolution, cycles  (AC145, AC146, AC147, AC109, AC110, AC112)
// ---------------------------------------------------------------------------------------------

test("the callable subset accepts function declarations and const-bound function or arrow expressions", async () => {
  for (const form of ["function helper() { assert.ok(1); }", "const helper = () => { assert.ok(1); };", "const helper = function () { assert.ok(1); };"]) {
    const declaration = await only(simple(form, 'test("n", () => { helper(); });'));
    assert.deepStrictEqual(declaration.effectiveOracleDeps, [{ path: "a.test.mjs", span: { kind: "whole-file" } }], form);
  }
});

test("every excluded callable form is fail-closed", async () => {
  const cases = [
    ["let helper = () => { assert.ok(1); };", "E_ORACLE_BINDING"],
    ["var helper = () => { assert.ok(1); };", "E_ORACLE_BINDING"],
    ["function helper() { assert.ok(1); }\nhelper = () => {};", "E_ORACLE_BINDING"],
    ["const bag = { helper() { assert.ok(1); } };\nconst { helper } = bag;", "E_ORACLE_BINDING"],
    ["const helper = () => assert.ok(1);", "E_ORACLE_BINDING"],
    ["function* helper() { assert.ok(1); }", "E_ORACLE_BINDING"],
  ];
  for (const [declaration, code] of cases) {
    assert.strictEqual(await rejects(simple(...declaration.split("\n"), 'test("n", () => { helper(); });')), code, declaration);
  }
  // Member, computed and optional-chain call targets are not direct identifier calls at all.
  assert.strictEqual(await rejects(simple("const bag = { helper() {} };", 'test("n", () => { bag.helper(); });')), "E_ORACLE_UNCLASSIFIED");
  assert.strictEqual(await rejects(simple("const bag = { helper() {} };", 'test("n", () => { bag?.helper(); });')), "E_ORACLE_UNCLASSIFIED");
  assert.strictEqual(await rejects(simple("const bag = { helper() {} };", 'const k = "helper";', 'test("n", () => { bag[k](); });')), "E_UNSUPPORTED_SYNTAX");
  assert.strictEqual(await rejects(simple("class Bag { helper() {} }", 'test("n", () => { Bag.helper(); });')), "E_ORACLE_UNCLASSIFIED");
});

test("cross-module resolution: every supported import form and every supported export form", async () => {
  const helperBody = (declaration) => src('import assert from "node:assert";', declaration);
  const cases = [
    ['import { helper } from "./h.mjs";', "export function helper() { assert.ok(1); }", "helper()"],
    ['import { helper as h } from "./h.mjs";', "export const helper = () => { assert.ok(1); };", "h()"],
    ['import helper from "./h.mjs";', "export default function () { assert.ok(1); }", "helper()"],
    ['import helper from "./h.mjs";', "export default () => { assert.ok(1); };", "helper()"],
    ['import { helper } from "./h.mjs";', "function local() { assert.ok(1); }\nexport { local as helper };", "helper()"],
    ['import { local } from "./h.mjs";', "function local() { assert.ok(1); }\nexport { local };", "local()"],
  ];
  for (const [importLine, exportLine, call] of cases) {
    const declaration = await only({
      "a.test.mjs": src(...HEAD, importLine, `test("n", () => { ${call}; });`),
      "h.mjs": helperBody(exportLine),
    });
    assert.deepStrictEqual(declaration.effectiveOracleDeps, [{ path: "h.mjs", span: { kind: "whole-file" } }], `${importLine} / ${exportLine}`);
  }
  // A nested relative path resolves against the importer's directory.
  const nested = await only({
    "deep/a.test.mjs": src(...HEAD, 'import { helper } from "../lib/h.mjs";', 'test("n", () => { helper(); });'),
    "lib/h.mjs": helperBody("export function helper() { assert.ok(1); }"),
  }, "deep/a.test.mjs");
  assert.deepStrictEqual(nested.effectiveOracleDeps, [{ path: "lib/h.mjs", span: { kind: "whole-file" } }]);
});

test("cross-module resolution negatives", async () => {
  const helper = src('import assert from "node:assert";', "export function helper() { assert.ok(1); }");
  const withHelper = (importLine, files = {}) => ({
    "a.test.mjs": src(...HEAD, importLine, 'test("n", () => { helper(); });'),
    "h.mjs": helper,
    ...files,
  });
  // The extension rule is checked at the binding, so an unsupported specifier fails whether or not
  // anything on the traversal path calls it.
  assert.strictEqual(await rejects(withHelper('import { helper } from "./h";')), "E_UNSUPPORTED_IMPORT", "extensionless");
  assert.strictEqual(await rejects(withHelper('import { helper } from "./lib";', { "lib/index.mjs": helper })), "E_UNSUPPORTED_IMPORT", "directory index");
  assert.strictEqual(await rejects(withHelper('import { missing as helper } from "./h.mjs";')), "E_ORACLE_RESOLVE", "no such export");
  assert.strictEqual(await rejects(withHelper('import { helper } from "./absent.mjs";')), "E_MODULE_MISSING", "not in the view");
  assert.strictEqual(await rejects(withHelper('import { helper } from "lodash";')), "E_UNSUPPORTED_IMPORT", "bare package");
  assert.strictEqual(await rejects({
    "a.test.mjs": src(...HEAD, 'import * as h from "./h.mjs";', 'test("n", () => { h.helper(); });'), "h.mjs": helper,
  }), "E_ORACLE_UNCLASSIFIED", "namespace import");
  // A re-export never reaches the component: the manifest lists it as unsupported syntax.
  assert.strictEqual(await rejects(withHelper('import { helper } from "./re.mjs";', { "re.mjs": src('export { helper } from "./h.mjs";') })), "E_UNSUPPORTED_SYNTAX");
  assert.strictEqual(await rejects(withHelper('import { helper } from "./star.mjs";', { "star.mjs": src('export * from "./h.mjs";') })), "E_UNSUPPORTED_SYNTAX");
});

test("lexical specifier normalization: every v1.7 case", async () => {
  const helper = src('import assert from "node:assert";', "export function helper() { assert.ok(1); }");
  const run = (specifier, files = {}) => ({
    "a.test.mjs": src(...HEAD, `import { helper } from ${JSON.stringify(specifier)};`, 'test("n", () => { helper(); });'),
    "h.mjs": helper,
    ...files,
  });
  // Positives: "." and ".." are resolved on a segment stack, and all three spellings land on one path.
  for (const specifier of ["./h.mjs", "./lib/../h.mjs", "./lib/./../h.mjs"]) {
    const declaration = await only(run(specifier));
    assert.deepStrictEqual(declaration.effectiveOracleDeps, [{ path: "h.mjs", span: { kind: "whole-file" } }], specifier);
  }
  const dotted = await only(run("./lib/../h.mjs"));
  const plain = await only(run("./h.mjs"));
  assert.strictEqual(dotted.effectiveOracleDeps[0].path, plain.effectiveOracleDeps[0].path);
  // Negatives.
  assert.strictEqual(await rejects(run("./%68.mjs")), "E_SPECIFIER", "percent is never URL-decoded");
  assert.strictEqual(await rejects(run("./a//h.mjs")), "E_SPECIFIER", "empty segment");
  assert.strictEqual(await rejects(run("../../../outside.mjs")), "E_SPECIFIER", "pop past the repo root");
  assert.strictEqual(await rejects(run(".\\h.mjs")), "E_UNSUPPORTED_IMPORT", "backslash is not a relative specifier at all");
  assert.strictEqual(await rejects(run("./h.mjs?v=1")), "E_UNSUPPORTED_IMPORT", "query");
  assert.strictEqual(await rejects(run("./h.mjs#frag")), "E_UNSUPPORTED_IMPORT", "fragment");
  assert.strictEqual(await rejects(run("/h.mjs")), "E_UNSUPPORTED_IMPORT", "absolute");
});

test(".js helper legality is decided by the nearest ancestor manifest of the HELPER's directory", async () => {
  const helper = src('import assert from "node:assert";', "export function helper() { assert.ok(1); }");
  const build = (manifests) => ({
    "a.test.mjs": src(...HEAD, 'import { helper } from "./lib/h.js";', 'test("n", () => { helper(); });'),
    "lib/h.js": helper,
    ...manifests,
  });
  const rootModule = { "package.json": '{ "type": "module" }\n' };
  const rootCommonjs = { "package.json": '{ "type": "commonjs" }\n' };

  const legal = await only(build(rootModule));
  assert.deepStrictEqual(legal.effectiveOracleDeps, [{ path: "lib/h.js", span: { kind: "whole-file" } }]);

  // One variable: a nearer manifest in the helper's own directory overrides the root one.
  assert.strictEqual(await rejects(build({ ...rootModule, "lib/package.json": '{ "type": "commonjs" }\n' })), "E_PACKAGE_BOUNDARY");
  // And the reverse, which is what shows the search starts at the helper rather than at the test.
  const rescued = await only(build({ ...rootCommonjs, "lib/package.json": '{ "type": "module" }\n' }));
  assert.deepStrictEqual(rescued.effectiveOracleDeps, [{ path: "lib/h.js", span: { kind: "whole-file" } }]);

  for (const manifest of [{}, { "package.json": "{ not json" }, { "package.json": "[]" }, { "package.json": "{}" },
    { "package.json": '{ "type": 1 }' }, { "package.json": '{ "type": "commonjs" }' }]) {
    assert.strictEqual(await rejects(build(manifest)), "E_PACKAGE_BOUNDARY", JSON.stringify(manifest));
  }
  // A .mjs helper never consults a manifest at all.
  const mjs = await only({
    "a.test.mjs": src(...HEAD, 'import { helper } from "./lib/h.mjs";', 'test("n", () => { helper(); });'),
    "lib/h.mjs": helper,
    "package.json": '{ "type": "commonjs" }\n',
  });
  assert.deepStrictEqual(mjs.effectiveOracleDeps, [{ path: "lib/h.mjs", span: { kind: "whole-file" } }]);
});

test("resolution reads the captured view and never the live filesystem", async () => {
  const outside = temporary("ctide-adapter-view-");
  const decoy = path.join(outside, "h.mjs");
  fs.writeFileSync(decoy, src('import assert from "node:assert";', "export function helper() { assert.ok(1); }"), "utf8");
  const before = fs.readFileSync(decoy, "utf8");
  // The view is missing h.mjs even though a file of that name exists on disk in a repo-external
  // directory. The resolver must still fail closed.
  assert.strictEqual(await rejects({ "a.test.mjs": src(...HEAD, 'import { helper } from "./h.mjs";', 'test("n", () => { helper(); });') }), "E_MODULE_MISSING");
  assert.strictEqual(fs.readFileSync(decoy, "utf8"), before, "the decoy was neither read into the analysis nor written to");
});

test("contributors are every callable on the path whose expansion reaches an assertion", async () => {
  const declaration = await only({
    "a.test.mjs": src(...HEAD, 'import { a } from "./chain.mjs";', 'test("n", () => { a(); });'),
    "chain.mjs": src(
      'import assert from "node:assert";',
      'import { deep } from "./deep.mjs";',
      "export function a() { b(); }",
      "function b() { deep(); }",
    ),
    "deep.mjs": src('import assert from "node:assert";', "export function deep() { assert.ok(1); }"),
  });
  assert.deepStrictEqual(declaration.effectiveOracleDeps, [
    { path: "chain.mjs", span: { kind: "whole-file" } },
    { path: "deep.mjs", span: { kind: "whole-file" } },
  ], "a is a contributor because what it reaches asserts, even though a itself does not");
});

test("a SUT callable with no assertion contributes nothing", async () => {
  const files = (body) => ({
    "a.test.mjs": src(...HEAD, 'import { compute } from "./sut.mjs";', 'test("n", () => { compute(); assert.ok(1); });'),
    "sut.mjs": src("export function compute() { return 1; }", body),
  });
  const first = await only(files(""));
  assert.deepStrictEqual(first.effectiveOracleDeps, [], "importing and calling the SUT is a resolution edge, not an oracle edge");
  const second = await only(files("// a change to the SUT and nothing else"));
  assert.strictEqual(second.effectiveOracleDigest, first.effectiveOracleDigest, "so changing it cannot mark the test modified");
  assert.strictEqual(second.declarationDigest, first.declarationDigest);

  // Single variable: give the same callable an assertion, and it becomes an oracle contributor.
  const bearing = await only({
    "a.test.mjs": src(...HEAD, 'import { compute } from "./sut.mjs";', 'test("n", () => { compute(); assert.ok(1); });'),
    "sut.mjs": src('import assert from "node:assert";', "export function compute() { assert.ok(1); return 1; }"),
  });
  assert.deepStrictEqual(bearing.effectiveOracleDeps, [{ path: "sut.mjs", span: { kind: "whole-file" } }]);
});

test("an assertion-bearing production callable is classified conservatively, and that is the intended result", async () => {
  // The rule is structural: reaching an allowlisted assertion makes a callable an oracle
  // contributor whatever the author thinks it is. Over-marking costs one extra review; missing an
  // oracle costs the provenance. Nothing here claims to know a callable's real role.
  const declaration = await only({
    "a.test.mjs": src(...HEAD, 'import { withInvariant } from "./production.mjs";', 'test("n", () => { withInvariant(); assert.ok(1); });'),
    "production.mjs": src('import assert from "node:assert";', "export function withInvariant() { assert.ok(true); }"),
  });
  assert.deepStrictEqual(declaration.effectiveOracleDeps, [{ path: "production.mjs", span: { kind: "whole-file" } }]);
});

test("a cycle terminates without erroring and without double counting", async () => {
  const declaration = await only({
    "a.test.mjs": src(...HEAD, 'import { a } from "./cycle.mjs";', 'test("n", () => { a(); });'),
    "cycle.mjs": src('import assert from "node:assert";', "export function a() { b(); }", "function b() { a(); assert.ok(1); }"),
  });
  assert.deepStrictEqual(declaration.effectiveOracleDeps, [{ path: "cycle.mjs", span: { kind: "whole-file" } }],
    "two contributors in one module collapse to one whole-file depRef");
});

test("an unclassified call on the traversal path is fatal, not an empty closure", async () => {
  assert.strictEqual(await rejects(simple('test("n", () => { console.log(1); });')), "E_ORACLE_UNCLASSIFIED");
  assert.strictEqual(await rejects(simple('test("n", () => { missing(); });')), "E_ORACLE_UNCLASSIFIED");
  assert.strictEqual(await rejects(simple("function outer() { unknown(); }", 'test("n", () => { outer(); });')), "E_ORACLE_UNCLASSIFIED");
  // Only a body whose every edge classified AND which really has no dependency is empty.
  const empty = await only(simple('test("n", () => { assert.ok(1); });'));
  assert.deepStrictEqual(empty.effectiveOracleDeps, []);
});

test("calls inside a function nobody calls are not entered", async () => {
  const declaration = await only(simple('test("n", () => { const later = () => { console.log(1); }; assert.ok(later); });'));
  assert.deepStrictEqual(declaration.effectiveOracleDeps, []);
});

test("a helper called from an argument position is still called", async () => {
  const declaration = await only(simple("function helper() { assert.ok(1); return 1; }", 'test("n", () => { assert.ok(helper()); });'));
  assert.deepStrictEqual(declaration.effectiveOracleDeps, [{ path: "a.test.mjs", span: { kind: "whole-file" } }]);
});

test("base and head expand separately: the same declaration over different helper content", async () => {
  const testModule = src(...HEAD, 'import { helper } from "./h.mjs";', 'test("n", () => { helper(); });');
  const digestFor = async (helperBody) => {
    const view = viewOf({ "a.test.mjs": testModule, "h.mjs": src('import assert from "node:assert";', helperBody) });
    return (await analyzeModule({ view, path: "a.test.mjs" })).declarations[0].effectiveOracleDigest;
  };
  const base = await digestFor("export function helper() { assert.ok(1); }");
  const head = await digestFor("export function helper() { assert.ok(2); }");
  assert.notStrictEqual(head, base, "the helper's content is inside the oracle digest");
});

// ---------------------------------------------------------------------------------------------
// Snapshot golden: the AC153 executable matrix  (AC108, AC111, AC153)
//
// One control fixture for the whole matrix. Every case below changes exactly the dimension it
// names -- the argument-0 StringValue, the AST carrier, where the module sits, whether the target
// is in the view, or an enclosing scope binding -- and holds everything else equal to this.
//
// The discriminator fixtures only work if fixtures/golden.txt EXISTS, which is asserted before the
// matrix runs. A writer that skipped the ./ gate resolves "fixtures/golden.txt" onto it and
// accepts; a writer that percent-decodes resolves "fix%74ures/..." onto it and accepts; a writer
// that hands the literal to a URL parser resolves "file:fixtures/..." onto it and accepts. If the
// target were absent, all three would fail for the wrong reason and prove nothing.
// ---------------------------------------------------------------------------------------------

const GOLDEN = "fixtures/golden.txt";
const CANONICAL_DEP = [{ path: GOLDEN, span: { kind: "whole-file" } }];
const FS_DEFAULT = 'import fs from "node:fs";';

// The control: one module, one test, one snapshot read, and the golden file it reads.
const snapshotControl = (call, files = {}, importLine = FS_DEFAULT) => ({
  "a.test.mjs": src('import test from "node:test";', 'import assert from "node:assert";', importLine,
    `test("n", async () => { ${call} assert.ok(1); });`),
  [GOLDEN]: "golden\n",
  ...files,
});
const snapshotRead = (literal) => `fs.readFileSync(new URL(${literal}, import.meta.url));`;

test("AC153 control: the discriminator target really is in the view", async () => {
  const files = snapshotControl(snapshotRead('"./fixtures/golden.txt"'));
  const control = viewOf(files);
  assert.strictEqual(control.has(GOLDEN), true, "every discriminator below depends on this file existing");
  assert.deepStrictEqual((await only(files)).effectiveOracleDeps, CANONICAL_DEP);
});

test("AC153 positives: prefixed, nested, dot-segment and escaped spellings all reach one canonical depRef", async () => {
  // (1) the plain prefixed form.
  assert.deepStrictEqual((await only(snapshotControl(snapshotRead('"./fixtures/golden.txt"')))).effectiveOracleDeps, CANONICAL_DEP);

  // (2) a nested module resolving against ITS OWN dirname, not the repo root and not a cwd.
  const nested = await only({
    "deep/nest/a.test.mjs": src('import test from "node:test";', 'import assert from "node:assert";', FS_DEFAULT,
      'test("n", () => { fs.readFileSync(new URL("../fixtures/golden.txt", import.meta.url)); assert.ok(1); });'),
    "deep/fixtures/golden.txt": "golden\n",
  }, "deep/nest/a.test.mjs");
  assert.deepStrictEqual(nested.effectiveOracleDeps, [{ path: "deep/fixtures/golden.txt", span: { kind: "whole-file" } }]);
  // A one-line control proving the root is the module's dirname: the same literal from the repo
  // root would name fixtures/golden.txt instead, and does not resolve from deep/nest.
  assert.notStrictEqual(nested.effectiveOracleDeps[0].path, GOLDEN);

  // (3) dot segments resolve lexically to the SAME canonical depRef, compared field by field.
  for (const literal of ['"./lib/../fixtures/golden.txt"', '"./fixtures/./golden.txt"', '"./lib/./../fixtures/golden.txt"']) {
    const declaration = await only(snapshotControl(snapshotRead(literal)));
    assert.deepStrictEqual(declaration.effectiveOracleDeps, CANONICAL_DEP, literal);
  }

  // (4) the decoded StringValue decides, not the raw token. The source really does carry a
  // backslash escape -- asserted on the bytes -- and \x2e decodes to ".".
  const escapedLiteral = `"${String.raw`\x2e`}/fixtures/golden.txt"`;
  const escapedFiles = snapshotControl(snapshotRead(escapedLiteral));
  const sourceBytes = B(escapedFiles["a.test.mjs"]);
  assert.ok(sourceBytes.includes(B(String.raw`\x2e`)), "the fixture must really contain a backslash escape in its source");
  assert.strictEqual(sourceBytes.indexOf(0x5c) >= 0, true, "a literal U+005C must be present in the source bytes");
  assert.deepStrictEqual((await only(escapedFiles)).effectiveOracleDeps, CANONICAL_DEP, "decoded StringValue is ./fixtures/golden.txt");

  // (5) both allowlisted APIs, through every supported binding form, still resolve.
  const apis = [
    [FS_DEFAULT, snapshotRead('"./fixtures/golden.txt"')],
    ['import * as fs from "node:fs";', 'fs.readFile(new URL("./fixtures/golden.txt", import.meta.url), () => {});'],
    ['import { readFileSync } from "node:fs";', 'readFileSync(new URL("./fixtures/golden.txt", import.meta.url));'],
    ['import { readFile } from "node:fs/promises";', 'await readFile(new URL("./fixtures/golden.txt", import.meta.url));'],
    ['import { readFile as read } from "node:fs/promises";', 'await read(new URL("./fixtures/golden.txt", import.meta.url));'],
  ];
  for (const [importLine, call] of apis) {
    assert.deepStrictEqual((await only(snapshotControl(call, {}, importLine))).effectiveOracleDeps, CANONICAL_DEP, call);
  }
});

test("AC153 negatives 1-13: StringValue cases, each fail-closed on its own", async () => {
  // Every literal here would, under some wrong reading, name a real file; none of them is rescued
  // by the target being absent, because fixtures/golden.txt is in the view for all of them.
  const specifierCases = [
    ['"fixtures/golden.txt"', "(1) no ./ or ../ prefix"],
    ['"fix%74ures/golden.txt"', "(2) percent escape, unprefixed"],
    ['"./fix%74ures/golden.txt"', "(3) percent escape, prefixed"],
    ['"C:/golden.txt"', "(4) drive-letter spelling"],
    ['"file:fixtures/golden.txt"', "(5) file: scheme"],
    ['"mailto:golden"', "(6) non-file scheme"],
    ['"/absolute/golden.txt"', "(7) absolute path"],
    ['"./a//golden.txt"', "(8) empty segment"],
    ['"./golden.txt?x"', "(9) query"],
    ['"./golden.txt#x"', "(10) fragment"],
    [`"./dir${String.raw`\\`}golden.txt"`, "(11) backslash in the decoded StringValue"],
    ['"../../../outside.txt"', "(12) pop past the repo root"],
  ];
  for (const [literal, label] of specifierCases) {
    assert.strictEqual(await rejects(snapshotControl(snapshotRead(literal))), "E_SPECIFIER", label);
  }
  // (11) again, on the bytes: two U+005C in the source token, exactly one after decoding.
  const backslashFixture = snapshotControl(snapshotRead(`"./dir${String.raw`\\`}golden.txt"`));
  const bytes = B(backslashFixture["a.test.mjs"]);
  let backslashes = 0;
  for (const byte of bytes) if (byte === 0x5c) backslashes += 1;
  assert.strictEqual(backslashes, 2, "the source token must carry two consecutive U+005C");
  assert.ok(bytes.includes(Buffer.from([0x5c, 0x5c])), "and they must be adjacent");
  assert.strictEqual(JSON.parse(`"./dir${String.raw`\\`}golden.txt"`), `./dir${String.fromCharCode(0x5c)}golden.txt`,
    "which decodes to exactly one U+005C");

  // (13) a perfectly canonical path whose target is not in the view. This is the ONLY case that
  // fails for absence, and it carries its own code.
  assert.strictEqual(await rejects(snapshotControl(snapshotRead('"./fixtures/absent.txt"'))), "E_SNAPSHOT_PATH", "(13) target absent");
});

test("AC153 negatives 14-17: carrier, shadowing and non-literal argument", async () => {
  // (14) new.target is a MetaProperty too, so a type-only check would let this resolve.
  assert.strictEqual(await rejects(snapshotControl(
    "outer();", { "a.test.mjs": src('import test from "node:test";', 'import assert from "node:assert";', FS_DEFAULT,
      'function outer() { fs.readFileSync(new URL("./fixtures/golden.txt", new.target.url)); }',
      'test("n", () => { outer(); assert.ok(1); });') },
  )), "E_SNAPSHOT_FORM", "(14) new.target.url");

  // (15) import.meta["url"] is a computed member, which the vendored parse rejects for the whole
  // module before the component sees a tree. Still fail-closed, one layer earlier, and the parser
  // is not relaxed to move it.
  assert.strictEqual(await rejects(snapshotControl('fs.readFileSync(new URL("./fixtures/golden.txt", import.meta["url"]));')),
    "E_UNSUPPORTED_SYNTAX", "(15) import.meta[\"url\"]");

  // (16) URL shadowed by a local, an import and a parameter.
  assert.strictEqual(await rejects(snapshotControl(snapshotRead('"./fixtures/golden.txt"'), {
    "a.test.mjs": src('import test from "node:test";', 'import assert from "node:assert";', FS_DEFAULT,
      "const URL = null;", `test("n", () => { ${snapshotRead('"./fixtures/golden.txt"')} assert.ok(1); });`),
  })), "E_SNAPSHOT_FORM", "(16a) local binding shadows URL");
  assert.strictEqual(await rejects({
    "a.test.mjs": src('import test from "node:test";', 'import assert from "node:assert";', FS_DEFAULT,
      'import { URL } from "./shim.mjs";', `test("n", () => { ${snapshotRead('"./fixtures/golden.txt"')} assert.ok(1); });`),
    "shim.mjs": src("export const URL = null;"),
    [GOLDEN]: "golden\n",
  }), "E_SNAPSHOT_FORM", "(16b) import binding shadows URL");
  assert.strictEqual(await rejects({
    "a.test.mjs": src('import test from "node:test";', 'import assert from "node:assert";', FS_DEFAULT,
      `function outer(URL) { ${snapshotRead('"./fixtures/golden.txt"')} assert.ok(1); }`,
      'test("n", () => { outer(null); });'),
    [GOLDEN]: "golden\n",
  }), "E_SNAPSHOT_FORM", "(16c) parameter shadows URL");

  // (17) an uninterpolated template literal and a variable are both non-literal arguments.
  assert.strictEqual(await rejects(snapshotControl("fs.readFileSync(new URL(`./fixtures/golden.txt`, import.meta.url));")),
    "E_SNAPSHOT_FORM", "(17a) uninterpolated template literal");
  assert.strictEqual(await rejects(snapshotControl(
    'const where = "./fixtures/golden.txt"; fs.readFileSync(new URL(where, import.meta.url));')),
  "E_SNAPSHOT_FORM", "(17b) variable argument");
});

test("AC153 discriminators: what each negative can and cannot prove", async () => {
  // (1) is the one that separates a literal-as-POSIX writer with no prefix gate: read as ordinary
  // POSIX text it lands on the control's own target, which exists, so such a writer accepts it.
  const control = viewOf(snapshotControl(snapshotRead('"./fixtures/golden.txt"')));
  assert.strictEqual(control.has(GOLDEN), true);
  assert.strictEqual(await rejects(snapshotControl(snapshotRead('"fixtures/golden.txt"'))), "E_SPECIFIER");

  // (2), (3) and (5) are the three that separate a WHATWG/percent-decoding writer: each resolves,
  // under WHATWG file-URL semantics, onto that same existing target. This asserts the premise
  // rather than asserting it in prose.
  const moduleUrl = "file:///repo/a.test.mjs";
  for (const literal of ["fix%74ures/golden.txt", "./fix%74ures/golden.txt", "file:fixtures/golden.txt"]) {
    const resolved = decodeURIComponent(new URL(literal, moduleUrl).pathname);
    assert.strictEqual(resolved, `/repo/${GOLDEN}`, `${literal} would resolve onto the existing target`);
  }
  // (4), (6) and (7) are mandatory negatives but do NOT separate that writer on their own: under
  // the same semantics (4) and (6) stop being file URLs at all, and (7) is a repo-boundary case a
  // compliant writer and a guarded WHATWG writer both reject.
  assert.notStrictEqual(new URL("C:/golden.txt", moduleUrl).protocol, "file:");
  assert.notStrictEqual(new URL("mailto:golden", moduleUrl).protocol, "file:");
  assert.strictEqual(new URL("/absolute/golden.txt", moduleUrl).pathname, "/absolute/golden.txt");
});

test("snapshot-golden negatives that are about the API and the binding, not the path", async () => {
  // Each of these carries a legal ./ prefix, so the prefix gate cannot be what rejects it.
  const build = (importLine, call, files = {}) => ({
    "a.test.mjs": src('import test from "node:test";', 'import assert from "node:assert";', importLine, `test("n", async () => { ${call} assert.ok(1); });`),
    [GOLDEN]: "golden\n",
    ...files,
  });
  assert.strictEqual(await rejects(build(FS_DEFAULT, 'fs.readdirSync(new URL("./fixtures", import.meta.url));')), "E_SNAPSHOT_FORM", "API off the allowlist");
  assert.strictEqual(await rejects(build('import { readFileSync } from "node:fs/promises";', 'readFileSync(new URL("./fixtures/golden.txt", import.meta.url));')), "E_SNAPSHOT_FORM", "readFileSync is not a node:fs/promises API here");
  assert.strictEqual(await rejects(build(FS_DEFAULT, 'fs.readFileSync("./fixtures/golden.txt");')), "E_SNAPSHOT_FORM", "bare literal with no URL carrier");
  assert.strictEqual(await rejects(build(FS_DEFAULT, 'fs.readFileSync(new URL("./fixtures/golden.txt", "file:///elsewhere/"));')), "E_SNAPSHOT_FORM", "resolution root is not import.meta.url");
  assert.strictEqual(await rejects(build('import { readFile } from "node:fs";', 'readFile.call(null, new URL("./fixtures/golden.txt", import.meta.url));')), "E_SNAPSHOT_FORM", "member call on an fs function binding");
  assert.strictEqual(await rejects(build(FS_DEFAULT, 'fs.readFileSync(new URL("./fixtures/golden.txt"));')), "E_SNAPSHOT_FORM", "new URL with one argument");
  // A JSON import is no longer an edge kind at all, so it falls into unsupported rather than being
  // read as expected data.
  assert.strictEqual(await rejects({
    "a.test.mjs": src('import test from "node:test";', 'import assert from "node:assert";', 'import expected from "./expected.json";', 'test("n", () => { assert.ok(expected); });'),
    "expected.json": "{}\n",
  }), "E_UNSUPPORTED_IMPORT");
});

// ---------------------------------------------------------------------------------------------
// depRef ordering and de-duplication  (AC112)
// ---------------------------------------------------------------------------------------------

test("depRefs come back sorted by path then span, de-duplicated, and independent of discovery order", async () => {
  const helper = (name) => src('import assert from "node:assert";', `export function ${name}() { assert.ok(1); }`);
  const order = (first, second) => ({
    "a.test.mjs": src(
      'import test, { before } from "node:test";',
      'import assert from "node:assert";',
      'import { z } from "./z.mjs";',
      'import { m } from "./m.mjs";',
      'import fs from "node:fs";',
      "before(() => { assert.ok(1); });",
      `test("n", () => { ${first}(); ${second}(); ${first}(); fs.readFileSync(new URL("./golden.txt", import.meta.url)); });`,
    ),
    "z.mjs": helper("z"),
    "m.mjs": helper("m"),
    "golden.txt": "golden\n",
  });
  const forward = await only(order("z", "m"));
  const backward = await only(order("m", "z"));
  assert.deepStrictEqual(forward.effectiveOracleDeps.map((d) => d.path), ["a.test.mjs", "golden.txt", "m.mjs", "z.mjs"]);
  assert.deepStrictEqual(backward.effectiveOracleDeps.map((d) => d.path), forward.effectiveOracleDeps.map((d) => d.path),
    "calling the same helpers in the other order changes nothing");
  assert.strictEqual(backward.effectiveOracleDigest, forward.effectiveOracleDigest);
  assert.strictEqual(new Set(forward.effectiveOracleDeps.map((d) => JSON.stringify(d))).size, forward.effectiveOracleDeps.length,
    "calling one helper twice yields one depRef");
});

test("two hook depRefs in one file are ordered by their canonical span encoding", async () => {
  const declaration = await only({
    "a.test.mjs": src(...HOOK_HEAD, "before(() => { assert.ok(1); });", "after(() => { assert.ok(2); });", 'test("n", () => { assert.ok(1); });'),
  });
  const spans = declaration.effectiveOracleDeps.map((d) => JSON.stringify(d.span));
  assert.strictEqual(spans.length, 2);
  assert.deepStrictEqual(spans, [...spans].sort(), "the order is the canonical encoding's, not the discovery order");
});

// ---------------------------------------------------------------------------------------------
// Named function expressions, optional calls, zero-specifier relative imports, view identity
// ---------------------------------------------------------------------------------------------

test("a named function expression binds its own name inside itself, and self-reference resolves", async () => {
  const declaration = await only(simple(
    "const helper = function recur() {",
    "  assert.ok(1);",
    "  if (false) { recur(); }",
    "};",
    'test("x", () => { helper(); });',
  ));
  // One callable, reached twice, counted once: the self-call resolves to the same node the outer
  // binding reaches, so the visited set terminates it and the module gets one whole-file depRef.
  assert.deepStrictEqual(declaration.effectiveOracleDeps, [{ path: "a.test.mjs", span: { kind: "whole-file" } }]);
  assert.strictEqual(declaration.effectiveOracleDeps.length, 1, "the contributor is not counted twice");
});

test("the function expression's name is invisible outside it", async () => {
  assert.strictEqual(await rejects(simple(
    "const helper = function recur() { assert.ok(1); };",
    'test("x", () => { recur(); });',
  )), "E_ORACLE_UNCLASSIFIED", "recur does not exist in the enclosing scope");
  // And it does not leak as a module binding either: a second declaration of the same name at
  // module scope is what wins for anyone outside.
  const declaration = await only(simple(
    "function recur() { assert.ok(1); }",
    "const helper = function recur2() { assert.ok(2); };",
    'test("x", () => { recur(); helper(); });',
  ));
  assert.deepStrictEqual(declaration.effectiveOracleDeps, [{ path: "a.test.mjs", span: { kind: "whole-file" } }]);
});

test("parameters and body bindings still shadow the function expression's own name", async () => {
  // The name lives outside the parameter scope, so a parameter of the same name shadows it and the
  // call resolves to a parameter -- which is not a supported callable, hence fail-closed.
  assert.strictEqual(await rejects(simple(
    "const helper = function recur(recur) { recur(); assert.ok(1); };",
    'test("x", () => { helper(null); });',
  )), "E_ORACLE_BINDING", "the parameter wins over the function expression name");
  assert.strictEqual(await rejects(simple(
    "const helper = function recur() { let recur2 = 1; recur2(); assert.ok(1); };",
    'test("x", () => { helper(); });',
  )), "E_ORACLE_BINDING", "a body binding is resolved normally");
});

test("existing recursion, cross-call cycles and de-duplication do not regress", async () => {
  const selfRecursive = await only(simple(
    "function walk(n) { if (n > 0) { walk(n - 1); } assert.ok(1); }",
    'test("x", () => { walk(2); });',
  ));
  assert.deepStrictEqual(selfRecursive.effectiveOracleDeps, [{ path: "a.test.mjs", span: { kind: "whole-file" } }]);
  const crossModule = await only({
    "a.test.mjs": src(...HEAD, 'import { a } from "./cycle.mjs";', 'test("x", () => { a(); });'),
    "cycle.mjs": src('import assert from "node:assert";', "export function a() { b(); }", "function b() { a(); assert.ok(1); }"),
  });
  assert.deepStrictEqual(crossModule.effectiveOracleDeps, [{ path: "cycle.mjs", span: { kind: "whole-file" } }]);
});

test("every optional call on the traversal path is fail-closed", async () => {
  const cases = [
    ["assert?.ok(1);", "optional member on an assert binding"],
    ["assert.ok?.(1);", "optional call on an allowlisted assertion"],
    ["ok?.(1);", "optional call on an assertion-function binding"],
    ["helper?.();", "optional call on a local callable"],
    ['readFileSync?.(new URL("./fixtures/golden.txt", import.meta.url));', "optional call on a snapshot API"],
    ["imported?.();", "optional call on a relative imported callable"],
    ["assert?.ok?.(1);", "both spellings at once"],
  ];
  for (const [call, label] of cases) {
    const code = await rejects({
      "a.test.mjs": src(
        'import test from "node:test";',
        'import assert, { ok } from "node:assert";',
        'import { readFileSync } from "node:fs";',
        'import { imported } from "./h.mjs";',
        "function helper() { assert.ok(1); }",
        `test("n", () => { ${call} });`,
      ),
      "h.mjs": src('import assert from "node:assert";', "export function imported() { assert.ok(1); }"),
      "fixtures/golden.txt": "golden\n",
    });
    assert.strictEqual(code, "E_ORACLE_UNCLASSIFIED", label);
  }
  // The same calls without the question mark keep working exactly as before.
  const plain = await only({
    "a.test.mjs": src(
      'import test from "node:test";',
      'import assert, { ok } from "node:assert";',
      'import { readFileSync } from "node:fs";',
      'import { imported } from "./h.mjs";',
      "function helper() { assert.ok(1); }",
      'test("n", () => { assert.ok(1); ok(1); helper(); imported(); readFileSync(new URL("./fixtures/golden.txt", import.meta.url)); });',
    ),
    "h.mjs": src('import assert from "node:assert";', "export function imported() { assert.ok(1); }"),
    "fixtures/golden.txt": "golden\n",
  });
  assert.deepStrictEqual(plain.effectiveOracleDeps.map((d) => d.path), ["a.test.mjs", "fixtures/golden.txt", "h.mjs"]);
});

test("a relative import with no binding is unsupported for its form, target present or not", async () => {
  for (const form of ['import "./h.mjs";', 'import {} from "./h.mjs";']) {
    // Present in the view -- so this cannot be an accidental pass on a missing file.
    assert.strictEqual(await rejects({
      "a.test.mjs": src('import test from "node:test";', 'import assert from "node:assert";', form, 'test("n", () => { assert.ok(1); });'),
      "h.mjs": src("export const x = 1;"),
    }), "E_UNSUPPORTED_IMPORT", `${form} with the target present`);
    assert.strictEqual(await rejects({
      "a.test.mjs": src('import test from "node:test";', 'import assert from "node:assert";', form, 'test("n", () => { assert.ok(1); });'),
    }), "E_UNSUPPORTED_IMPORT", `${form} with the target absent`);
  }
  // A named or default relative import that nothing on the oracle path touches is still fine.
  const unused = await only({
    "a.test.mjs": src('import test from "node:test";', 'import assert from "node:assert";', 'import { sut } from "./sut.mjs";',
      'test("n", () => { assert.ok(1); });'),
    "sut.mjs": src("export function sut() { return 1; }"),
  });
  assert.deepStrictEqual(unused.effectiveOracleDeps, [], "an unused SUT import produces no depRef and no failure");
  const usedDefault = await only({
    "a.test.mjs": src('import test from "node:test";', 'import assert from "node:assert";', 'import sut from "./sut.mjs";',
      'test("n", () => { sut(); assert.ok(1); });'),
    "sut.mjs": src("export default function () { return 1; }"),
  });
  assert.deepStrictEqual(usedDefault.effectiveOracleDeps, [], "and a used non-assertion SUT still contributes nothing");
});

test("only the exact object createContentView returned is a view", async () => {
  const files = simple('test("n", () => { assert.ok(1); });');
  const real = viewOf(files);
  assert.deepStrictEqual((await analyzeModule({ view: real, path: "a.test.mjs" })).declarations.length, 1);

  const impostors = [
    ["a duck-typed look-alike", { size: real.size, has: (p) => real.has(p), read: (p) => real.read(p), paths: () => real.paths() }],
    ["a spread copy", { ...real }],
    ["a frozen spread copy", Object.freeze({ ...real })],
    ["a prototype-delegating clone", Object.create(real)],
    ["a plain object", {}],
    ["null", null],
    ["a function", () => {}],
  ];
  for (const [label, impostor] of impostors) {
    assert.strictEqual(await failureOf(() => analyzeModule({ view: impostor, path: "a.test.mjs" })), "E_VIEW_INPUT", `analyzeModule: ${label}`);
    assert.strictEqual(await failureOf(() => analyzeView({ view: impostor, modulePaths: ["a.test.mjs"] })), "E_VIEW_INPUT", `analyzeView: ${label}`);
  }
  // The factory's own guarantees survive the branding.
  assert.ok(Object.isFrozen(real));
  assert.ok(Object.isFrozen(real.paths()));
  const first = real.read("a.test.mjs");
  first.fill(0x20);
  assert.notDeepStrictEqual(real.read("a.test.mjs"), first, "reads stay stable after a caller mutates one");
  assert.strictEqual((await analyzeView({ view: real, modulePaths: ["a.test.mjs"] })).modules.length, 1);
});

// ---------------------------------------------------------------------------------------------
// Public API shape and the closed component mapping
// ---------------------------------------------------------------------------------------------

test("the public API accepts exactly one options object with an exact key set", async () => {
  const view = viewOf(simple('test("n", () => { assert.ok(1); });'));
  assert.strictEqual(await failureOf(() => analyzeModule({ view, path: "a.test.mjs" }, { parser: "other" })), "E_API_ARGUMENTS");
  assert.strictEqual(await failureOf(() => analyzeModule()), "E_API_ARGUMENTS");
  assert.strictEqual(await failureOf(() => analyzeModule({ view })), "E_API_ARGUMENTS");
  assert.strictEqual(await failureOf(() => analyzeModule({ view, path: "a.test.mjs", parser: "other" })), "E_API_ARGUMENTS");
  assert.strictEqual(await failureOf(() => analyzeModule({ view, path: "a.test.mjs", implementationModule: "./elsewhere.mjs" })), "E_API_ARGUMENTS");
  assert.strictEqual(await failureOf(() => analyzeModule({ view: { has: 1 }, path: "a.test.mjs" })), "E_VIEW_INPUT");
  assert.strictEqual(await failureOf(() => analyzeView({ view, modulePaths: "a.test.mjs" })), "E_API_ARGUMENTS");
  assert.strictEqual(await failureOf(() => createContentView("not entries")), "E_VIEW_INPUT");
  assert.strictEqual(await failureOf(() => createContentView({ "a.mjs": "text not bytes" })), "E_VIEW_INPUT");
  assert.strictEqual(await failureOf(() => createContentView({ "../escape.mjs": B("") })), "E_PATH");
  assert.strictEqual(await failureOf(() => createContentView({ "C:/abs.mjs": B("") })), "E_PATH");
  assert.strictEqual(await failureOf(() => createContentView({ "back\\slash.mjs": B("") })), "E_PATH");
});

test("a module path outside the view, or not ESM, is fail-closed", async () => {
  assert.strictEqual(await rejects(simple('test("n", () => {});'), "absent.test.mjs"), "E_MODULE_MISSING");
  assert.strictEqual(await failureOf(() => analyze({ "a.test.ts": src(...HEAD, 'test("n", () => {});') }, "a.test.ts")), "E_MODULE_FORMAT");
  assert.strictEqual(await failureOf(() => analyze({ "a.test.js": src(...HEAD, 'test("n", () => {});') }, "a.test.js")), "E_PACKAGE_BOUNDARY");
  const asEsm = await analyze({ "a.test.js": src(...HEAD, 'test("n", () => { assert.ok(1); });'), "package.json": '{ "type": "module" }\n' }, "a.test.js");
  assert.strictEqual(asEsm.declarations.length, 1);
});

test("the view is a copy, so a caller cannot change what the next read returns", async () => {
  const bytes = B(src(...HEAD, 'test("n", () => { assert.ok(1); });'));
  const view = createContentView({ "a.test.mjs": bytes });
  bytes.fill(0x20);
  const result = await analyzeModule({ view, path: "a.test.mjs" });
  assert.strictEqual(result.declarations.length, 1, "the analysis ran against the captured bytes, not the mutated buffer");
  const read = view.read("a.test.mjs");
  read.fill(0x20);
  assert.notDeepStrictEqual(view.read("a.test.mjs"), read);
});

test("the implementationId maps to a shipped component through a closed table, never a module path", async () => {
  const component = resolveAdapterComponent("node-test-v1");
  assert.strictEqual(component, nodeTestV1Component);
  assert.strictEqual(component.implementationId, "node-test-v1");
  assert.ok(Object.isFrozen(component));
  const badIds = ["node-test-v2", "./node-test-adapter.mjs", "../../../elsewhere.mjs",
    "file:///D:/anything.mjs", "node:fs", "", "node-test-v1 "];
  for (const id of badIds) {
    let code = null;
    try { resolveAdapterComponent(id); } catch (e) {
      assert.strictEqual(e.name, "TestAdapterRegistryError", `${id}: ${e && e.message}`);
      code = e.code;
    }
    assert.strictEqual(code, "E_REGISTRY_UNSUPPORTED", JSON.stringify(id));
  }
  let extraArgumentCode = null;
  try { resolveAdapterComponent("node-test-v1", nodeTestV1Component); } catch (e) { extraArgumentCode = e.code; }
  assert.strictEqual(extraArgumentCode, "E_API_ARGUMENTS");
});

test("every adapter in the shipped registry resolves to a component, and the component agrees", async () => {
  const registry = loadTestAdapterRegistry();
  for (const adapter of registry.adapters) {
    const component = resolveAdapterComponent(adapter.implementationId);
    assert.strictEqual(component.implementationId, adapter.implementationId);
    assert.strictEqual(typeof component.analyzeModule, "function");
    assert.strictEqual(typeof component.analyzeView, "function");
  }
  // The identity the analysis reports comes from the hash-verified vendor manifest, so a component
  // result and the registry declaration cannot drift apart without one of them failing first.
  const view = viewOf(simple('test("n", () => { assert.ok(1); });'));
  const analysis = await nodeTestV1Component.analyzeModule({ view, path: "a.test.mjs" });
  assert.deepStrictEqual(analysis.identity, loadVendorCapability().identities.parser);
  assert.deepStrictEqual(analysis.identity, registry.adapters[0].implementationIdentity);
});

test("the production registry and vendor capability survive every failure above", async () => {
  // Nothing in this file can reach the shipped caches: the views are in-memory and the loaders take
  // no arguments. This is the check that says so out loud after the fact.
  const registry = loadTestAdapterRegistry();
  assert.strictEqual(registry.adapters.length, 1);
  assert.strictEqual(registry.adapters[0].adapterId, "node-test");
  assert.strictEqual(loadVendorCapability().identities.parser.parserId, "acorn");
  assert.strictEqual(resolveAdapterComponent("node-test-v1"), nodeTestV1Component);
  assert.ok(NodeTestAdapterError.prototype instanceof Error);
});

test("the analysis result is frozen all the way down", async () => {
  const declaration = await only(simple(`// @src ${REQ}`, 'test("n", () => { assert.ok(1); });'));
  assert.ok(Object.isFrozen(declaration));
  assert.ok(Object.isFrozen(declaration.tag));
  assert.ok(Object.isFrozen(declaration.effectiveOracleDeps));
  assert.ok(Object.isFrozen(declaration.canonicalRange));
});
