#!/usr/bin/env node
// ctide pack-review-diff: reorder + line-number + down-rank a unified `git diff` for reviewer focus.
// Session-time helper (NOT a Claude Code hook, NOT CI-only): the orchestrator pipes the base review diff
// through it once (`git diff <base> -- <paths> | node pack-review-diff.mjs`) to produce the Review Packet's
// "Changed diff (filtered)" — a focus-ordered, line-numbered view every reviewer shares. A pure stdin->stdout
// text transform. Dependency-free (Node built-ins only). Fail-open: on ANY parse error or non-diff input it
// echoes stdin UNCHANGED (raw passthrough), so it is never worse than today's raw diff; the CLI always exits
// 0 and never throws to its caller. Exposes pure functions (parseDiff / classifyLang / rankAndPack /
// formatPacked) for the test suite; main() wraps them under the import.meta.url guard.
//
// G1 INVARIANT (the whole point): the packer only REORDERS and ANNOTATES for focus; it never drops content —
// deletion-only and whitespace-only hunks are ranked LAST, never removed; any --max-lines trim is DISCLOSED
// (the trimmed file names + a regenerate pointer), never silent. It strengthens focus; it never caps
// investigation.
import fs from "node:fs";
import { fileURLToPath } from "node:url";

// Coarse extension -> language label, used ONLY to group files into reviewer sections and order them; it is
// a focus bucket, not a semantic language claim (the JS/TS family shares one bucket by design, per the
// approved mapping). Small hand-map, no dependency; anything unknown falls through to "Other".
const LANG_BY_EXT = {
  js: "JavaScript", mjs: "JavaScript", cjs: "JavaScript", jsx: "JavaScript", ts: "JavaScript", tsx: "JavaScript",
  py: "Python", go: "Go", rs: "Rust", rb: "Ruby", php: "PHP", java: "Java", kt: "Kotlin", swift: "Swift",
  c: "C", h: "C", cc: "C++", cpp: "C++", cxx: "C++", hpp: "C++", cs: "C#",
  sh: "Shell", bash: "Shell", ps1: "Shell",
  md: "Markdown", markdown: "Markdown", rst: "Markdown",
  json: "Config", yml: "Config", yaml: "Config", toml: "Config", ini: "Config", xml: "Config",
  html: "Markup", htm: "Markup", css: "Styles", scss: "Styles", less: "Styles",
  sql: "SQL",
};

// A short language label from the path's extension. Basename-relative so a dotted path is fine; a dotfile
// (leading-dot basename, e.g. `.gitignore`) or an extension-less file (`Makefile`) has no meaningful
// extension and falls through to "Other". Normalizes backslashes so it is identical on Windows and POSIX.
export function classifyLang(p) {
  const path = String(p == null ? "" : p).replace(/\\/g, "/");
  const base = path.slice(path.lastIndexOf("/") + 1);
  const dot = base.lastIndexOf(".");
  if (dot <= 0) return "Other";                 // no extension, or a dotfile -> Other
  return LANG_BY_EXT[base.slice(dot + 1).toLowerCase()] || "Other";
}

// True when a raw hunk body line has no substantive content after its +/- marker (blank or whitespace only).
function isBlankChange(raw) { return raw.slice(1).trim() === ""; }

// A hunk is DOWN-RANKED (moved last, never removed) when it is deletion-only or whitespace-only noise.
function isDownRanked(h) { return h.deletionOnly || h.whitespaceOnly; }

// The new-file path for a parsed file: prefer the `+++ b/...` path, else the `--- a/...` path (a deletion
// has `+++ /dev/null`), else fall back to the `b/Y` (new) side of the `diff --git a/X b/Y` line (a pure
// rename/binary has no +++/--- pair, so use its NEW path). Strips one leading a/ or b/ git prefix. Returns
// "unknown" only if all fail.
function filePath(file) {
  const strip = (s, pfx) => (s.startsWith(pfx) ? s.slice(pfx.length) : s);
  const plus = file.plusPath && file.plusPath !== "/dev/null" ? strip(file.plusPath, "b/") : "";
  if (plus) return plus;
  const minus = file.minusPath && file.minusPath !== "/dev/null" ? strip(file.minusPath, "a/") : "";
  if (minus) return minus;
  const rest = file.gitLine.slice("diff --git ".length);
  const bIdx = rest.indexOf(" b/");                                     // take the b/ (new) side so a pure rename
  return strip((bIdx >= 0 ? rest.slice(bIdx + 1) : rest).trim(), "b/") || "unknown";  // is labeled with its NEW path
}

