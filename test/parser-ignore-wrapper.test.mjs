// Coverage for the vendored-dependency wrapper layer: cressetide/skills/vigil/scripts/
// parser-ignore-wrapper.mjs and the worker/runner pair it drives.
//
// SCOPE NOTE: these tests exercise the WRAPPER ONLY. Nothing here asserts declaration discovery,
// node:test or node:assert binding classification, stableId/structuralId or oracle closure -- that
// layer is the node-test-v1 component, and it has its own file, test/node-test-adapter.test.mjs.
// Adapter selection and inventory production are asserted nowhere, because neither is implemented.
// A green run of this file does not mean a producer, a populated inventory or Phase 2 is ready.
//
// The public API takes no overrides, so nothing below injects through it. Worker fault fixtures go
// straight to the internal runner, result-shape negatives go to the exported pure validators, and
// manifest tampering happens in a repo-external scratch copy of the shipped layout whose wrapper is
// a separate module instance -- the production capability cache is never reachable from a test.
//
// The manifest is the authority for every operational number, so expectations are read from it
// rather than restated. No test here touches the network, installs anything, mutates the user's Git
// configuration, or writes into the vendored tree.
import assert from "node:assert";
import cp from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";
import { Worker } from "node:worker_threads";

import {
  ParserIgnoreWrapperError,
  buildByteOffsetMap,
  byteOffsetAt,
  loadVendorCapability,
  matchGitignoreSnapshot,
  normalizeSource,
  parseGitignorePatterns,
  parseModuleSource,
  prepareIgnoreSnapshot,
  validateIgnoreResult,
  validateParserResult,
} from "../cressetide/skills/vigil/scripts/parser-ignore-wrapper.mjs";
import {
  WORKER_ENTRY_PATH,
  laneStats,
  resetLaneStats,
  resolveExecArgv,
  runWorkerJob,
} from "../cressetide/skills/vigil/scripts/parser-ignore-worker-runner.mjs";
import { root } from "./support.mjs";
import { temporary } from "./helpers.mjs";

const VENDOR_REL = "cressetide/skills/vigil/vendor";
const SCRIPTS_REL = "cressetide/skills/vigil/scripts";
const MANIFEST_PATH = path.join(root, VENDOR_REL, "vendor-manifest.json");
const MANIFEST = JSON.parse(fs.readFileSync(MANIFEST_PATH, "utf8"));
const LIMITS = MANIFEST.resourcePolicy.preDispatch;
const VENDOR = loadVendorCapability();
const EXEC_ARGV = resolveExecArgv();

const utf8 = (s) => Buffer.from(s, "utf8");
// Identity by name, not by class: the scratch-layout cases below load a SECOND instance of the
// wrapper module, which has its own ParserIgnoreWrapperError constructor, so instanceof across the
// two would fail on an error that is exactly the right type.
const codeOf = async (fn) => {
  try { await fn(); } catch (e) {
    assert.strictEqual(e && e.name, "ParserIgnoreWrapperError", `expected a ParserIgnoreWrapperError, got ${e && e.name}: ${e && e.message}`);
    assert.ok(ParserIgnoreWrapperError.prototype instanceof Error, "the exported error type must extend Error");
    return e.code;
  }
  return null;
};
const syncCode = (fn) => { try { fn(); return null; } catch (e) { return e.code; } };

// --- vendor authority -----------------------------------------------------------------------------

test("wrapper: reads every operational value from the shipped manifest", () => {
  assert.deepStrictEqual({ ...VENDOR.limits.preDispatch }, { ...LIMITS });
  assert.strictEqual(VENDOR.limits.maxAstNodes, MANIFEST.resourcePolicy.postParse.maxAstNodes);
  assert.deepStrictEqual({ ...VENDOR.worker.resourceLimits }, {
    maxOldGenerationSizeMb: MANIFEST.resourcePolicy.worker.maxOldGenerationSizeMb,
    maxYoungGenerationSizeMb: MANIFEST.resourcePolicy.worker.maxYoungGenerationSizeMb,
    stackSizeMb: MANIFEST.resourcePolicy.worker.stackSizeMb,
  });
  assert.strictEqual(VENDOR.worker.parserTimeoutMs, MANIFEST.resourcePolicy.worker.parserWallTimeoutMsPerSource);
  assert.strictEqual(VENDOR.worker.ignoreTimeoutMs, MANIFEST.resourcePolicy.worker.ignoreWallTimeoutMsPerSnapshot);
  assert.deepStrictEqual({ ...VENDOR.identities.parser }, MANIFEST.implementationIdentity);
  assert.deepStrictEqual({ ...VENDOR.identities.ignore }, MANIFEST.ignoreEngineIdentity);
  assert.strictEqual(VENDOR.acorn.sourceType, MANIFEST.wrapperContract.acorn.sourceType);
  assert.deepStrictEqual([...VENDOR.acorn.unsupported], MANIFEST.wrapperContract.acorn.unsupported);
  assert.strictEqual(VENDOR.ignore.ignorecase, MANIFEST.wrapperContract.ignore.ignorecase);
  assert.strictEqual(VENDOR.ignore.allowRelativePaths, MANIFEST.wrapperContract.ignore.allowRelativePaths);
});

test("wrapper: the loaded engine bytes are the vendored members the manifest authorizes", () => {
  const members = MANIFEST.packages.flatMap((p) => p.members);
  const digest = (text) => crypto.createHash("sha256").update(Buffer.from(text, "utf8")).digest("hex");
  assert.strictEqual(digest(VENDOR.acorn.source), members.find((m) => m.target.endsWith("acorn-8.18.0.mjs")).sha256);
  assert.strictEqual(digest(VENDOR.ignore.source), members.find((m) => m.target.endsWith("ignore-7.0.6.js")).sha256);
});

test("wrapper: the public API accepts no overrides at all", async () => {
  const bytes = utf8("const a = 1;\nexport { a };\n");
  const overrides = [
    { vendor: VENDOR },
    { execArgv: [] },
    { workerSource: "parentPort.postMessage({ ok: true, result: {} });" },
    { timeoutMs: 1 },
    { manifestPath: MANIFEST_PATH },
  ];
  for (const override of overrides) {
    assert.strictEqual(await codeOf(() => parseModuleSource(bytes, override)), "E_API_ARGUMENTS", JSON.stringify(Object.keys(override)));
    assert.strictEqual(await codeOf(() => matchGitignoreSnapshot({ ignoreFiles: [], candidatePaths: ["a"] }, override)), "E_API_ARGUMENTS", JSON.stringify(Object.keys(override)));
  }
  assert.strictEqual(loadVendorCapability.length, 0, "loadVendorCapability must take no parameter that could name another manifest");
});

