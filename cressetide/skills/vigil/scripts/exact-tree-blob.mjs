// The ONE hardened read of a single regular blob at an exact path inside an exact Git tree.
//
// WHY THIS IS ITS OWN MODULE. Two components need this read — the accepted producer's private base
// capture and the Step 6 committed consumer's private historical witness — and a second
// implementation of it is not a style problem. The older synchronous helper in contract-check.mjs
// carries two of the defects a near-copy invites:
//
//   • an inherited Git environment, where a `refs/replace` entry silently turns "read tree A" into
//     tree B for the whole read, so an exact-tree witness becomes whatever replacement currently
//     points at;
//   • a type-only leaf check, where mode 120000 is still `blob` to `ls-tree`, so a symlink's target
//     string is read as file content.
//
// CORRECTION, recorded because an earlier draft of this comment got it wrong: that helper does NOT
// collapse failure into absence. contract-check.mjs:174-201 refuses an unresolvable object, a failed
// listing and an unreadable blob explicitly, each saying a Git failure is never read as "no store in
// the tree", and it refuses an ambiguous listing too. Its third known defect is elsewhere and is not
// this module's business: it validates a historical store with the CURRENT clock. All three legacy
// items belong to a separate integration slice; nothing here changes that helper.
//
// SCOPE. Bytes and scalars only. This module decides nothing about what the bytes MEAN: absence is
// reported as absence, never mapped to a canonical empty anything, and no parsing, decoding,
// version dispatch or validation happens here. Those are store semantics and stay private to each
// caller, which is why this can be shared without sharing any governance context.
import crypto from "node:crypto";
import { runGit, GitReadError, newControlledHome, gitEnvironment } from "./git-object-read.mjs";

export class ExactTreeBlobError extends Error {
  constructor(code, message, detail) {
    super(message);
    this.name = "ExactTreeBlobError";
    this.code = code;
    if (detail !== undefined) this.detail = detail;
  }
}

const fail = (code, message, detail) => new ExactTreeBlobError(code, message, detail);

// A regular file. 100644 and 100755 are the only two regular-blob modes Git records; 120000 is a
// symlink (whose blob content is a target path, not file content) and 160000 is a gitlink.
const REGULAR_BLOB_MODES = ["100644", "100755"];

// EXACT means an object NAME, not a revision expression. `cat-file -t HEAD` reports "commit" and is
// refused by the type check below, but `cat-file -t HEAD^{tree}` reports "tree" and would sail
// through -- so "the exact tree the witness names" would have become "whatever that expression
// resolves to today". Requiring a raw 40/64-hex object name closes every expression spelling at once.
// The producer's request layer already enforces this same grammar, so this is not a new restriction
// on its path; it is what makes the newly exported contract mean what it says.
const OBJECT_NAME = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;

// THE ALLOWED INPUT DOMAIN, defined positively rather than guessed character by character. This
// helper reads ONE canonical repo-relative path, so that is what it accepts:
//
//   nonempty, "/"-separated, no leading "/", no backslash, no Windows drive prefix,
//   no empty / "." / ".." segment, and no leading ":".
//
// Ordinary legal punctuation is fine, and a leading "-" is fine because every read below passes the
// path after `--`, which stops Git reading it as an option.
//
// WHY A LEADING COLON IS EXCLUDED, stated accurately. `:` introduces pathspec magic (`:(glob)`,
// `:(icase)`, `:!`). This is a choice of API domain, NOT a claim that literal-pathspec reading is
// unsafe: `git --literal-pathspecs ls-tree … -- <path>` works, that option can be passed through
// runGit because it prepends GIT_GLOBAL_OPTIONS and args may begin with a further global option, and
// under a literal-filename API a nonexistent literal name reporting absence is the CORRECT answer.
// The reason to exclude it here is narrower: this helper's callers read a canonical store path, and
// restricting the domain lets an out-of-contract input be refused BEFORE a read can report an
// absence its caller would map onto "no store in that tree". Both magic spellings -- one that would
// have matched and one that would not -- fail this input rule, so neither reaches Git at all.
const PATH_SEGMENT_BAD = new Set(["", ".", ".."]);
function canonicalRelativePathFault(p) {
  if (p.startsWith("/")) return "is absolute";
  if (p.includes("\\")) return "contains a backslash; the separator is \"/\"";
  if (/^[A-Za-z]:/.test(p)) return "carries a Windows drive prefix";
  if (p.startsWith(":")) return "begins with \":\", which Git reads as pathspec magic";
  if (p.split("/").some((s) => PATH_SEGMENT_BAD.has(s))) return "contains an empty, \".\" or \"..\" segment";
  return null;
}

