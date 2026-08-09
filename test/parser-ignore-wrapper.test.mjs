// Coverage for the vendored-dependency wrapper layer: cressetide/skills/vigil/scripts/
// parser-ignore-wrapper.mjs and the worker/runner pair it drives.
//
// SCOPE NOTE: these tests exercise the WRAPPER ONLY. Nothing here asserts declaration discovery,
// node:test or node:assert binding classification, stableId/structuralId, oracle closure, adapter
// selection or inventory production, because none of that is implemented. A green run of this file
// does not mean the parser component, a populated inventory or Phase 2 is ready.
//
// The manifest is the authority for every operational number, so the expectations below are read
// from it rather than restated. No test here touches the network, installs anything, mutates the
// user's Git configuration, or writes into the vendored tree.
import assert from "node:assert";
import cp from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

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

const MANIFEST_PATH = path.join(root, "cressetide", "skills", "vigil", "vendor", "vendor-manifest.json");
const MANIFEST = JSON.parse(fs.readFileSync(MANIFEST_PATH, "utf8"));
const LIMITS = MANIFEST.resourcePolicy.preDispatch;
const VENDOR = loadVendorCapability();

const utf8 = (s) => Buffer.from(s, "utf8");
const codeOf = async (fn) => {
  try { await fn(); } catch (e) {
    assert.ok(e instanceof ParserIgnoreWrapperError, `expected a ParserIgnoreWrapperError, got ${e && e.name}: ${e && e.message}`);
    return e.code;
  }
  return null;
};
// A vendor view with one limit lowered, so an exact ceiling can be probed without generating an
// input the size of the real one. The real values are asserted separately.
const withAstLimit = (maxAstNodes) => ({ ...VENDOR, limits: { ...VENDOR.limits, maxAstNodes } });

// --- vendor authority -----------------------------------------------------------------------------

test("wrapper: reads every operational value from the shipped manifest", () => {
  assert.deepStrictEqual(VENDOR.limits.preDispatch, { ...LIMITS });
  assert.strictEqual(VENDOR.limits.maxAstNodes, MANIFEST.resourcePolicy.postParse.maxAstNodes);
  assert.deepStrictEqual(VENDOR.worker.resourceLimits, {
    maxOldGenerationSizeMb: MANIFEST.resourcePolicy.worker.maxOldGenerationSizeMb,
    maxYoungGenerationSizeMb: MANIFEST.resourcePolicy.worker.maxYoungGenerationSizeMb,
    stackSizeMb: MANIFEST.resourcePolicy.worker.stackSizeMb,
  });
  assert.strictEqual(VENDOR.worker.parserTimeoutMs, MANIFEST.resourcePolicy.worker.parserWallTimeoutMsPerSource);
  assert.strictEqual(VENDOR.worker.ignoreTimeoutMs, MANIFEST.resourcePolicy.worker.ignoreWallTimeoutMsPerSnapshot);
  assert.deepStrictEqual(VENDOR.identities.parser, MANIFEST.implementationIdentity);
  assert.deepStrictEqual(VENDOR.identities.ignore, MANIFEST.ignoreEngineIdentity);
  assert.strictEqual(VENDOR.acorn.sourceType, MANIFEST.wrapperContract.acorn.sourceType);
  assert.deepStrictEqual(VENDOR.acorn.unsupported, MANIFEST.wrapperContract.acorn.unsupported);
  assert.strictEqual(VENDOR.ignore.ignorecase, MANIFEST.wrapperContract.ignore.ignorecase);
  assert.strictEqual(VENDOR.ignore.allowRelativePaths, MANIFEST.wrapperContract.ignore.allowRelativePaths);
});

