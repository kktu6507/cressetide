// DiscoveryAnalysisPreimage: approved test-provenance v1.12, sections 11b.4a-11b.4d and 11b.10b.
//
// WHAT IT IS. One logical operation with one exact return shape. It captures the base tree and the
// head view, decides which paths each side's adapters cover, runs the closed component over exactly
// those paths, and returns the projection §11b.10b names. It is pure in the sense that matters here:
// nothing is written, nothing is cached, nothing is persisted, and a failure anywhere returns nothing
// at all rather than a partial answer.
//
// WHAT IT IS NOT, said plainly because the surrounding model is full of things it resembles. It is
// NOT the populated-inventory producer. It does NOT match base modules against head modules, and
// therefore classifies nothing as added, deleted, moved, retagged or body-changed. It computes no
// inventoryDigest, emits no artifact, is not Step 5 or Step 6, touches no ledger or arbiter, and
// never reads or writes the provenance store. It is not wired into parseInventory, loadInventory or
// contract-check: a v2 envelope, empty or populated, is still refused at the product entry point.
// A green run of this file leaves AC118, AC136, AC137 and AC138 exactly as unsatisfied as before,
// leaves the unsupported-populated-inventory gate standing, and does not make Phase 2 READY.
//
// THE ONE PUBLIC REQUEST IS { repoRoot, baseTreeOid } AND NOTHING ELSE. §11b.10b lists what may not
// be supplied -- a registry, a registry path or root, a parser, an ignore matcher, a Git executable
// or environment, a filesystem adapter, a config object or path, modulePaths or any equivalent
// caller-provided candidate list, a component module path, a capture hook, a prebuilt view or
// snapshot. The key set is exact, so every one of those is refused by name. Nothing in this file
// reads an environment variable to change its behaviour and there is no test-only seam: the tests
// build real repositories and go in through this same door.
import { readTestAdapterRegistryRootFresh, resolveAdapterComponent } from "./adapter-registry.mjs";
import {
  captureBaseAdapterContentView, projectHeadAdapterContentView, requireAdapterContentView,
} from "./adapter-content-view.mjs";
import { ExplicitConfigError, readBaseExplicitConfig, readHeadExplicitConfig, registryDigestOf } from "./explicit-config.mjs";
import { withStableHeadView } from "./head-view-snapshot.mjs";
import { parseModuleSource } from "./parser-ignore-wrapper.mjs";
import { compareCodePoint } from "./provenance-store.mjs";

export class DiscoveryPreimageError extends Error {
  constructor(code, message, detail) {
    super(message);
    this.name = "DiscoveryPreimageError";
    this.code = code;
    if (detail !== undefined) this.detail = detail;
  }
}

const fail = (code, message, detail) => new DiscoveryPreimageError(code, message, detail);

const REQUEST_KEYS = ["repoRoot", "baseTreeOid"];

// §11b.4a: the suffix gate, and only the suffix gate. It decides whether a path is worth an AST
// probe -- it is not evidence, not a selector, not a registry field, and it never makes anything a
// candidate on its own. The comparison is case-sensitive on the Git literal path, so ".MJS" and
// ".Js" do not hit; folding the case would be a normalisation this contract forbids.
const PROBE_SUFFIXES = [".mjs", ".js"];

// §11b.4c: the middle value. A distinct sentinel rather than null or undefined, so "no evidence
// anywhere" can never be confused with "nothing was computed".
const NOT_A_CANDIDATE = Symbol("not-a-candidate");

// --- probe universe (§11b.4a) --------------------------------------------------------------------

// Two sources, unioned. The suffix half is ordinary; the config half is FORCED -- an assigned path
// is a discovery subject whatever it is called.
function probeUniverse(view, explicitConfig) {
  const universe = new Set();
  for (const p of view.paths()) {
    if (view.entry(p).type !== "blob") continue;
    if (PROBE_SUFFIXES.some((suffix) => p.endsWith(suffix))) universe.add(p);
  }
  if (explicitConfig !== null) for (const assignment of explicitConfig.assignments) universe.add(assignment.path);
  return [...universe].sort(compareCodePoint);
}

// --- import evidence (§11b.4b) --------------------------------------------------------------------