function finalizeHunk(hunk) {
  const changed = hunk.lines.filter((l) => l[0] === "+" || l[0] === "-");
  return {
    header: hunk.header,
    lines: hunk.lines,
    added: hunk.added,
    removed: hunk.removed,
    deletionOnly: hunk.added === 0 && hunk.removed > 0,
    whitespaceOnly: changed.length > 0 && changed.every(isBlankChange),
  };
}

function finalizeFile(file) {
  const path = filePath(file);
  return {
    file: path,
    lang: classifyLang(path),
    hunks: file.hunks,
    notes: file.notes,
    added: file.hunks.reduce((s, h) => s + h.added, 0),
    removed: file.hunks.reduce((s, h) => s + h.removed, 0),
  };
}

// Parse a unified `git diff` into files -> hunks. Split on `diff --git` file boundaries; within a file split
// on `@@ ... @@` hunk headers; count +/- BODY lines only (the +++/--- file-header lines sit before the first
// @@, so they are never miscounted). Returns [] when the text carries no `diff --git` boundary OR when a +/-
// body line cannot be placed in a hunk (a corruption/loss signal) — so main() falls back to raw passthrough
// (fail-open, never worse than the raw diff; [] is main's no-op signal via `!files.length`).
// Line-by-line with prefix checks, no backtracking regex, so a hostile huge diff stays linear (ReDoS-safe).
export function parseDiff(text) {
  const lines = (typeof text === "string" ? text : "").split(/\r?\n/);
  if (lines.length && lines[lines.length - 1] === "") lines.pop();  // drop the trailing "" from the final newline
  const files = [];
  let file = null;      // current file record
  let hunk = null;      // current hunk record
  let faithful = true;  // cleared if a +/- body line can't be placed in a hunk => fall back to raw (G1)
  const closeHunk = () => { if (file && hunk) { file.hunks.push(finalizeHunk(hunk)); hunk = null; } };
  const closeFile = () => { closeHunk(); if (file) { files.push(finalizeFile(file)); file = null; } };

  for (const raw of lines) {
    if (raw.startsWith("diff --git ")) {
      closeFile();
      file = { gitLine: raw, plusPath: "", minusPath: "", notes: [], hunks: [] };
      continue;
    }
    if (!file) {                                          // preamble before the first `diff --git`
      if (raw[0] === "+" || raw[0] === "-") faithful = false;  // a +/- line stranded here would be dropped -> raw passthrough (G1)
      continue;
    }
    if (raw.startsWith("@@")) {
      closeHunk();
      hunk = { header: raw, lines: [], added: 0, removed: 0 };
      continue;
    }
    if (hunk) {
      const c = raw[0];
      if (c === " " || c === "+" || c === "-" || c === "\\" || raw === "") {  // body line (bare "" = trimmed blank context)
        hunk.lines.push(raw);
        if (c === "+") hunk.added++;
        else if (c === "-") hunk.removed++;
        continue;
      }
      closeHunk();                                        // a genuine non-body line (not a bare "") ends the hunk
    }
    // file-header lines (between `diff --git` and the first @@)
    if (raw.startsWith("--- ")) { file.minusPath = raw.slice(4).replace(/\t.*$/, ""); continue; }  // git appends a \t
    if (raw.startsWith("+++ ")) { file.plusPath = raw.slice(4).replace(/\t.*$/, ""); continue; }    // to spaced names
    if (raw.startsWith("index ") || raw.startsWith("old mode ") || raw.startsWith("new mode ") ||
        raw.startsWith("similarity index ") || raw.startsWith("dissimilarity index ")) continue; // boilerplate
    if (raw.trim() !== "") {
      if (raw[0] === "+" || raw[0] === "-") faithful = false;  // a +/- body line stranded outside a hunk = content loss
      file.notes.push(raw);                                    // Binary/rename/copy/new-file/deleted-file markers
    }
  }
  closeFile();
  return (files.length && faithful) ? files : [];             // any stranded +/- => [] => main() raw passthrough
}

