// The version-aware HISTORICAL validator -- TP approved v1.17 §11b.10c step 6b.
//
// SCOPE: this is the store-layer unit evidence for the one rule the producer's base-store read
// depends on. A green run here is not producer acceptance and does not establish
// AC118/AC136/AC137/AC138. (The unsupported-populated-inventory gate it used to name is retired.)
//
// WHAT IS BEING PROVED, in three parts:
//   1. Each historical version keeps its OWN approved expiry grammar on the TERMINAL path, not just
//      at the Source layer. A nonterminal legacy grant never reaches mechanicallyApplicable(), so it
//      cannot exercise this; the fixtures below put the grant on a DP's terminal REQ.
//   2. The excluded set is EXACTLY "evaluate against the current instant". Every non-temporal rule
//      -- Check A, the exception chain, the COMPLETE scopeCovers predicate, DP coherence -- is still
//      charged, so a store that was invalid when it was written stays refused.
//   3. Unknown historical time is three-valued, and both SIGNS behave: INV-4 (which needs an
//      applicable terminal) does not reject on an unknown expiry, while reopen-cause coherence
//      (which rejects an APPLICABLE successor) does not reject on one either.
//
// PROOF BOUNDARY: no historical instant is stored or reconstructed anywhere here, so none of this
// attests that a grant was unexpired at some past commit. It preserves the non-temporal rules.
import { test } from "node:test";
import assert from "node:assert";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import cp from "node:child_process";

import { root } from "./helpers.mjs";
import {
  emptyStore, sha256Hex, digestOf, applicable, validateAll, validateStoreSchema, validateLegacyV1,
  validateHistoricalStore, validateHistoricalLegacyV1, LEGACY_PROVENANCE_VERSION,
} from "../cressetide/skills/vigil/scripts/provenance-store.mjs";

const SCRIPTS = path.join(root, "cressetide", "skills", "vigil", "scripts");
const STORE_MODULE = path.join("scripts", "provenance-store.mjs");

// A disposable copy of the scripts, so a deliberately WRONG variant can be run without touching the
// production module this process imported. Shape B, in a child process, confined to a temp dir.
function scratchScripts(prefix) {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
  fs.cpSync(SCRIPTS, path.join(dir, "scripts"), { recursive: true });
  return dir;
}

function patch(file, from, to) {
  const text = fs.readFileSync(file, "utf8");
  assert.strictEqual(text.split(from).length - 1, 1, `the single-point edit target must be unique: ${from}`);
  fs.writeFileSync(file, text.split(from).join(to), "utf8");
}

// Runs the three readings of ONE store against a scratch copy and reports each outcome.
function runHistoricalIn(scratch, store) {
  const script = path.join(scratch, "run.mjs");
  fs.writeFileSync(script, [
    'const m = await import("./scripts/provenance-store.mjs");',
    `const store = ${JSON.stringify(store)};`,
    "const attempt = (fn) => { try { fn(); return { ok: true }; } catch (e) { return { ok: false, code: e.code, message: String(e.message) }; } };",
    "console.log(JSON.stringify({",
    `  beforeExpiry: attempt(() => m.validateAll(store, { now: ${Date.UTC(2025, 0, 1)} })),`,
    `  afterExpiry: attempt(() => m.validateAll(store, { now: ${Date.UTC(2027, 0, 1)} })),`,
    "  historical: attempt(() => m.validateHistoricalStore(store)),",
    "}));",
  ].join("\n"), "utf8");
  const r = cp.spawnSync(process.execPath, [script], { encoding: "utf8" });
  assert.strictEqual(r.status, 0, `the probe run must complete: ${r.stderr}`);
  return JSON.parse(r.stdout.trim());
}

// assert.throws() matches the MESSAGE; these refusals are identified by their code, so the code is
// what is asserted -- a message substring would be a weaker claim than the one being made.
function throwsCode(fn, code, why) {
  let error = null;
  try { fn(); } catch (e) { error = e; }
  assert.ok(error, `${why}: expected a refusal, got none`);
  assert.strictEqual(error.code, code, `${why}: expected ${code}, got ${error.code} (${error.message})`);
  return error;
}

const U = (tail) => "01J000000000000000000000" + tail;
const REQ = (t) => `REQ-${U(t)}`;
const DP7 = `DP-${U("07")}`;
const INTENT = { kind: "discipline", discipline: "intent" };
const OWNER = { kind: "source-authority", ref: "R-owner" };
const NOW = Date.UTC(2026, 6, 26);

