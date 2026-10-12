#!/usr/bin/env node
// The ONE operation that writes the ChangedTestInventoryV2 artifact to disk.
//
// WHY IT IS NOT THE PRODUCER. TP §11b.10c fixes the producer's side-effect boundary: it "不寫
// .ctide/output/**（含 inventory 自身）", returns a deep-frozen in-memory envelope, and on any error
// yields "整輪 no-result、no-write" with no partial envelope. Emission is therefore a separate
// operation, and it adds no request parameter, no output field, no captured context and no dependency
// to the producer it calls.
//
// TWO INDEPENDENT PROTECTIONS, which are easy to run together and are not the same thing:
//
//   digest correctness -- §11b.10 hard-excludes `.ctide/output/**` from the head view, so writing this
//     artifact cannot perturb the headViewDigest the envelope just declared. That is why emission may
//     safely follow production.
//   Git hygiene -- references/verification-gate.md (Artifact Hygiene) requires that the FIRST write
//     under `.ctide/output/` create a top-level `.ctide/output/.gitignore` holding `*` then
//     `!.gitignore`, so an ordinary `git add` can never commit run residue. A head-view exclusion does
//     nothing about that; on a fresh consuming repo this emitter is plausibly that first writer.
//
// ORDERING, and what each failure leaves behind:
//   1. the producer runs FIRST -- its failure writes nothing at all, not even the output directory;
//   2. path guards, then the output directory;
//   3. the hygiene guard, created EXCLUSIVELY when absent and never rewritten when present;
//   4. sibling temp -> fsync -> raw re-read through the canonical authority -> digest equality;
//   5. atomic rename.
// Any failure before the rename leaves a pre-existing artifact BYTE-IDENTICAL and removes only this
// operation's own temp file. A failure at step 4 or 5 can leave behind a newly created output
// directory and a newly created `.gitignore`; that residue is deliberate and documented -- it is the
// protective guard itself, which by then may already be covering other run artifacts, so removing it
// would be the worse outcome. What can never remain is a new or partial inventory.
//
// OWNERSHIP, which is what makes "only this operation's own temp file" true rather than hopeful. Both
// files this operation creates are created with `wx`, and the temp name carries a fresh random suffix
// per attempt. Exclusive creation is the whole guarantee: `O_CREAT|O_EXCL` refuses a regular file, a
// directory, a symlink and a hard link to a peer elsewhere, so an entry that was already at the path
// is never followed, truncated or adopted, and a failed open leaves this operation owning nothing to
// clean up. Cleanup is gated on a flag set only by a successful creation, and cleared again by a
// successful rename -- once our inode is the target, the temp NAME belongs to whoever takes it next.
//
// The bounded guarantee: pre-existing entries of any type at either path, stale names left by an
// earlier crashed run, and accidental collisions. NOT a guarantee against an adversary replacing a
// path between two of our filesystem operations; `wx` does not close that window and nothing here
// claims to. Within one process the staging block below is entirely synchronous after the producer's
// await, so it does not interleave with itself.
//
// The returned path and digest attest an ACTUAL successful emission of this round. A caller in Steps
// 1-4 consumes those values; the mere existence of an older file on disk is not a successful emission
// and must not be used as one.
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { produceChangedTestInventoryV2 } from "./changed-test-inventory-producer.mjs";
import { INVENTORY_PATH, parseCanonicalInventoryV2 } from "./changed-test-inventory.mjs";
// The ONE canonical serialization authority, taken from the primitives module the inventory reader
// itself uses -- not re-spelled here, and not a second encoder.
import { canonicalJson } from "./canonical-json.mjs";

export class InventoryArtifactError extends Error {
  constructor(code, message, detail) {
    super(message);
    this.name = "InventoryArtifactError";
    this.code = code;
    if (detail !== undefined) this.detail = detail;
  }
}

const fail = (code, message, detail) => new InventoryArtifactError(code, message, detail);
const REQUEST_KEYS = ["baseTreeOid", "repoRoot", "taskId"];
const IGNORE_BODY = "*\n!.gitignore\n";
// EEXIST on an exclusive create means somebody else holds the name. Bounded, then fail closed: after
// three refusals of a freshly randomised name -- or three disappearances of the guard between our
// create and our re-inspection -- something is actively churning this directory, and spinning would
// hide it. Three is a contention allowance, not a retry loop.
const MAX_CREATE_ATTEMPTS = 3;

