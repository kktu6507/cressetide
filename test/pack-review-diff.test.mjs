// Tests for pack-review-diff.mjs — the Review-Packet diff packer. The load-bearing property is G1:
// the packer REORDERS + ANNOTATES for focus but never drops content (deletion/whitespace hunks are ranked
// last, never removed; any --max-lines trim is disclosed with a regenerate pointer; non-diff input passes
// through unchanged). Those invariants are pinned hardest. All deterministic, no model.
import { test } from "node:test";
import assert from "node:assert";
import cp from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  parseDiff, classifyLang, rankAndPack, formatPacked,
} from "../cressetide/skills/vigil/scripts/pack-review-diff.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SCRIPT = path.join(root, "cressetide", "skills", "vigil", "scripts", "pack-review-diff.mjs");

// Build a diff from explicit lines (leading +/-/space prefixes stay unambiguous) with a trailing newline.
const d = (...lines) => lines.join("\n") + "\n";
// The full stdin->stdout transform, minus the actual stdin read.
const pack = (diff, opts, meta) => formatPacked(rankAndPack(parseDiff(diff), opts || { maxLines: 0 }), meta || {});

// One file with a deletion-only hunk FIRST (in SOURCE order) and a substantive hunk SECOND — so the
// "substantive ranked first" assertion actually requires the packer to REORDER (it would pass trivially
// if the substantive hunk already led the source, which is the hollow-ordering trap T1 closes).
const APP_JS = d(
  "diff --git a/app.js b/app.js",
  "--- a/app.js",
  "+++ b/app.js",
  "@@ -1,3 +1,2 @@",
  " aboveDel",
  "-DELETION_ONLY_LINE",
  " belowDel",
  "@@ -20,3 +19,3 @@",
  " keep",
  "-old",
  "+SUBSTANTIVE_ADD",
  " tail",
);

test("G1-a: a deletion-only hunk is RETAINED and ranked AFTER the substantive hunk (which led it in SOURCE)", () => {
  const out = pack(APP_JS);
  assert.ok(out.includes("DELETION_ONLY_LINE"), "deletion-only hunk content must be present (never dropped)");
  assert.ok(out.includes("SUBSTANTIVE_ADD"), "substantive hunk content must be present");
  // APP_JS puts the deletion-only hunk FIRST in source, so this only passes if the packer actually reorders.
  assert.ok(out.indexOf("SUBSTANTIVE_ADD") < out.indexOf("DELETION_ONLY_LINE"),
    "the substantive hunk must be emitted BEFORE the deletion-only hunk (a real reorder, not source order)");
});

test("G1-b: default (maxLines=0) drops nothing — every +/- changed line survives", () => {
  const diff =
    d("diff --git a/a.js b/a.js", "--- a/a.js", "+++ b/a.js", "@@ -1,2 +1,2 @@", " ctxA", "-A_REMOVED", "+A_ADDED") +
    d("diff --git a/b.py b/b.py", "--- a/b.py", "+++ b/b.py", "@@ -1,2 +1,2 @@", " ctxB", "-B_REMOVED", "+B_ADDED") +
    d("diff --git a/c.md b/c.md", "--- a/c.md", "+++ b/c.md", "@@ -1,2 +1,2 @@", " ctxC", "-C_REMOVED", "+C_ADDED");
  const out = pack(diff, { maxLines: 0 });
  for (const line of ["A_REMOVED", "A_ADDED", "B_REMOVED", "B_ADDED", "C_REMOVED", "C_ADDED"]) {
    assert.ok(out.includes(line), `changed line ${line} must appear in the packed output`);
  }
});

// A big file (3 additions) and a tiny file (1 change), same language so ranking is purely by size.
const BIG_JS = d(
  "diff --git a/big.js b/big.js", "--- a/big.js", "+++ b/big.js",
  "@@ -1,3 +1,6 @@", " top", "+BIG_ADD_1", "+BIG_ADD_2", "+BIG_ADD_3", " BIG_TAIL_LINE",
);
const TINY_JS = d(
  "diff --git a/tiny.js b/tiny.js", "--- a/tiny.js", "+++ b/tiny.js",
  "@@ -1,1 +1,1 @@", "-TINY_OLD", "+TINY_ADD",
);

