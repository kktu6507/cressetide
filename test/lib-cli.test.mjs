// Unit tests for cressetide/lib/cli.mjs: parseCli (every error class, last-wins, the `=` and `--` forms,
// the dash-value guard) and isMain (imported, run directly, run through a junction/symlink, `node -e`).
import assert from "node:assert/strict";
import cp from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { tempDir, test, write } from "./helpers.mjs";
import { dashValueError, isMain, parseCli } from "../cressetide/lib/cli.mjs";

const LIB_CLI_URL = new URL("../cressetide/lib/cli.mjs", import.meta.url).href;
const OPTIONS = { cwd: { type: "string" }, base: { type: "string" }, json: { type: "boolean" } };
const parse = (argv, config = {}) => parseCli(argv, { options: OPTIONS, ...config });

// --- parseCli: success ---

test("parseCli(): string and boolean flags, in both the separate and the `=` form", () => {
  assert.deepEqual({ ...parse(["--cwd", "a", "--json"]).values }, { cwd: "a", json: true });
  assert.deepEqual({ ...parse(["--cwd=a"]).values }, { cwd: "a" });
  assert.deepEqual(parse([]).positionals, []);
  assert.deepEqual({ ...parse([]).values }, {});
});

test("parseCli(): a repeated string flag keeps its last value", () => {
  assert.equal(parse(["--cwd", "first", "--cwd", "second"]).values.cwd, "second");
  assert.equal(parse(["--cwd=first", "--cwd", "second", "--cwd=third"]).values.cwd, "third");
});

test("parseCli(): `--flag=` gives the empty string, and `--flag=-x` passes a dash value", () => {
  assert.equal(parse(["--cwd="]).values.cwd, "");
  assert.equal(parse(["--cwd=-x"]).values.cwd, "-x");
});

test("parseCli(): `--` ends the flags — what follows is positional", () => {
  assert.deepEqual(parse(["--json", "--", "--cwd", "x"], { allowPositionals: true }), { values: parse(["--json"]).values, positionals: ["--cwd", "x"] });
  assert.equal(parse(["--", "--cwd"]).code, "ERR_PARSE_ARGS_UNEXPECTED_POSITIONAL", "still positional, so refused without allowPositionals");
});

test("parseCli(): positionals, when allowed, up to the given limit", () => {
  assert.deepEqual(parse(["a", "--json", "b"], { allowPositionals: true, positionals: 2 }).positionals, ["a", "b"]);
  assert.deepEqual(parse(["a", "b", "c"], { allowPositionals: true }).positionals, ["a", "b", "c"], "no limit by default");
});

// --- parseCli: every error class, returned and never thrown ---

for (const [label, argv, config, code, message] of [
  ["an unknown flag", ["--bogus"], {}, "ERR_PARSE_ARGS_UNKNOWN_OPTION", /--bogus/],
  ["an unknown short flag", ["-x"], {}, "ERR_PARSE_ARGS_UNKNOWN_OPTION", /-x/],
  ["a value-taking flag at the end", ["--json", "--cwd"], {}, "ERR_PARSE_ARGS_INVALID_OPTION_VALUE", /--cwd/],
  ["a value-taking flag followed by another flag", ["--cwd", "--json"], {}, "ERR_PARSE_ARGS_INVALID_OPTION_VALUE", /--cwd/],
  ["a value-taking flag followed by a dash value", ["--cwd", "-1"], {}, "ERR_PARSE_ARGS_INVALID_OPTION_VALUE", /--cwd/],
  ["a boolean flag given a value", ["--json=1"], {}, "ERR_PARSE_ARGS_INVALID_OPTION_VALUE", /--json/],
  ["a positional when none is allowed", ["stray"], {}, "ERR_PARSE_ARGS_UNEXPECTED_POSITIONAL", /stray/],
  ["more positionals than allowed", ["a", "b", "c"], { allowPositionals: true, positionals: 2 }, "ERR_CLI_TOO_MANY_POSITIONALS", /at most 2 .* got 3/],
  ["a rejected dash value in the `=` form", ["--base=--output=x"], { rejectDashValues: ["base"] }, "ERR_CLI_DASH_VALUE", /--base.*--output=x/],
  ["argv that is not an array", undefined, {}, "ERR_CLI_ARGV", /array/],
  ["an invalid option config", ["--n", "1"], { options: { n: { type: "number" } } }, /^ERR_INVALID_ARG_/, /./],
]) {
  test(`parseCli(): ${label} is returned as { error, code }, not thrown`, () => {
    let result;
    assert.doesNotThrow(() => { result = parseCli(argv, { options: OPTIONS, ...config }); });
    assert.deepEqual(Object.keys(result).sort(), ["code", "error"]);
    if (code instanceof RegExp) assert.match(result.code, code); else assert.equal(result.code, code);
    assert.equal(typeof result.error, "string");
    assert.match(result.error, message);
  });
}