// A resolved path may still be a symlink to somewhere else entirely: `path.resolve` proves what the
// STRING says, never what the filesystem will do with it. Every directory component from the
// repository root down to the output directory is therefore lstat'd, and the deepest existing parent
// is realpath'd and required to stay inside the realpath'd repository root.
function assertNoRedirection(repoRoot, outputDir) {
  const rootReal = fs.realpathSync(repoRoot);
  const relative = path.relative(rootReal, outputDir);
  if (relative === "" || relative.startsWith("..") || path.isAbsolute(relative)) {
    throw fail("E_ARTIFACT_TARGET",
      `the output directory ${outputDir} is not inside ${rootReal}`, { outputDir });
  }
  let cursor = rootReal;
  for (const segment of relative.split(path.sep)) {
    cursor = path.join(cursor, segment);
    let stats;
    try {
      stats = fs.lstatSync(cursor);
    } catch (error) {
      if (error && error.code === "ENOENT") return;          // not created yet: nothing to redirect
      throw fail("E_ARTIFACT_TARGET", `cannot inspect ${cursor} (${error && error.code})`, { path: cursor });
    }
    if (stats.isSymbolicLink()) {
      throw fail("E_ARTIFACT_TARGET",
        `${cursor} is a symbolic link; the artifact path is never followed through one`, { path: cursor });
    }
    if (!stats.isDirectory()) {
      throw fail("E_ARTIFACT_TARGET", `${cursor} exists and is not a directory`, { path: cursor });
    }
  }
  const outReal = fs.realpathSync(outputDir);
  if (path.relative(rootReal, outReal).startsWith("..")) {
    throw fail("E_ARTIFACT_TARGET",
      `the output directory resolves to ${outReal}, outside ${rootReal}`, { outputDir, resolved: outReal });
  }
}

// A file that must be an ordinary regular file if it exists at all. Returns whether it is there.
function assertRegularOrAbsent(file, what) {
  let stats;
  try {
    stats = fs.lstatSync(file);
  } catch (error) {
    if (error && error.code === "ENOENT") return false;
    throw fail("E_ARTIFACT_TARGET", `cannot inspect ${what} at ${file} (${error && error.code})`, { path: file });
  }
  if (stats.isSymbolicLink()) {
    throw fail("E_ARTIFACT_TARGET",
      `${what} at ${file} is a symbolic link; it is refused rather than followed`, { path: file });
  }
  if (!stats.isFile()) {
    throw fail("E_ARTIFACT_TARGET", `${what} at ${file} exists and is not a regular file`, { path: file });
  }
  return true;
}

// The hygiene guard, created exclusively rather than after an absence check. `writeFileSync` follows a
// symlink planted between the check and the write; `wx` refuses one outright, and refuses a directory
// or a regular file too. EEXIST therefore means "something is there NOW": re-inspect it, preserve a
// regular file byte-for-byte, refuse a symlink or a non-file.
//
// The one outcome that must not fall through is the re-inspection finding NOTHING -- a competitor
// removed the entry between our failed create and our lstat. Returning there would proceed with no
// guard created and none observed, which is exactly what verification-gate.md's footgun rule forbids,
// so it costs an attempt and tries again; exhausting the attempts refuses. This function returns only
// when the guard was created by us or was observed present as a regular file.
function ensureIgnoreGuard(ignoreFile) {
  const what = "the .ctide/output/.gitignore";
  let lastError;
  for (let attempt = 0; attempt < MAX_CREATE_ATTEMPTS; attempt += 1) {
    let handle;
    try {
      handle = fs.openSync(ignoreFile, "wx");
    } catch (error) {
      if (!error || error.code !== "EEXIST") {
        throw fail("E_ARTIFACT_IO",
          `cannot create the output hygiene guard at ${ignoreFile} (${error && error.code})`, { path: ignoreFile });
      }
      if (assertRegularOrAbsent(ignoreFile, what)) return;      // present and ordinary: preserved
      lastError = error;                                        // vanished under us: try again
      continue;
    }
    try {
      fs.writeFileSync(handle, IGNORE_BODY, "utf8");
    } catch (error) {
      fs.closeSync(handle);
      handle = undefined;
      // We created this file, so we remove it: a zero-byte `.gitignore` ignores nothing, and every
      // later run would find a regular file present and dutifully preserve the useless guard.
      try { fs.rmSync(ignoreFile, { force: true }); } catch { /* best effort */ }
      throw fail("E_ARTIFACT_IO",
        `cannot write the output hygiene guard at ${ignoreFile} (${error && error.code})`, { path: ignoreFile });
    } finally {
      if (handle !== undefined) fs.closeSync(handle);
    }
    return;
  }
  throw fail("E_ARTIFACT_IO",
    `the output hygiene guard at ${ignoreFile} was neither created nor observed in ${MAX_CREATE_ATTEMPTS} `
    + `attempts (${lastError && lastError.code}); the output directory is being modified concurrently`,
    { path: ignoreFile });
}