// Exactly the top-level static ImportDeclarations of the Program body, and their decoded string
// values. Everything else the section names -- dynamic import(), require(), `export … from`,
// `export * from`, a specifier that appears in a comment, an ordinary string literal that happens to
// read like one -- is not import evidence, and is not collected here rather than being collected and
// filtered later.
function staticImportSpecifiers(ast, where) {
  if (ast === null || typeof ast !== "object" || ast.type !== "Program" || !Array.isArray(ast.body)) {
    throw fail("E_PARSER", `${where}: the parser did not return a Program body`);
  }
  const specifiers = [];
  for (const node of ast.body) {
    if (node === null || typeof node !== "object" || node.type !== "ImportDeclaration") continue;
    const source = node.source;
    if (source === null || typeof source !== "object" || source.type !== "Literal" || typeof source.value !== "string") {
      throw fail("E_PARSER", `${where}: an ImportDeclaration carries a source that is not a string literal`);
    }
    // The DECODED value, so an escaped spelling of the same specifier is the same evidence.
    specifiers.push(source.value);
  }
  return specifiers;
}

// --- discovery (§11b.4c): adapterId | NOT_A_CANDIDATE | throw ---------------------------------------
//
// The logical input §11b.4 fixes at exactly two columns is { view, path }. `side` names which of the
// two views is being asked so a refusal can say so; the registry root and the explicit config are
// not extra inputs but the per-invocation and per-side context §11b.10b step 4 resolves BEFORE
// discovery runs -- the config is derived from this same side's carrier (§11b.4d) and the registry
// root is the single fresh read of step 1. Neither can come from a caller: the public request has
// no key that could carry one.
//
// This function is deliberately NOT exported. Exporting it would mean exporting a door that takes a
// view and a config, and a caller that can hand in both can decide discovery -- which is exactly the
// caller-provided candidate authority §11b.4c forbids.
async function discover(context, path) {
  const { view, explicitConfig, registryRoot, side } = context;

  // Level 1: explicit config. A forced subject is validated as a carrier subject first, because
  // §11b.4a makes every one of these failures fail-closed rather than not-a-candidate.
  if (explicitConfig !== null) {
    const assignment = explicitConfig.assignments.find((a) => a.path === path);
    if (assignment !== undefined) {
      if (!view.has(path)) {
        throw fail("E_FORCED_SUBJECT",
          `${side}: the explicit config assigns ${path}, which is not present in that view; a forced discovery `
          + "subject that is missing is fail-closed, not omitted",
          { side, path, reason: "missing" });
      }
      const type = view.entry(path).type;
      if (type !== "blob") {
        throw fail("E_FORCED_SUBJECT",
          `${side}: the explicit config assigns ${path}, which is a ${type} in that view; a forced discovery `
          + "subject that is not a blob is fail-closed, and a symlink is never followed",
          { side, path, reason: "not-a-blob", type });
      }
      // A unique hit at the highest level. §11b.4c: lower levels are not evaluated at all.
      return assignment.adapterId;
    }
  }

  // Level 2: manifest dependency. The level exists structurally and is evaluated in order, but in v1
  // every adapter's manifestDependencies is exactly [] -- so the intersection with any manifest is
  // empty whatever the manifest says, and there is nothing to look up. Resolving the nearest-ancestor
  // package.json here would change no outcome and would force this file to decide WHICH package.json
  // fields count as dependencies, which §11b.4b says this version may not define. A non-empty list
  // would need that authority, so it is refused rather than guessed. The shipped registry's closed
  // binding table already pins the list to [], so this is a defensive check on an unreachable state,
  // not a path any conforming registry can take.
  const manifestCarriers = registryRoot.adapters.filter((a) => a.discovery.manifestDependencies.length > 0);
  if (manifestCarriers.length > 0) {
    throw fail("E_MANIFEST_LEVEL_UNAUTHORISED",
      `${side}: adapter ${manifestCarriers[0].adapterId} declares a non-empty manifestDependencies, but the union of `
      + "package-manifest dependency fields that would have to be read is not defined by approved v1.12; the level is "
      + "refused rather than given a meaning here",
      { side, path, adapterId: manifestCarriers[0].adapterId });
  }

  // Level 3: import specifier. Only ordinary probe subjects reach it, and every one of them is a
  // .mjs/.js blob by construction of the probe universe.
  let ast;
  try {
    ({ ast } = await parseModuleSource(view.read(path)));
  } catch (error) {
    // §11b.4b(3): a parser refusal is fail-closed. It is never read as "this module has no imports"
    // and never softened into not-a-candidate.
    throw fail("E_PARSER",
      `${side}: ${path} could not be parsed as a module, so its import evidence is unknown: `
      + `${error && error.message ? error.message : String(error)}. A parser refusal is fail-closed, not "no imports"`,
      { side, path, cause: error && error.code });
  }
  const specifiers = new Set(staticImportSpecifiers(ast, `${side}: ${path}`));

  const hits = new Set();
  for (const adapter of registryRoot.adapters) {
    // EXACT comparison: no trim, no normalisation, no URL or path interpretation, no prefix or
    // suffix matching. "node:test" is the specifier; "node:test/reporters" is a different string.
    if (adapter.discovery.importSpecifiers.some((s) => specifiers.has(s))) hits.add(adapter.adapterId);
  }

  if (hits.size === 0) return NOT_A_CANDIDATE;
  if (hits.size > 1) {
    throw fail("E_AMBIGUOUS_EVIDENCE",
      `${side}: ${path} carries import evidence for more than one adapter (${[...hits].sort(compareCodePoint).join(", ")}); `
      + "ambiguous evidence at one level is fail-closed",
      { side, path, adapterIds: [...hits].sort(compareCodePoint) });
  }
  // Several specifiers may have matched; all of them pointed at the same adapter, which §11b.4c
  // calls a unique hit rather than an ambiguity.
  return [...hits][0];
}