// Extract the new-side start line `c` from a `@@ -a,b +c,d @@` header. Linear regex (no nested quantifiers);
// defaults to 1 for a malformed/absent header so rendering never throws.
function newSideStart(header) {
  const m = /^@@ -\d+(?:,\d+)? \+(\d+)/.exec(String(header));
  return m ? parseInt(m[1], 10) : 1;
}

// Render one hunk with NEW-SIDE line numbers derived from its header. Context and added lines carry the
// running new-side number; a removed (`-`) line and the `\ No newline` marker carry none. The raw diff line
// (with its own +/-/space prefix) is preserved verbatim after the number column, so no content is altered.
function renderHunk(hunk) {
  const start = newSideStart(hunk.header);
  const printed = hunk.lines.filter((l) => l[0] !== "-" && l[0] !== "\\").length;
  const width = Math.max(4, String(printed > 0 ? start + printed - 1 : start).length);
  const blank = " ".repeat(width);
  const out = [hunk.header];
  let n = start;
  for (const raw of hunk.lines) {
    const c = raw[0];
    if (c === "-" || c === "\\") out.push(blank + " " + raw);          // no new-side line for a deletion
    else { out.push(String(n).padStart(width) + " " + raw); n++; }     // context / addition
  }
  return out;
}

// Render one file block: the `### path (lang, +A/-R)` header, then any git note lines (rename/copy/mode/binary
// provenance — shown whether or not the file also has hunks, so a rename-with-edit keeps its provenance), then
// its hunks (already reordered: substantive first, down-ranked last). A file with neither notes nor textual
// hunks still renders its header + an explicit marker, so a changed file is never silently invisible.
function renderFile(file) {
  const out = ["### " + file.file + " (" + file.lang + ", +" + file.added + "/-" + file.removed + ")"];
  const notes = (file.notes && file.notes.length) ? file.notes : [];
  for (const note of notes) out.push("  " + note);        // rename/copy/mode/binary provenance — shown even WITH hunks
  if (file.hunks.length) {
    for (const h of file.hunks) for (const l of renderHunk(h)) out.push(l);
  } else if (!notes.length) {
    out.push("  (no textual hunks in diff)");             // neither notes nor hunks: an explicit not-silently-empty marker
  }
  return out;
}