// A store whose DP's TERMINAL is an exception-backed REQ. `expiry` is the only variable; `version`
// selects which approved grammar that value has to satisfy.
function terminalGrantStore({ expiry, version = 2 }) {
  const s = emptyStore();
  s.provenanceVersion = version;
  s.records.push({ recordId: "R-owner", kind: "source-authority", authorityIdentity: "EU DPA" });
  s.sources.push({
    sourceId: "S-hc", contentKind: "policy", driftMode: "snapshot-only",
    locator: "p#1", excerpt: "PII stays in the EU", digest: sha256Hex("PII stays in the EU"),
  });
  s.clauses.push({
    id: REQ("0A"), authority: "hard-constraint", kind: "specification",
    text: "PII stays in the EU", sourceRef: "S-hc", ownerRef: OWNER,
  });
  s.sources.push({
    sourceId: "S-exc", contentKind: "exception-grant", driftMode: "snapshot-only", locator: "g#1",
    excerpt: "grant", digest: sha256Hex("grant"), targetConstraintRef: REQ("0A"),
    grantAuthorityRef: OWNER, scope: "eu", expiry,
  });
  s.clauses.push({
    id: REQ("0B"), authority: "approved-requirement", kind: "specification",
    text: "eu carve-out", sourceRef: "S-exc", taskRef: "TASK-1",
  });
  const packet = {
    dpId: DP7, scenario: "s", alternatives: ["A", "B"], layer: "intent",
    classificationBasis: "policy", materialReasons: [], requestedPrincipal: INTENT, basisRefs: [],
  };
  s.records.push({
    recordId: "R-scope", kind: "review-ruling", by: INTENT, subjectRef: DP7, ruling: "covered",
    rulingKind: "scope-coverage", basis: "stated basis", scopeCovers: true,
    inputPacketSnapshot: packet, inputPacketDigest: digestOf(packet),
  });
  const dp = {
    id: DP7, dimension: "data", scenario: "s", alternatives: ["A", "B"], layer: "intent",
    classificationBasis: "policy", materialReasons: [], status: "resolved", resolvedBy: REQ("0B"),
    scopeRulingRef: { kind: "review-ruling", ref: "R-scope" },
  };
  if (version === 2) dp.reopenCauseRef = null;   // v2-only field, keyed on the version
  s.decisionPoints.push(dp);
  return s;
}

// --- 1. each version's OWN expiry grammar, on the terminal path -------------------------------------

test("historical v1: a terminal grant with the legacy version's own expiry grammar is accepted", () => {
  // "2099-01-01T12:00:00Z" is legitimate under upstream approved v1.11's Date.parse lane, which is
  // the grammar a version-1 store was written against. mechanicallyApplicable() used to apply the
  // v1.15 exact-ASCII grammar unconditionally, so this store was refused with
  // E_INV4_NOT_APPLICABLE / exception-expiry-non-canonical: the current grammar reaching backwards
  // through the one path that had not been made version-aware.
  const v1 = terminalGrantStore({ expiry: "2099-01-01T12:00:00Z", version: LEGACY_PROVENANCE_VERSION });
  assert.doesNotThrow(() => validateHistoricalStore(v1),
    "the legacy store's terminal grant is judged by the legacy lane's grammar");
  assert.doesNotThrow(() => validateHistoricalLegacyV1(v1), "and the v1 entry point agrees");

  // The legacy lane is a grammar, not an absence of one: a value neither lane can parse fails closed.
  const junk = terminalGrantStore({ expiry: "not a date at all", version: LEGACY_PROVENANCE_VERSION });
  assert.throws(() => validateHistoricalStore(junk), /E_SHAPE|unparseable expiry/,
    "an unparseable legacy expiry is still refused; nothing is defaulted to unexpired");
});

test("current v2 grammar stays exact -- the historical lane does not leak into it", () => {
  // The SAME value in a version-2 store is refused, at the Source layer, by the exact grammar.
  const v2 = terminalGrantStore({ expiry: "2099-01-01T12:00:00Z" });
  assert.throws(() => validateAll(v2, { now: NOW }), /E_SHAPE|non-canonical expiry/);
  assert.throws(() => validateStoreSchema(v2), /E_SHAPE|non-canonical expiry/);
  assert.throws(() => validateHistoricalStore(v2), /E_SHAPE|non-canonical expiry/,
    "a v2 historical store is judged by the v2 grammar: the historical read never relaxes it");

  // And the canonical control passes everywhere.
  const canonical = terminalGrantStore({ expiry: "2099-01-01" });
  assert.doesNotThrow(() => validateAll(canonical, { now: NOW }));
  assert.doesNotThrow(() => validateHistoricalStore(canonical));
});