test("wrapper: the cached capability cannot be poisoned by a caller", async () => {
  const capability = loadVendorCapability();
  assert.ok(Object.isFrozen(capability) && Object.isFrozen(capability.limits) && Object.isFrozen(capability.limits.preDispatch)
    && Object.isFrozen(capability.acorn) && Object.isFrozen(capability.acorn.unsupported) && Object.isFrozen(capability.identities.parser)
    && Object.isFrozen(capability.worker.resourceLimits), "every reachable object must be frozen");

  // Each of these is a silent no-op on a frozen object in sloppy mode and a throw in strict mode;
  // either is fine, because what matters is that the wrapper's behaviour afterwards is unchanged.
  const attempts = [
    () => { capability.acorn.unsupported.length = 0; },
    () => { capability.acorn.unsupported.splice(0, capability.acorn.unsupported.length); },
    () => { capability.identities.parser.parserVersion = "0.0.0"; },
    () => { capability.limits.preDispatch.maxNormalizedSourceBytes = 1; },
    () => { capability.limits.maxAstNodes = 1; },
    () => { capability.worker.parserTimeoutMs = 1; },
  ];
  for (const attempt of attempts) { try { attempt(); } catch { /* frozen: rejection is the point */ } }

  assert.strictEqual(await codeOf(() => parseModuleSource(utf8("const x = require(\"node:test\");\n"))), "E_UNSUPPORTED_SYNTAX",
    "emptying the unsupported list must not let a forbidden construct through");
  const parsed = await parseModuleSource(utf8("const a = 1;\nexport { a };\n"));
  assert.deepStrictEqual({ ...parsed.identity }, MANIFEST.implementationIdentity, "identity must still be the manifest's");
  assert.deepStrictEqual([...loadVendorCapability().acorn.unsupported], MANIFEST.wrapperContract.acorn.unsupported);
  assert.strictEqual(loadVendorCapability().limits.maxAstNodes, MANIFEST.resourcePolicy.postParse.maxAstNodes);
});

// A repo-external copy of the shipped layout. The wrapper resolves its manifest and vendor
// directory from its own location, so a scratch copy is a fully independent capability with its own
// cache: tampering here can never reach the production one.
function scratchLayout(mutate) {
  const dir = temporary("ctide-scratch-layout-");
  const vigil = path.join(dir, "cressetide", "skills", "vigil");
  fs.mkdirSync(path.join(vigil, "scripts"), { recursive: true });
  fs.cpSync(path.join(root, VENDOR_REL), path.join(vigil, "vendor"), { recursive: true });
  for (const file of ["parser-ignore-wrapper.mjs", "parser-ignore-worker.mjs", "parser-ignore-worker-runner.mjs"]) {
    fs.cpSync(path.join(root, SCRIPTS_REL, file), path.join(vigil, "scripts", file));
  }
  const manifestFile = path.join(vigil, "vendor", "vendor-manifest.json");
  const manifest = JSON.parse(fs.readFileSync(manifestFile, "utf8"));
  mutate(manifest);
  fs.writeFileSync(manifestFile, JSON.stringify(manifest, null, 2));
  return { dir, url: pathToFileURL(path.join(vigil, "scripts", "parser-ignore-wrapper.mjs")).href };
}