// --- per-side analysis (§11b.10b step 4) ------------------------------------------------------------

function adapterOf(registryRoot, adapterId, side) {
  const adapter = registryRoot.adapters.find((a) => a.adapterId === adapterId);
  if (adapter === undefined) {
    throw fail("E_UNKNOWN_ADAPTER", `${side}: discovery produced adapterId ${JSON.stringify(adapterId)}, which the fresh registry root does not declare`);
  }
  return adapter;
}

// §11b.11: the identity the preimage reports is the registry's, projected from the SAME fresh root
// step 1 read. The component's own reported identity is compared against it rather than trusted or
// ignored -- a drift between the two is precisely the failure §11b.11 says must be fail-closed.
function projectIdentity(adapter, reported, side, path) {
  const registryIdentity = adapter.implementationIdentity;
  for (const key of ["implementationId", "parserId", "parserVersion"]) {
    if (reported === null || typeof reported !== "object" || reported[key] !== registryIdentity[key]) {
      throw fail("E_IDENTITY_DRIFT",
        `${side}: ${path} was analysed by a component reporting ${key} `
        + `${JSON.stringify(reported === null || typeof reported !== "object" ? reported : reported[key])}, but the `
        + `registry declares ${JSON.stringify(registryIdentity[key])}; identity drift is fail-closed`,
        { side, path, key });
    }
  }
  return Object.freeze({
    implementationId: registryIdentity.implementationId,
    parserId: registryIdentity.parserId,
    parserVersion: registryIdentity.parserVersion,
  });
}

// §11b.10b declarations[]: exactly { structuralId, tag, bodyDigest }. The AST, the source bytes, the
// canonical declaration bytes, the evidence level, the component module path, the oracle closure and
// every other column the component computes stay inside the component.
function projectDeclarations(declarations, side, path) {
  const seen = new Set();
  const out = declarations.map((d) => {
    if (seen.has(d.structuralId)) {
      throw fail("E_DUPLICATE_STRUCTURAL_ID", `${side}: ${path} reports structuralId ${JSON.stringify(d.structuralId)} twice`, { side, path, structuralId: d.structuralId });
    }
    seen.add(d.structuralId);
    return Object.freeze({
      structuralId: d.structuralId,
      // null stays null; a tag object is copied and frozen so the caller cannot reach back into the
      // component's own record.
      tag: d.tag === null ? null : Object.freeze({ ...d.tag }),
      bodyDigest: d.bodyDigest,
    });
  });
  out.sort((a, b) => compareCodePoint(a.structuralId, b.structuralId));
  for (let i = 1; i < out.length; i += 1) {
    if (compareCodePoint(out[i - 1].structuralId, out[i].structuralId) >= 0) {
      throw fail("E_ORDER", `${side}: ${path} declarations are not strictly ascending by structuralId`);
    }
  }
  return Object.freeze(out);
}