test("ranking: the bigger-change file appears before the smaller one", () => {
  const out = pack(TINY_JS + BIG_JS, { maxLines: 0 });          // tiny first in SOURCE order
  assert.ok(out.indexOf("### big.js") < out.indexOf("### tiny.js"),
    "the big-change file must be ordered before the small-change file");
});

test("G1-c: exceeding a small --max-lines DISCLOSES the trim (names files + regenerate pointer); the biggest file is retained IN FULL", () => {
  const out = pack(TINY_JS + BIG_JS, { maxLines: 4 });          // big.js alone exceeds 4 rendered lines
  assert.ok(out.includes("BIG_ADD_1"), "the top-ranked (biggest) file must be retained — its FIRST changed line");
  assert.ok(out.includes("BIG_TAIL_LINE"), "the kept file's LAST line must ALSO survive (no mid-file truncation of the kept file)");
  assert.ok(out.includes("⚠️"), "a trim must surface the disclosure trailer");
  assert.ok(out.includes("1 more file(s) trimmed"), "the trailer must count the trimmed files");
  assert.ok(out.includes("  - tiny.js"), "the trailer must NAME the trimmed file");
  assert.ok(out.includes("git diff <base> -- <paths>"), "the trailer must carry the regenerate pointer");
  assert.ok(out.includes("(+1 trimmed)"), "the one-line header must reflect the trimmed count (FIX5), not imply the trimmed files don't exist");
  assert.ok(!out.includes("TINY_ADD"), "a trimmed file's content is withheld (disclosed by name+pointer, not shown)");
});

test("G1-c: --regen overrides the default regenerate pointer in the trailer", () => {
  const out = pack(TINY_JS + BIG_JS, { maxLines: 4 }, { regen: "git diff main..HEAD -- src" });
  assert.ok(out.includes("regenerate the full same-scoped diff: git diff main..HEAD -- src"));
});

test("line numbers: an added line is prefixed with its correct NEW-side line number; a deletion has none", () => {
  const diff = d(
    "diff --git a/n.js b/n.js", "--- a/n.js", "+++ b/n.js",
    "@@ -1,2 +1,2 @@", " firstline", "-REMOVED_LINE", "+SECONDLINE_ADDED",
  );
  const out = pack(diff);
  assert.ok(out.includes("2 +SECONDLINE_ADDED"), "the added line must carry new-side number 2");
  assert.ok(!/\d -REMOVED_LINE/.test(out), "a removed line must carry NO new-side number");
});

test("parseDiff: computes added/removed and flags deletion-only + whitespace-only hunks", () => {
  const files = parseDiff(APP_JS);
  assert.strictEqual(files.length, 1);
  const app = files[0];
  assert.strictEqual(app.file, "app.js");
  assert.strictEqual(app.added, 1);                            // SUBSTANTIVE_ADD
  assert.strictEqual(app.removed, 2);                          // old + DELETION_ONLY_LINE
  const delHunk = app.hunks.find((h) => h.deletionOnly);
  assert.ok(delHunk && delHunk.lines.some((l) => l.includes("DELETION_ONLY_LINE")));

  const ws = parseDiff(d(
    "diff --git a/w.py b/w.py", "--- a/w.py", "+++ b/w.py",
    "@@ -1,3 +1,3 @@", " a", "-  ", "+", " b",
  ));
  assert.strictEqual(ws[0].hunks[0].whitespaceOnly, true, "an all-blank change is whitespace-only");
});

test("fail-open: parseDiff on non-diff text yields an empty array (main's passthrough signal)", () => {
  // [] is not literally falsy in JS, but it IS main()'s no-op signal: main guards `!files || !files.length`.
  const r = parseDiff("not a diff at all\njust prose\n");
  assert.ok(Array.isArray(r));
  assert.strictEqual(r.length, 0);
  assert.strictEqual(parseDiff("").length, 0);
  assert.strictEqual(parseDiff(42).length, 0);
});

test("fail-open: spawned script echoes non-diff stdin UNCHANGED and exits 0", () => {
  const input = "not a diff at all\nsecond line\n";
  const r = cp.spawnSync("node", [SCRIPT], { input, encoding: "utf8" });
  assert.strictEqual(r.status, 0, "must always exit 0");
  assert.strictEqual(r.stdout, input, "non-diff input must pass through byte-for-byte");
});