// --- 2. the excluded set is exactly "against the current instant" -------------------------------------

test("historical: an expired terminal is readable, while every non-temporal rule still refuses", () => {
  const expired = terminalGrantStore({ expiry: "2020-01-01" });
  // Under the current clock this store is invalid -- the terminal is not applicable any more.
  throwsCode(() => validateAll(expired, { now: NOW }), "E_INV4_NOT_APPLICABLE", "the current clock");
  // Historically it is readable: the instant it was written at is unknown, so the comparison is not
  // performed. No fabricated instant, no "unexpired = true".
  assert.doesNotThrow(() => validateHistoricalStore(expired),
    "the expiry-versus-instant comparison is the ONLY thing the historical read skips");

  // scopeCovers is still charged, and it is the COMPLETE predicate rather than a presence check.
  // The two limbs executed here are the ones a schema-only shortcut would have let through: the ref
  // missing entirely, and a typed ruling that says NOT covered. The remaining limbs (rulingKind,
  // intent principal, subject binding) are exercised by the store suite's own scopeCovers coverage
  // and by AC176 (10b)'s scope-ruling-missing control; this test does not claim them.
  const drop = (mutate, why) => {
    const s = terminalGrantStore({ expiry: "2099-01-01" });
    mutate(s);
    assert.doesNotThrow(() => validateStoreSchema(s),
      `${why}: a schema-only historical pass would let this through -- which is why it is not one`);
    throwsCode(() => validateHistoricalStore(s), "E_INV4_NOT_APPLICABLE", why);
  };
  drop((s) => { delete s.decisionPoints[0].scopeRulingRef; }, "no scope ruling at all");
  drop((s) => { s.records.find((r) => r.recordId === "R-scope").scopeCovers = false; },
    "a scope ruling that says NOT covered");

  // Check A is non-temporal too, and stays charged historically.
  const badDigest = terminalGrantStore({ expiry: "2099-01-01" });
  badDigest.sources.find((x) => x.sourceId === "S-exc").digest = sha256Hex("something else");
  throwsCode(() => validateHistoricalStore(badDigest), "E_INV4_NOT_APPLICABLE",
    "a snapshot whose digest and excerpt disagree is not a temporal question");
});

// --- 3. both SIGNS of applicability under an unknown instant ---------------------------------------

// A DP reopened by source-2: its prior terminal was superseded, and the postcondition is that the
// successor is NOT applicable to it. An expired grant is precisely what can make that true.
//
// ISOLATION, and the reason this fixture is written the way it is: the DP KEEPS its valid scope
// ruling, and every other applicability limb of the successor holds. Expiry is therefore the ONLY
// thing that can make the successor inapplicable. An earlier version deleted scopeRulingRef, which
// silently gave the successor a second, non-temporal reason to be inapplicable -- so the case passed
// even against an implementation that collapsed unknown historical time into "unexpired", and it
// proved nothing about the three-valued answer.
function reopenedStore({ expiry }) {
  const s = terminalGrantStore({ expiry });
  const dp = s.decisionPoints[0];
  delete dp.resolvedBy;
  dp.status = "open";
  dp.priorTerminalRef = REQ("0C");
  dp.reopenedBy = "terminal-invalidated-no-successor";
  dp.resolutionRulingRef = null;
  dp.reopenCauseRef = { kind: "transition", ref: "T-1" };
  s.clauses.push({
    id: REQ("0C"), authority: "approved-requirement", kind: "specification",
    text: "the prior terminal", sourceRef: "S-hc", taskRef: "TASK-1",
  });
  const compatibility = { impact: "no consumers", disposition: "no-affected-dependents" };
  s.records.push({
    recordId: "R-ack", kind: "plan-gate", target: REQ("0C"), successor: REQ("0B"),
    impact: compatibility.impact, disposition: compatibility.disposition, approvedBy: "user",
  });
  s.transitions.push({
    id: "T-1", subject: REQ("0C"), action: "supersede", successor: REQ("0B"),
    authorityRef: { kind: "user" }, effectiveAt: "2026-01-01T00:00:00.000Z",
    ackRef: { kind: "plan-gate", ref: "R-ack" }, compatibility,
  });
  return s;
}