// Rank + pack parsed files for focus. Group by language; order languages by total SUBSTANTIVE change size
// (added+removed of NON-down-ranked hunks) desc; within a language order files by substantive size desc;
// within a file put substantive hunks first and down-ranked (deletionOnly||whitespaceOnly) hunks LAST —
// reordered, never removed (G1). opts.maxLines (0 = no limit) budgets emitted lines: the top-ranked file is
// ALWAYS emitted in full (never an empty/decapitated packet), then once the running budget would overflow
// the REMAINING files are moved to `trimmed` for disclosure — never silently dropped. Returns
// { groups: [{ lang, files }], trimmed: [file] }, both deterministically ordered.
export function rankAndPack(files, opts = {}) {
  const maxLines = Number.isFinite(opts.maxLines) && opts.maxLines > 0 ? Math.floor(opts.maxLines) : 0;

  // per-file: reorder hunks (substantive first, down-ranked last) + compute substantive size
  const prepared = (files || []).map((f) => {
    const substantiveHunks = [];
    const downRanked = [];
    for (const h of f.hunks) (isDownRanked(h) ? downRanked : substantiveHunks).push(h);
    return {
      ...f,
      hunks: [...substantiveHunks, ...downRanked],
      substantive: substantiveHunks.reduce((s, h) => s + h.added + h.removed, 0),
    };
  });

  // group by language, then order languages by total substantive size desc (tie: name asc for determinism)
  const byLang = new Map();
  for (const f of prepared) {
    if (!byLang.has(f.lang)) byLang.set(f.lang, []);
    byLang.get(f.lang).push(f);
  }
  const langGroups = [...byLang.entries()].map(([lang, gf]) => ({
    lang, files: gf, total: gf.reduce((s, f) => s + f.substantive, 0),
  }));
  langGroups.sort((a, b) => b.total - a.total || a.lang.localeCompare(b.lang));
  // order files within a language by substantive size desc (tie: path asc)
  for (const g of langGroups) g.files.sort((a, b) => b.substantive - a.substantive || String(a.file).localeCompare(String(b.file)));

  // flatten to a ranked file list (language order, then file order), then apply the line budget
  const ranked = [];
  for (const g of langGroups) for (const f of g.files) ranked.push(f);
  const kept = new Set();
  const trimmed = [];
  let emitted = 0;
  let overflowed = false;
  for (let i = 0; i < ranked.length; i++) {
    const f = ranked[i];
    const rendered = renderFile(f);
    if (!overflowed && (i === 0 || maxLines === 0 || emitted + rendered.length <= maxLines)) {
      f.rendered = rendered;
      kept.add(f);
      emitted += rendered.length;
    } else {
      overflowed = true;                                  // clean cut: this and all further files are disclosed
      trimmed.push(f);
    }
  }

  // regroup the kept files, preserving language + file order
  const groups = [];
  for (const g of langGroups) {
    const gf = g.files.filter((f) => kept.has(f));
    if (gf.length) groups.push({ lang: g.lang, files: gf });
  }
  return { groups, trimmed };
}

// Render the packed structure to plain text: a one-line header, then per-language sections, then each file
// block. If any files were trimmed to fit --max-lines, append the DISCLOSED trailer (count + regenerate
// pointer + the trimmed file names) so a reviewer always knows exactly what is missing and how to get the
// full same-scoped diff — a disclosed trim, never a silent drop (G1).
export function formatPacked(packed, meta = {}) {
  const groups = (packed && packed.groups) || [];
  const trimmed = (packed && packed.trimmed) || [];
  const fileCount = groups.reduce((s, g) => s + g.files.length, 0);
  const trimNote = trimmed.length ? " (+" + trimmed.length + " trimmed)" : "";
  const out = ["ctide packed diff — " + fileCount + " file(s)" + trimNote + " across " + groups.length +
    " language(s), ordered by language/size; deletion-only & whitespace-only hunks ranked last (never dropped)."];
  for (const g of groups) {
    out.push("", "## " + g.lang);
    for (const f of g.files) {
      out.push("");
      for (const l of (f.rendered || renderFile(f))) out.push(l);
    }
  }
  let text = out.join("\n") + "\n";
  if (trimmed.length) {
    const regen = (meta && meta.regen) ? meta.regen : "git diff <base> -- <paths>";
    text += "\n⚠️ " + trimmed.length + " more file(s) trimmed to fit --max-lines — regenerate the full same-scoped diff: " +
      regen + "\n" + trimmed.map((f) => "  - " + f.file).join("\n") + "\n";
  }
  return text;
}

// Read ALL of stdin synchronously (fd 0). Fail-open: "" on any read error, so main() then passes through.
function readStdin() {
  try { return fs.readFileSync(0, "utf8"); } catch (e) { return ""; }
}

function main(argv) {
  const args = argv.slice(2);
  const get = (flag, def) => { const i = args.indexOf(flag); return (i >= 0 && args[i + 1]) ? args[i + 1] : def; };
  const maxLines = Math.max(0, parseInt(get("--max-lines", "0"), 10) || 0);
  const regen = get("--regen", "");
  let input = "";
  try {
    input = readStdin();
    const files = parseDiff(input);
    if (files && files.length) {
      process.stdout.write(formatPacked(rankAndPack(files, { maxLines }), { regen }));
    } else {
      process.stdout.write(input);                        // non-diff / unparseable => raw passthrough
    }
  } catch (e) {
    try { process.stdout.write(input); } catch (e2) {}    // any error => raw passthrough, still exit 0
  }
  process.exit(0);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main(process.argv);