async function analyseSide(context) {
  const { view, explicitConfig, registryRoot, side } = context;

  // Discovery over the whole probe universe first, so a fail-closed reason is reported before any
  // analysis work is done on the paths that happened to sort earlier.
  const chosen = new Map();
  for (const path of probeUniverse(view, explicitConfig)) {
    const outcome = await discover(context, path);
    // §11b.4c: not-a-candidate omits the path. It is not an error and it does not fail the run.
    if (outcome === NOT_A_CANDIDATE) continue;
    chosen.set(path, outcome);
  }

  // One component call per adapter, over exactly the paths discovery chose. The module set is
  // DERIVED here; nothing a caller supplied could reach it.
  const byAdapter = new Map();
  for (const [path, adapterId] of chosen) {
    if (!byAdapter.has(adapterId)) byAdapter.set(adapterId, []);
    byAdapter.get(adapterId).push(path);
  }

  const modules = [];
  for (const adapterId of [...byAdapter.keys()].sort(compareCodePoint)) {
    const adapter = adapterOf(registryRoot, adapterId, side);
    const component = resolveAdapterComponent(adapter.implementationId);
    const modulePaths = byAdapter.get(adapterId).slice().sort(compareCodePoint);
    const analysis = await component.analyzeView({ view, modulePaths });
    for (const module of analysis.modules) {
      modules.push(Object.freeze({
        path: module.path,
        adapterId,
        framework: adapter.framework,
        implementationIdentity: projectIdentity(adapter, module.identity, side, module.path),
        declarations: projectDeclarations(module.declarations, side, module.path),
      }));
    }
  }

  // §11b.10b: strictly ascending by the (path, adapterId) tuple. Strict is the operative word --
  // equal tuples are a duplicate module, and a duplicate module is fail-closed before returning.
  modules.sort((a, b) => compareCodePoint(a.path, b.path) || compareCodePoint(a.adapterId, b.adapterId));
  for (let i = 1; i < modules.length; i += 1) {
    const previous = modules[i - 1];
    const current = modules[i];
    if ((compareCodePoint(previous.path, current.path) || compareCodePoint(previous.adapterId, current.adapterId)) >= 0) {
      throw fail("E_DUPLICATE_MODULE",
        `${side}: two module records share the (path, adapterId) tuple (${current.path}, ${current.adapterId})`,
        { side, path: current.path, adapterId: current.adapterId });
    }
  }
  return Object.freeze(modules);
}

// --- the operation (§11b.10b) ------------------------------------------------------------------------

/**
 * Build the DiscoveryAnalysisPreimage for one repository at one base tree.
 *
 * @param {{ repoRoot: string, baseTreeOid: string }} request exact key set; nothing else is accepted.
 * @returns {Promise<Readonly<object>>} { baseTreeOid, headViewDigest, registryDigest, baseModules, headModules }
 */
