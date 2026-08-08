// ctide changed-test-inventory: the CANONICAL ENVELOPE reader for the AC60 historical-consumer
// clean slice. It is NOT a full populated ChangedTestInventory parser, and it does not claim to be.
//
// What it implements: the root envelope's exact shape, `baseTreeOid` as a full Git object name,
// `entries` as an array, and `inventoryDigest` recomputed from §2's one formula.
//
// What it deliberately does NOT implement: any semantics of a populated `entries[]`. The §6 entry
// contract — testRef identity and one-to-one matching, path normalisation, the status/reason/tag
// invariants, clause-ref and DP-ref validity, body and oracle digests, framework adapters, the
// lifecycle-affected reverse closure — needs the producer and the per-result consumers, none of
// which exist. So a NON-EMPTY entries[] is refused HERE, at the parser boundary, with a named and
// stable error. An earlier version parsed a reduced subset of those fields and relied on a
// downstream guard in contract-check to refuse populated inventories; that made this module hand
// back a populated inventory as though it were a parsed canonical artifact, with the refusal living
// somewhere else. The downstream guard remains as defence in depth, not as the contract.
//
// Library only, by design: no CLI entry point, so this file is not a fourteenth copy of the
// isInvokedDirectly() cluster the structure validator byte-compares.
import fs from "node:fs";
import { canonicalJson, sha256Hex } from "./provenance-store.mjs";

// Per-run derived scratch (docs/runtime-contract.md): rebuildable from Git base/head, never a
// semantic truth source, read-only for the checker, not committed.
export const INVENTORY_PATH = ".ctide/output/changed-test-inventory.json";

// The root envelope, exact. `storePath` is deliberately ABSENT: the canonical store path is a
// property of TaskState.baseProvenance, and a copy here would be a second authority for it.
export const INVENTORY_KEYS = ["baseTreeOid", "entries", "inventoryDigest"];

// The stable marker callers and tests can match on, so "this build does not support that yet" is
// never confused with "that inventory is malformed".
export const UNSUPPORTED_POPULATED = "unsupported-populated-inventory";

export class InventoryError extends Error {
  constructor(message) {
    super(message);
    this.name = "InventoryError";
  }
}

function refuse(message) {
  throw new InventoryError(message);
}

function sameKeys(o, expected) {
  return canonicalJson(Object.keys(o).sort()) === canonicalJson([...expected].sort());
}

// A 40-hex Git object name. Abbreviated oids are refused: the witness is compared for equality, so
// two spellings of one tree would make that comparison depend on how it was written down.
function isFullOid(v) {
  return typeof v === "string" && /^[0-9a-f]{40}$/.test(v);
}

// §2's single formula. Recomputed, never trusted: the digest is the artifact that proves two readers
// saw the same inventory, so accepting whatever string the file carries would prove nothing.
export function computeInventoryDigest({ baseTreeOid, entries }) {
  return sha256Hex(canonicalJson({ baseTreeOid, entries }));
}

export function parseInventory(text) {
  let raw;
  try {
    raw = JSON.parse(text);
  } catch (e) {
    refuse(`changed-test-inventory is not valid JSON: ${e.message}`);
  }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    refuse("changed-test-inventory must be a JSON object");
  }
  if (!sameKeys(raw, INVENTORY_KEYS)) {
    const ks = Object.keys(raw).sort();
    const extra = ks.filter((k) => !INVENTORY_KEYS.includes(k));
    const missing = INVENTORY_KEYS.filter((k) => !ks.includes(k));
    refuse(
      "changed-test-inventory key set is not the canonical envelope"
      + `${missing.length ? ` (missing: ${missing.join(", ")})` : ""}`
      + `${extra.length ? ` (undeclared: ${extra.join(", ")})` : ""}`,
    );
  }
  if (!isFullOid(raw.baseTreeOid)) {
    refuse(`changed-test-inventory baseTreeOid must be a full 40-hex Git object name, got ${JSON.stringify(raw.baseTreeOid)}`);
  }
  if (!Array.isArray(raw.entries)) refuse("changed-test-inventory entries must be an array");

  // The clean-slice boundary. Refusing here — before any entry is inspected — is the point: this
  // module must not partially understand an entry shape whose semantics it cannot enforce, because
  // a partial understanding is indistinguishable from a complete one to everyone downstream.
  if (raw.entries.length !== 0) {
    refuse(
      `${UNSUPPORTED_POPULATED}: this build reads the canonical envelope for the AC60 historical-consumer `
      + `clean slice only, so entries[] must be empty; got ${raw.entries.length}. Populated entries need the `
      + `§6 producer and the per-result body/tag consumers, which are not implemented — the inventory is `
      + "refused rather than partially parsed",
    );
  }

  const expected = computeInventoryDigest(raw);
  if (raw.inventoryDigest !== expected) {
    refuse(
      `changed-test-inventory inventoryDigest ${JSON.stringify(raw.inventoryDigest)} does not equal `
      + `sha256(canonicalJson({ baseTreeOid, entries })) = ${expected}`,
    );
  }
  return raw;
}

export function loadInventory(file) {
  let text;
  try {
    text = fs.readFileSync(file, "utf8");
  } catch (e) {
    refuse(`cannot read changed-test-inventory at ${file} (${e && e.code})`);
  }
  return parseInventory(text);
}
