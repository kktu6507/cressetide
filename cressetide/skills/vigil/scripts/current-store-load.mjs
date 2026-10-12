// The ONE place the current provenance store is read from disk for governance seed derivation.
//
// Why its own module: TP approved v1.15 §11b.10c step 2 forbids a second read between validation,
// digest and seed derivation, and AC171 (vii) requires executable evidence that no second read
// happened. The only authorised way to observe that (§11b.10c, shape B) is a scratch source copy in
// a child process whose ONE edit points a fixed internal store-loader import at a counting proxy.
// That shape needs a fixed internal import to point at, so the read lives behind one, in one file,
// with one export.
//
// This is module decomposition, not a seam: it adds no public request key, no override, no
// environment argument and no injection point. buildGovernanceSeedPreimage()'s request stays exactly
// { repoRoot, baseTreeOid }, and the store path stays fixed -- a caller still cannot say where the
// store is, only which repository root to look under.
import fs from "node:fs";
import path from "node:path";

import { CANONICAL_STORE_PATH } from "./provenance-store.mjs";

// Returns the file text, or null when the store is absent. Absence is a legitimate state -- §11b.10c
// step 3 maps it onto the canonical empty v2 store -- so it is a return value, not an error.
// Every other failure (a directory, a permission error, unreadable bytes) is thrown: "cannot read"
// must never be silently folded into "not there", because the two lead to opposite conclusions.
export function readCurrentStoreFile(repoRoot) {
  const file = path.join(repoRoot, CANONICAL_STORE_PATH);
  try {
    return fs.readFileSync(file, "utf8");
  } catch (error) {
    if (error && error.code === "ENOENT") return null;
    throw error;
  }
}