/**
 * Produce the v2 inventory and publish it as the run's artifact.
 *
 * @param {{ repoRoot: string, baseTreeOid: string, taskId: string }} request exact key set -- the
 *   producer's own request, unchanged. No output path, no snapshot, no context, no callback.
 * @returns {Promise<Readonly<{path: string, inventoryDigest: string}>>} evidence that THIS invocation
 *   wrote that file. Producer failures propagate unchanged; this operation's own failures are
 *   InventoryArtifactError.
 */
export async function emitChangedTestInventory(request) {
  if (arguments.length !== 1) {
    throw fail("E_API_ARGUMENTS",
      "emitChangedTestInventory takes exactly one argument; an output path, a snapshot, a filesystem, a "
      + "Git executable or a capture hook cannot be supplied");
  }
  if (request === null || typeof request !== "object" || Array.isArray(request)) {
    throw fail("E_API_ARGUMENTS", "the emitChangedTestInventory request must be a JSON object");
  }
  // Own keys, not merely the enumerable string ones; symbols refused before the sort and the message,
  // which are defined over strings. String() is the one rendering a symbol survives.
  const ownKeys = Reflect.ownKeys(request);
  const symbolKeys = ownKeys.filter((key) => typeof key !== "string");
  if (symbolKeys.length > 0) {
    throw fail("E_API_ARGUMENTS",
      `the emitChangedTestInventory request carries symbol-keyed own properties `
      + `(${symbolKeys.map(String).join(", ")}); it must declare exactly ${JSON.stringify(REQUEST_KEYS)}`);
  }
  const keys = ownKeys.sort();
  if (keys.length !== REQUEST_KEYS.length || keys.some((k, i) => k !== REQUEST_KEYS[i])) {
    throw fail("E_API_ARGUMENTS",
      `the emitChangedTestInventory request must declare exactly ${JSON.stringify(REQUEST_KEYS)}; got `
      + `${JSON.stringify(keys)}`);
  }

  // ONE read of each owned value, before the await. The derivation below and the publication after it
  // must name the SAME repository: re-reading `request.repoRoot` after the producer resolved let an
  // ordinary mutation — or an accessor — send an artifact derived from one repository into another.
  const captured = {};
  for (const key of REQUEST_KEYS) captured[key] = request[key];

  // 1. PRODUCER FIRST. Its refusals are its own and propagate unchanged, and because nothing has been
  //    written yet, a failed derivation cannot leave the output tree touched in any way.
  const envelope = await produceChangedTestInventoryV2({
    repoRoot: captured.repoRoot, baseTreeOid: captured.baseTreeOid, taskId: captured.taskId,
  });

  const repoRoot = path.resolve(captured.repoRoot);
  const target = path.join(repoRoot, INVENTORY_PATH);
  const outputDir = path.dirname(target);

  // 2. guards, then the directory.
  assertNoRedirection(repoRoot, outputDir);
  try {
    fs.mkdirSync(outputDir, { recursive: true });
  } catch (error) {
    throw fail("E_ARTIFACT_IO", `cannot create ${outputDir} (${error && error.code})`, { path: outputDir });
  }
  assertNoRedirection(repoRoot, outputDir);                  // re-checked now that it exists

  // 3. the hygiene guard: created exclusively, so it is created only when genuinely absent and an
  //    existing one is never rewritten, appended to or followed. The repository-root .gitignore is
  //    neither read nor written.
  ensureIgnoreGuard(path.join(outputDir, ".gitignore"));

  // 4. the artifact itself. Canonical text through the one serialization authority, written to a
  //    sibling temp, flushed, then RE-READ from disk and validated by the canonical v2 parser -- so
  //    what is published is bytes that have actually been parsed back, not bytes that were merely
  //    intended.
  assertRegularOrAbsent(target, "the inventory artifact");
  const text = `${canonicalJson(envelope)}\n`;

  // The staging name is unpredictable and freshly randomised per attempt, and the open is exclusive,
  // so nothing that was already at the name can be followed, truncated or adopted -- a hard link's
  // peer elsewhere keeps its bytes, and a symlink's destination is never opened. The PID stays in the
  // name for operator legibility only; the random suffix is what makes the name unused.
  let temporary;
  let handle;
  let owned = false;                    // set ONLY by a successful exclusive create: it authorises the
  let lastError;                        // cleanup below, and a failed open must authorise nothing
  for (let attempt = 0; attempt < MAX_CREATE_ATTEMPTS && !owned; attempt += 1) {
    temporary = path.join(outputDir,
      `.changed-test-inventory.${process.pid}.${crypto.randomBytes(8).toString("hex")}.tmp`);
    try {
      handle = fs.openSync(temporary, "wx");
      owned = true;
    } catch (error) {
      lastError = error;
      if (!error || error.code !== "EEXIST") {
        throw fail("E_ARTIFACT_IO",
          `cannot stage the artifact at ${temporary} (${error && error.code})`, { path: temporary });
      }
    }
  }
  if (!owned) {
    throw fail("E_ARTIFACT_IO",
      `no unused staging name was available under ${outputDir} in ${MAX_CREATE_ATTEMPTS} attempts `
      + `(${lastError && lastError.code})`, { path: outputDir });
  }

  try {
    try {
      fs.writeFileSync(handle, text, "utf8");
      fs.fsyncSync(handle);
    } finally {
      fs.closeSync(handle);
    }
    let readBack;
    try {
      readBack = fs.readFileSync(temporary, "utf8");
    } catch (error) {
      throw fail("E_ARTIFACT_IO", `cannot re-read the staged artifact (${error && error.code})`, { path: temporary });
    }
    const reparsed = parseCanonicalInventoryV2(readBack);
    if (reparsed.inventoryDigest !== envelope.inventoryDigest) {
      throw fail("E_ARTIFACT_REREAD",
        `the staged artifact re-reads as inventoryDigest ${reparsed.inventoryDigest}, not the produced `
        + `${envelope.inventoryDigest}`,
        { produced: envelope.inventoryDigest, readBack: reparsed.inventoryDigest });
    }
    try {
      fs.renameSync(temporary, target);
    } catch (error) {
      throw fail("E_ARTIFACT_IO",
        `cannot publish the artifact to ${target} (${error && error.code})`, { path: target });
    }
    owned = false;      // our inode is the target now; whoever next takes that NAME is not us
  } catch (error) {
    if (error instanceof InventoryArtifactError) throw error;
    if (error && error.code && String(error.code).startsWith("E_")) throw error;   // canonical reader's own
    throw fail("E_ARTIFACT_IO", `staging the artifact failed (${error && error.code}): ${error && error.message}`,
      { path: temporary });
  } finally {
    // ONLY a file this operation actually created, and only while it is still ours. Not "whatever is
    // at that path": a failed create owns nothing, and after a successful rename the name is free.
    // A pre-existing artifact is never removed or rewritten here.
    if (owned) {
      try { fs.rmSync(temporary, { force: true }); } catch { /* best effort: never mask the original error */ }
    }
  }

  return Object.freeze({ path: target, inventoryDigest: envelope.inventoryDigest });
}

