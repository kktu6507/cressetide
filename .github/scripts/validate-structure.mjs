#!/usr/bin/env node
// CLI for the structural validator (validate-structure-core.mjs): resolves the repository root from this
// script's own location (never the process cwd), prints every failure, and sets the exit code.
import path from "node:path";
import { fileURLToPath } from "node:url";
import { gitFiles, validate } from "./validate-structure-core.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const files = gitFiles(root);
if (files === null) {
  console.error(`validate-structure: ${root} is not the top of a git work tree (or git is unavailable); scanning every file under it instead of git's tracked + untracked-not-ignored list`);
}
const errors = validate({ root, files });
if (errors.length) {
  console.error("Plugin structure validation FAILED:");
  for (const e of errors) console.error("  - " + e);
  process.exitCode = 1;
} else {
  console.log("Plugin structure validation passed.");
}