test("wrapper: the loaded engine bytes are the vendored members the manifest authorizes", () => {
  const members = MANIFEST.packages.flatMap((p) => p.members);
  const bySuffix = (suffix) => members.find((m) => m.target.endsWith(suffix));
  const acorn = bySuffix(".mjs");
  const ignore = bySuffix("ignore-7.0.6.js");
  assert.strictEqual(crypto.createHash("sha256").update(Buffer.from(VENDOR.acorn.source, "utf8")).digest("hex"), acorn.sha256);
  assert.strictEqual(crypto.createHash("sha256").update(Buffer.from(VENDOR.ignore.source, "utf8")).digest("hex"), ignore.sha256);
});

// A scratch manifest lets tampering be exercised without ever writing into the repository's vendor
// tree. Targets still point at the real members, so a wrong size or digest is a genuine mismatch.
function scratchManifest(mutate) {
  const copy = JSON.parse(JSON.stringify(MANIFEST));
  mutate(copy);
  const dir = temporary("ctide-vendor-manifest-");
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, "vendor-manifest.json");
  fs.writeFileSync(file, JSON.stringify(copy, null, 2));
  return { file, dir };
}

test("wrapper: a tampered member size, digest, state or target fails closed before any dispatch", async (t) => {
  const cases = [
    ["E_MEMBER_BYTES", (m) => { m.packages[0].members[0].bytes += 1; }],
    ["E_MEMBER_DIGEST", (m) => { m.packages[0].members[0].sha256 = "0".repeat(64); }],
    ["E_MANIFEST_NOT_VENDORED", (m) => { m.packages[0].members[0].state = "authorized-not-vendored"; }],
    ["E_MEMBER_PATH", (m) => { m.packages[0].members[0].target = "cressetide/skills/vigil/vendor/../../../../etc/passwd"; }],
    ["E_MEMBER_PATH", (m) => { m.packages[0].members[0].target = "cressetide\\skills\\vigil\\vendor\\acorn-8.18.0.mjs"; }],
    ["E_MANIFEST_NOT_VENDORED", (m) => { m.authorization.status = "selection-authorized-artifacts-not-vendored"; }],
    ["E_MANIFEST_SHAPE", (m) => { m.authorization.canonicalAuthority = "docs/adr/whatever.md"; }],
    ["E_MANIFEST_SHAPE", (m) => { m.resourcePolicy.worker.networkAccess = true; }],
    ["E_IDENTITY_UNRESOLVED", (m) => { m.implementationIdentity.parserVersion = "9.99.99"; }],
    // A second, fully valid JavaScript runtime member inside one package: every member still
    // verifies, so this reaches role selection instead of tripping an integrity check first.
    ["E_MEMBER_AMBIGUOUS", (m) => { m.packages[0].members.push(m.packages[1].members[0]); }],
  ];
  for (const [expected, mutate] of cases) {
    const { file, dir } = scratchManifest(mutate);
    try {
      const code = await codeOf(() => loadVendorCapability({ manifestPath: file, cache: false }));
      assert.strictEqual(code, expected, `case producing ${expected}`);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  }
  t.diagnostic(`${cases.length} tamper cases each failed closed`);
});

test("wrapper: the vendored tree is committed and free of working-tree drift", () => {
  const targets = MANIFEST.packages.flatMap((p) => p.members).map((m) => m.target);
  const out = cp.execFileSync("git", ["status", "--porcelain", "--", ...targets, "cressetide/skills/vigil/vendor/vendor-manifest.json"],
    { cwd: root, encoding: "utf8" });
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
    assert.strictEqual(parsed.normalizedBytes, utf8(body).length, `${label}: normalized length`);
    assert.deepStrictEqual([parsed.ast.byteStart, parsed.ast.byteEnd], [0, utf8(body).length], `${label}: root span`);
  }
  assert.strictEqual(seen.size, 1, "every line-ending variant must normalize to identical bytes");
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
  const parsed = await parseModuleSource(atLimit);
  assert.strictEqual(parsed.normalizedBytes, limit);

  const overLimit = utf8("//" + "a".repeat(limit - 2) + "\n");
  assert.strictEqual(overLimit.length, limit + 1);
  assert.strictEqual(await codeOf(() => parseModuleSource(overLimit)), "E_SOURCE_TOO_LARGE");
});

