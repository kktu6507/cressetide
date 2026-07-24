#!/usr/bin/env node
// ctide check-model-provenance: a deterministic, repo-root MAINTAINER tool (mirrors
// .github/scripts/validate-structure.mjs and eval/fixture-eval.workflow.js — not shipped under
// cressetide/, never installed into a consumer project) that answers one question: does the model you are
// about to rely on match the model eval/baseline.md was last validated against?
//
// Why this exists: reviewer recall/false-positive measurements are model-sensitive. A model
// upgrade or downgrade can invalidate an otherwise unchanged baseline, so provenance must be checked.
//
// This is NOT a SessionStart hook: eval/ is repo-root tooling that never ships to a consumer install, and
// Claude Code only exposes the active model to a hook at SessionStart (and only there) — wiring this as a
// hook would mean shipping a check that fires for every plugin user, almost none of whom have a
// eval/baseline.md to compare against. Run this by hand (or from a release checklist, RELEASING.md) when
// the model you validate against changes, passing the model explicitly via --model.
//
// Dependency-free (Node built-ins only). Fail-open: a missing file, an unparseable provenance line, or no
// --model given yields a "no claim" report, never a crash, and the CLI always exits 0.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Extract the provenance baseline.md already records by convention (eval/README.md: "update this file
// with the new scores + date + model"): a "**Date:** YYYY-MM-DD" line and a "**Reviewer under test:**
// `<agent>` on `<model>`" line. Returns { model, date } with a field null when that line is absent/
// unparseable — a partial result is still usable (checkProvenance degrades per-field).
export function extractProvenance(markdown) {
  const text = String(markdown == null ? "" : markdown);
  const dateMatch = text.match(/\*\*Date:\*\*\s*(\d{4}-\d{2}-\d{2})/);
  const modelMatch = text.match(/\*\*Reviewer under test:\*\*[^\n]*?\bon\s+`([^`]+)`/);
  return {
    date: dateMatch ? dateMatch[1] : null,
    model: modelMatch ? modelMatch[1] : null,
  };
}

// Compare the recorded provenance against the model actually in use. Honest by construction — a "no
// claim" status whenever the inputs don't support a real comparison (no recorded model, or none supplied),
// rather than guessing or defaulting to "match"/"mismatch". Comparison is case-insensitive exact-string
// (no fuzzy/prefix matching — a model id typo should surface as a mismatch, not be silently forgiven).
export function checkProvenance(provenance, currentModel) {
  const recordedModel = provenance && provenance.model ? provenance.model : null;
  const recordedDate = provenance && provenance.date ? provenance.date : null;
  if (!recordedModel) {
    return { status: "unknown", recordedModel, recordedDate, currentModel: currentModel || null,
      message: "no recorded model found in the baseline file — no provenance claim" };
  }
  if (!currentModel) {
    return { status: "unknown", recordedModel, recordedDate, currentModel: null,
      message: "no --model given — pass the model you intend to rely on to check provenance" };
  }
  const match = recordedModel.trim().toLowerCase() === String(currentModel).trim().toLowerCase();
  return {
    status: match ? "match" : "mismatch",
    recordedModel, recordedDate, currentModel,
    message: match
      ? "current model matches the model the baseline/evidence was last validated against"
      : "current model differs from the baseline's recorded model — recall/false-positive numbers in " +
        "eval/baseline.md may not hold; re-run eval/ fixtures before " +
        "relying on them for this model",
  };
}

export function formatReport(result, sourceFile) {
  const lines = ["ctide check-model-provenance (advisory, repo-root dev tool — not shipped, never blocks):"];
  lines.push("  source: " + sourceFile);
  lines.push("  recorded: model=" + (result.recordedModel || "(none)") + " date=" + (result.recordedDate || "(none)"));
  lines.push("  queried model: " + (result.currentModel || "(none given)"));
  lines.push("  status: " + result.status.toUpperCase() + " — " + result.message);
  return lines.join("\n");
}

// Every flag token this file's `get()` closure is ever queried with (main()'s own --cwd/--file/--model
// reads below -- the complete recognized-flag set of this CLI's parser). Exported so the test suite can
// drive the SAME list `get()` guards against (no hardcoded duplicate list to drift out of sync). `get()`
// itself (below) checks this list before ever returning `args[i + 1]` as a flag's value: when that next
// token is itself one of these names, the value is treated as omitted -- `get()` returns the flag's own
// default rather than swallowing the neighboring flag's name. Mirrors run-reconcile.mjs's / run-ledger.mjs's
// identical KNOWN_FLAGS guard, each over its own file's complete flag set.
export const KNOWN_FLAGS = ["--cwd", "--file", "--model"];

function main(argv) {
  const args = argv.slice(2);
  // The one shared flag-value lookup EVERY flag in this file goes through. Guards the swallow at its single
  // root: if the token immediately following `flag` is itself one of KNOWN_FLAGS (this file's own complete
  // recognized-flag set, above), the value is treated as omitted -- `def` is returned instead of the
  // neighboring flag's own name. Fixes every flag uniformly, not per-call-site.
  const get = (flag, def) => {
    const i = args.indexOf(flag);
    const v = i >= 0 ? args[i + 1] : undefined;
    return v && !KNOWN_FLAGS.includes(v) ? v : def;
  };
  const cwd = get("--cwd", process.cwd());
  const file = get("--file", path.join(cwd, "eval", "baseline.md"));
  const currentModel = get("--model", "");
  let markdown = "";
  try { markdown = fs.readFileSync(file, "utf8"); } catch (e) { markdown = ""; }
  const provenance = extractProvenance(markdown);
  const result = checkProvenance(provenance, currentModel);
  process.stdout.write(formatReport(result, file) + "\n");
  process.exit(0);
}

function isInvokedDirectly() {
  if (!process.argv[1]) return false;
  try {
    return fs.realpathSync(process.argv[1]) === fileURLToPath(import.meta.url);
  } catch {
    return false;
  }
}

if (isInvokedDirectly()) main(process.argv);