// The RAW digest -- sha256 over the bytes as they stand. Deliberately NOT the store's sha256Hex(),
// which canonicalises its input first: that is the current store's CAS notation, while shared §9
// verifies a historical witness against the file's ORIGINAL bytes. Confusing the two makes every
// base store with a BOM or CRLF permanently mismatch, and the failure looks like a race rather than
// a notation error. Computing it HERE is the point of returning it: both callers get one notation.
const rawSha256 = (bytes) => crypto.createHash("sha256").update(bytes).digest("hex");

/**
 * Read one path inside one exact tree.
 *
 * @param {{ repoRoot: string, treeOid: string, path: string }} request exact key set. `treeOid` is a
 *   raw 40/64-hex object NAME, never a revision expression; `path` is a literal repo-relative path,
 *   never a pathspec.
 * @returns {Promise<{present: boolean, rawBytes: Buffer|null, rawDigest: string|null}>}
 *   `present: false` means the tree genuinely lists nothing at that path, and both other fields are
 *   null — absence is reported as absence and is never mapped onto a canonical empty anything, which
 *   is store semantics and stays with each caller. The entry's mode and oid are deliberately NOT
 *   returned: every non-regular mode is already refused here, so no caller gains anything actionable
 *   from them, and both already travel in the `detail` of the refusals that mention them. Every other
 *   outcome — an out-of-contract request, an unresolvable name, an object that is not a tree, an
 *   ambiguous listing, a returned path that is not the requested one, a non-regular entry, or a
 *   failed blob read — throws.
 */
