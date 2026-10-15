// Structural validation for the ctide plugin. Auth-free, deterministic, and side-effect free at import:
// validate() returns every failure as a string (an empty array is a pass); the CLI wrapper
// (validate-structure.mjs) prints them and sets the exit code. Every file read goes through a reader
// ({ file(rel), list(rel) } over POSIX paths relative to the repo root), so tests can overlay a defect
// in memory instead of copying the repository; messages always use POSIX paths.
import cp from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { git as runGit } from "../../cressetide/lib/git.mjs";

// The plugin itself lives in ./cressetide (only that subdir ships). The marketplace
// manifest that lists it lives in the separate kktu6507/plugins repo, not here.
const PLUGIN = "cressetide";

// Directory names never descended into when walking the reader (the non-git fallback scan and the
// env-var inventory walk): VCS metadata, dependencies, the runtime root, and release staging — the
// same entries git's own file list leaves out.
const SKIP_DIRS = new Set([".git", "node_modules", ".ctide", "_release"]);

// Disk reader rooted at `root`. file(rel) -> Buffer, or null when rel is not a file;
// list(rel) -> [{ name, dir }], or null when rel is not a directory. "" is the root itself. Only "absent"
// reads as null: any other error (a path that exists but cannot be read — EACCES, EPERM, EBUSY, …) is
// thrown, so an unreadable file is never mistaken for a missing one.
const NOT_A_FILE = new Set(["ENOENT", "ENOTDIR", "EISDIR"]);
const NOT_A_DIR = new Set(["ENOENT", "ENOTDIR"]);
export function diskReader(root) {
  const abs = (rel) => path.join(root, ...rel.split("/"));
  return {
    file(rel) {
      try {
        return fs.readFileSync(abs(rel));
      } catch (error) {
        if (NOT_A_FILE.has(error.code)) return null;
        throw error;
      }
    },
    list(rel) {
      try {
        return fs.readdirSync(abs(rel), { withFileTypes: true }).map((e) => ({ name: e.name, dir: e.isDirectory() }));
      } catch (error) {
        if (NOT_A_DIR.has(error.code)) return null;
        throw error;
      }
    },
  };
}

// Every file under `dir` in reader `read` (POSIX paths), skipping SKIP_DIRS at any depth: the scan list of a
// tree that is not a git work tree, and the env-var inventory walk.
export function readerFiles(read, dir = "") {
  const out = [];
  for (const e of read.list(dir) || []) {
    if (SKIP_DIRS.has(e.name)) continue;
    const rel = dir ? `${dir}/${e.name}` : e.name;
    if (e.dir) out.push(...readerFiles(read, rel));
    else out.push(rel);
  }
  return out;
}

// Git's view of the tree, as POSIX paths relative to root: `scan` = tracked + untracked-not-ignored files
// (what the scratch-file and text-integrity scans cover, so ignored local run output such as .ctide/ is
// out of scope) and `tracked` = the index (what the tracked-.ctide guard checks). null when git is
// unavailable or fails, or when root is not the TOP of a git work tree (a subdirectory, or a plain copy
// that happens to sit inside another repository). Runs through cressetide/lib/git.mjs: the user's own
// configuration still applies (safe.directory included), while an inherited GIT_DIR, GIT_INDEX_FILE and
// the like cannot point it at another repository than root.
export function gitFiles(root) {
  const git = (args) => {
    const r = runGit(root, args, { maxBuffer: 256 * 1024 * 1024 });
    return r.error || r.status !== 0 || typeof r.stdout !== "string" ? null : r.stdout;
  };
  const prefix = git(["rev-parse", "--show-prefix"]);
  if (prefix === null || prefix.trim() !== "") return null;
  const scan = git(["ls-files", "-z", "--cached", "--others", "--exclude-standard"]);
  const tracked = scan === null ? null : git(["ls-files", "-z", "--cached"]);
  if (tracked === null) return null;
  const split = (out) => [...new Set(out.split("\0").filter(Boolean))];
  return { scan: split(scan), tracked: split(tracked) };
}

// `node --check` on the reader's bytes (so an overlaid edit, not the disk copy, is what gets checked),
// fed through stdin and memoized per process by content hash. Node applies syntax detection to a
// typeless .js FILE (CommonJS first, then ES module) but not to stdin under --check, so that fallback is
// mirrored explicitly. A spawn failure is not memoized: it says nothing about the content.
const syntaxMemo = new Map();
function nodeCheck(buffer, inputType) {
  const key = `${inputType}:${crypto.createHash("sha256").update(buffer).digest("hex")}`;
  if (!syntaxMemo.has(key)) {
    const r = cp.spawnSync(process.execPath, [`--input-type=${inputType}`, "--check", "-"], { input: buffer, stdio: ["pipe", "ignore", "ignore"] });
    if (r.error) return false;
    syntaxMemo.set(key, r.status === 0);
  }
  return syntaxMemo.get(key);
}
function syntaxOk(name, buffer) {
  if (name.endsWith(".mjs")) return nodeCheck(buffer, "module");
  if (name.endsWith(".cjs")) return nodeCheck(buffer, "commonjs");
  return nodeCheck(buffer, "commonjs") || nodeCheck(buffer, "module");
}