test("classifyLang: extension -> label, with 'Other' as the default", () => {
  assert.strictEqual(classifyLang("src/app.js"), "JavaScript");
  assert.strictEqual(classifyLang("lib/util.py"), "Python");
  assert.strictEqual(classifyLang("cmd/main.go"), "Go");
  assert.strictEqual(classifyLang("README.md"), "Markdown");
  assert.strictEqual(classifyLang("Makefile"), "Other");        // no extension
  assert.strictEqual(classifyLang(".gitignore"), "Other");      // dotfile, not an extension
});

test("T-MAJOR: a hunk-less file is NEVER silently invisible — binary + rename-with-edit show path AND notes", () => {
  // binary: a `diff --git` with no `@@` hunk — the path header AND the Binary note must both appear
  const binary = d(
    "diff --git a/logo.png b/logo.png", "index 1a2b3c..4d5e6f 100644",
    "Binary files a/logo.png and b/logo.png differ",
  );
  const outB = pack(binary);
  assert.ok(outB.includes("### logo.png"), "a binary file's path header must appear (not invisible)");
  assert.ok(outB.includes("Binary files a/logo.png and b/logo.png differ"), "the binary note must be rendered");

  // rename-with-edit: the rename provenance notes AND the edit hunk must BOTH appear (FIX 2)
  const renameEdit = d(
    "diff --git a/old.js b/new.js", "similarity index 90%", "rename from old.js", "rename to new.js",
    "index e69de29..0cfbf08 100644", "--- a/old.js", "+++ b/new.js",
    "@@ -1,2 +1,3 @@", " ctx", "+RENAMED_ADD", " more",
  );
  const outR = pack(renameEdit);
  assert.ok(outR.includes("### new.js"), "a rename-with-edit is labeled with its NEW path");
  assert.ok(outR.includes("rename from old.js") && outR.includes("rename to new.js"),
    "the rename provenance notes must appear even though the file ALSO has a hunk");
  assert.ok(outR.includes("RENAMED_ADD"), "the edit's added line must still appear");
});

test("FIX3: a PURE rename (no ---/+++ pair) is labeled with its NEW (b/) path, not the old (a/) path", () => {
  const pureRename = d(
    "diff --git a/old.js b/new.js", "similarity index 100%", "rename from old.js", "rename to new.js",
  );
  const out = pack(pureRename);
  assert.ok(out.includes("### new.js"), "a pure rename must be labeled with its NEW path (b/ side)");
  assert.ok(!out.includes("### old.js"), "a pure rename must NOT be labeled with its OLD path (a/ side)");
});

// A single file with a whitespace-only hunk FIRST in source and a substantive hunk SECOND.
const WS_END2END = d(
  "diff --git a/ws.js b/ws.js", "--- a/ws.js", "+++ b/ws.js",
  "@@ -1,3 +1,3 @@", " WS_CTX_MARKER", "-   ", "+", " after_ws",
  "@@ -20,2 +20,3 @@", " sctx", "+WS_SUBSTANTIVE", " sctx2",
);

test("T3: a whitespace-only hunk survives the FULL pipeline and is ranked LAST (retained, never dropped)", () => {
  const out = pack(WS_END2END);                                 // parseDiff -> rankAndPack -> formatPacked
  assert.ok(out.includes("WS_SUBSTANTIVE"), "the substantive hunk's content must be present");
  assert.ok(out.includes("WS_CTX_MARKER"), "the whitespace-only hunk must be RETAINED (its content is not dropped)");
  assert.ok(out.indexOf("WS_SUBSTANTIVE") < out.indexOf("WS_CTX_MARKER"),
    "the whitespace-only hunk must be ranked AFTER the substantive one (down-ranked last, though FIRST in source)");
});