test("historical: expiry ALONE decides the reopen postcondition, in all three time positions", () => {
  // ONE store, three readings. Every applicability limb of the successor holds -- active, Check A,
  // a resolvable in-owner exception chain, and the DP's own valid scope ruling -- so the ONLY thing
  // that can flip `applicable(successor, dp)` is the expiry comparison.
  const store = reopenedStore({ expiry: "2026-01-01" });
  const BEFORE = Date.UTC(2025, 0, 1);      // the grant is still live
  const AFTER = Date.UTC(2027, 0, 1);       // the grant has expired

  // Sanity: the fixture really is isolated. The successor is applicable before expiry and
  // inapplicable after it, for that reason and no other.
  const index = validateStoreSchema(store).index;
  assert.strictEqual(applicable(index, REQ("0B"), store.decisionPoints[0], BEFORE).ok, true,
    "before expiry every limb holds -- including scopeCovers, which this fixture keeps");
  const after = applicable(index, REQ("0B"), store.decisionPoints[0], AFTER);
  assert.strictEqual(after.ok, false);
  assert.strictEqual(after.reason, "exception-expired", "and afterwards the ONLY failing limb is expiry");

  // AFTER expiry the reopen is coherent: the successor cannot serve this DP, so it was reopened
  // rather than repointed.
  assert.doesNotThrow(() => validateAll(store, { now: AFTER }),
    "a source-2 reopen explained by an expired grant is valid once the grant has expired");
  // BEFORE expiry the same store is incoherent: an applicable successor means repoint, not reopen.
  throwsCode(() => validateAll(store, { now: BEFORE }), "E_CAUSE_POSTCONDITION",
    "while the grant was live the DP should have been repointed");
  // And historically the answer is UNKNOWN -- neither of the two above. It must not be collapsed
  // into either, and the store stays readable.
  assert.doesNotThrow(() => validateHistoricalStore(store),
    "unknown historical time is a third answer, not a silent 'unexpired'");

  // THE DISCRIMINATOR, in a disposable scratch copy: an implementation whose historical branch
  // returns a plain { ok: true } -- collapsing unknown into "unexpired" -- reads the successor as
  // applicable and REFUSES this store. That is precisely the assertion above, so the mutant fails
  // this regression rather than passing it, which the earlier fixture could not show.
  const scratch = scratchScripts("ctide-hist-sign-");
  try {
    patch(path.join(scratch, STORE_MODULE),
      "      if (historical) return { ok: true, temporalUnknown: true };",
      "      if (historical) return { ok: true }; // WRONG: unknown collapsed into unexpired");
    const mutant = runHistoricalIn(scratch, store);
    assert.strictEqual(mutant.historical.ok, false,
      "the collapsing mutant must REFUSE the store the correct implementation reads");
    assert.strictEqual(mutant.historical.code, "E_CAUSE_POSTCONDITION",
      `and it fails exactly where this test asserts success (got ${JSON.stringify(mutant.historical)})`);
    assert.strictEqual(mutant.afterExpiry.ok, true, "the current-clock readings are unaffected by the mutation");
    assert.strictEqual(mutant.beforeExpiry.code, "E_CAUSE_POSTCONDITION");
  } finally { fs.rmSync(scratch, { recursive: true, force: true }); }
});

test("historical: a NON-TEMPORALLY applicable successor is still refused, in both readings", () => {
  // The other sign, kept separate on purpose: a successor whose applicability involves no clock at
  // all -- here it is not exception-backed -- must be refused historically as well as currently.
  // Nothing about this case is about expiry, and it is not the isolation control above.
  const alwaysApplicable = reopenedStore({ expiry: "2099-01-01" });
  alwaysApplicable.clauses.find((c) => c.id === REQ("0B")).sourceRef = "S-hc";
  throwsCode(() => validateAll(alwaysApplicable, { now: NOW }), "E_CAUSE_POSTCONDITION", "currently");
  throwsCode(() => validateHistoricalStore(alwaysApplicable), "E_CAUSE_POSTCONDITION",
    "deterministic non-temporal applicability is preserved in the negated direction too");
});

test("the historical entry points do not weaken the current public validators", () => {
  // validateAll / validateLegacyV1 keep their complete current semantics; the historical pass is a
  // separate entry point that shares the same private primitives.
  const expired = terminalGrantStore({ expiry: "2020-01-01" });
  throwsCode(() => validateAll(expired, { now: NOW }), "E_INV4_NOT_APPLICABLE",
    "the current validator is untouched by the historical one");
  const v1 = terminalGrantStore({ expiry: "2099-01-01T12:00:00Z", version: LEGACY_PROVENANCE_VERSION });
  assert.doesNotThrow(() => validateLegacyV1(v1, { now: NOW }),
    "and the current LEGACY validator keeps its own approved grammar as well");
  throwsCode(() => validateHistoricalLegacyV1(terminalGrantStore({ expiry: "2099-01-01" })),
    "E_STORE_VERSION", "the v1 entry point refuses a v2 store rather than guessing");
});