// validate({ root, read, files }) -> string[] of failures.
//   root  — repository root (required; never inferred from the process cwd).
//   read  — reader as returned by diskReader(); defaults to the disk under root. A reader passed here
//           must come with `files`: git's lists are taken from the disk, which a custom reader may not match.
//   files — { scan, tracked } as returned by gitFiles(); defaults to gitFiles(root) when `read` is not
//           given. Pass null for a tree that is not a git work tree: the scans then walk `read` (skipping
//           SKIP_DIRS), and a present .ctide/ fails because its tracked state cannot be verified.
export function validate({ root, read: reader, files } = {}) {
  if (typeof root !== "string" || root === "") throw new TypeError("validate: `root` (the repository root path) is required");
  if (reader && files === undefined) {
    throw new TypeError("validate: a custom `read` needs explicit `files` (gitFiles(root), or null for a tree that is not a git work tree) — git's lists come from the disk, not from the reader");
  }
  if (!reader) reader = diskReader(root);
  if (files === undefined) files = gitFiles(root);

  const errors = [];
  const fail = (m) => errors.push(m);
  // The checks below read only through `read`, the one guarded door to the reader: a read error (a path
  // that exists but cannot be read) is reported once per path, and the path then reads as absent, so the
  // remaining checks still run and the result still fails.
  const unreadable = new Set();
  const guarded = (method, rel) => {
    try {
      return reader[method](rel);
    } catch (error) {
      if (!unreadable.has(rel)) {
        unreadable.add(rel);
        fail(`cannot read ${rel || "."}: ${error?.code || error?.message || error}`);
      }
      return null;
    }
  };
  const read = { file: (rel) => guarded("file", rel), list: (rel) => guarded("list", rel) };
  const readText = (rel) => {
    const buf = read.file(rel);
    return buf === null ? null : buf.toString("utf8");
  };
  const isFile = (rel) => read.file(rel) !== null;
  const exists = (rel) => isFile(rel) || read.list(rel) !== null;
  const names = (rel) => (read.list(rel) || []).map((e) => e.name);
  const subdirs = (rel) => (read.list(rel) || []).filter((e) => e.dir).map((e) => e.name);
  const listFiles = (dir) => readerFiles(read, dir);

  function readJSON(rel) {
    const text = readText(rel);
    if (text === null) return fail(`missing file: ${rel}`), null;
    try {
      return JSON.parse(text);
    } catch (e) {
      return fail(`invalid JSON in ${rel}: ${e.message}`), null;
    }
  }

  // 1. plugin.json
  const plugin = readJSON(`${PLUGIN}/.claude-plugin/plugin.json`);
  if (plugin) {
    for (const k of ["name", "version", "description"]) {
      if (!plugin[k]) fail(`plugin.json missing "${k}"`);
    }
  }

  // 2. plugin.json version is valid semver
  const SEMVER = /^\d+\.\d+\.\d+(?:[-+].+)?$/;
  if (plugin && plugin.version && !SEMVER.test(plugin.version)) fail(`plugin.json version "${plugin.version}" is not semver`);

  // 3c. CHANGELOG has an entry for the current plugin version
  if (plugin && plugin.version) {
    const changelog = readText("CHANGELOG.md");
    if (changelog === null) fail(`missing CHANGELOG.md`);
    else if (!new RegExp(`^##\\s*\\[?${plugin.version.replace(/\./g, "\\.")}\\]?`, "m").test(changelog)) {
      fail(`CHANGELOG.md has no "## [${plugin.version}]" entry`);
    }
  }

  // 3d. root package.json version agrees with the plugin version, so a bump can't
  // update the manifests but forget package.json (or vice-versa).
  const pkg = readJSON("package.json");
  if (pkg && plugin && pkg.version !== plugin.version) {
    fail(`version mismatch: package.json ${pkg.version} vs plugin.json ${plugin.version}`);
  }

  // 4. hooks.json parses (if present)
  const hooksRel = `${PLUGIN}/hooks/hooks.json`;
  const hooksJson = isFile(hooksRel) ? readJSON(hooksRel) : null;

  // 5. every agent and SKILL has YAML frontmatter with name + description
  function checkFrontmatter(rel) {
    const text = readText(rel) ?? "";
    if (!text.startsWith("---")) return fail(`${rel}: missing frontmatter`);
    const end = text.indexOf("\n---", 3);
    if (end === -1) return fail(`${rel}: unterminated frontmatter`);
    const fm = text.slice(3, end);
    if (!/\bname\s*:/.test(fm)) fail(`${rel}: frontmatter missing "name"`);
    if (!/\bdescription\s*:/.test(fm)) fail(`${rel}: frontmatter missing "description"`);
  }

  function walk(dir, fn) {
    for (const e of read.list(dir) || []) {
      const rel = `${dir}/${e.name}`;
      if (e.dir) walk(rel, fn);
      else fn(rel);
    }
  }

  walk(`${PLUGIN}/agents`, (rel) => { if (rel.endsWith(".md")) checkFrontmatter(rel); });
  walk(`${PLUGIN}/skills`, (rel) => { if (path.posix.basename(rel) === "SKILL.md") checkFrontmatter(rel); });

  // 5b. every reference that a skill's own SKILL.md points to must exist somewhere in the plugin
  // (catches a renamed/deleted reference that prose alone would not surface), and every agent in
  // vigil/SKILL.md's own roster must exist on disk.
  //
  // Check (1) — reference existence — is GENERALIZED to all five skills, the reverse direction of garden
  // 9a's "true reachability over directory ownership" model: resolve a `references/X.md` mention to the
  // mentioning skill's own `references/` directory FIRST; only if not found there, search every OTHER
  // skill's `references/` directory. Fail only when X.md exists in NO skill's `references/` directory.
  // This replaces the single hardcoded exception this check used to carry (vigil -> map's
  // vigil-map-overlay.md): a repo-wide grep during planning proved that exception-list approach incomplete
  // — salvage/SKILL.md also legitimately mentions map/references/operational-readiness.md and
  // vigil/references/external-capabilities.md. Verified directly (not merely reasoned): an own-directory-
  // only generalization false-flags all three of these real, working references the moment this check
  // starts running per-skill; search-based resolution needs no growing exception list for a future
  // cross-skill reference.
  //
  // Check (2) — the agent roster — stays scoped to vigil/SKILL.md specifically (grepping the whole
  // plugin confirms `subagents (` appears only there). It runs inside the per-skill
  // loop, gated to `skillName === "vigil"`, reusing that iteration's already-read file content (not a
  // second file read).
  {
    if (read.list(`${PLUGIN}/skills`) !== null) {
      const skillNames = subdirs(`${PLUGIN}/skills`);
      const refExistsIn = (skillName, file) => exists(`${PLUGIN}/skills/${skillName}/references/${file}`);
      for (const skillName of skillNames) {
        const skillRel = `${PLUGIN}/skills/${skillName}/SKILL.md`;
        const skill = readText(skillRel);
        if (skill === null) continue;
        for (const m of new Set([...skill.matchAll(/references\/([a-z0-9-]+\.md)/gi)].map((x) => x[1]))) {
          if (!refExistsIn(skillName, m) && !skillNames.some((other) => other !== skillName && refExistsIn(other, m)))
            fail(`${skillRel} links a missing reference: references/${m}`);
        }

        if (skillName === "vigil") {
          // Claude Code discovers agents/*.agent.md on its own (no plugin.json agents[]), so a roster name
          // without its file is an agent the workflow names but can never spawn.
          const roster = (skill.match(/subagents \(([^)]+)\)/) || [])[1] || "";
          for (const m of roster.matchAll(/`([a-z0-9-]+)`/gi)) {
            const name = m[1];
            if (!exists(`${PLUGIN}/agents/${name}.agent.md`))
              fail(`SKILL.md names agent "${name}" but ${PLUGIN}/agents/${name}.agent.md is missing`);
          }
        }
      }
    }
  }
  // 5d. the compact (default) final-report rendering must keep the machine contract — the sentinel
  // tokens and the verdict literals — inside its EMITTABLE template fence, not merely somewhere in the
  // file (the intro paragraph also names them in prose). `references/final-report.md` is their sole owner,
  // and the compact block is what most runs emit by default; guard against a future edit
  // silently dropping them from the compact template (which would make the Stop hook go inert with every
  // other gate still green). Scope the check to the compact `~~~markdown` fence so a prose copy cannot mask
  // a real deletion, and fail CLOSED if the report structure moved (so the guard can't silently degrade).
  const finalReportRel = `${PLUGIN}/skills/vigil/references/final-report.md`;
  const fr = readText(finalReportRel);
  if (fr !== null) {
    const afterCompactHeading = fr.split(/^##\s+Default \(compact\)/m)[1];
    // Bound to the compact section BEFORE matching the fence, so a deleted/mangled compact fence cannot
    // fall through to the `--report full` fence (which also holds the literals) and silently pass green.
    const compactSection = afterCompactHeading && afterCompactHeading.split(/^##\s+`--report full`/m)[0];
    const fence = compactSection && compactSection.match(/~~~markdown\n([\s\S]*?)\n~~~/);
    if (!fence) {
      fail(`final-report.md: cannot locate the compact (Default) ~~~markdown template fence — the report structure changed; re-point the 5d sentinel guard`);
    } else {
      const compactFence = fence[1];
      for (const tok of ["ctide:verify=", "ctide:delivery=", "ctide:panel=", "READY", "FIX REQUIRED", "NOT READY"]) {
        if (!compactFence.includes(tok))
          fail(`final-report.md compact template is missing the machine-contract literal "${tok}" (the default report must keep the sentinel footer + verdict literals)`);
      }
    }
  }

  // 5e. the `--report full` cost table must keep its billable-component columns (Input / Output /
  // Cache-write / Cache-read) — AC2's contract. Mirrors 5d's fail-CLOSED pattern: bound to the
  // `--report full` section so a compact-section table cannot mask a real deletion, and fail closed
  // if the section structure moved. No machine consumer reads this table, but a silent revert to the
  // old single-`Tokens` column is exactly the drift class 5d (compact fence) and the README-parity
  // guard already protect against.
  if (fr !== null) {
    const afterFull = fr.split(/^##\s+`--report full`/m)[1];
    if (afterFull === undefined) {
      fail(`final-report.md: cannot locate the \`--report full\` section — the report structure changed; re-point the 5e cost-column guard`);
    } else {
      const header = afterFull.match(/\|\s*Agent \/ phase\s*\|([^\n]*)\|/);
      if (!header) {
        fail(`final-report.md: cannot locate the \`--report full\` Cost table header — re-point the 5e cost-column guard`);
      } else {
        for (const col of ["Input", "Output", "Cache-write", "Cache-read"]) {
          if (!header[1].includes(col))
            fail(`final-report.md \`--report full\` Cost table is missing the billable-component column "${col}" (the cost breakdown must itemize input/output/cache)`);
        }
      }
    }
  }

  // 5f. Contract-invariant guard — the machine-checked literals that SKILL.md's Language-And-Text-Integrity
  // rule marks as verbatim / never-translate (the verdict, the severities, the sentinel tokens) must survive
  // in the files that OWN them, so a prose edit can't silently gut the contract while every other gate stays
  // green. Deliberately NARROW + high-confidence: only literals that are contractually immutable are
  // asserted, so a legitimate reword can never false-trip this (pragmatism axiom — a false CI failure is
  // worse than a documented miss). Complements 5d (which guards only the final-report compact fence) by
  // covering the other contract-bearing files. Substring match is sufficient: these tokens are immutable, so
  // presence anywhere in the owning file is the invariant.
  const CONTRACT_INVARIANTS = {
    [`${PLUGIN}/agents/arbiter.agent.md`]: ["READY", "FIX REQUIRED", "NOT READY", "Extended-Safe", "Residual", "never auto-applied"],
    [`${PLUGIN}/skills/vigil/references/reviewer-common.md`]: ["blocker", "major", "minor"],
    [`${PLUGIN}/skills/vigil/references/reviewer-selection.md`]: ["intent-reviewer", "test-reviewer"],
    // The `### Live run` evidence-block header is tooling-read: orchestration-check.js (advisory 4) detects
    // a real verified run that omitted the block by matching this literal, so a prose rename would silently
    // make the "real run -> always log evidence" nudge go inert. Guard it like the other machine literals.
    [`${PLUGIN}/skills/vigil/references/final-report.md`]: ["### Live run"],
    [`${PLUGIN}/skills/vigil/SKILL.md`]: [
      "ctide:verify=", "ctide:delivery=", "ctide:panel=",
      "READY", "FIX REQUIRED", "NOT READY",
      "blocker", "major", "minor",
    ],
  };
  for (const [rel, phrases] of Object.entries(CONTRACT_INVARIANTS)) {
    const text = readText(rel);
    if (text === null) { fail(`contract-invariant guard: ${rel} is missing (cannot verify its machine-checked literals)`); continue; }
    for (const p of phrases) {
      if (!text.includes(p))
        fail(`contract-invariant guard: ${rel} no longer contains the machine-checked literal "${p}" — a prose edit dropped a load-bearing contract token (see SKILL.md Language-And-Text-Integrity)`);
    }
  }

  const hooksText = readText(hooksRel);
  if (hooksText !== null) {
    const wiredHooks = new Set((hooksText.match(/hooks\/[a-z0-9-]+\.m?js/gi) || []));
    for (const m of wiredHooks) {
      if (!exists(`${PLUGIN}/${m}`))
        fail(`hooks.json references a missing hook: ${m}`);
    }
    // Prevention (a real lesson: a hook shipped without updating the docs): every wired
    // hook must be named in README.md so the docs can't silently fall out of sync.
    const readme = readText("README.md");
    if (readme !== null) {
      for (const m of wiredHooks) {
        const base = m.replace(/^hooks\//, "").replace(/\.m?js$/, "");
        if (!readme.includes(base)) fail(`README.md does not mention the hook "${base}" (docs out of sync with hooks.json)`);
      }
    }

    // 5c. Hook WIRING — the auth-free stand-in for a live install->enable->reload activation smoke.
    // A regression that drops a hook from its event, or narrows a matcher so the hook no longer fires
    // for a tool/lifecycle it must cover, is still valid JSON (so the parse + node --check + behavioral
    // tests can all stay green) — assert the wiring structurally so such a regression fails the build.
    // The file itself names no other host: the removed second runtime's root-variable fallback, or a bare
    // plugin-root variable, would let another host (or a stray variable) pick which code a hook runs;
    // Claude Code is the only supported host. The bare-variable pattern's \b does not match inside
    // CLAUDE_PLUGIN_ROOT ("_" is a word character). Both names are spelled with a character class so the
    // removed names have no literal occurrence left in the tree (P5's zero-hit grep covers this file too).
    if (/cop[i]lot/i.test(hooksText)) fail("hooks.json names the removed second runtime (its root-variable fallback) — ctide supports Claude Code only");
    if (/\bPLUGIN[_]ROOT\b/.test(hooksText)) fail("hooks.json uses a bare plugin-root variable — the plugin root is ${CLAUDE_PLUGIN_ROOT} only");
    const hj = hooksJson; // a parse error is already reported by section 4
    if (hj) {
      const h = hj.hooks || {};
      const entriesFor = (event) => (Array.isArray(h[event]) ? h[event] : []);
      const cmdsFor = (event) => entriesFor(event).flatMap((e) => (Array.isArray(e.hooks) ? e.hooks : []).map((x) => (x && x.command) || ""));
      const wiresUnder = (event, hookFile) => cmdsFor(event).some((c) => c.includes("hooks/" + hookFile));
      // Matcher coverage must be bound to the entry that ACTUALLY wires the target hook, not satisfied by
      // some OTHER entry's matcher. Without this scoping, once a second entry (a different hook) with a
      // broad matcher exists, it could falsely "cover" a token the target hook's own entry omits — so a
      // real pre-tool-use matcher regression ("Write|Edit", dropping NotebookEdit/Bash/PowerShell) could
      // pass green. Filtering to entries whose command wires `hookFile` is strictly more restrictive.
      const eventMatchesForHook = (event, token, hookFile) => entriesFor(event).some((e) => {
        const wiresIt = (Array.isArray(e.hooks) ? e.hooks : []).some((x) => x && typeof x.command === "string" && x.command.includes("hooks/" + hookFile));
        if (!wiresIt) return false;
        try { return new RegExp("^(?:" + (e.matcher || "") + ")$").test(token); } catch (err) { return false; }
      });
      const WIRING = [
        // the plan gate (edit tools + shell writes), the destructive-command check (shells) and the
        // contract check (Write/Edit), in one process
        { event: "PreToolUse", hook: "pre-tool-use.mjs", tokens: ["Write", "Edit", "NotebookEdit", "Bash", "PowerShell"] },
        // the failure-memory digest on every start, plus the post-compaction fidelity nudge on "compact"
        // (SessionStart, not PreCompact: CC rejects hookSpecificOutput there)
        { event: "SessionStart", hook: "session-start.mjs", tokens: ["startup", "resume", "clear", "compact"] },
        { event: "Stop", hook: "orchestration-check.js", tokens: [] }, // Stop has no matcher
      ];
      for (const w of WIRING) {
        if (!wiresUnder(w.event, w.hook)) fail(`hooks.json: ${w.event} does not wire ${w.hook} (hook would never fire)`);
        for (const t of w.tokens) {
          if (!eventMatchesForHook(w.event, t, w.hook)) fail(`hooks.json: the ${w.event} matcher does not cover "${t}" (the hook would never fire for it)`);
        }
      }

      // Command form (P0-1): every handler is the shell form `node "${CLAUDE_PLUGIN_ROOT}/hooks/<name>.mjs"`
      // (or .js), which Claude Code expands before the shell runs it, under Git Bash and PowerShell alike —
      // not an exec form with `args` (a client without it runs a bare `node`, and the hook silently does
      // nothing) and not a `node -e` bootstrap that resolves the root itself.
      const COMMAND_FORM = /^node "\$\{CLAUDE_PLUGIN_ROOT\}\/hooks\/[a-z-]+\.m?js"$/;
      for (const event of Object.keys(h)) {
        for (const entry of entriesFor(event)) {
          for (const handler of Array.isArray(entry?.hooks) ? entry.hooks : []) {
            const command = handler && typeof handler.command === "string" ? handler.command : "";
            if (!COMMAND_FORM.test(command))
              fail(`hooks.json: a ${event} handler is not the shell form node "\${CLAUDE_PLUGIN_ROOT}/hooks/<name>.mjs": ${JSON.stringify(command).slice(0, 120)}`);
          }
        }
      }

      // 5g. Claude Code OUTPUT-CONTRACT conformance — the external boundary that broke once. CC's hook-output
      // validator only accepts `hookSpecificOutput` on a fixed set of events; emitting it on any other event is
      // SILENTLY REJECTED. Therefore any hook whose SOURCE emits
      // `hookSpecificOutput` must be wired ONLY to events in CC's accept-set. Unlike 5c (which checks ctide's
      // OWN wiring) this checks conformance to CC's external, evolving contract. If CC's documented hook-output
      // contract changes, update HSO_ACCEPT_EVENTS and re-smoke per RELEASING.md.
      const HSO_ACCEPT_EVENTS = new Set(["PreToolUse", "UserPromptSubmit", "PostToolUse", "PostToolBatch", "SessionStart", "Stop", "SubagentStop"]);
      for (const event of Object.keys(h)) {
        for (const cmd of cmdsFor(event)) {
          const m = cmd.match(/hooks\/([a-z0-9-]+\.m?js)/i);
          if (!m) continue;
          const src = readText(`${PLUGIN}/hooks/${m[1]}`);
          if (src === null) continue; // a missing hook is already reported above
          if (src.includes("hookSpecificOutput") && !HSO_ACCEPT_EVENTS.has(event)) {
            fail(`hooks.json: ${m[1]} emits \`hookSpecificOutput\` but is wired to "${event}", which Claude Code's hook-output schema does NOT accept it on — it would be silently rejected (the compact-fidelity/PreCompact bug class). CC accepts hookSpecificOutput only on: ${[...HSO_ACCEPT_EVENTS].join(", ")}.`);
          }
        }
      }
    }
  }

  // 5h. Release asset contract: release archives/checksums must be tag-bound and repairable.
  // This is a lightweight static guard for the release workflow because the actual GitHub Release
  // asset behavior can only be exercised during a real release.
  const validationWorkflowRel = ".github/workflows/validate.yml";
  const validationWorkflow = readText(validationWorkflowRel);
  if (validationWorkflow === null) fail(`${validationWorkflowRel}: missing validation workflow`);
  const releaseWorkflowRel = ".github/workflows/release.yml";
  const releaseWorkflow = readText(releaseWorkflowRel);
  if (releaseWorkflow === null) fail(`${releaseWorkflowRel}: missing release workflow`);
  const releaseScriptRel = ".github/scripts/publish-release.mjs";
  const releaseScriptPresent = isFile(releaseScriptRel);
  if (!releaseScriptPresent) fail(`${releaseScriptRel}: missing release publisher script`);
  if (pkg && pkg.scripts?.["release:publish"] !== `node ${releaseScriptRel} --publish`) {
    fail(`package.json: release:publish must delegate to ${releaseScriptRel} --publish`);
  }
  const workflowKeyPattern = (indent, key) => {
    const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp(`^ {${indent}}(?:${escaped}|"${escaped}"|'${escaped}')\\s*:`);
  };
  const workflowMappingLines = (block, indent, key) => {
    const starts = block
      .map((line, index) => workflowKeyPattern(indent, key).test(line) ? index : -1)
      .filter((index) => index !== -1);
    if (starts.length !== 1) return [];
    const start = starts[0];
    const end = block.findIndex((line, index) => {
      if (index <= start || /^\s*(?:#.*)?$/.test(line)) return false;
      return (line.match(/^ */)?.[0].length || 0) <= indent;
    });
    return block.slice(start, end === -1 ? block.length : end);
  };
  const workflowJobLines = (workflow, jobName) => {
    const lines = workflow.replace(/\r\n/g, "\n").split("\n");
    const jobsLines = workflowMappingLines(lines, 0, "jobs");
    return workflowMappingLines(jobsLines, 2, jobName);
  };
  const workflowNamedStepLines = (jobLines, stepName) => {
    const starts = jobLines
      .map((line, index) => line === `      - name: ${stepName}` ? index : -1)
      .filter((index) => index !== -1);
    if (starts.length !== 1) return [];
    const start = starts[0];
    const end = jobLines.findIndex((line, index) => index > start && /^      - /.test(line));
    return jobLines.slice(start, end === -1 ? jobLines.length : end);
  };
  const hasWorkflowBypass = (block, indent) => block.some((line) =>
    workflowKeyPattern(indent, "if").test(line)
    || workflowKeyPattern(indent, "continue-on-error").test(line));
  const hasWorkflowRunContextOverride = (workflow, jobLines, stepLines) => {
    const workflowLines = workflow.replace(/\r\n/g, "\n").split("\n");
    const workflowDefaults = workflowMappingLines(workflowLines, 0, "defaults");
    const workflowRunDefaults = workflowMappingLines(workflowDefaults, 2, "run");
    const jobDefaults = workflowMappingLines(jobLines, 4, "defaults");
    const jobRunDefaults = workflowMappingLines(jobDefaults, 6, "run");
    const hasOverride = (block, indent) => block.some((line) =>
      workflowKeyPattern(indent, "shell").test(line)
      || workflowKeyPattern(indent, "working-directory").test(line));
    return hasOverride(workflowRunDefaults, 4)
      || hasOverride(jobRunDefaults, 8)
      || hasOverride(stepLines, 8);
  };
  const hasExactWorkflowRun = (stepLines, exactRun) => {
    const runLines = stepLines.filter((line) => workflowKeyPattern(8, "run").test(line));
    return runLines.length === 1 && runLines[0] === exactRun;
  };
  if (validationWorkflow !== null && releaseScriptPresent) {
    const workflow = validationWorkflow;
    const validationJob = workflowJobLines(workflow, "validate");
    const syntaxStep = workflowNamedStepLines(validationJob, "Syntax-check release publisher");
    const exactRun = `        run: node --check ${releaseScriptRel}`;
    if (validationJob.length === 0 || syntaxStep.length === 0
        || hasWorkflowBypass(validationJob, 4) || hasWorkflowBypass(syntaxStep, 8)
        || hasWorkflowRunContextOverride(workflow, validationJob, syntaxStep)
        || !hasExactWorkflowRun(syntaxStep, exactRun)) {
      fail(`${validationWorkflowRel}: validation job must syntax-check ${releaseScriptRel}`);
    }
  }
  if (releaseWorkflow !== null && releaseScriptPresent) {
    const workflow = releaseWorkflow;
    const publishLines = workflowJobLines(workflow, "publish");
    const stepLines = workflowNamedStepLines(publishLines, "Publish or verify immutable release assets");
    const exactRun = '        run: npm run release:publish -- --tag "$RELEASE_TAG"';
    if (publishLines.length === 0 || stepLines.length === 0 || hasWorkflowBypass(publishLines, 4)
        || hasWorkflowBypass(stepLines, 8) || hasWorkflowRunContextOverride(workflow, publishLines, stepLines)
        || !hasExactWorkflowRun(stepLines, exactRun)) {
      fail(`${releaseWorkflowRel}: publish job must call package.json release:publish with the explicit release tag`);
    }
  }

  // 5i. Example provenance contract: clean-room examples are illustrative only and must never look like
  // historical or Type-B evidence.
  const exampleProvenance = [
    ["examples/ready-run.md", ["Source: illustrative Cressetide workflow example.", "not counted as evidence"]],
    ["examples/fix-required-run.md", ["Source: illustrative Cressetide repair-loop example.", "not counted as evidence"]],
    ["examples/not-ready-run.md", ["Source: illustrative Cressetide example.", "not counted as evidence"]],
    ["examples/review-packet.md", ["Source: illustrative Cressetide contract-field example.", "not a historical run", "not evidence"]],
    ["examples/final-report-compact.md", ["Source: illustrative Cressetide report shape.", "Values in angle brackets must be replaced"]],
    ["examples/final-report-full.md", ["Source: illustrative Cressetide report shape.", "not a historical run or evidence record"]],
  ];
  for (const [rel, snippets] of exampleProvenance) {
    const text = readText(rel);
    if (text === null) { fail(`${rel}: missing example file`); continue; }
    for (const snippet of snippets) {
      if (!text.includes(snippet)) fail(`${rel}: missing required provenance marker "${snippet}"`);
    }
  }

  // 5j. Contract / packet template field guard — the contract.md schema (references/task-contract.md)
  // and the Review Packet handoff template (references/review-packet.md) must keep the fields the
  // runtime contract-check.mjs and the reviewers depend on, so a prose edit can't silently gut the
  // deterministic inputs while CI stays green. Narrow, high-confidence, fail-CLOSED (mirrors 5d/5e/5f).
  const taskContractRel = `${PLUGIN}/skills/vigil/references/task-contract.md`;
  const tc = readText(taskContractRel);
  if (tc === null) {
    fail(`missing reference: ${PLUGIN}/skills/vigil/references/task-contract.md (contract schema doc)`);
  } else {
    for (const field of ["acceptanceCriteria", "allowedPaths", "forbiddenPaths", "behaviorChanging", "verification"]) {
      if (!tc.includes(field))
        fail(`task-contract.md no longer documents the machine field "${field}" (contract-check.mjs reads it)`);
    }
  }
  const packetRel = `${PLUGIN}/skills/vigil/references/review-packet.md`;
  const pk = readText(packetRel);
  if (pk !== null) {
    for (const field of ["Acceptance criteria", "Out of scope", "Verification evidence", "Must-not-change", "Migration status"]) {
      if (!pk.includes(field))
        fail(`review-packet.md template is missing the required field "${field}"`);
    }
  }

  // 5k. Rigor-contract dual-write guard — the claims-evidence discipline (admission rule, evidence
  // grading, self-refutation, severity-rubric anchoring, two-channel output) lives in BOTH
  // references/reviewer-common.md (the source of truth) and the review-packet.md "Shared reviewer
  // contract" verbatim block (the ONLY copy a spawned reviewer ever receives — review-packet.md's sync
  // mandate). A drift that drops one side silently guts the contract for every reviewer while CI stays
  // green. Narrow literal-presence anchors only, no wording constraints — same philosophy as 5f/5j.
  // ("as the fixed reference" pins the severity-rubric rule (C3), added after it drifted into one file.)
  // The last four anchors protect packet-block synchronization after a prior one-sided drift: the
  // Non-mutating rule, the underspecified clause, and the blocker/minor severity definitions each
  // silently dropped out of ONE side once). Curated substrings, not a full hash — the two files are
  // different formats by design (canonical prose vs the verbatim handoff block).
  const RIGOR_ANCHORS = [
    "Admission to the findings index", "Evidence grading", "refute your strongest finding", "as the fixed reference", /[Tt]wo channels/,
    "Non-mutating: inspect, don't change",
    "scratch/temp copy",
    "materially underspecified",
    "clearly incorrect, materially unsafe", // the `blocker` definition
    "should be fixed before the work is considered ready", // the `major` definition
    "worthwhile cleanup or polish",         // the `minor` definition
  ];
  for (const rel of [
    `${PLUGIN}/skills/vigil/references/reviewer-common.md`,
    `${PLUGIN}/skills/vigil/references/review-packet.md`,
  ]) {
    const text = readText(rel);
    if (text === null) { fail(`rigor-contract guard: ${rel} is missing (cannot verify the claims-evidence anchors)`); continue; }
    for (const anchor of RIGOR_ANCHORS) {
      const ok = anchor instanceof RegExp ? anchor.test(text) : text.includes(anchor);
      if (!ok)
        fail(`rigor-contract guard: ${rel} no longer contains the anchor ${anchor instanceof RegExp ? String(anchor) : `"${anchor}"`} — the reviewer-common ↔ review-packet dual write drifted (the verbatim block is the only copy reviewers receive)`);
    }
  }

  // 6. distribution hygiene: runtime/process artifacts must never ship in the
  // plugin subdir, and scratch/temp files must not be committed anywhere.
  const forbidden = [
    "ai/FAILURE_MEMORY.md",        // workflow runtime output — belongs in the consuming project, not here
    `${PLUGIN}/ai`,
    `${PLUGIN}/test`,
    `${PLUGIN}/.github`,
    `${PLUGIN}/node_modules`,
    `${PLUGIN}/package.json`,
  ];
  for (const rel of forbidden) {
    if (exists(rel)) fail(`distribution hygiene: "${rel}" must not exist (runtime/dev artifact in the shipped tree)`);
  }

  // 6b. .ctide/ hygiene — the consuming-project runtime root (memory/design/map/incidents/output).
  // For THIS tool repo it is dogfood-run residue, exactly like the root ai/FAILURE_MEMORY.md stance above:
  // (a) the repo .gitignore must carry a literal `/.ctide/` line so run output can never be committed by
  // accident; (b) no path under .ctide/ may already be tracked. When the tree is not a git work tree
  // (files === null) the tracked state cannot be verified, so a present .ctide/ fails closed there.
  {
    const gitignore = readText(".gitignore");
    if (gitignore === null) {
      fail(`.ctide hygiene: .gitignore is missing — it must contain a "/.ctide/" line so the consuming-project runtime root is never committed into this repo`);
    } else if (!gitignore.split(/\r?\n/).some((l) => l.trim() === "/.ctide/")) {
      fail(`.ctide hygiene: .gitignore has no "/.ctide/" line — add it so ctide's own run output (.ctide/) is never committed into this repo`);
    }
    if (files) {
      const tracked = files.tracked.filter((p) => p === ".ctide" || p.startsWith(".ctide/"));
      if (tracked.length) fail(`.ctide hygiene: tracked path(s) under .ctide/ must not be committed (git rm --cached them): ${tracked.join(", ")}`);
    } else if (exists(".ctide")) {
      fail(`.ctide hygiene: runtime .ctide state is present outside a verifiable Git checkout — its tracked state cannot be checked; validate from the top of a git work tree or remove .ctide/`);
    }
  }

  // The scratch-file and text-integrity scans cover git's tracked + untracked-not-ignored files (ignored
  // local run output is out of scope); outside a git work tree they walk the reader instead.
  const scanFiles = files ? files.scan : listFiles("");
  for (const rel of scanFiles) {
    if (/^_|\.(tmp|bak|log)$|~$/.test(path.posix.basename(rel))) fail(`scratch/process file should not be committed: ${rel}`);
  }

  // 7. text integrity: every scanned text file must be valid UTF-8 and free of NUL bytes, replacement
  // characters, and known mojibake markers.
  const TEXT_EXT = /\.(md|json|[cm]?js|ya?ml|toml|txt)$/i;
  const TEXT_NAMES = new Set(["LICENSE", ".gitignore", ".gitattributes", ".lycheeignore"]);
  const MOJIBAKE_MARKERS = [
    0xFFFD, // replacement character
    0x7AB6,
    0x7ACA,
    0x5689,
    0x90E2,
    0x90B5,
    0x8B41,
    0xFF82, // halfwidth katakana often produced by UTF-8/CP932 mojibake
    0xFF77,
    0xFF9E,
    0xFF80,
  ];
  const utf8 = new TextDecoder("utf-8", { fatal: true });
  for (const rel of scanFiles) {
    const name = path.posix.basename(rel);
    if (!TEXT_EXT.test(name) && !TEXT_NAMES.has(name)) continue;
    const buf = read.file(rel);
    if (buf === null) continue; // listed by git but absent from the working tree
    let text;
    try {
      text = utf8.decode(buf);
    } catch {
      fail(`text integrity: ${rel} is not valid UTF-8`);
      continue;
    }
    if (text.includes("\u0000")) fail(`text integrity: ${rel} contains a NUL byte (U+0000)`);
    for (const codePoint of MOJIBAKE_MARKERS) {
      const marker = String.fromCodePoint(codePoint);
      if (text.includes(marker)) {
        fail(`text integrity: ${rel} contains suspicious mojibake marker U+${codePoint.toString(16).toUpperCase()}`);
        break;
      }
    }
  }

  // 8. multilingual README parity: every translated README must name every wired hook (like README.md)
  // and have the same number of top-level (## ) sections — a structural-drift guard that does not
  // compare translated prose. Covers every translation in TRANSLATED_READMES, not just one language,
  // so adding a new translation can't silently skip the guard the original bilingual pair had.
  const TRANSLATED_READMES = ["README.zh-TW.md", "README.ja.md"];
  const en = readText("README.md");
  if (en !== null) {
    // Count top-level (## ) sections, ignoring any inside fenced code blocks so the structural guard is
    // not tripped by a Markdown/shell sample that happens to contain a "## " line.
    const sectionCount = (s) => (s.replace(/```[\s\S]*?```/g, "").match(/^##\s+/gm) || []).length;
    const enSections = sectionCount(en);
    const requiredReadmeLinks = [
      "docs/tutorial-first-run.md",
      "docs/task-writing-guide.md",
      "docs/how-to-read-verdicts.md",
      "docs/compatibility.md",
      "examples/ready-run.md",
      "examples/fix-required-run.md",
      "examples/not-ready-run.md",
      "examples/review-packet.md",
      "examples/final-report-compact.md",
      "examples/final-report-full.md",
      "EVIDENCE.md",
      "SECURITY.md",
      "RELEASING.md",
      "template=verified-run.yml",
    ];
    for (const link of requiredReadmeLinks) {
      if (!en.includes(link)) fail(`README parity: README.md missing required entry link "${link}"`);
    }
    const wiredHookBases = hooksText !== null
      ? [...new Set((hooksText.match(/hooks\/[a-z0-9-]+\.m?js/gi) || []))].map((m) => m.replace(/^hooks\//, "").replace(/\.m?js$/, ""))
      : [];
    for (const rel of TRANSLATED_READMES) {
      const translated = readText(rel);
      if (translated === null) {
        fail(`README parity: README.md exists but ${rel} is missing (a translated README must not drift by deletion)`);
        continue;
      }
      if (sectionCount(translated) !== enSections) {
        fail(`README parity: README.md has ${enSections} top-level (##) sections but ${rel} has ${sectionCount(translated)}`);
      }
      for (const link of requiredReadmeLinks) {
        if (!translated.includes(link)) fail(`README parity: ${rel} missing required entry link "${link}"`);
      }
      for (const base of wiredHookBases) {
        if (!translated.includes(base)) fail(`README parity: ${rel} does not mention the hook "${base}" (docs out of sync)`);
      }
    }
    // Beside the fence-skipping section count above (owner decision 2026-10-14), the raw count the pre-merge
    // structure test enforced (37ea5df): lines matching /^##\s+/ with code fences NOT skipped, equal across
    // every present README, so a "## " line inside a fenced sample must be mirrored in every translation.
    const rawHeadingCount = (s) => (s.match(/^##\s+/gm) || []).length;
    const rawCounts = ["README.md", ...TRANSLATED_READMES]
      .map((rel) => [rel, rel === "README.md" ? en : readText(rel)])
      .filter(([, text]) => text !== null)
      .map(([rel, text]) => [rel, rawHeadingCount(text)]);
    if (new Set(rawCounts.map(([, count]) => count)).size > 1) {
      fail(`README raw ## count differs (code fences included): ${rawCounts.map(([rel, count]) => `${rel} ${count}`).join(", ")} — a "## " line in a fenced sample must appear in every README`);
    }
  }

  // 9. "Garden" guards — dead weight and drift (shape borrowed from wshobson/agents `make garden`).
  // Deterministic only, no fuzzy matching. Every failure names the fix, and every cap/anchor has an
  // obvious conscious-override path: edit the constant/list HERE with a justifying comment. Shared code
  // has one copy, in cressetide/lib/ (test/lib-binding.test.mjs binds every user to it), so there are no
  // documented copies left to hash-guard here; the packet-block anchors that must stay in step across two
  // reference files live in §5k's RIGOR_ANCHORS above.

  // 9a. Reference reachability: every shipped skills/*/references/*.md must be reachable from the
  // plugin's load surface — an orphan reference is dead weight the workflow can never load. GLOBAL
  // reachability, not per-skill-directory ownership: a skill's own SKILL.md is not the only legitimate
  // loader. Verified directly against this repo (not merely reasoned about) — two real, working files
  // break a naive per-skill-ownership model: `map/references/vigil-map-overlay.md` is loaded only by
  // `vigil/SKILL.md`, and `map/references/navigator-map-overlay.md` is loaded only by
  // `agents/navigator.agent.md` — neither is named in `map/SKILL.md` itself. So a reference file is
  // flagged only when its filename is mentioned in NEITHER any `skills/*/SKILL.md` NOR any
  // `agents/*.agent.md` across the plugin.
  {
    const skillsDir = `${PLUGIN}/skills`;
    const agentsDir = `${PLUGIN}/agents`;
    if (read.list(skillsDir) !== null) {
      const skillDirs = subdirs(skillsDir);
      // Union of every plausible loader: all SKILL.md files across the plugin, plus every agent doc —
      // not just the reference's own skill directory.
      let reachableText = skillDirs
        .map((name) => readText(`${skillsDir}/${name}/SKILL.md`))
        .filter((text) => text !== null)
        .join("\n");
      if (read.list(agentsDir) !== null) {
        reachableText += "\n" + names(agentsDir)
          .filter((name) => name.endsWith(".agent.md"))
          .map((name) => readText(`${agentsDir}/${name}`) ?? "")
          .join("\n");
      }
      for (const skill of skillDirs) {
        const refDir = `${skillsDir}/${skill}/references`;
        if (read.list(refDir) === null) continue;
        for (const name of names(refDir)) {
          if (!name.endsWith(".md")) continue;
          if (!reachableText.includes(name))
            fail(`garden 9a: ${PLUGIN}/skills/${skill}/references/${name} is not mentioned by filename in any skills/*/SKILL.md or agents/*.agent.md — an orphan reference the workflow can never load; add it to a SKILL.md's Reference Loading list (or an agent doc that loads it) or delete the file`);
        }
      }
    }
  }

  // 9c. Size caps with headroom. These two files dominate always-loaded prompt cost;
  // the caps leave headroom so ordinary edits do not trip. Raising a cap is allowed —
  // but must be a CONSCIOUS decision made here with a justifying comment, not accretion.
  {
    // arbiter.agent.md is loaded on every arbiter spawn (and every repair-iteration re-spawn), so its
    // cap is held at 27000: growth must be funded by consolidating existing text, not by raising it.
    const SIZE_CAPS = [
      [`${PLUGIN}/skills/vigil/SKILL.md`, 30000],
      [`${PLUGIN}/agents/arbiter.agent.md`, 27000],
    ];
    for (const [rel, cap] of SIZE_CAPS) {
      const buf = read.file(rel);
      if (buf === null) continue; // a missing file is reported by earlier sections
      const size = buf.length;
      if (size > cap)
        fail(`garden 9c: ${rel} is ${size} bytes and grew past the agreed cap (${cap}); either shrink it or consciously raise the cap in validate-structure with a justifying comment`);
    }
  }

  // 9e. ${CLAUDE_PLUGIN_ROOT} lint: an installed plugin's scripts do NOT live under the consuming
  // project's cwd, so a shipped doc instructing `node skills/vigil/scripts/…` (bare,
  // without the ${CLAUDE_PLUGIN_ROOT}/ prefix) breaks at runtime in every consuming repo. Narrow by
  // design: only the `node <path>` invocation form is flagged, so prose
  // mentions of script paths never false-trip.
  {
    const badInvocation = /node\s+(?:\.\/)?skills\/(?:doctor|map|salvage|ship|vigil)\/scripts\//;
    walk(PLUGIN, (rel) => {
      if (!rel.endsWith(".md")) return;
      const lines = (readText(rel) ?? "").split(/\r?\n/);
      lines.forEach((ln, i) => {
        if (badInvocation.test(ln))
          fail(`garden 9e: ${rel}:${i + 1} invokes a plugin script without the plugin root — write "node \${CLAUDE_PLUGIN_ROOT}/skills/vigil/scripts/…" so the command resolves in a consuming repo`);
      });
    });
  }

  // 9f. Trust-marker enumeration parity — the Map operational-readiness trust marker is a 3-tier
  //     set (verified / dry-run-verified / UNVERIFIED). Every current-facing FULL
  //     enumeration must list all three, else a future edit silently drops a tier (enumerated-member
  //     drift — the risk FAILURE_MEMORY names). It is explicitly site-anchored rather than a blanket
  //     regex so intentionally partial examples cannot false-trip the guard.
  const TRUST_TOP = /(?<!dry-run-)verified: <date>/; // standalone top tier, not the dry-run-verified substring
  const TRUST_MARKER_SITES = [
    { rel: `${PLUGIN}/skills/map/references/operational-readiness.md`, anchor: "carries a trust marker" },
    { rel: `${PLUGIN}/skills/map/references/operational-readiness.md`, anchor: "Exact steps: <commands, in order>" },
    { rel: `${PLUGIN}/skills/map/references/operational-readiness.md`, anchor: "how to flip it" },
    { rel: "README.md", anchor: "carries a trust marker" },
    { rel: "README.zh-TW.md", anchor: "帶信任標記" },
    { rel: "README.ja.md", anchor: "信頼マーカー" },
  ];
  for (const { rel, anchor } of TRUST_MARKER_SITES) {
    const text = readText(rel);
    if (text === null) { fail(`garden 9f: ${rel} missing — trust-marker enumeration site (update TRUST_MARKER_SITES if it moved)`); continue; }
    const matched = text.replace(/\r\n/g, "\n").split("\n").filter((l) => l.includes(anchor));
    if (matched.length !== 1) { fail(`garden 9f: ${rel} — trust-marker anchor "${anchor}" matched ${matched.length} line(s), expected 1; the enumeration moved or the anchor drifted — update TRUST_MARKER_SITES`); continue; }
    const line = matched[0];
    const missing = [];
    if (!TRUST_TOP.test(line)) missing.push("verified: <date>");
    if (!line.includes("dry-run-verified: <date>")) missing.push("dry-run-verified: <date>");
    if (!line.includes("UNVERIFIED")) missing.push("UNVERIFIED");
    if (missing.length) fail(`garden 9f: ${rel} trust-marker enumeration ("${anchor}") is missing tier(s): ${missing.join(", ")} — the 3-tier set (verified: <date> / dry-run-verified: <date> / UNVERIFIED) must stay in sync across all ${TRUST_MARKER_SITES.length} sites (or update TRUST_MARKER_SITES if the enumeration was consciously changed)`);
  }

  // 10. Cressetide identity and exact public-surface inventories (agents, skills, hooks, environment
  // variables, public commands, README tokens). Exact match on purpose: adding, renaming, or removing
  // one of these is a conscious edit made HERE, never silent drift.
  if (pkg?.name !== "ctide" || plugin?.name !== "ctide" || plugin?.displayName !== "Cressetide") {
    fail("Cressetide package/plugin identity mismatch");
  }

  const expectedAgents = [
    "navigator", "implementer", "intent-reviewer", "test-reviewer", "code-reviewer",
    "security-reviewer", "architecture-reviewer", "operability-reviewer",
    "ui-ux-reviewer", "arbiter", "cartographer",
  ];
  const agentEntries = names(`${PLUGIN}/agents`);
  for (const name of agentEntries) {
    if (!name.endsWith(".agent.md")) fail(`Cressetide agents/ entry is not an .agent.md file: ${PLUGIN}/agents/${name} (every entry in agents/ must be an agent definition)`);
  }
  const agentFiles = agentEntries.filter((name) => name.endsWith(".agent.md")).sort();
  if (JSON.stringify(agentFiles) !== JSON.stringify(expectedAgents.map((name) => `${name}.agent.md`).sort())) {
    fail("Cressetide agent file inventory mismatch");
  }
  // Claude Code discovers agents/*.agent.md itself (probe P0-4) and names each agent by its frontmatter
  // `name`, so the manifest lists none, and every file's name is its stem: a list would be a second
  // roster that can drift, and a name that differs from the file would load under a name nothing spawns.
  if (plugin && Object.hasOwn(plugin, "agents")) fail("plugin.json declares an `agents` key — Claude Code discovers agents/*.agent.md; remove the list");
  for (const name of agentFiles) {
    const text = readText(`${PLUGIN}/agents/${name}`) ?? "";
    const end = text.startsWith("---") ? text.indexOf("\n---", 3) : -1;
    const match = end === -1 ? null : text.slice(3, end).match(/^[ \t]*name[ \t]*:[ \t]*(.+?)[ \t]*\r?$/m);
    const declared = match ? match[1].replace(/^["']|["']$/g, "") : null;
    const stem = name.slice(0, -".agent.md".length);
    if (declared !== stem) fail(`${PLUGIN}/agents/${name}: frontmatter name is ${declared === null ? "missing" : `"${declared}"`}, expected "${stem}" (the file stem)`);
  }

  const skillRoot = `${PLUGIN}/skills`;
  const expectedSkills = ["doctor", "map", "salvage", "ship", "vigil"];
  if (JSON.stringify(subdirs(skillRoot).sort()) !== JSON.stringify(expectedSkills)) fail("public skill inventory mismatch");
  for (const name of expectedSkills) {
    const text = readText(`${skillRoot}/${name}/SKILL.md`);
    if (text === null) { fail(`missing skill ${name}`); continue; }
    if (!text.startsWith("---") || !new RegExp(`^name:\\s*${name}\\s*$`, "m").test(text)) fail(`${name} frontmatter mismatch`);
    if (["doctor", "map", "ship"].includes(name)) {
      if (!/^disable-model-invocation:\s*true\s*$/m.test(text)) fail(`${name} must remain manual-only`);
      if (!/^user-invocable:\s*true\s*$/m.test(text)) fail(`${name} must remain user-invocable`);
    }
  }
  const vigil = readText(`${skillRoot}/vigil/SKILL.md`) ?? ""; // a missing file is reported just above
  const roster = ((vigil.match(/subagents \(([^)]+)\)/) || [])[1] || "").match(/`([a-z0-9-]+)`/g)?.map((value) => value.slice(1, -1)).sort() || [];
  if (JSON.stringify(roster) !== JSON.stringify([...expectedAgents].sort())) fail("Vigil subagent roster mismatch");

  const expectedHooks = [
    ["PreToolUse", "Edit|Write|NotebookEdit|Bash|PowerShell", "pre-tool-use.mjs"],
    ["SessionStart", "startup|resume|clear|compact", "session-start.mjs"],
    ["Stop", "", "orchestration-check.js"],
  ];
  const actualHooks = [];
  for (const [event, groups] of Object.entries(hooksJson?.hooks || {})) {
    for (const group of Array.isArray(groups) ? groups : []) {
      for (const hook of Array.isArray(group?.hooks) ? group.hooks : []) {
        const command = String(hook?.command || "");
        const name = command.match(/hooks\/([a-z0-9-]+\.m?js)/i)?.[1] || "";
        actualHooks.push([event, group.matcher || "", name]);
      }
    }
  }
  if (JSON.stringify(actualHooks.sort()) !== JSON.stringify(expectedHooks.sort())) fail("hook registration inventory or event mapping mismatch");
  const hookScripts = names(`${PLUGIN}/hooks`).filter((name) => /\.m?js$/.test(name)).sort();
  if (JSON.stringify(hookScripts) !== JSON.stringify(expectedHooks.map((item) => item[2]).sort())) fail("hook script inventory mismatch");
  for (const name of hookScripts) {
    const source = read.file(`${PLUGIN}/hooks/${name}`);
    if (source === null || !syntaxOk(name, source)) fail(`hook syntax check failed: ${name}`);
  }

  const envNames = new Set();
  for (const rel of listFiles(PLUGIN).concat([".github/scripts/publish-release.mjs"])) {
    if (!/\.[cm]?js$/.test(rel)) continue;
    const text = readText(rel);
    if (text === null) continue;
    for (const match of text.matchAll(/process\.env\.(CTIDE_[A-Z0-9_]+)/g)) envNames.add(match[1]);
  }
  const expectedEnvNames = ["CTIDE_ENFORCE_STOP", "CTIDE_HOOK_DEBUG", "CTIDE_REPAIR_PUBLISHED_RELEASE_ASSETS"];
  if (JSON.stringify([...envNames].sort()) !== JSON.stringify(expectedEnvNames)) fail("supported Cressetide environment-variable inventory mismatch");

  const publicCommands = new Set();
  for (const rel of ["README.md", "README.zh-TW.md", "README.ja.md", "docs/command-reference.md"]) {
    const text = readText(rel);
    // Worded "not found" on purpose: "<README> is missing" is §8's translated-README deletion message,
    // and its test must not be satisfied by this one.
    if (text === null) { fail(`public command inventory: ${rel} not found, so its /ctide: commands cannot be read`); continue; }
    for (const match of text.matchAll(/\/ctide:([a-z][a-z0-9-]*)/g)) publicCommands.add(match[1]);
  }
  if (JSON.stringify([...publicCommands].sort()) !== JSON.stringify(expectedSkills)) fail("public command inventory mismatch");

  for (const name of ["README.md", "README.zh-TW.md", "README.ja.md"]) {
    const text = readText(name);
    if (text === null) { fail(`${name}: not found, so its Cressetide public tokens cannot be checked`); continue; }
    for (const token of ["/ctide:vigil", "/ctide:salvage", "/ctide:map", "/ctide:doctor", "/ctide:ship", ".ctide/", "ctide@kktu"]) {
      if (!text.includes(token)) fail(`${name}: missing Cressetide public token ${token}`);
    }
  }
  if (!(readText("CHANGELOG.md") ?? "").includes("## [Unreleased]")) fail("CHANGELOG must remain Unreleased");

  return errors;
}