test("parser: a CRLF source that only fits after folding is still accepted", async () => {
  // Raw is over the ceiling; normalized is exactly at it. The pre-decode guard must not reject it.
  const limit = LIMITS.maxNormalizedSourceBytes;
  const lines = limit / 4;
  const raw = utf8("//a\r\n".repeat(lines));
  assert.ok(raw.length > limit, "the raw form must exceed the ceiling for this test to mean anything");
  const parsed = await parseModuleSource(raw);
  assert.strictEqual(parsed.normalizedBytes, limit);
});

// --- parser: ranges -------------------------------------------------------------------------------

test("parser: emoji, CJK and astral characters map back to normalized byte offsets", async () => {
  const source = 'const a = "\u4f60\u597d";\nconst b = "\ud83d\ude80";\nconst c = "\ud840\udc0b";\n';
  const bytes = utf8(source);
  const parsed = await parseModuleSource(bytes);
  const literals = [];
  const visit = (node) => {
    if (node === null || typeof node !== "object") return;
    if (Array.isArray(node)) { node.forEach(visit); return; }
    if (typeof node.type !== "string") return;
    if (node.type === "Literal" && typeof node.value === "string") literals.push(node);
    for (const key of Object.keys(node)) if (!["type", "start", "end", "range", "loc"].includes(key)) visit(node[key]);
  };
  visit(parsed.ast);
  assert.strictEqual(literals.length, 3, "three string literals");
  for (const literal of literals) {
    const slice = bytes.subarray(literal.byteStart, literal.byteEnd).toString("utf8");
    assert.strictEqual(slice, JSON.stringify(literal.value).replace(/^"/, '"').replace(/"$/, '"'),
      "the byte span must slice back to exactly the literal's own source text");
    assert.ok(literal.byteEnd > literal.end, "a multi-byte literal's byte span must exceed its code-unit span");
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
  const ids = [];
  for (let i = 0; i < 2; i += 1) {
    const parsed = await parseModuleSource(bytes);
    const seen = [];
    const visited = new Set();
    const visit = (node) => {
      if (node === null || typeof node !== "object") return;
      if (Array.isArray(node)) { node.forEach(visit); return; }
      if (typeof node.type !== "string") return;
      if (visited.has(node)) return;
      visited.add(node);
      seen.push(`${node.nodeId}:${node.type}:${node.byteStart}-${node.byteEnd}`);
      for (const key of Object.keys(node)) if (!["type", "start", "end", "range", "loc", "nodeId", "byteStart", "byteEnd"].includes(key)) visit(node[key]);
    };
    visit(parsed.ast);
    ids.push(seen);
  }
  assert.deepStrictEqual(ids[0], ids[1]);
  assert.strictEqual(new Set(ids[0].map((s) => s.split(":")[0])).size, ids[0].length, "node ids must be unique within one parse");
});

// --- parser: profile restrictions ------------------------------------------------------------------

test("parser: syntax errors fail closed with no AST", async () => {
  let caught = null;
  try { await parseModuleSource(utf8("const a = ;\n")); } catch (e) { caught = e; }
  assert.ok(caught instanceof ParserIgnoreWrapperError);
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
    const code = await codeOf(() => parseModuleSource(utf8(source)));
    const expected = kind === "syntax-error" ? "E_SYNTAX" : "E_UNSUPPORTED_SYNTAX";
    assert.strictEqual(code, expected, `${kind} must fail closed`);
  }
  // The named re-export form is rejected too, not just export-all.
  assert.strictEqual(await codeOf(() => parseModuleSource(utf8("export { a } from \"./other.mjs\";\n"))), "E_UNSUPPORTED_SYNTAX");
  // A plain local export is not a re-export and must still parse.
  const ok = await parseModuleSource(utf8("const a = 1;\nexport { a };\n"));
  assert.strictEqual(ok.ast.type, "Program");
});

test("parser: the AST node ceiling admits exactly the limit and rejects one more", async () => {
  const statements = 50;
  const source = utf8("1;\n".repeat(statements));
  const exact = 2 * statements + 1; // Program + (ExpressionStatement + Literal) per line
  const parsed = await parseModuleSource(source, { vendor: withAstLimit(exact) });
  assert.strictEqual(parsed.nodeCount, exact);

  let caught = null;
  try { await parseModuleSource(source, { vendor: withAstLimit(exact - 1) }); } catch (e) { caught = e; }
  assert.strictEqual(caught.code, "E_AST_TOO_LARGE");
  assert.strictEqual(caught.ast, undefined, "an over-limit parse must not return a partial AST");
  assert.strictEqual(caught.detail.limit, exact - 1);
});

// --- ignore: input validation and limits -----------------------------------------------------------

const gitignoreFile = (p, text) => ({ path: p, bytes: utf8(text) });

test("ignore: active-pattern counting distinguishes blanks, comments, escapes and negations", () => {
  const text = [
    "",
    "   ",
    "# a comment",
    "\\#not-a-comment",
    "!negated",
    "plain",
    "trailing-space   ",
  ].join("\r\n");
  const patterns = parseGitignorePatterns(text.replace(/\r\n/g, "\n"), ".gitignore", LIMITS);
  assert.deepStrictEqual(patterns, ["\\#not-a-comment", "!negated", "plain", "trailing-space   "]);
});

test("ignore: a dangling backslash escape is never swallowed", () => {
  assert.throws(() => parseGitignorePatterns("bad\\\n", ".gitignore", LIMITS), (e) => e.code === "E_IGNORE_PATTERN");
  // An even run is a real escaped backslash and stays legal.
  assert.deepStrictEqual(parseGitignorePatterns("ok\\\\\n", ".gitignore", LIMITS), ["ok\\\\"]);
});

test("ignore: every pre-dispatch ceiling admits the limit and rejects one more", () => {
  const prep = (input) => prepareIgnoreSnapshot(input, LIMITS);
  const codeFor = (input) => { try { prep(input); return null; } catch (e) { return e.code; } };
  const candidates = ["a.txt"];

  // per-file bytes
  const pad = (n) => "#".repeat(n - 1) + "\n";
  assert.strictEqual(codeFor({ ignoreFiles: [gitignoreFile(".gitignore", pad(LIMITS.maxGitignoreFileBytes))], candidatePaths: candidates }), null);
  assert.strictEqual(codeFor({ ignoreFiles: [gitignoreFile(".gitignore", pad(LIMITS.maxGitignoreFileBytes + 1))], candidatePaths: candidates }), "E_IGNORE_LIMIT");

  // total bytes across files
  const per = LIMITS.maxGitignoreFileBytes;
  const files = (count, extra = 0) => Array.from({ length: count }, (_, i) =>
    gitignoreFile(`d${i}/.gitignore`, pad(per + (i === count - 1 ? extra : 0))));
  const exactFiles = LIMITS.maxGitignoreTotalBytes / per;
  assert.strictEqual(codeFor({ ignoreFiles: files(exactFiles), candidatePaths: candidates }), null);
  assert.strictEqual(codeFor({ ignoreFiles: files(exactFiles, 1), candidatePaths: candidates }), "E_IGNORE_LIMIT");

  // file count
  const tiny = (n) => Array.from({ length: n }, (_, i) => gitignoreFile(`f${i}/.gitignore`, "#\n"));
  assert.strictEqual(codeFor({ ignoreFiles: tiny(LIMITS.maxGitignoreFiles), candidatePaths: candidates }), null);
  assert.strictEqual(codeFor({ ignoreFiles: tiny(LIMITS.maxGitignoreFiles + 1), candidatePaths: candidates }), "E_IGNORE_LIMIT");

  // active patterns
  const rules = (n) => gitignoreFile(".gitignore", Array.from({ length: n }, (_, i) => `p${i}`).join("\n") + "\n");
  assert.strictEqual(codeFor({ ignoreFiles: [rules(LIMITS.maxGitignorePatterns)], candidatePaths: candidates }), null);
  assert.strictEqual(codeFor({ ignoreFiles: [rules(LIMITS.maxGitignorePatterns + 1)], candidatePaths: candidates }), "E_IGNORE_LIMIT");

  // one pattern's bytes
  assert.strictEqual(codeFor({ ignoreFiles: [gitignoreFile(".gitignore", "x".repeat(LIMITS.maxGitignorePatternBytes) + "\n")], candidatePaths: candidates }), null);
  assert.strictEqual(codeFor({ ignoreFiles: [gitignoreFile(".gitignore", "x".repeat(LIMITS.maxGitignorePatternBytes + 1) + "\n")], candidatePaths: candidates }), "E_IGNORE_LIMIT");

  // layer depth
  const deep = (d) => gitignoreFile(Array.from({ length: d }, (_, i) => `d${i}`).join("/") + "/.gitignore", "x\n");
  assert.strictEqual(codeFor({ ignoreFiles: [deep(LIMITS.maxIgnoreLayerDepth)], candidatePaths: candidates }), null);
  assert.strictEqual(codeFor({ ignoreFiles: [deep(LIMITS.maxIgnoreLayerDepth + 1)], candidatePaths: candidates }), "E_IGNORE_LIMIT");

  // snapshot entries
  const many = (n) => Array.from({ length: n }, (_, i) => `f${i}.txt`);
  assert.strictEqual(codeFor({ ignoreFiles: [], candidatePaths: many(LIMITS.maxSnapshotEntries) }), null);
  assert.strictEqual(codeFor({ ignoreFiles: [], candidatePaths: many(LIMITS.maxSnapshotEntries + 1) }), "E_IGNORE_LIMIT");
});

test("ignore: malformed inputs fail closed", async () => {
  const bad = [
    ["E_IGNORE_INPUT", { ignoreFiles: [], candidatePaths: [] }],
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

// --- ignore: semantics ----------------------------------------------------------------------------

async function ignored(ignoreFiles, candidatePaths) {
  const out = await matchGitignoreSnapshot({ ignoreFiles, candidatePaths });
  assert.deepStrictEqual(out.results.map((r) => r.path), candidatePaths, "results must preserve candidate order");
  return Object.fromEntries(out.results.map((r) => [r.path, r.ignored]));
}

test("ignore: anchors, wildcards, classes, negation and last-rule-wins", async () => {
  const rules = [
    "/root-only.txt",
    "build/",
    "*.log",
    "!keep.log",
    "a?c.txt",
    "**/deep.txt",
    "[abc].cfg",
  ].join("\n") + "\n";
  const paths = [
    "root-only.txt", "sub/root-only.txt",
    "build/out.js", "src/build/out.js",
    "x.log", "keep.log", "nested/keep.log",
    "abc.txt", "ac.txt",
    "deep.txt", "one/two/deep.txt",
    "a.cfg", "d.cfg",
  ];
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
  const files = [
    gitignoreFile(".gitignore", "*.tmp\n"),
    gitignoreFile("src/.gitignore", "!keep.tmp\n*.gen\n"),
  ];
  assert.deepStrictEqual(await ignored(files, ["a.tmp", "src/a.tmp", "src/keep.tmp", "src/x.gen", "x.gen"]), {
    "a.tmp": true,
    "src/a.tmp": true,
    "src/keep.tmp": false,   // the deeper layer speaks last
    "src/x.gen": true,
    "x.gen": false,          // the nested rule does not leak upward
  });
});

test("ignore: nothing under a directory excluded by an ancestor can be re-included", async () => {
  const files = [
    gitignoreFile(".gitignore", "vendorlib/\n"),
    gitignoreFile("vendorlib/.gitignore", "!keep.txt\n!*\n"),
  ];
  assert.deepStrictEqual(await ignored(files, ["vendorlib/keep.txt", "vendorlib/deep/keep.txt", "other/keep.txt"]), {
    "vendorlib/keep.txt": true,
    "vendorlib/deep/keep.txt": true,
    "other/keep.txt": false,
  });
});

test("ignore: matching is literal-case and never folded", async () => {
  const files = [gitignoreFile(".gitignore", "Build/\nREADME.md\n")];
  assert.deepStrictEqual(await ignored(files, ["Build/x", "build/x", "README.md", "readme.md"]), {
    "Build/x": true, "build/x": false, "README.md": true, "readme.md": false,
  });
});

test("ignore: a symlink candidate is matched as a leaf and never probed as a directory", async () => {
  // `link/` is a directory-only rule. The candidate names a symlink whose target happens to be a
  // directory; the wrapper only ever sees the path, must not append a trailing slash, and so must
  // not match. This is asserted at the input level, so it needs no symlink-creation privilege.
  const files = [gitignoreFile(".gitignore", "link/\nplain\n")];
  assert.deepStrictEqual(await ignored(files, ["link", "plain", "link/inside.txt"]), {
    "link": false,
    "plain": true,
    "link/inside.txt": true, // a real path UNDER the directory still matches, as Git does
  });
});

test("ignore: results are complete, ordered, and never partial when a later stage fails", async () => {
  const files = [gitignoreFile(".gitignore", "*.log\n")];
  const out = await matchGitignoreSnapshot({ ignoreFiles: files, candidatePaths: ["b.log", "a.log", "c.txt"] });
  assert.deepStrictEqual(out.results, [
    { path: "b.log", ignored: true },
    { path: "a.log", ignored: true },
    { path: "c.txt", ignored: false },
  ]);
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
    const out = await ignored([gitignoreFile(".gitignore", "*.log\n")], ["authority.txt", "x.log"]);
    assert.deepStrictEqual(out, { "authority.txt": false, "x.log": true });
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

test("ignore: matches real `git check-ignore` across an oracle matrix", (t) => {
  const { dir, env } = gitOracleRepo();
  try {
    const layers = {
      ".gitignore": ["*.log", "!keep.log", "/root-only.txt", "build/", "**/deep.txt", "a?c.txt", "[abc].cfg", "Case.txt"].join("\n") + "\n",
      "src/.gitignore": ["*.gen", "!special.gen"].join("\n") + "\n",
      "src/nested/.gitignore": ["!*.log"].join("\n") + "\n",
      "vendorlib/.gitignore": ["!kept.txt"].join("\n") + "\n",
    };
    const extra = "vendorlib/\n";
    for (const [file, text] of Object.entries(layers)) {
      const abs = path.join(dir, file);
      fs.mkdirSync(path.dirname(abs), { recursive: true });
      fs.writeFileSync(abs, file === ".gitignore" ? text + extra : text);
    }
    const candidates = [
      "app.log", "keep.log", "src/app.log", "src/nested/app.log", "src/nested/keep.log",
      "root-only.txt", "sub/root-only.txt",
      "build/out.js", "src/build/out.js",
      "deep.txt", "one/two/deep.txt",
      "abc.txt", "ac.txt",
      "a.cfg", "d.cfg",
      "Case.txt", "case.txt",
      "src/x.gen", "src/special.gen", "x.gen",
      "vendorlib/kept.txt", "vendorlib/deep/kept.txt",
      "plain.txt",
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
    return matchGitignoreSnapshot({ ignoreFiles, candidatePaths: candidates }).then((out) => {
      const mine = Object.fromEntries(out.results.map((r) => [r.path, r.ignored]));
      assert.deepStrictEqual(mine, oracle);
      t.diagnostic(`oracle matrix: ${candidates.length} paths, ${Object.values(oracle).filter(Boolean).length} ignored by real git`);
    }).finally(() => fs.rmSync(dir, { recursive: true, force: true }));
  } catch (e) {
    fs.rmSync(dir, { recursive: true, force: true });
    throw e;
  }
});

// --- worker isolation -----------------------------------------------------------------------------

const EXEC_ARGV = resolveExecArgv();

test("worker: execArgv is explicit, permission-gated, and never inherited", () => {
  assert.ok(EXEC_ARGV.includes("--experimental-vm-modules"));
  assert.ok(EXEC_ARGV.includes("--permission") || EXEC_ARGV.includes("--experimental-permission"),
    "one of the two permission-model flags must be selected");
  assert.throws(() => resolveExecArgv(new Set(["--experimental-vm-modules"])), (e) => e.code === "E_ENV_UNSUPPORTED");
  assert.throws(() => resolveExecArgv(new Set(["--permission"])), (e) => e.code === "E_ENV_UNSUPPORTED");
});

const fixtureWorker = (body) => `import { parentPort, workerData } from "node:worker_threads";\n${body}\n`;

async function runFixture(body, { timeoutMs = 5000, workerData = {} } = {}) {
  return runWorkerJob({
    workerData,
    resourceLimits: VENDOR.worker.resourceLimits,
    timeoutMs,
    execArgv: EXEC_ARGV,
    workerSource: fixtureWorker(body),
  });
}

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
  const result = await runFixture(`
    parentPort.postMessage({ ok: true, result: { keys: Object.keys(process.env).length } });
    parentPort.close();
  `);
  assert.strictEqual(result.keys, 0, "env: {} must give the worker no inherited variables");
});

test("worker: timeout, early exit, throw, malformed result and duplicate messages all fail closed", async () => {
  const cases = [
    // A live timer, not a bare pending promise: an empty event loop would let the worker exit
    // cleanly and the case would prove nothing about the timeout path.
    ["E_WORKER_TIMEOUT", "await new Promise((r) => setTimeout(r, 60000));", 150],
    ["E_WORKER_EXIT", "process.exit(0);", 5000],
    ["E_WORKER_ERROR", "throw new Error(\"boom\");", 5000],
    ["E_WORKER_RESULT", "parentPort.postMessage({ nope: true }); parentPort.close();", 5000],
    ["E_WORKER_MESSAGE", "parentPort.postMessage({ ok: true, result: {} }); parentPort.postMessage({ ok: true, result: {} }); parentPort.close();", 5000],
    ["E_WORKER_RESULT", "parentPort.postMessage({ ok: true }); parentPort.close();", 5000],
  ];
  for (const [expected, body, timeoutMs] of cases) {
    let code = null;
    try { await runFixture(body, { timeoutMs }); } catch (e) { code = e.code; }
    assert.strictEqual(code, expected, `fixture: ${body.slice(0, 40)}`);
  }
});

test("worker: a rejected job does not poison the lane", async () => {
  await assert.rejects(() => runFixture("throw new Error(\"first\");"));
  const result = await runFixture("parentPort.postMessage({ ok: true, result: { alive: true } }); parentPort.close();");
  assert.deepStrictEqual(result, { alive: true });
});

test("worker: at most one job is ever in flight", async () => {
  resetLaneStats();
  const jobs = Array.from({ length: 6 }, (_, i) =>
    runFixture(`parentPort.postMessage({ ok: true, result: { i: ${i} } }); parentPort.close();`));
  const settled = await Promise.all(jobs);
  assert.deepStrictEqual(settled.map((r) => r.i), [0, 1, 2, 3, 4, 5], "jobs must complete in submission order");
  assert.strictEqual(laneStats().peakActive, 1, "concurrency must never exceed one");
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
