// Tests for eval/check-model-provenance.mjs — a repo-root maintainer tool (mirrors
// .github/scripts/validate-structure.mjs; not shipped under cressetide/, never installed into a consumer
// project) that flags when the model in use differs from the model eval/baseline.md was last validated
// against. The honesty guards (no recorded model / no --model given -> "unknown", never a guessed
// match/mismatch) are the load-bearing behavior.
import { test } from "node:test";
import assert from "node:assert";
import cp from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { extractProvenance, checkProvenance, formatReport } from "../eval/check-model-provenance.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CLI = path.join(root, "eval", "check-model-provenance.mjs");

const REAL_BASELINE = `# Behavioral regression baseline

Last run of the \`eval/fixtures/\` suite (method: \`README.md\`).

- **Date:** 2099-01-02
- **Reviewer under test:** \`ctide:code-reviewer\` on \`model-alpha\` — blind (shown only intent + code).
- **Independent judge:** a separate agent on \`model-alpha\` (separate context + prompt).
`;

// --- extractProvenance ---

test("extractProvenance parses the real eval/baseline.md format", () => {
  const p = extractProvenance(REAL_BASELINE);
  assert.strictEqual(p.date, "2099-01-02");
  assert.strictEqual(p.model, "model-alpha");
});

test("extractProvenance degrades to nulls on missing lines / empty / garbage input", () => {
  assert.deepStrictEqual(extractProvenance(""), { date: null, model: null });
  assert.deepStrictEqual(extractProvenance("no relevant lines here"), { date: null, model: null });
  const dateOnly = extractProvenance("- **Date:** 2026-01-01\nsome prose, no reviewer line");
  assert.deepStrictEqual(dateOnly, { date: "2026-01-01", model: null });
});

// --- checkProvenance: the honesty guards ---

test("no recorded model -> status unknown, no claim", () => {
  const r = checkProvenance({ model: null, date: null }, "claude-sonnet-5");
  assert.strictEqual(r.status, "unknown");
  assert.match(r.message, /no recorded model/i);
});

test("no --model given -> status unknown, no claim (even with a recorded model)", () => {
  const r = checkProvenance({ model: "model-alpha", date: "2099-01-02" }, "");
  assert.strictEqual(r.status, "unknown");
  assert.match(r.message, /no --model given/i);
});

test("matching model (case-insensitive) -> status match", () => {
  const r = checkProvenance({ model: "model-alpha", date: "2099-01-02" }, "MODEL-ALPHA");
  assert.strictEqual(r.status, "match");
});

test("different model -> status mismatch, names both models and recommends a re-run", () => {
  const r = checkProvenance({ model: "model-alpha", date: "2099-01-02" }, "model-beta");
  assert.strictEqual(r.status, "mismatch");
  assert.strictEqual(r.recordedModel, "model-alpha");
  assert.strictEqual(r.currentModel, "model-beta");
  assert.match(r.message, /re-run eval/i);
});

test("a near-miss model id (typo) is reported as a mismatch, not silently forgiven", () => {
  const r = checkProvenance({ model: "model-alpha", date: "2099-01-02" }, "model-alphx");
  assert.strictEqual(r.status, "mismatch");
});

// --- formatReport ---

test("formatReport states it is advisory and never blocks", () => {
  const out = formatReport(checkProvenance({ model: "model-alpha", date: "2099-01-02" }, "model-beta"), "eval/baseline.md");
  assert.match(out, /advisory/i);
  assert.match(out, /never blocks/i);
  assert.match(out, /MISMATCH/);
});

// --- CLI: end-to-end, fail-open ---

test("CLI: a real baseline file + matching --model reports MATCH and exits 0", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ctide-prov-"));
  try {
    const f = path.join(dir, "baseline.md");
    fs.writeFileSync(f, REAL_BASELINE, "utf8");
    const out = cp.execFileSync("node", [CLI, "--file", f, "--model", "model-alpha"]).toString();
    assert.match(out, /status: MATCH/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("CLI: a missing baseline file fails open (UNKNOWN, exit 0, no crash)", () => {
  const r = cp.spawnSync("node", [CLI, "--file", "/nonexistent/baseline.md", "--model", "model-beta"]);
  assert.strictEqual(r.status, 0, "must exit 0 even when the baseline file is absent");
  assert.match(r.stdout.toString(), /status: UNKNOWN/);
});

test("CLI: no --model given reports UNKNOWN, not a false match/mismatch", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ctide-prov2-"));
  try {
    const f = path.join(dir, "baseline.md");
    fs.writeFileSync(f, REAL_BASELINE, "utf8");
    const out = cp.execFileSync("node", [CLI, "--file", f]).toString();
    assert.match(out, /status: UNKNOWN/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