test("wrapper: an untouched scratch copy of the shipped layout still loads", async () => {
  const { dir, url } = scratchLayout(() => {});
  try {
    const scratch = await import(url);
    assert.deepStrictEqual({ ...scratch.loadVendorCapability().identities.parser }, MANIFEST.implementationIdentity,
      "the scratch harness must be able to succeed, or its failures prove nothing");
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("wrapper: a manifest this build cannot serve fails closed, and never reaches the production cache", async (t) => {
  const cases = [
    ["E_MEMBER_BYTES", (m) => { m.packages[0].members[0].bytes += 1; }],
    ["E_MEMBER_DIGEST", (m) => { m.packages[0].members[0].sha256 = "0".repeat(64); }],
    ["E_MANIFEST_NOT_VENDORED", (m) => { m.packages[0].members[0].state = "authorized-not-vendored"; }],
    ["E_MANIFEST_NOT_VENDORED", (m) => { m.authorization.status = "selection-authorized-artifacts-not-vendored"; }],
    ["E_MEMBER_PATH", (m) => { m.packages[0].members[0].target = "cressetide/skills/vigil/vendor/../../../../etc/passwd"; }],
    ["E_MEMBER_PATH", (m) => { m.packages[0].members[0].target = "cressetide\\skills\\vigil\\vendor\\acorn-8.18.0.mjs"; }],
    ["E_MEMBER_MISSING", (m) => { m.packages[0].members[0].target = "cressetide/skills/vigil/vendor/absent.mjs"; }],
    ["E_MANIFEST_SHAPE", (m) => { m.authorization.canonicalAuthority = "docs/adr/whatever.md"; }],
    ["E_MANIFEST_SHAPE", (m) => { m.resourcePolicy.worker.networkAccess = true; }],
    ["E_MANIFEST_SHAPE", (m) => { m.resourcePolicy.worker.concurrency = 2; }],
    ["E_IDENTITY_UNRESOLVED", (m) => { m.implementationIdentity.parserVersion = "9.99.99"; }],
    ["E_MEMBER_AMBIGUOUS", (m) => { m.packages[0].members.push(m.packages[1].members[0]); }],
    // Implementation-support checks: the shape is legal, this build just cannot serve it.
    ["E_MANIFEST_UNSUPPORTED", (m) => { m.resourcePolicy.worker.module = "node:child_process"; }],
    ["E_MANIFEST_UNSUPPORTED", (m) => { m.resourcePolicy.failureMode = "best-effort"; }],
    ["E_MANIFEST_UNSUPPORTED", (m) => { m.wrapperContract.acorn.sourceType = "script"; }],
    ["E_MANIFEST_UNSUPPORTED", (m) => { m.wrapperContract.acorn.rangeAuthority = "acorn code units"; }],
    ["E_MANIFEST_UNSUPPORTED", (m) => { m.wrapperContract.ignore.ignorecase = true; }],
    ["E_MANIFEST_UNSUPPORTED", (m) => { m.wrapperContract.ignore.allowRelativePaths = true; }],
    // What the packet says it is, what it authorizes, and what its engines are allowed to read.
    ["E_MANIFEST_UNSUPPORTED", (m) => { m.schemaVersion = 999; }],
    ["E_MANIFEST_UNSUPPORTED", (m) => { m.authorization.carrierRole = "adapter-registry"; }],
    ["E_MANIFEST_UNSUPPORTED", (m) => { m.wrapperContract.ignore.authority = "arbitrary filesystem discovery"; }],
    ["E_MANIFEST_UNSUPPORTED", (m) => { m.packages[0].runtimeDependencies = 1; }],
    ["E_MANIFEST_UNSUPPORTED", (m) => { m.packages[1].runtimeDependencies = 1; }],
    // The capability set is compared as written: a missing half, a reversed pair, a duplicate and an
    // extra entry are each a different declaration, and none of them is quietly repaired.
    ["E_MANIFEST_UNSUPPORTED", (m) => { m.authorization.inseparableCapabilities = ["ast-parser"]; }],
    ["E_MANIFEST_UNSUPPORTED", (m) => { m.authorization.inseparableCapabilities = ["gitignore-matching", "ast-parser"]; }],
    ["E_MANIFEST_UNSUPPORTED", (m) => { m.authorization.inseparableCapabilities = ["ast-parser", "ast-parser"]; }],
    ["E_MANIFEST_UNSUPPORTED", (m) => { m.authorization.inseparableCapabilities = ["ast-parser", "gitignore-matching", "network-fetch"]; }],
    ["E_MANIFEST_UNSUPPORTED", (m) => { m.authorization.inseparableCapabilities = []; }],
    ["E_MANIFEST_UNSUPPORTED", (m) => { m.authorization.inseparableCapabilities = "ast-parser,gitignore-matching"; }],
  ];
  for (const [expected, mutate] of cases) {
    const { dir, url } = scratchLayout(mutate);
    try {
      const scratch = await import(url);
      assert.strictEqual(await codeOf(() => scratch.loadVendorCapability()), expected, `case producing ${expected}`);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  }
  // The production capability is untouched by any of it.
  assert.deepStrictEqual({ ...loadVendorCapability().identities.parser }, MANIFEST.implementationIdentity);
  assert.strictEqual(loadVendorCapability().manifestPath, MANIFEST_PATH);
  t.diagnostic(`${cases.length} unserviceable manifests each failed closed`);
});

test("wrapper: the vendored tree is committed and free of working-tree drift", () => {
  const targets = MANIFEST.packages.flatMap((p) => p.members).map((m) => m.target);
  const out = cp.execFileSync("git", ["status", "--porcelain", "--", ...targets, `${VENDOR_REL}/vendor-manifest.json`], { cwd: root, encoding: "utf8" });
  assert.strictEqual(out, "", "vendored bytes and their manifest must be committed and unmodified");
});

// --- parser: normalization ------------------------------------------------------------------------

test("parser: BOM, CRLF and bare CR all normalize to the same canonical LF source", async () => {
  const body = "const a = 1;\nconst b = 2;\n";
  const variants = {
    lf: utf8(body),
    bom: Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), utf8(body)]),
    crlf: utf8(body.replace(/\n/g, "\r\n")),
    cr: utf8(body.replace(/\n/g, "\r")),
  };
  const seen = new Set();
  for (const [label, bytes] of Object.entries(variants)) {
    const { normalized } = normalizeSource(bytes, LIMITS);
    assert.ok(!normalized.includes(0x0d), `${label}: no CR may survive normalization`);
    seen.add(normalized.toString("hex"));
    const parsed = await parseModuleSource(bytes);
    assert.deepStrictEqual(parsed.normalizedSourceBytes, utf8(body), `${label}: canonical bytes`);
    assert.deepStrictEqual([parsed.ast.byteStart, parsed.ast.byteEnd], [0, utf8(body).length], `${label}: root span`);
  }
  assert.strictEqual(seen.size, 1, "every line-ending variant must normalize to identical bytes");
});

test("parser: returns the canonical bytes the spans index into", async () => {
  const parsed = await parseModuleSource(utf8("const greeting = \"hi\";\r\nexport { greeting };\r\n"));
  assert.ok(Buffer.isBuffer(parsed.normalizedSourceBytes), "normalizedSourceBytes must be real bytes, not a length");
  assert.strictEqual(parsed.normalizedByteLength, parsed.normalizedSourceBytes.length);
  assert.ok(!parsed.normalizedSourceBytes.includes(0x0d));
  const declaration = parsed.ast.body[0];
  assert.strictEqual(parsed.normalizedSourceBytes.subarray(declaration.byteStart, declaration.byteEnd).toString("utf8"),
    "const greeting = \"hi\";", "a caller must be able to slice a span without re-implementing normalization");
});

test("parser: invalid UTF-8 fails closed", async () => {
  assert.strictEqual(await codeOf(() => parseModuleSource(Buffer.from([0x63, 0x6f, 0xff, 0xfe]))), "E_UTF8");
});

test("parser: rejects anything that is not already-captured bytes", async () => {
  for (const bad of ["const a = 1;", 42, null, undefined, { path: "x.mjs" }]) {
    assert.strictEqual(await codeOf(() => parseModuleSource(bad)), "E_SOURCE_TYPE", `input ${JSON.stringify(bad)}`);
  }
});

test("parser: the normalized-byte ceiling admits exactly the limit and rejects one more", async () => {
  const limit = LIMITS.maxNormalizedSourceBytes;
  const atLimit = utf8("//" + "a".repeat(limit - 3) + "\n");
  assert.strictEqual(atLimit.length, limit);
  assert.strictEqual((await parseModuleSource(atLimit)).normalizedByteLength, limit);

  const overLimit = utf8("//" + "a".repeat(limit - 2) + "\n");
  assert.strictEqual(overLimit.length, limit + 1);
  assert.strictEqual(await codeOf(() => parseModuleSource(overLimit)), "E_SOURCE_TOO_LARGE");
});

test("parser: a CRLF source that only fits after folding is still accepted", async () => {
  const limit = LIMITS.maxNormalizedSourceBytes;
  const raw = utf8("//a\r\n".repeat(limit / 4));
  assert.ok(raw.length > limit, "the raw form must exceed the ceiling for this test to mean anything");
  assert.strictEqual((await parseModuleSource(raw)).normalizedByteLength, limit);
});

// --- parser: ranges -------------------------------------------------------------------------------

const walkNodes = (ast, visit) => {
  const seen = new Set();
  const step = (node) => {
    if (node === null || typeof node !== "object") return;
    if (Array.isArray(node)) { node.forEach(step); return; }
    if (typeof node.type !== "string") return;
    if (seen.has(node)) return;
    seen.add(node);
    visit(node);
    for (const key of Object.keys(node)) {
      if (["type", "start", "end", "range", "loc", "nodeId", "byteStart", "byteEnd"].includes(key)) continue;
      step(node[key]);
    }
  };
  step(ast);
  return seen.size;
};

test("parser: emoji, CJK and astral characters map back to normalized byte offsets", async () => {
  const parsed = await parseModuleSource(utf8('const a = "\u4f60\u597d";\nconst b = "\ud83d\ude80";\nconst c = "\ud840\udc0b";\n'));
  const literals = [];
  walkNodes(parsed.ast, (node) => { if (node.type === "Literal" && typeof node.value === "string") literals.push(node); });
  assert.strictEqual(literals.length, 3);
  for (const literal of literals) {
    const slice = parsed.normalizedSourceBytes.subarray(literal.byteStart, literal.byteEnd).toString("utf8");
    assert.strictEqual(slice, `"${literal.value}"`, "the byte span must slice back to the literal's own source text");
    assert.ok(literal.byteEnd - literal.byteStart > literal.end - literal.start, "a multi-byte literal spans more bytes than code units");
  }
});

test("parser: a surrogate half is never a legal byte boundary", () => {
  const map = buildByteOffsetMap("a\ud83d\ude80b");
  assert.strictEqual(byteOffsetAt(map, 0), 0);
  assert.strictEqual(byteOffsetAt(map, 1), 1);
  assert.throws(() => byteOffsetAt(map, 2), (e) => e.code === "E_RANGE_BOUNDARY", "mid-surrogate must not resolve");
  assert.strictEqual(byteOffsetAt(map, 3), 5);
  assert.strictEqual(byteOffsetAt(map, 4), 6);
  assert.throws(() => byteOffsetAt(map, 5), (e) => e.code === "E_RANGE_BOUNDARY");
});

test("parser: node identity is deterministic across parses of the same source", async () => {
  const bytes = utf8("const a = 1;\nfunction f(x) { return x + a; }\nexport { f };\n");
  const runs = [];
  for (let i = 0; i < 2; i += 1) {
    const parsed = await parseModuleSource(bytes);
    const seen = [];
    const count = walkNodes(parsed.ast, (node) => seen.push(`${node.nodeId}:${node.type}:${node.byteStart}-${node.byteEnd}`));
    assert.strictEqual(count, parsed.nodeCount, "the reported node count must match the tree the caller can walk");
    runs.push(seen);
  }
  assert.deepStrictEqual(runs[0], runs[1]);
  assert.strictEqual(new Set(runs[0].map((s) => s.split(":")[0])).size, runs[0].length, "node ids must be unique within one parse");
});

// --- parser: profile restrictions ------------------------------------------------------------------

test("parser: syntax errors fail closed with no AST", async () => {
  let caught = null;
  try { await parseModuleSource(utf8("const a = ;\n")); } catch (e) { caught = e; }
  assert.strictEqual(caught.code, "E_SYNTAX");
  assert.strictEqual(caught.ast, undefined, "a failure must not carry a partial AST");
});

test("parser: parses as a module, not a script", async () => {
  const parsed = await parseModuleSource(utf8("import x from \"node:test\";\nexport { x };\n"));
  assert.strictEqual(parsed.sourceType, "module");
  assert.strictEqual(parsed.ast.sourceType, "module");
  // A top-level return is valid in a CommonJS wrapper and invalid in a module: proof of the mode.
  assert.strictEqual(await codeOf(() => parseModuleSource(utf8("return 1;\n"))), "E_SYNTAX");
});

test("parser: every unsupported construct the manifest names fails closed", async () => {
  const cases = {
    "commonjs-require": "const x = require(\"node:test\");\n",
    "computed-member": "const k = \"a\";\nconst v = globalThis[k];\n",
    "dynamic-import": "const m = await import(\"node:test\");\n",
    "re-export": "export * from \"./other.mjs\";\n",
    "syntax-error": "const = ;\n",
  };
  assert.deepStrictEqual(Object.keys(cases).sort(), [...MANIFEST.wrapperContract.acorn.unsupported].sort(),
    "this test must cover exactly the unsupported set the manifest declares");
  for (const [kind, source] of Object.entries(cases)) {
    assert.strictEqual(await codeOf(() => parseModuleSource(utf8(source))),
      kind === "syntax-error" ? "E_SYNTAX" : "E_UNSUPPORTED_SYNTAX", `${kind} must fail closed`);
  }
  assert.strictEqual(await codeOf(() => parseModuleSource(utf8("export { a } from \"./other.mjs\";\n"))), "E_UNSUPPORTED_SYNTAX");
  assert.strictEqual((await parseModuleSource(utf8("const a = 1;\nexport { a };\n"))).ast.type, "Program");
});

test("parser: the worker enforces the AST ceiling at exactly the limit", async () => {
  const statements = 50;
  const exact = 2 * statements + 1; // Program + (ExpressionStatement + Literal) per line
  const job = (maxAstNodes) => runWorkerJob({
    workerData: {
      kind: "parse",
      acornSource: VENDOR.acorn.source,
      source: "1;\n".repeat(statements),
      settings: { sourceType: VENDOR.acorn.sourceType, unsupported: [...VENDOR.acorn.unsupported] },
      limits: { maxAstNodes },
    },
    resourceLimits: VENDOR.worker.resourceLimits,
    timeoutMs: VENDOR.worker.parserTimeoutMs,
    execArgv: EXEC_ARGV,
  });
  assert.strictEqual((await job(exact)).nodeCount, exact);
  await assert.rejects(() => job(exact - 1), (e) => {
    assert.strictEqual(e.code, "E_AST_TOO_LARGE");
    assert.strictEqual(e.detail.limit, exact - 1);
    assert.strictEqual(e.ast, undefined, "an over-limit parse must not return a partial AST");
    return true;
  });
});

// --- worker result validation -----------------------------------------------------------------------

test("parser: a malformed worker reply is never accepted", () => {
  const map = buildByteOffsetMap("1;\n");
  const program = () => ({ type: "Program", start: 0, end: 3, range: [0, 3], sourceType: "module", body: [] });
  const cases = [
    ["E_WORKER_RESULT", { kind: "parse", ast: program(), nodeCount: 1, extra: true }],
    ["E_WORKER_RESULT", { kind: "parse", ast: program() }],
    ["E_WORKER_RESULT", { kind: "ignore", ast: program(), nodeCount: 1 }],
    ["E_WORKER_RESULT", { kind: "parse", ast: { type: "Identifier", start: 0, end: 1, range: [0, 1] }, nodeCount: 1 }],
    ["E_WORKER_RESULT", { kind: "parse", ast: program(), nodeCount: 0 }],
    ["E_WORKER_RESULT", { kind: "parse", ast: program(), nodeCount: -1 }],
    ["E_WORKER_RESULT", { kind: "parse", ast: program(), nodeCount: 1.5 }],
    ["E_WORKER_RESULT", { kind: "parse", ast: program(), nodeCount: "1" }],
    // The count disagrees with the tree that was actually returned.
    ["E_WORKER_RESULT", { kind: "parse", ast: program(), nodeCount: 2 }],
    // Over the ceiling even before the tree is walked.
    ["E_AST_TOO_LARGE", { kind: "parse", ast: program(), nodeCount: VENDOR.limits.maxAstNodes + 1 }],
    // A span the coordinator cannot map, and a range that contradicts start/end.
    ["E_RANGE_BOUNDARY", { kind: "parse", ast: { ...program(), end: 99, range: [0, 99] }, nodeCount: 1 }],
    ["E_WORKER_RESULT", { kind: "parse", ast: { ...program(), range: [0, 2] }, nodeCount: 1 }],
  ];
  for (const [expected, result] of cases) {
    assert.strictEqual(syncCode(() => validateParserResult({ result, map, maxAstNodes: VENDOR.limits.maxAstNodes })),
      expected, JSON.stringify(result).slice(0, 90));
  }
  assert.strictEqual(validateParserResult({ result: { kind: "parse", ast: program(), nodeCount: 1 }, map, maxAstNodes: VENDOR.limits.maxAstNodes }), 1);
});

test("ignore: a malformed worker reply is never accepted", () => {
  const candidates = ["a.txt", "b.txt"];
  const good = [{ path: "a.txt", ignored: true }, { path: "b.txt", ignored: false }];
  const cases = [
    ["E_WORKER_RESULT", { kind: "ignore", results: good, extra: 1 }],
    ["E_WORKER_RESULT", { kind: "ignore" }],
    ["E_WORKER_RESULT", { kind: "parse", results: good }],
    ["E_WORKER_RESULT", { kind: "ignore", results: [good[0]] }],
    ["E_WORKER_RESULT", { kind: "ignore", results: [good[1], good[0]] }],
    ["E_WORKER_RESULT", { kind: "ignore", results: [{ path: "a.txt", ignored: "yes" }, good[1]] }],
    ["E_WORKER_RESULT", { kind: "ignore", results: [{ path: "a.txt", ignored: true, why: "x" }, good[1]] }],
    ["E_WORKER_RESULT", { kind: "ignore", results: [{ path: "a.txt" }, good[1]] }],
  ];
  for (const [expected, result] of cases) {
    assert.strictEqual(syncCode(() => validateIgnoreResult({ result, candidates })), expected, JSON.stringify(result).slice(0, 90));
  }
  assert.deepStrictEqual(validateIgnoreResult({ result: { kind: "ignore", results: good }, candidates }), good);
});

// --- ignore: input validation and limits -----------------------------------------------------------

const gitignoreFile = (p, text) => ({ path: p, bytes: utf8(text) });

test("ignore: active-pattern counting distinguishes blanks, comments, escapes and negations", () => {
  const text = ["", "   ", "# a comment", "\\#not-a-comment", "!negated", "plain", "trailing-space   "].join("\r\n");
  assert.deepStrictEqual(parseGitignorePatterns(text.replace(/\r\n/g, "\n"), ".gitignore", LIMITS),
    ["\\#not-a-comment", "!negated", "plain", "trailing-space   "]);
});

test("ignore: a dangling backslash escape is never swallowed", () => {
  assert.throws(() => parseGitignorePatterns("bad\\\n", ".gitignore", LIMITS), (e) => e.code === "E_IGNORE_PATTERN");
  assert.deepStrictEqual(parseGitignorePatterns("ok\\\\\n", ".gitignore", LIMITS), ["ok\\\\"]);
});

test("ignore: every pre-dispatch ceiling admits the limit and rejects one more", () => {
  const codeFor = (input) => syncCode(() => prepareIgnoreSnapshot(input, LIMITS));
  const candidates = ["a.txt"];
  const pad = (n) => "#".repeat(n - 1) + "\n";

  assert.strictEqual(codeFor({ ignoreFiles: [gitignoreFile(".gitignore", pad(LIMITS.maxGitignoreFileBytes))], candidatePaths: candidates }), null);
  assert.strictEqual(codeFor({ ignoreFiles: [gitignoreFile(".gitignore", pad(LIMITS.maxGitignoreFileBytes + 1))], candidatePaths: candidates }), "E_IGNORE_LIMIT");

  const per = LIMITS.maxGitignoreFileBytes;
  const files = (count, extra = 0) => Array.from({ length: count }, (_, i) => gitignoreFile(`d${i}/.gitignore`, pad(per + (i === count - 1 ? extra : 0))));
  const exactFiles = LIMITS.maxGitignoreTotalBytes / per;
  assert.strictEqual(codeFor({ ignoreFiles: files(exactFiles), candidatePaths: candidates }), null);
  assert.strictEqual(codeFor({ ignoreFiles: files(exactFiles, 1), candidatePaths: candidates }), "E_IGNORE_LIMIT");

  const tiny = (n) => Array.from({ length: n }, (_, i) => gitignoreFile(`f${i}/.gitignore`, "#\n"));
  assert.strictEqual(codeFor({ ignoreFiles: tiny(LIMITS.maxGitignoreFiles), candidatePaths: candidates }), null);
  assert.strictEqual(codeFor({ ignoreFiles: tiny(LIMITS.maxGitignoreFiles + 1), candidatePaths: candidates }), "E_IGNORE_LIMIT");

  const rules = (n) => gitignoreFile(".gitignore", Array.from({ length: n }, (_, i) => `p${i}`).join("\n") + "\n");
  assert.strictEqual(codeFor({ ignoreFiles: [rules(LIMITS.maxGitignorePatterns)], candidatePaths: candidates }), null);
  assert.strictEqual(codeFor({ ignoreFiles: [rules(LIMITS.maxGitignorePatterns + 1)], candidatePaths: candidates }), "E_IGNORE_LIMIT");

  assert.strictEqual(codeFor({ ignoreFiles: [gitignoreFile(".gitignore", "x".repeat(LIMITS.maxGitignorePatternBytes) + "\n")], candidatePaths: candidates }), null);
  assert.strictEqual(codeFor({ ignoreFiles: [gitignoreFile(".gitignore", "x".repeat(LIMITS.maxGitignorePatternBytes + 1) + "\n")], candidatePaths: candidates }), "E_IGNORE_LIMIT");

  const deep = (d) => gitignoreFile(Array.from({ length: d }, (_, i) => `d${i}`).join("/") + "/.gitignore", "x\n");
  assert.strictEqual(codeFor({ ignoreFiles: [deep(LIMITS.maxIgnoreLayerDepth)], candidatePaths: candidates }), null);
  assert.strictEqual(codeFor({ ignoreFiles: [deep(LIMITS.maxIgnoreLayerDepth + 1)], candidatePaths: candidates }), "E_IGNORE_LIMIT");

  const many = (n) => Array.from({ length: n }, (_, i) => `f${i}.txt`);
  assert.strictEqual(codeFor({ ignoreFiles: [], candidatePaths: many(LIMITS.maxSnapshotEntries) }), null);
  assert.strictEqual(codeFor({ ignoreFiles: [], candidatePaths: many(LIMITS.maxSnapshotEntries + 1) }), "E_IGNORE_LIMIT");
});

test("ignore: malformed inputs fail closed", async () => {
  const bad = [
    ["E_IGNORE_INPUT", { ignoreFiles: [gitignoreFile("notes.txt", "x\n")], candidatePaths: ["a"] }],
    ["E_IGNORE_INPUT", { ignoreFiles: [gitignoreFile(".gitignore", "x\n"), gitignoreFile(".gitignore", "y\n")], candidatePaths: ["a"] }],
    ["E_IGNORE_INPUT", { ignoreFiles: [{ path: ".gitignore", bytes: "x\n" }], candidatePaths: ["a"] }],
    ["E_IGNORE_INPUT", { ignoreFiles: [], candidatePaths: ["a", "a"] }],
    ["E_IGNORE_INPUT", { ignoreFiles: [], candidatePaths: ["/abs.txt"] }],
    ["E_IGNORE_INPUT", { ignoreFiles: [], candidatePaths: ["C:/win.txt"] }],
    ["E_IGNORE_INPUT", { ignoreFiles: [], candidatePaths: ["a\\b.txt"] }],
    ["E_IGNORE_INPUT", { ignoreFiles: [], candidatePaths: ["a//b.txt"] }],
    ["E_IGNORE_INPUT", { ignoreFiles: [], candidatePaths: ["./a.txt"] }],
    ["E_IGNORE_INPUT", { ignoreFiles: [], candidatePaths: ["../a.txt"] }],
    ["E_IGNORE_INPUT", { ignoreFiles: [], candidatePaths: ["a/"] }],
    ["E_UTF8", { ignoreFiles: [{ path: ".gitignore", bytes: Buffer.from([0xff, 0xfe]) }], candidatePaths: ["a"] }],
  ];
  for (const [expected, input] of bad) {
    assert.strictEqual(await codeOf(() => matchGitignoreSnapshot(input)), expected, JSON.stringify(input.candidatePaths));
  }
});

test("ignore: an empty snapshot is a legitimate answer, not malformed input", async () => {
  const out = await matchGitignoreSnapshot({ ignoreFiles: [], candidatePaths: [] });
  assert.deepStrictEqual(out.results, []);
  assert.strictEqual(out.activePatterns, 0);
  assert.strictEqual(out.layerCount, 0);
  assert.deepStrictEqual(out.identity, MANIFEST.ignoreEngineIdentity);
  // Integrity still had to hold to get here: a broken capability cannot answer even the empty case.
  const withLayers = await matchGitignoreSnapshot({ ignoreFiles: [gitignoreFile(".gitignore", "*.log\n")], candidatePaths: [] });
  assert.deepStrictEqual(withLayers.results, []);
  assert.strictEqual(withLayers.activePatterns, 1);
  assert.strictEqual(withLayers.layerCount, 1);
});

// --- ignore: semantics ----------------------------------------------------------------------------

async function ignored(ignoreFiles, candidatePaths) {
  const out = await matchGitignoreSnapshot({ ignoreFiles, candidatePaths });
  assert.deepStrictEqual(out.results.map((r) => r.path), candidatePaths, "results must preserve candidate order");
  return Object.fromEntries(out.results.map((r) => [r.path, r.ignored]));
}

test("ignore: anchors, wildcards, classes, negation and last-rule-wins", async () => {
  const rules = ["/root-only.txt", "build/", "*.log", "!keep.log", "a?c.txt", "**/deep.txt", "[abc].cfg"].join("\n") + "\n";
  const paths = ["root-only.txt", "sub/root-only.txt", "build/out.js", "src/build/out.js", "x.log", "keep.log",
    "nested/keep.log", "abc.txt", "ac.txt", "deep.txt", "one/two/deep.txt", "a.cfg", "d.cfg"];
  assert.deepStrictEqual(await ignored([gitignoreFile(".gitignore", rules)], paths), {
    "root-only.txt": true, "sub/root-only.txt": false,
    "build/out.js": true, "src/build/out.js": true,
    "x.log": true, "keep.log": false, "nested/keep.log": false,
    "abc.txt": true, "ac.txt": false,
    "deep.txt": true, "one/two/deep.txt": true,
    "a.cfg": true, "d.cfg": false,
  });
});

test("ignore: a nested .gitignore is rooted at its own directory and overrides its ancestor", async () => {
  const files = [gitignoreFile(".gitignore", "*.tmp\n"), gitignoreFile("src/.gitignore", "!keep.tmp\n*.gen\n")];
  assert.deepStrictEqual(await ignored(files, ["a.tmp", "src/a.tmp", "src/keep.tmp", "src/x.gen", "x.gen"]), {
    "a.tmp": true, "src/a.tmp": true, "src/keep.tmp": false, "src/x.gen": true, "x.gen": false,
  });
});

test("ignore: nothing under a directory excluded by an ancestor can be re-included", async () => {
  const files = [gitignoreFile(".gitignore", "vendorlib/\n"), gitignoreFile("vendorlib/.gitignore", "!keep.txt\n!*\n")];
  assert.deepStrictEqual(await ignored(files, ["vendorlib/keep.txt", "vendorlib/deep/keep.txt", "other/keep.txt"]), {
    "vendorlib/keep.txt": true, "vendorlib/deep/keep.txt": true, "other/keep.txt": false,
  });
});

test("ignore: matching is literal-case and never folded", async () => {
  assert.deepStrictEqual(await ignored([gitignoreFile(".gitignore", "Build/\nREADME.md\n")], ["Build/x", "build/x", "README.md", "readme.md"]),
    { "Build/x": true, "build/x": false, "README.md": true, "readme.md": false });
});

test("ignore: a symlink candidate is matched as a leaf and never probed as a directory", async () => {
  // `link/` is a directory-only rule. The candidate names a symlink whose target happens to be a
  // directory; the wrapper only ever sees the path, must not append a trailing slash, and so must
  // not match. Asserted at the input level, so it needs no symlink-creation privilege.
  assert.deepStrictEqual(await ignored([gitignoreFile(".gitignore", "link/\nplain\n")], ["link", "plain", "link/inside.txt"]),
    { link: false, plain: true, "link/inside.txt": true });
});

test("ignore: results are complete, ordered, and never partial when a later stage fails", async () => {
  const files = [gitignoreFile(".gitignore", "*.log\n")];
  assert.deepStrictEqual((await matchGitignoreSnapshot({ ignoreFiles: files, candidatePaths: ["b.log", "a.log", "c.txt"] })).results,
    [{ path: "b.log", ignored: true }, { path: "a.log", ignored: true }, { path: "c.txt", ignored: false }]);
  let caught = null;
  try { await matchGitignoreSnapshot({ ignoreFiles: files, candidatePaths: ["ok.txt", "../escape"] }); } catch (e) { caught = e; }
  assert.strictEqual(caught.code, "E_IGNORE_INPUT");
  assert.strictEqual(caught.results, undefined, "a rejected snapshot must not carry partial matches");
});

test("ignore: the wrapper reads only the bytes it is given", async () => {
  // Nothing outside the supplied ignoreFiles may influence the answer: not a global excludes file,
  // not .git/info/exclude, not the environment. Setting all three must change nothing.
  const dir = temporary("ctide-ignore-authority-");
  fs.mkdirSync(path.join(dir, ".git", "info"), { recursive: true });
  fs.writeFileSync(path.join(dir, "globalexcludes"), "authority.txt\n");
  fs.writeFileSync(path.join(dir, ".git", "info", "exclude"), "authority.txt\n");
  const previous = { GIT_CONFIG_GLOBAL: process.env.GIT_CONFIG_GLOBAL, CTIDE_IGNORE_EXTRA: process.env.CTIDE_IGNORE_EXTRA };
  try {
    process.env.GIT_CONFIG_GLOBAL = path.join(dir, "gitconfig");
    process.env.CTIDE_IGNORE_EXTRA = "authority.txt";
    fs.writeFileSync(path.join(dir, "gitconfig"), `[core]\n\texcludesFile = ${path.join(dir, "globalexcludes").replace(/\\/g, "/")}\n`);
    assert.deepStrictEqual(await ignored([gitignoreFile(".gitignore", "*.log\n")], ["authority.txt", "x.log"]),
      { "authority.txt": false, "x.log": true });
  } finally {
    for (const [k, v] of Object.entries(previous)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// --- Git oracle -----------------------------------------------------------------------------------

// Cross-checks the wrapper against real Git on a scratch repository. Git runs only here, in the
// test; the runtime wrapper never invokes Git. The scratch repo is isolated from the user's global
// and system configuration and its .git/info/exclude is emptied, so the oracle is the tree's own
// .gitignore files and nothing else.
function gitOracleRepo() {
  const dir = temporary("ctide-git-oracle-");
  fs.mkdirSync(dir, { recursive: true });
  const env = {
    ...process.env,
    GIT_CONFIG_GLOBAL: path.join(dir, "no-global-config"),
    GIT_CONFIG_SYSTEM: path.join(dir, "no-system-config"),
    GIT_CONFIG_NOSYSTEM: "1",
    HOME: dir,
    USERPROFILE: dir,
  };
  cp.execFileSync("git", ["init", "-q"], { cwd: dir, env, stdio: "ignore" });
  // The manifest pins ignorecase:false, and the approved model requires literal case. Windows and
  // macOS auto-detect core.ignorecase=true, which would make the oracle answer a DIFFERENT question
  // than the one under test, so the scratch repo is pinned to the same semantics.
  cp.execFileSync("git", ["config", "core.ignoreCase", "false"], { cwd: dir, env });
  fs.writeFileSync(path.join(dir, ".git", "info", "exclude"), "");
  return { dir, env };
}

test("ignore: matches real `git check-ignore` across an oracle matrix", async (t) => {
  const { dir, env } = gitOracleRepo();
  try {
    const layers = {
      ".gitignore": ["*.log", "!keep.log", "/root-only.txt", "build/", "**/deep.txt", "a?c.txt", "[abc].cfg", "Case.txt", "vendorlib/"].join("\n") + "\n",
      "src/.gitignore": ["*.gen", "!special.gen"].join("\n") + "\n",
      "src/nested/.gitignore": ["!*.log"].join("\n") + "\n",
      "vendorlib/.gitignore": ["!kept.txt"].join("\n") + "\n",
    };
    for (const [file, text] of Object.entries(layers)) {
      const abs = path.join(dir, file);
      fs.mkdirSync(path.dirname(abs), { recursive: true });
      fs.writeFileSync(abs, text);
    }
    const candidates = [
      "app.log", "keep.log", "src/app.log", "src/nested/app.log", "src/nested/keep.log",
      "root-only.txt", "sub/root-only.txt", "build/out.js", "src/build/out.js",
      "deep.txt", "one/two/deep.txt", "abc.txt", "ac.txt", "a.cfg", "d.cfg",
      "Case.txt", "case.txt", "src/x.gen", "src/special.gen", "x.gen",
      "vendorlib/kept.txt", "vendorlib/deep/kept.txt", "plain.txt",
    ];
    for (const candidate of candidates) {
      const abs = path.join(dir, candidate);
      fs.mkdirSync(path.dirname(abs), { recursive: true });
      fs.writeFileSync(abs, "x");
    }

    const oracle = {};
    for (const candidate of candidates) {
      const r = cp.spawnSync("git", ["check-ignore", "-q", "--no-index", "--", candidate], { cwd: dir, env });
      assert.ok(r.status === 0 || r.status === 1, `git check-ignore failed for ${candidate}: ${r.stderr}`);
      oracle[candidate] = r.status === 0;
    }

    const ignoreFiles = Object.keys(layers).map((file) => gitignoreFile(file, fs.readFileSync(path.join(dir, file), "utf8")));
    const out = await matchGitignoreSnapshot({ ignoreFiles, candidatePaths: candidates });
    assert.deepStrictEqual(Object.fromEntries(out.results.map((r) => [r.path, r.ignored])), oracle);
    t.diagnostic(`oracle matrix: ${candidates.length} paths, ${Object.values(oracle).filter(Boolean).length} ignored by real git`);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

// --- worker isolation -----------------------------------------------------------------------------

test("worker: execArgv is explicit, permission-gated, and never inherited", () => {
  assert.ok(EXEC_ARGV.includes("--experimental-vm-modules"));
  assert.ok(EXEC_ARGV.includes("--permission") || EXEC_ARGV.includes("--experimental-permission"));
  assert.throws(() => resolveExecArgv(new Set(["--experimental-vm-modules"])), (e) => e.code === "E_ENV_UNSUPPORTED");
  assert.throws(() => resolveExecArgv(new Set(["--permission"])), (e) => e.code === "E_ENV_UNSUPPORTED");
});

const fixtureWorker = (body) => `import { parentPort, workerData } from "node:worker_threads";\n${body}\n`;

const runFixture = (body, { timeoutMs = 5000, workerData = {} } = {}) => runWorkerJob({
  workerData,
  resourceLimits: VENDOR.worker.resourceLimits,
  timeoutMs,
  execArgv: EXEC_ARGV,
  workerSource: fixtureWorker(body),
});

test("worker: runs with the production permission flags and is denied filesystem reads", async () => {
  const dir = temporary("ctide-worker-sentinel-");
  fs.mkdirSync(dir, { recursive: true });
  const sentinel = path.join(dir, "sentinel.txt");
  fs.writeFileSync(sentinel, "secret");
  try {
    const result = await runFixture(`
      const fs = await import("node:fs");
      let code = "ALLOWED";
      try { fs.readFileSync(workerData.sentinel); } catch (e) { code = e.code || e.name; }
      parentPort.postMessage({ ok: true, result: { code } });
      parentPort.close();
    `, { workerData: { sentinel } });
    assert.strictEqual(result.code, "ERR_ACCESS_DENIED", "the worker must not be able to read the filesystem");
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("worker: starts with an empty environment", async () => {
  const result = await runFixture("parentPort.postMessage({ ok: true, result: { keys: Object.keys(process.env).length } }); parentPort.close();");
  assert.strictEqual(result.keys, 0, "env: {} must give the worker no inherited variables");
});

test("worker: timeout, early exit, throw, malformed envelope and duplicate messages all fail closed", async () => {
  const cases = [
    // A live timer, not a bare pending promise: an empty event loop would let the worker exit
    // cleanly and the case would prove nothing about the timeout path.
    ["E_WORKER_TIMEOUT", "await new Promise((r) => setTimeout(r, 60000));", 150],
    ["E_WORKER_EXIT", "process.exit(0);", 5000],
    ["E_WORKER_ERROR", "throw new Error(\"boom\");", 5000],
    ["E_WORKER_RESULT", "parentPort.postMessage({ nope: true }); parentPort.close();", 5000],
    ["E_WORKER_MESSAGE", "parentPort.postMessage({ ok: true, result: {} }); parentPort.postMessage({ ok: true, result: {} }); parentPort.close();", 5000],
    ["E_WORKER_RESULT", "parentPort.postMessage({ ok: true }); parentPort.close();", 5000],
    // Contradictory envelopes: a success carrying an error, and a failure carrying a result.
    ["E_WORKER_RESULT", "parentPort.postMessage({ ok: true, result: {}, error: { code: \"X\" } }); parentPort.close();", 5000],
    ["E_WORKER_RESULT", "parentPort.postMessage({ ok: false, error: { code: \"X\", message: \"m\" }, result: {} }); parentPort.close();", 5000],
    // A well-formed failure envelope surfaces the worker's own code.
    ["X", "parentPort.postMessage({ ok: false, error: { code: \"X\", message: \"m\" } }); parentPort.close();", 5000],
  ];
  for (const [expected, body, timeoutMs] of cases) {
    let code = null;
    try { await runFixture(body, { timeoutMs }); } catch (e) { code = e.code; }
    assert.strictEqual(code, expected, `fixture: ${body.slice(0, 48)}`);
  }
});

test("worker: a non-zero exit code overrules an otherwise well-formed result", async () => {
  let caught = null;
  let value;
  try {
    value = await runFixture("parentPort.postMessage({ ok: true, result: { looksFine: true } }); process.exitCode = 7; parentPort.close();");
  } catch (e) { caught = e; }
  assert.ok(caught, "a worker that exits non-zero must never have its result accepted");
  assert.strictEqual(caught.code, "E_WORKER_EXIT");
  assert.strictEqual(caught.detail.code, 7);
  assert.strictEqual(value, undefined, "no result may be handed back");
});

test("worker: a rejected job does not poison the lane", async () => {
  await assert.rejects(() => runFixture("throw new Error(\"first\");"));
  assert.deepStrictEqual(await runFixture("parentPort.postMessage({ ok: true, result: { alive: true } }); parentPort.close();"), { alive: true });
});

test("worker: at most one job is ever in flight", async () => {
  resetLaneStats();
  const jobs = Array.from({ length: 6 }, (_, i) => runFixture(`parentPort.postMessage({ ok: true, result: { i: ${i} } }); parentPort.close();`));
  assert.deepStrictEqual((await Promise.all(jobs)).map((r) => r.i), [0, 1, 2, 3, 4, 5], "jobs must complete in submission order");
  assert.strictEqual(laneStats().peakActive, 1, "concurrency must never exceed one");
});

test("worker: a slow terminate still cannot let two workers live at once", async () => {
  // Live workers are counted in shared memory: each increments on start, and the count only drops
  // once its terminate has actually settled. Delaying terminate makes the difference visible -- a
  // lane that released before termination completed would overlap these two workers.
  const realTerminate = Worker.prototype.terminate;
  const view = new Int32Array(new SharedArrayBuffer(8));
  Worker.prototype.terminate = async function delayedTerminate() {
    const code = await realTerminate.call(this);
    await new Promise((resolve) => setTimeout(resolve, 200));
    Atomics.sub(view, 0, 1);
    return code;
  };
  const census = `
    const v = new Int32Array(workerData.sab);
    const now = Atomics.add(v, 0, 1) + 1;
    let peak = Atomics.load(v, 1);
    while (now > peak) { const seen = Atomics.compareExchange(v, 1, peak, now); if (seen === peak) break; peak = seen; }
  `;
  try {
    const slow = runFixture(`${census}\nawait new Promise((r) => setTimeout(r, 60000));`, { timeoutMs: 150, workerData: { sab: view.buffer } });
    const next = runFixture(`${census}\nparentPort.postMessage({ ok: true, result: { done: true } }); parentPort.close();`, { workerData: { sab: view.buffer } });
    await assert.rejects(() => slow, (e) => e.code === "E_WORKER_TIMEOUT");
    assert.deepStrictEqual(await next, { done: true });
    assert.strictEqual(Atomics.load(view, 1), 1, "at most one worker may be live at any moment, even when terminate is slow");
    assert.strictEqual(Atomics.load(view, 0), 0, "every worker must be accounted for");
  } finally {
    Worker.prototype.terminate = realTerminate;
  }
});

test("worker: the production entry imports only node:worker_threads and node:vm", () => {
  const source = fs.readFileSync(WORKER_ENTRY_PATH, "utf8");
  const specifiers = [...source.matchAll(/^\s*import\s[^;]*?from\s+["']([^"']+)["']/gm)].map((m) => m[1]);
  assert.deepStrictEqual([...new Set(specifiers)].sort(), ["node:vm", "node:worker_threads"]);
  for (const forbidden of ["node:fs", "node:http", "node:https", "node:net", "node:tls", "node:dns", "node:dgram", "node:child_process"]) {
    assert.ok(!source.includes(`"${forbidden}"`), `the worker entry must not reference ${forbidden}`);
  }
});

test("worker: the dependency context has no ambient authority", async () => {
  const result = await runFixture(`
    const vm = await import("node:vm");
    const ctx = vm.createContext(Object.create(null), { codeGeneration: { strings: false, wasm: false } });
    const probe = vm.runInContext("[typeof process, typeof fetch, typeof require, typeof WebSocket]", ctx);
    let evalBlocked = false;
    try { vm.runInContext("eval('1+1')", ctx); } catch { evalBlocked = true; }
    parentPort.postMessage({ ok: true, result: { probe: [...probe], evalBlocked } });
    parentPort.close();
  `);
  assert.deepStrictEqual(result.probe, ["undefined", "undefined", "undefined", "undefined"]);
  assert.strictEqual(result.evalBlocked, true, "string code generation must be disabled in the dependency context");
});

test("wrapper: parsing and matching write nothing", async () => {
  const dir = temporary("ctide-no-write-");
  fs.mkdirSync(path.join(dir, "sub"), { recursive: true });
  fs.writeFileSync(path.join(dir, "a.mjs"), "const a = 1;\nexport { a };\n");
  fs.writeFileSync(path.join(dir, "sub", "b.txt"), "b");
  const snapshot = () => fs.readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((e) => e.isFile())
    .map((e) => {
      const abs = path.join(e.parentPath ?? e.path, e.name);
      return `${path.relative(dir, abs)}:${crypto.createHash("sha256").update(fs.readFileSync(abs)).digest("hex")}`;
    }).sort();
  try {
    const before = snapshot();
    await parseModuleSource(fs.readFileSync(path.join(dir, "a.mjs")));
    await matchGitignoreSnapshot({ ignoreFiles: [gitignoreFile(".gitignore", "*.txt\n")], candidatePaths: ["sub/b.txt"] });
    assert.deepStrictEqual(snapshot(), before, "no wrapper operation may create, modify or delete a file");
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
