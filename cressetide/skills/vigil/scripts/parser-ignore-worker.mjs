// Worker body for the vendored parser / ignore engines.
//
// This file runs inside a node:worker_threads worker started with the permission model on and no
// filesystem, child-process or nested-worker authority. It therefore imports NOTHING but
// node:worker_threads and node:vm: the vendored source text arrives through workerData, already
// hash-verified by the coordinator, so the worker never needs to read a file -- not even its own
// entry, which is handed to it as an in-memory data: URL.
//
// The isolation here is least-authority execution of PINNED, HASH-VERIFIED, TRUSTED bytes. It is
// deliberately NOT a malicious-code sandbox, and nothing in this file should be read as claiming
// that node:vm or the permission model provides one.
import { parentPort, workerData } from "node:worker_threads";
import vm from "node:vm";

function fail(code, message, detail) {
  return { code, message, detail };
}

class WorkerFailure extends Error {
  constructor(code, message, detail) {
    super(message);
    this.name = "WorkerFailure";
    this.payload = fail(code, message, detail);
  }
}

// A context with no ambient authority: no process, no fetch, no timers, no require, and with
// string/WASM code generation switched off so the dependency cannot compile new code at runtime.
function isolatedContext(seed) {
  return vm.createContext(seed ?? Object.create(null), {
    codeGeneration: { strings: false, wasm: false },
  });
}

async function loadAcorn(source) {
  const context = isolatedContext();
  const mod = new vm.SourceTextModule(source, { context, identifier: "vendor:acorn" });
  await mod.link(() => {
    throw new WorkerFailure("E_VENDOR_IMPORT", "the vendored parser must not resolve any static import");
  });
  await mod.evaluate();
  const ns = mod.namespace;
  if (typeof ns.parse !== "function") {
    throw new WorkerFailure("E_VENDOR_SHAPE", "the vendored parser did not export parse()");
  }
  return ns;
}

function loadIgnore(source) {
  const moduleShim = { exports: {} };
  const context = isolatedContext({ module: moduleShim, exports: moduleShim.exports });
  new vm.Script(source, { filename: "vendor:ignore" }).runInContext(context);
  const exported = moduleShim.exports;
  const factory = typeof exported === "function" ? exported : exported && exported.default;
  if (typeof factory !== "function") {
    throw new WorkerFailure("E_VENDOR_SHAPE", "the vendored ignore engine did not export a factory");
  }
  return factory;
}

// --- AST traversal -------------------------------------------------------------------------------

// Deterministic pre-order walk. Key order is the parser's own property insertion order, which is
// stable for a given source, so node ordinals are reproducible across runs and machines.
// The parser reuses one node object in more than one position -- `export { f }` hands the same
// Identifier to both `local` and `exported` -- so a seen-set keeps a shared node one node: counted
// once against the ceiling and carrying one identity rather than two.
function walk(node, visit, seen = new Set()) {
  if (node === null || typeof node !== "object") return;
  if (Array.isArray(node)) {
    for (const item of node) walk(item, visit, seen);
    return;
  }
  if (typeof node.type !== "string") return;
  if (seen.has(node)) return;
  seen.add(node);
  visit(node);
  for (const key of Object.keys(node)) {
    if (key === "type" || key === "start" || key === "end" || key === "range" || key === "loc") continue;
    walk(node[key], visit, seen);
  }
}

// The unsupported set is read from the manifest, not restated here. An entry the worker does not
// know how to enforce is a fail-closed condition, never a silently-skipped one.
const STRUCTURAL_CHECKS = {
  "commonjs-require": (node) =>
    node.type === "CallExpression" && node.callee && node.callee.type === "Identifier" && node.callee.name === "require",
  "computed-member": (node) => node.type === "MemberExpression" && node.computed === true,
  "dynamic-import": (node) => node.type === "ImportExpression",
  "re-export": (node) =>
    node.type === "ExportAllDeclaration" ||
    (node.type === "ExportNamedDeclaration" && node.source !== null && node.source !== undefined),
  // Enforced by the parser itself: a syntax error never produces an AST to walk.
  "syntax-error": null,
};