// --- CLI ------------------------------------------------------------------------------------------

// The complete flag set of THIS CLI, and the subset that must be supplied. `--cwd` defaults to the
// actual working directory; the other two name what is being attested and have no sane default.
export const ARTIFACT_FLAGS = ["base-tree", "cwd", "task"];
export const REQUIRED_ARTIFACT_FLAGS = ["base-tree", "task"];
const flagList = () => ARTIFACT_FLAGS.map((f) => `--${f}`).join(", ");

/**
 * Strict argument parsing for the artifact CLI, and deliberately unlike the long-standing
 * contract-report parser next door (which stays exactly as it is: it produces a fail-open report,
 * where tolerating an unrecognised token is the safer reading).
 *
 * This CLI publishes an attested artifact, so every kind of "we think you meant" is refused:
 *   - an unknown flag is not silently dropped -- it used to be, and the emission still SUCCEEDED,
 *     writing an inventory the operator had no reason to believe they had asked for;
 *   - a missing value never becomes a literal string. `--task --base-tree <oid>` once produced
 *     taskId "true", which the producer would have accepted had a task really been named `true`;
 *   - an empty value is not "supplied"; a bare positional is not silently skipped; and a flag given
 *     twice is refused rather than resolved last-wins.
 *
 * Every failure is E_API_ARGUMENTS, thrown BEFORE any production runs, and rendered by main()'s catch
 * as machine JSON on stderr with exit 1.
 *
 * @param {string[]} argv full process argv
 * @returns {{ "base-tree": string, task: string, cwd?: string }}
 */