test("T4/FIX1: a bare '' (trimmed blank context) mid-hunk keeps ALL +/- lines; genuine garbage falls back to RAW", () => {
  // (a) a bare "" between two + lines is a trimmed blank CONTEXT line — faithfully reconstructed, nothing lost
  const faithful = d(
    "diff --git a/x.js b/x.js", "--- a/x.js", "+++ b/x.js",
    "@@ -1,3 +1,5 @@", " keep", "+ADD_ONE", "", "+ADD_TWO", " tail",
  );
  const parsedF = parseDiff(faithful);
  assert.strictEqual(parsedF.length, 1, "a well-formed diff with a trimmed blank context line stays parsed (faithful)");
  assert.strictEqual(parsedF[0].added, 2, "BOTH + lines are counted — neither is dropped by the blank context line");
  const outF = pack(faithful);
  assert.ok(outF.includes("+ADD_ONE") && outF.includes("+ADD_TWO"), "both + lines must survive the faithful render");

  // (b) genuine garbage (no valid prefix) followed by a + line = a stranded body line => [] => RAW passthrough
  const garbage = d(
    "diff --git a/y.js b/y.js", "--- a/y.js", "+++ b/y.js",
    "@@ -1,3 +1,4 @@", " keep", "+GOOD_ADD", "GARBAGE_NO_PREFIX", "+LOST_ADD", " tail",
  );
  assert.strictEqual(parseDiff(garbage).length, 0,
    "a stranded +/- body line signals corruption => [] (never a lossy faithful render)");
  const r = cp.spawnSync("node", [SCRIPT], { input: garbage, encoding: "utf8" });
  assert.strictEqual(r.status, 0, "must always exit 0");
  assert.strictEqual(r.stdout, garbage, "a genuinely-corrupted diff passes through byte-for-byte (never worse than raw)");
});

test("faithful guard covers the PREAMBLE too: a +/- line before the first `diff --git` => [] => RAW passthrough", () => {
  // A stranded body line before any file header must not be silently dropped — completes the faithful
  // invariant across every region a +/- line can appear. Unreachable from `git diff <base>` (always starts
  // with `diff --git`), but honored so the packer is never worse than the raw diff.
  const preamble = d(
    "+LOOSE_LEADING_ADD",                                   // stranded before the first `diff --git`
    "diff --git a/z.js b/z.js", "--- a/z.js", "+++ b/z.js",
    "@@ -1,1 +1,2 @@", " keep", "+CLEAN_ADD",
  );
  assert.strictEqual(parseDiff(preamble).length, 0,
    "a +/- line before the first `diff --git` signals corruption => [] (never a lossy render)");
  const r2 = cp.spawnSync("node", [SCRIPT], { input: preamble, encoding: "utf8" });
  assert.strictEqual(r2.status, 0, "must always exit 0");
  assert.strictEqual(r2.stdout, preamble, "the stranded leading line passes through byte-for-byte (never worse than raw)");
});

test("T5/CRLF: a \\r\\n-terminated diff parses (Windows repo; the split is /\\r?\\n/)", () => {
  const crlf = [
    "diff --git a/crlf.js b/crlf.js", "--- a/crlf.js", "+++ b/crlf.js",
    "@@ -1,2 +1,2 @@", " ctx", "-CRLF_OLD", "+CRLF_NEW",
  ].join("\r\n") + "\r\n";
  const files = parseDiff(crlf);
  assert.strictEqual(files.length, 1, "a CRLF diff must parse to one file");
  assert.strictEqual(files[0].file, "crlf.js", "the CRLF path must not carry a stray \\r");
  assert.strictEqual(files[0].added, 1);
  assert.strictEqual(files[0].removed, 1);
  const out = pack(crlf);
  assert.ok(out.includes("CRLF_NEW") && out.includes("CRLF_OLD"), "CRLF diff content survives the pipeline");
});

test("FIX4: a spaced filename's trailing tab is stripped from the ---/+++ path (correct path + lang)", () => {
  const spaced = d(
    "diff --git a/my file.js b/my file.js", "--- a/my file.js\t", "+++ b/my file.js\t",
    "@@ -1,1 +1,2 @@", " ctx", "+SPACED_ADD",
  );
  const out = pack(spaced);
  assert.ok(out.includes("### my file.js (JavaScript,"),
    "the path must drop git's trailing tab and classify by the real .js extension");
  assert.ok(!/my file\.js\t/.test(out), "no stray trailing tab may survive in the rendered path");
});