test("parseCli(): rejectDashValues leaves ordinary values and unnamed flags alone", () => {
  assert.equal(parse(["--base=HEAD~1"], { rejectDashValues: ["base"] }).values.base, "HEAD~1");
  assert.equal(parse(["--cwd=-x"], { rejectDashValues: ["base"] }).values.cwd, "-x");
  assert.equal(parse(["--base", "-x"], { rejectDashValues: ["base"] }).code, "ERR_PARSE_ARGS_INVALID_OPTION_VALUE", "the separate form is already refused by parseArgs");
});

test("dashValueError(): names the first dash value, checks every value of a multiple option, ignores the rest", () => {
  assert.match(dashValueError({ base: "-p" }, ["base"]), /--base.*-p/);
  assert.match(dashValueError({ base: ["ok", "--x"] }, ["base"]), /--base.*--x/);
  assert.equal(dashValueError({ base: "HEAD", json: true }, ["base", "json"]), null);
  assert.equal(dashValueError({}, ["base"]), null);
  assert.equal(dashValueError(undefined, ["base"]), null);
  assert.equal(dashValueError({ base: "-p" }, undefined), null);
});

// --- isMain ---

// A module that records isMain(import.meta.url) and prints MAIN when it is the entry script.
function entryModule() {
  const dir = tempDir("ctide-lib-cli-entry-");
  const file = path.join(dir, "entry.mjs");
  write(file, [
    `import { isMain } from ${JSON.stringify(LIB_CLI_URL)};`,
    "export const main = isMain(import.meta.url);",
    'process.stdout.write(main ? "MAIN" : "NOT-MAIN");',
    "",
  ].join("\n"));
  return { dir, file };
}

test("isMain(): false for an imported module", async () => {
  const { file } = entryModule();
  const module = await import(pathToFileURL(file).href);
  assert.equal(module.main, false);
});

test("isMain(): true for the script node was started with", () => {
  const { file } = entryModule();
  const run = cp.spawnSync(process.execPath, [file], { encoding: "utf8" });
  assert.equal(run.status, 0, run.stderr);
  assert.equal(run.stdout, "MAIN");
});

test("isMain(): true for a script started through a directory junction or symlink", (t) => {
  const { dir } = entryModule();
  const link = path.join(tempDir("ctide-lib-cli-link-"), "linked");
  try {
    fs.symlinkSync(dir, link, process.platform === "win32" ? "junction" : "dir");
  } catch (error) {
    t.skip(`cannot create a directory link here: ${error.code || error.message}`);
    return;
  }
  const run = cp.spawnSync(process.execPath, [path.join(link, "entry.mjs")], { encoding: "utf8" });
  assert.equal(run.status, 0, run.stderr);
  assert.equal(run.stdout, "MAIN");
});

test("isMain(): false under `node -e` (no argv[1])", () => {
  const run = cp.spawnSync(process.execPath, [
    "--input-type=module", "-e",
    `import { isMain } from ${JSON.stringify(LIB_CLI_URL)}; process.stdout.write(String(isMain(import.meta.url)) + "|" + String(process.argv[1]));`,
  ], { encoding: "utf8" });
  assert.equal(run.status, 0, run.stderr);
  assert.equal(run.stdout, "false|undefined");
});

test("isMain(): false, never a throw, when argv[1] is missing or unresolvable or the URL is not a file URL", () => {
  const saved = process.argv[1];
  try {
    for (const argv1 of [undefined, "", path.join(tempDir("ctide-lib-cli-gone-"), "missing.mjs")]) {
      process.argv[1] = argv1;
      assert.equal(isMain(import.meta.url), false, String(argv1));
    }
    process.argv[1] = saved;
    assert.equal(isMain("not a url"), false);
    assert.equal(isMain("https://example.invalid/x.mjs"), false);
    assert.equal(isMain(undefined), false);
  } finally {
    process.argv[1] = saved;
  }
});