export async function buildDiscoveryAnalysisPreimage(request) {
  if (arguments.length !== 1) {
    throw fail("E_API_ARGUMENTS",
      "buildDiscoveryAnalysisPreimage takes exactly one argument; a registry, a registry path or root, a parser, an "
      + "ignore matcher, a Git executable, an environment, a filesystem adapter, a config object or path, modulePaths "
      + "or any equivalent caller-provided candidate list, a component module path, a capture hook, or a prebuilt view "
      + "or snapshot cannot be supplied");
  }
  if (request === null || typeof request !== "object" || Array.isArray(request)) {
    throw fail("E_API_ARGUMENTS", "buildDiscoveryAnalysisPreimage expects a request object");
  }
  const actual = Object.keys(request).sort();
  const wanted = [...REQUEST_KEYS].sort();
  if (actual.length !== wanted.length || actual.some((k, i) => k !== wanted[i])) {
    throw fail("E_API_ARGUMENTS",
      `the buildDiscoveryAnalysisPreimage request must declare exactly ${JSON.stringify(wanted)}; got ${JSON.stringify(actual)}`);
  }
  if (typeof request.repoRoot !== "string" || request.repoRoot === "") {
    throw fail("E_API_ARGUMENTS", "repoRoot must be a non-empty string");
  }

  // Step 1: ONE fresh registry read for this invocation. The same parsed root serves discovery, the
  // implementationIdentity projection and registryDigest -- there is no second read between them, so
  // a registry edit mid-invocation cannot make one part of the answer describe a different registry
  // than another. The cached accessors are not used and their cache is not touched.
  const registryRoot = readTestAdapterRegistryRootFresh();

  // Step 2: the base view, from the object database only.
  const baseView = requireAdapterContentView(
    await captureBaseAdapterContentView({ repoRoot: request.repoRoot, baseTreeOid: request.baseTreeOid }),
    "the base content view");

  // Step 3-5, all inside evaluate. withStableHeadView returns this value only after S2 has matched
  // S1 on both headViewDigest and configCarrierState, so nothing computed here escapes an unstable
  // head view -- and an error thrown here propagates instead of producing a partial preimage.
  const stable = await withStableHeadView({
    repoRoot: request.repoRoot,
    evaluate: async (s1) => {
      const headView = requireAdapterContentView(projectHeadAdapterContentView(s1), "the head content view");
      // §11b.4d, the two carrier rules, in the order §11b.10b numbers the sides: base is step 2 and
      // head is step 3. Head reads S1's own `tracked` metadata; base reads tree membership. Neither
      // side consults the other's carrier.
      const baseExplicitConfig = wrapConfig(() => readBaseExplicitConfig(baseView, registryRoot), "base");
      const headExplicitConfig = wrapConfig(() => readHeadExplicitConfig(s1, registryRoot), "head");

      // Each side reads ONLY its own view. The base analysis takes nothing from S1 and the head
      // analysis takes nothing from the base tree.
      const baseModules = await analyseSide({ view: baseView, explicitConfig: baseExplicitConfig, registryRoot, side: "base" });
      const headModules = await analyseSide({ view: headView, explicitConfig: headExplicitConfig, registryRoot, side: "head" });
      return { headExplicitConfig, baseModules, headModules };
    },
  });
  const { headExplicitConfig, baseModules, headModules } = stable.value;

  // §11b.9c's formula, unchanged: the registry root plus the HEAD explicit config. The base config
  // is bound by baseTreeOid and never enters this preimage.
  const registryDigest = registryDigestOf(registryRoot, headExplicitConfig);

  // Cross-view invariant (§11b.10b, defensive/future). If one canonical path is a candidate on BOTH
  // sides under DIFFERENT adapterIds, this stops here rather than letting a matcher read a framework
  // migration as a move or a retag.
  //
  // v1 REACHABILITY, stated honestly: under the current closed registry this cannot be reached
  // through any conforming public input. §11b.3 admits exactly one implementation/framework binding,
  // and both sides above resolve against the SAME fresh registry root, so two sides can only ever
  // produce the same adapterId. The check is implemented because §11b.10b requires it, and it has
  // NOT been exercised end to end -- doing that would need a second adapter, a registry override, a
  // caller injection or a test-only public seam, all of which are forbidden. It is not claimed to
  // have run against a v1 fixture.
  const baseById = new Map(baseModules.map((m) => [m.path, m.adapterId]));
  for (const module of headModules) {
    const baseAdapterId = baseById.get(module.path);
    // Only one side being a candidate does NOT trigger this: added/deleted classification belongs to
    // the matcher, which this round does not define.
    if (baseAdapterId === undefined || baseAdapterId === module.adapterId) continue;
    throw fail("E_CROSS_VIEW_ADAPTER",
      `${module.path} is a candidate on both sides under different adapters (base ${baseAdapterId}, head `
      + `${module.adapterId}); a cross-view framework migration is fail-closed here and is never left for a matcher `
      + "to read as a move or a retag",
      { path: module.path, base: baseAdapterId, head: module.adapterId });
  }

  return Object.freeze({
    baseTreeOid: request.baseTreeOid,
    headViewDigest: stable.snapshot.headViewDigest,
    registryDigest,
    baseModules,
    headModules,
  });
}

// The shared config helper reports with the S3 component's own codes and messages. They are re-wrapped
// here into this component's error type, with the side named, so a refusal says which carrier failed
// without changing what the message says about it.
function wrapConfig(read, side) {
  try {
    return read();
  } catch (error) {
    if (error instanceof ExplicitConfigError) {
      throw fail(error.code, `${side}: ${error.message}`, { side, ...(error.detail === undefined ? {} : error.detail) });
    }
    throw error;
  }
}
