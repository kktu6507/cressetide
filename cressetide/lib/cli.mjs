// Command-line plumbing shared by the plugin's scripts and .github/scripts/publish-release.mjs: one
// entry-point check and one strict argument parser, in place of a per-script entry-point copy and a
// hand-rolled flag lookup in each. Node built-ins only.
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

// True when the module whose import.meta.url is passed is the process's entry script: the real path of
// process.argv[1] equals that module's path. A script started through a symlink or a junction still
// counts (both sides resolve to the real file), an import from another module or a test does not. False,
// never a throw, when there is no argv[1] (`node -e`, a REPL) or either side cannot be resolved.
export function isMain(importMetaUrl) {
  if (!process.argv[1]) return false;
  try {
    return fs.realpathSync(process.argv[1]) === fileURLToPath(importMetaUrl);
  } catch {
    return false;
  }
}

// Parses `argv` (normally process.argv.slice(2)) with node:util parseArgs in strict mode and never
// throws. Returns { values, positionals } on success, or { error, code } with parseArgs's own message and
// code (or one of the two below). The rules, all from parseArgs strict mode unless noted:
//   - an undeclared flag is an error (ERR_PARSE_ARGS_UNKNOWN_OPTION);
//   - a value-taking flag with nothing after it, or followed by a token that starts with "-", is an error
//     (ERR_PARSE_ARGS_INVALID_OPTION_VALUE); a value that starts with "-" is passed as `--flag=-value`;
//   - a boolean flag given a value (`--json=1`) is an error (ERR_PARSE_ARGS_INVALID_OPTION_VALUE);
//   - `--flag=` gives the empty string, not an error — callers that treat a value as optional use `||`;
//   - a repeated value-taking flag keeps its LAST value (parseArgs, for options without `multiple`);
//   - `--` ends the flags: everything after it is positional;
//   - positionals are an error unless `allowPositionals` (ERR_PARSE_ARGS_UNEXPECTED_POSITIONAL), and more
//     than `positionals` of them is an error too (ERR_CLI_TOO_MANY_POSITIONALS — this module's own);
//   - a string flag named in `rejectDashValues` whose value starts with "-" is an error even in the
//     `--flag=-value` form (ERR_CLI_DASH_VALUE — this module's own; see dashValueError).
// `options` is parseArgs's option config ({ cwd: { type: "string" }, json: { type: "boolean" } }). An
// invalid config, or an `argv` that is not an array (parseArgs would quietly fall back to process.argv),
// is reported the same way, as { error, code }, rather than thrown.
export function parseCli(argv, { options = {}, allowPositionals = false, positionals = Infinity, rejectDashValues = [] } = {}) {
  if (!Array.isArray(argv)) return { error: "argv must be an array of strings", code: "ERR_CLI_ARGV" };
  let parsed;
  try {
    parsed = parseArgs({ args: argv, options, strict: true, allowPositionals });
  } catch (error) {
    return { error: String(error?.message ?? error), code: error?.code ?? "ERR_CLI_PARSE" };
  }
  if (allowPositionals && parsed.positionals.length > positionals) {
    return {
      error: `Expected at most ${positionals} positional argument(s), got ${parsed.positionals.length}`,
      code: "ERR_CLI_TOO_MANY_POSITIONALS",
    };
  }
  const dashError = dashValueError(parsed.values, rejectDashValues);
  if (dashError) return { error: dashError, code: "ERR_CLI_DASH_VALUE" };
  return { values: parsed.values, positionals: parsed.positionals };
}

// A message naming the first of `names` whose parsed value (or, for a `multiple` option, any of whose
// values) starts with "-", or null. For a flag whose value is handed on to another program (contract-check's
// `--base`, passed to git): a leading "-" would be read there as an option of its own.
export function dashValueError(values, names) {
  for (const name of names || []) {
    const raw = values?.[name];
    for (const value of Array.isArray(raw) ? raw : [raw]) {
      if (typeof value === "string" && value.startsWith("-")) {
        return `Option '--${name}' does not accept a value starting with '-' (got '${value}')`;
      }
    }
  }
  return null;
}