export function parseArtifactArgs(argv) {
  const args = argv.slice(2);
  const options = {};
  for (let i = 0; i < args.length; i += 1) {
    const token = args[i];
    if (!token.startsWith("--")) {
      throw fail("E_API_ARGUMENTS",
        `unexpected argument ${JSON.stringify(token)}; this CLI takes only ${flagList()}`, { argument: token });
    }
    const name = token.slice(2);
    if (!ARTIFACT_FLAGS.includes(name)) {
      throw fail("E_API_ARGUMENTS", `unknown flag ${token}; this CLI accepts only ${flagList()}`, { flag: token });
    }
    if (Object.hasOwn(options, name)) {
      throw fail("E_API_ARGUMENTS", `${token} was given more than once`, { flag: token });
    }
    const value = args[i + 1];
    if (value === undefined || value.startsWith("--")) {
      throw fail("E_API_ARGUMENTS", `${token} requires a value`, { flag: token });
    }
    if (value === "") {
      throw fail("E_API_ARGUMENTS", `${token} was given an empty value`, { flag: token });
    }
    options[name] = value;
    i += 1;                                        // the value is consumed, never re-read as a flag
  }
  for (const name of REQUIRED_ARTIFACT_FLAGS) {
    if (!Object.hasOwn(options, name)) {
      throw fail("E_API_ARGUMENTS", `--${name} is required`, { flag: `--${name}` });
    }
  }
  return options;
}

export async function main(argv) {
  // Parsing lives INSIDE the caught boundary: a parser throw must reach the operator as the same
  // machine JSON and the same exit 1 as every other refusal, not as an unhandled rejection.
  try {
    const options = parseArtifactArgs(argv);
    const result = await emitChangedTestInventory({
      repoRoot: options.cwd ?? process.cwd(),
      baseTreeOid: options["base-tree"],
      taskId: options.task,
    });
    process.stdout.write(`${JSON.stringify({ ok: true, ...result })}\n`);
    process.exit(0);
  } catch (error) {
    const code = error && typeof error.code === "string" ? error.code : "E_UNEXPECTED";
    process.stderr.write(`${JSON.stringify({
      ok: false, code, message: error && error.message, detail: (error && error.detail) ?? null,
    })}\n`);
    process.exit(1);
  }
}

// The direct-invocation guard, in the SAME forward-direction body the existing CLI entry points use
// (realpath the invoked path, compare against this module's own file). Stated accurately, because an
// earlier draft of this comment claimed more than was true: validate-structure-core.mjs's garden 9d
// check runs over a CLOSED, hard-coded list of entry-point files, and this new file is NOT on it. So
// nothing currently hash-checks this copy against its siblings; the body is written to match them so
// that registering it later is a list edit and not a behaviour change. The existing sites are left
// exactly as they are.
function isInvokedDirectly() {
  if (!process.argv[1]) return false;
  try {
    return fs.realpathSync(process.argv[1]) === fileURLToPath(import.meta.url);
  } catch {
    return false;
  }
}

if (isInvokedDirectly()) main(process.argv);