export async function readExactTreeBlob(request) {
  if (arguments.length !== 1) {
    throw fail("E_API_ARGUMENTS",
      "readExactTreeBlob takes exactly one argument; a git executable, an environment, a filesystem "
      + "or a capture hook cannot be supplied");
  }
  if (request === null || typeof request !== "object" || Array.isArray(request)) {
    throw fail("E_API_ARGUMENTS", "the readExactTreeBlob request must be a JSON object");
  }
  // OWN keys, not merely the enumerable string ones; symbols refused before the sort and the message.
  const ownKeys = Reflect.ownKeys(request);
  const symbols = ownKeys.filter((k) => typeof k !== "string");
  if (symbols.length > 0) {
    throw fail("E_API_ARGUMENTS",
      `the readExactTreeBlob request carries symbol-keyed own properties (${symbols.map(String).join(", ")}); `
      + 'it must declare exactly ["path","repoRoot","treeOid"]');
  }
  const keys = ownKeys.sort();
  if (keys.length !== 3 || keys[0] !== "path" || keys[1] !== "repoRoot" || keys[2] !== "treeOid") {
    throw fail("E_API_ARGUMENTS",
      `the readExactTreeBlob request must declare exactly ["path","repoRoot","treeOid"]; got ${JSON.stringify(keys)}`);
  }
  // ONE read of each value, after the key check and before the per-key string check, so the three
  // refusals keep their order: E_API_ARGUMENTS, then E_TREE_OID_GRAMMAR, then E_PATH_GRAMMAR.
  const captured = {};
  for (const key of ["repoRoot", "treeOid", "path"]) captured[key] = request[key];
  for (const key of ["repoRoot", "treeOid", "path"]) {
    if (typeof captured[key] !== "string" || captured[key] === "") {
      throw fail("E_API_ARGUMENTS", `${key} must be a non-empty string`);
    }
  }
  const { repoRoot, treeOid } = captured;
  const wanted = captured.path;
  if (!OBJECT_NAME.test(treeOid)) {
    throw fail("E_TREE_OID_GRAMMAR",
      `treeOid must be a 40 or 64 lowercase hex object name; got ${JSON.stringify(treeOid)}. A revision `
      + "expression is not an exact tree: it names whatever it resolves to at read time",
      { treeOid });
  }
  const pathFault = canonicalRelativePathFault(wanted);
  if (pathFault !== null) {
    throw fail("E_PATH_GRAMMAR",
      `path must be a canonical repo-relative path; ${JSON.stringify(wanted)} ${pathFault}`,
      { path: wanted });
  }

  // One controlled environment for the whole read: redirect variables scrubbed, HOME and the config
  // files pointed nowhere, object replacement and lazy fetching closed in BOTH spellings. A Git that
  // does not recognise a variable ignores it in silence, while an unknown option is a refusal, so
  // neither spelling alone is sufficient.
  const environment = gitEnvironment(newControlledHome(repoRoot));
  const run = async (args) => {
    try {
      return await runGit(repoRoot, args, environment);
    } catch (error) {
      if (error instanceof GitReadError) throw fail("E_GIT_FAILED", error.message, error.detail);
      throw error;
    }
  };

  // The object's OWN type. `rev-parse --verify <oid>^{tree}` succeeds on a commit and hands back a
  // DIFFERENT oid, and `ls-tree` accepts a commit too — so peelability proves nothing about the
  // declared object, and a witness naming a commit would be read against the tree it points at.
  let type;
  try {
    type = (await run(["cat-file", "-t", treeOid])).toString("utf8").trim();
  } catch (error) {
    throw fail("E_TREE_OID", `${treeOid} is not an object in this repository`,
      { treeOid, cause: error && error.code });
  }
  if (type !== "tree") {
    throw fail("E_TREE_OID",
      `${treeOid} is a ${type}, not a tree; an object that merely PEELS to a tree is not the tree`,
      { treeOid, type });
  }

  // `-z` so a path containing a quote or a newline cannot be misparsed, and `--` so a path is never
  // read as a revision. An EMPTY listing is the ONLY thing that counts as absence.
  const listing = (await run(["ls-tree", "-z", "--full-tree", treeOid, "--", wanted]))
    .toString("utf8").replace(/\0+$/, "");
  if (listing.length === 0) return { present: false, rawBytes: null, rawDigest: null };

  const records = listing.split("\0").filter((r) => r.length > 0);
  if (records.length > 1) {
    throw fail("E_TREE_ENTRY_AMBIGUOUS",
      `tree ${treeOid} lists ${records.length} entries for ${wanted}; refusing rather than choosing one`,
      { treeOid, path: wanted, count: records.length });
  }
  const tab = records[0].indexOf("\t");
  if (tab < 0) throw fail("E_GIT_OUTPUT", "an ls-tree record carries no tab separator", { treeOid, path: wanted });
  // The record's own path, compared to the one asked for. Under `-z` it is emitted raw and unquoted,
  // so this is a byte comparison: an entry returned for any other path -- however it came to be
  // matched -- is content from somewhere else and is refused rather than read.
  const returnedPath = records[0].slice(tab + 1);
  if (returnedPath !== wanted) {
    throw fail("E_TREE_ENTRY_PATH",
      `tree ${treeOid} returned an entry for ${JSON.stringify(returnedPath)} when ${JSON.stringify(wanted)} was `
      + "requested; an exact read does not accept content from another path",
      { treeOid, requested: wanted, returned: returnedPath });
  }
  const [mode, objectType, oid] = records[0].slice(0, tab).split(" ");
  // Type AND mode. Type alone admits a symlink, whose bytes are a target string rather than content.
  if (objectType !== "blob" || !REGULAR_BLOB_MODES.includes(mode)) {
    throw fail("E_TREE_ENTRY_KIND",
      `${wanted} in tree ${treeOid} is mode ${mode} (${objectType}); only a regular blob is readable here`,
      { treeOid, path: wanted, mode, objectType });
  }
  const rawBytes = await run(["cat-file", "blob", oid]);
  return { present: true, rawBytes, rawDigest: rawSha256(rawBytes) };
}