function parseJob({ acornSource, source, settings, limits }) {
  return loadAcorn(acornSource).then((acorn) => {
    for (const kind of settings.unsupported) {
      if (!Object.prototype.hasOwnProperty.call(STRUCTURAL_CHECKS, kind)) {
        throw new WorkerFailure("E_UNSUPPORTED_UNKNOWN", `the manifest requires an unsupported-syntax check this build cannot enforce: ${kind}`, kind);
      }
    }
    const active = settings.unsupported.filter((k) => STRUCTURAL_CHECKS[k]).map((k) => [k, STRUCTURAL_CHECKS[k]]);

    let ast;
    try {
      ast = acorn.parse(source, {
        ecmaVersion: "latest",
        sourceType: settings.sourceType,
        ranges: true,
      });
    } catch (e) {
      throw new WorkerFailure("E_SYNTAX", `source is not valid ${settings.sourceType} syntax: ${e.message}`);
    }

    // One walk: count, enforce the node ceiling, and reject unsupported constructs. The AST is
    // never returned when any of these fail, so no partial result can escape.
    let nodeCount = 0;
    let violation = null;
    walk(ast, (node) => {
      nodeCount += 1;
      if (violation) return;
      for (const [kind, predicate] of active) {
        if (predicate(node)) { violation = { kind, type: node.type, start: node.start }; break; }
      }
    });
    if (violation) {
      throw new WorkerFailure("E_UNSUPPORTED_SYNTAX", `unsupported construct for this profile: ${violation.kind}`, violation);
    }
    if (nodeCount > limits.maxAstNodes) {
      throw new WorkerFailure("E_AST_TOO_LARGE", `AST has ${nodeCount} nodes, over the authorized ceiling of ${limits.maxAstNodes}`, { nodeCount, limit: limits.maxAstNodes });
    }
    return { ast, nodeCount };
  });
}

// --- ignore layering -----------------------------------------------------------------------------

// Each layer is one .gitignore, rooted at its own directory. Layers arrive already sorted
// root-to-leaf by the coordinator; a later (deeper) layer that says anything overrides what a
// shallower one said, which is how "the last matching rule wins" extends across nested files.
function layerVerdict(engine, relativePath) {
  const result = engine.test(relativePath);
  if (result.ignored) return "ignore";
  if (result.unignored) return "unignore";
  return "none";
}

function decide(layers, target, isDirectory) {
  const probe = isDirectory ? `${target}/` : target;
  let verdict = "none";
  for (const layer of layers) {
    if (layer.dir !== "") {
      const prefix = `${layer.dir}/`;
      if (!target.startsWith(prefix)) continue;
    }
    const relative = layer.dir === "" ? probe : probe.slice(layer.dir.length + 1);
    if (relative === "" || relative === "/") continue;
    const said = layerVerdict(layer.engine, relative);
    if (said !== "none") verdict = said;
  }
  return verdict === "ignore";
}

function ignoreJob({ ignoreSource, layers, candidates, settings }) {
  const factory = loadIgnore(ignoreSource);
  const built = layers.map((layer) => {
    const engine = factory({ ignorecase: settings.ignorecase, allowRelativePaths: settings.allowRelativePaths });
    engine.add(layer.patterns);
    return { dir: layer.dir, engine };
  });

  const results = candidates.map((path) => {
    // Git cannot re-include anything under an excluded directory, so an ancestor directory that is
    // ignored settles the question before the leaf's own rules are ever consulted.
    const segments = path.split("/");
    for (let i = 1; i < segments.length; i += 1) {
      const ancestor = segments.slice(0, i).join("/");
      if (decide(built, ancestor, true)) return { path, ignored: true };
    }
    // The candidate is a leaf: a symlink is matched by its own path and never followed, so it is
    // never probed as a directory even when its target happens to be one.
    return { path, ignored: decide(built, path, false) };
  });

  return { results };
}

// --- dispatch ------------------------------------------------------------------------------------

async function main() {
  const job = workerData;
  if (job.kind === "parse") return { kind: "parse", ...(await parseJob(job)) };
  if (job.kind === "ignore") return { kind: "ignore", ...ignoreJob(job) };
  throw new WorkerFailure("E_WORKER_JOB", `unknown job kind ${JSON.stringify(job && job.kind)}`);
}

main().then(
  (result) => { parentPort.postMessage({ ok: true, result }); parentPort.close(); },
  (error) => {
    const payload = error instanceof WorkerFailure
      ? error.payload
      : fail("E_WORKER_INTERNAL", (error && error.message) || String(error));
    parentPort.postMessage({ ok: false, error: payload });
    parentPort.close();
  },
);
