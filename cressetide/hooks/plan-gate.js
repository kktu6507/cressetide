#!/usr/bin/env node
// ctide plan gate: while permission mode is "plan", deny structured edits
// (Write/Edit/MultiEdit/NotebookEdit) except Claude Code's own plan files under
// ~/.claude/plans/, and deny Bash/PowerShell commands that obviously write the working tree
// (redirect-to-file, tee-to-file, sed -i, git apply). The Bash/PowerShell check is a narrow
// tripwire for the common cases — not full shell classification; it defaults to allow.
// Cross-platform Node; fail-open (exit 0 = allow) on any error so it never breaks a session.
const os = require("os");
const path = require("path");
const fs = require("fs");

const MAX_STDIN = 5 * 1024 * 1024; // cap to avoid unbounded buffering of a large tool_input (bytes)

// debug() kept in sync with destructive-guard.js / contract-guard.js / load-failure-memory.js / compact-fidelity.js / orchestration-check.js (documented copy — see garden hash guard)
function debug(msg) {
  if (!process.env.CTIDE_HOOK_DEBUG) return;
  try { fs.appendFileSync(path.join(os.tmpdir(), "ctide-hook.log"), "[plan-gate] " + msg + "\n"); } catch (e) {}
  try { process.stderr.write("[ctide plan-gate] " + msg + "\n"); } catch (e) {}
}

// Resolve symlinks on the deepest existing ancestor (the target file may not exist yet),
// so a symlink under a "plans" path cannot redirect the exemption elsewhere.
function realpathDeepest(p) {
  let cur = p;
  for (let i = 0; i < 64; i++) {
    if (fs.existsSync(cur)) {
      const real = fs.realpathSync(cur);
      const rest = path.relative(cur, p);
      return rest ? path.join(real, rest) : real;
    }
    const parent = path.dirname(cur);
    if (parent === cur) break;
    cur = parent;
  }
  return p;
}

// Empirically decide whether the filesystem holding `p` is case-insensitive, instead of guessing from
// the OS — a case-sensitive APFS (macOS) or a case-insensitive mount on Linux would fool the platform
// guess. Probe: find the deepest existing ancestor of `p`, flip the case of its basename, and test
// whether that variant resolves in the same directory. Returns true/false, or null when undeterminable
// (no cased characters, or any error) so the caller can fall back to the platform default.
function fsCaseInsensitiveNear(p) {
  try {
    let cur = path.resolve(String(p));
    for (let i = 0; i < 64; i++) {
      if (fs.existsSync(cur)) break;
      const parent = path.dirname(cur);
      if (parent === cur) return null; // reached the root without an existing ancestor
      cur = parent;
    }
    if (!fs.existsSync(cur)) return null;
    const base = path.basename(cur);
    const flipped = base === base.toLowerCase() ? base.toUpperCase() : base.toLowerCase();
    if (flipped === base) return null; // no cased characters to test -> undeterminable
    return fs.existsSync(path.join(path.dirname(cur), flipped));
  } catch (e) { return null; }
}

// Narrow tripwire: does this Bash/PowerShell command obviously write the working tree? Conservative,
// defaults to allow — false positives are worse than the documented miss list. It deliberately
// does NOT catch: no-space redirects (echo x>f), `>|`, $VAR/~ targets, cp/mv, or interpreter
// one-liners (node -e fs.writeFileSync / python -c open(...,'w') / xargs touch) — those are
// unbounded to classify and tightening the redirect form would false-positive on arithmetic
// like $((a>b)). git checkout/restore and read-only commands stay allowed. The covered set is a
// safety net, not a guarantee — the workflow rule (no Bash/PowerShell tree-writes while planning) plus a
// default plan mode are the real guard; see SKILL.md and the README "Plan gate" section.
function bashLooksLikePlanWrite(command) {
  const cmd = String(command || "");
  // Drop quoted spans first so a literal ">" inside quotes doesn't count. Kept simple and
  // non-recursive so a multi-MB hostile string can't overflow the regex stack; a stray
  // apostrophe in an unquoted word can still mis-pair (an accepted, tested miss).
  // quote-stripper regex kept in sync with destructive-guard.js (documented copy — see garden hash guard)
  const unquoted = cmd.replace(/'[^']*'|"[^"]*"/g, " ");
  const obviousWritePatterns = [
    // redirect to a file (>, >>, &>) after start/space/separator; exempt fd-dups (2>&1),
    // /dev/null, NUL. Target must be a literal path/word (so > $VAR and > ~ slip — accepted).
    /(?:^|[\s;&|])(?:\d?>|>>|&>)\s*(?!&?\d\b|\/dev\/null\b|NUL\b)(?:\.{0,2}[\\/]|[A-Za-z]:[\\/]|[A-Za-z0-9_.][A-Za-z0-9_.-]*)/i,
    // tee writing to a file (skipping flags); /dev/null and NUL exempt.
    /(?:^|[\s;&|])tee\s+(?:-[A-Za-z]+\s+)*(?!\/dev\/null\b|NUL\b)(?:\.{0,2}[\\/]|[A-Za-z]:[\\/]|[A-Za-z0-9_.][A-Za-z0-9_.-]*)/i,
    // sed in place: bare -i, -i<suffix> (e.g. -i.bak), or --in-place, within the sed arg span.
    /(?:^|[\s;&|])sed\b(?=[^;&|]*\s(?:-[A-Za-z]*i[\w.-]*|--in-place\b))/i,
    // perl in place: -i / -i.bak / -pi / -ni etc. (the -i flag is always an in-place rewrite).
    /(?:^|[\s;&|])perl\b(?=[^;&|]*\s-[A-Za-z]*i)/i,
    // truncate: always resizes (and creates) the named file.
    /(?:^|[\s;&|])truncate\s+\S/i,
    // dd writing to a file via of= (exempt of=/dev/null, of=NUL); without of= dd writes stdout.
    // Anchor class includes `(` (subshell start) — kept character-identical with destructive-guard.js's dd pattern.
    /(?:^|[\s;&|(])dd\s(?=[^;&|]*\bof=)(?![^;&|]*\bof=(?:\/dev\/null\b|NUL\b))/i,
    // ln creating a link (symbolic or hard) — writes a new directory entry into the tree.
    /(?:^|[\s;&|])ln\s+(?:-[A-Za-z]+\s+)*\S/i,
    // git apply that actually applies — exempt dry-run/report-only flags.
    /(?:^|[\s;&|])git\s+apply\b(?![^;&|]*\s--(?:check|stat|numstat|summary)\b)/i
  ];
  return obviousWritePatterns.some((re) => re.test(unquoted));
}

// Project opt-out: a project may disable the plan gate for its OWN sessions by setting
// "ctide": { "planGate": false } in its .claude/settings.json (or .claude/settings.local.json,
// which takes precedence). The gate is otherwise global — it blocks plan-mode edits even in a
// project unrelated to any ctide task — and this is the documented escape hatch. Resolve the
// project dir from CLAUDE_PROJECT_DIR, falling back to the event's cwd. FAIL-SAFE toward the
// safety net: a missing file, parse error, oversized config, or any read error counts as
// "not disabled" (keep enforcing), so a broken settings file can never silently drop the gate.
// settings-flag reader (DisabledForProject + readFlag pair) kept in sync with destructive-guard.js / contract-guard.js / compact-fidelity.js (documented copy — see garden hash guard)
function planGateDisabledForProject(input) {
  try {
    const root = process.env.CLAUDE_PROJECT_DIR || (input && input.cwd) || "";
    if (!root) return false;
    for (const name of ["settings.local.json", "settings.json"]) { // local overrides project
      const v = readPlanGateFlag(path.join(root, ".claude", name));
      if (v === false) return true;  // explicitly disabled in the higher-precedence file -> allow
      if (v === true) return false;  // explicitly enabled -> enforce (a lower file can't flip it back)
      // undefined -> not set here; fall through to the lower-precedence file
    }
  } catch (e) {}
  return false;
}

// Read ctide.planGate from a settings file: true/false when set, undefined otherwise (missing
// file / not set / any error). Caps the read so a pathological settings file can't stall the hook.
function readPlanGateFlag(file) {
  try {
    let size = 0;
    try { size = fs.statSync(file).size; } catch (e) { return undefined; } // not present / unstatable
    if (size > 1024 * 1024) return undefined;
    const cfg = JSON.parse(fs.readFileSync(file, "utf8"));
    const v = cfg?.ctide?.planGate; // ?. (not &&): a bare-false "ctide" must read as no claim, not collapse to false
    return v === false ? false : (v === true ? true : undefined);
  } catch (e) { return undefined; }
}

// stdin reader kept in sync with destructive-guard.js / contract-guard.js / load-failure-memory.js / compact-fidelity.js / orchestration-check.js (documented copy — see garden hash guard)
let raw = "";
let rawBytes = 0;
process.stdin.setEncoding("utf8");
process.stdin.on("error", () => process.exit(0));
const _watchdog = setTimeout(() => process.exit(0), 5000); _watchdog.unref();
process.stdin.on("data", (c) => {
  raw += c;
  rawBytes += Buffer.byteLength(c, "utf8");
  if (rawBytes > MAX_STDIN) { debug("stdin over cap; allowing"); try { process.stdin.pause(); } catch (e) {} process.exit(0); }
});
process.stdin.on("end", () => {
  try {
    const input = JSON.parse(raw || "{}");
    const tool = input.tool_name || "";
    const mode = input.permission_mode || input.permissionMode || "";
    const ti = input.tool_input || {};
    const editBlocked = tool === "Write" || tool === "Edit" || tool === "MultiEdit" || tool === "NotebookEdit";
    const bashBlocked = (tool === "Bash" || tool === "PowerShell") && bashLooksLikePlanWrite(ti.command);

    const targetPath = ti.file_path || ti.path || ti.notebook_path || "";
    let isPlanFile = false; // only relevant for structured edits to ~/.claude/plans
    if (targetPath) {
      try {
        // Compare case-insensitively ONLY on a case-insensitive filesystem, detected EMPIRICALLY
        // rather than guessed from the OS — a case-sensitive APFS or a case-insensitive Linux mount
        // would fool a platform check and wrongly widen/narrow the ~/.claude/plans write-exemption.
        // Probe the exemption subtree itself (deepest existing ancestor of ~/.claude/plans, e.g.
        // ~/.claude — a cased basename, so it also engages for numeric/caseless home dir names), and
        // fall back to the platform default only when undeterminable.
        const probed = fsCaseInsensitiveNear(path.join(os.homedir(), ".claude", "plans"));
        const caseInsensitiveFS = probed === null ? (process.platform === "win32" || process.platform === "darwin") : probed;
        const norm = (s) => { s = s.replace(/\\/g, "/"); return caseInsensitiveFS ? s.toLowerCase() : s; };
        let resolved = path.resolve(String(targetPath));
        try { resolved = realpathDeepest(resolved); } catch (e) {}
        resolved = norm(resolved);
        // Resolve symlinks on the exemption root too, so BOTH sides compare in realpath space. The
        // target above is already realpath-resolved; if the home path itself contains a symlink (e.g.
        // macOS, where the per-user temp dir resolves through /var -> /private/var, or any symlinked
        // home), a non-resolved planRoot would never prefix the resolved target and the legitimate
        // ~/.claude/plans write would be wrongly denied.
        let planRootAbs = path.join(os.homedir(), ".claude", "plans");
        try { planRootAbs = realpathDeepest(planRootAbs); } catch (e) {}
        const planRoot = norm(planRootAbs) + "/";
        isPlanFile = resolved.startsWith(planRoot);
      } catch (e) { isPlanFile = false; }
    }

    const deny = (editBlocked && !isPlanFile) || bashBlocked;
    debug("tool=" + tool + " mode=" + mode + " editBlocked=" + editBlocked + " bashBlocked=" + bashBlocked + " isPlanFile=" + isPlanFile);

    if (mode === "plan" && deny) {
      if (planGateDisabledForProject(input)) {
        debug("plan gate disabled for this project (ctide.planGate=false); allowing");
        return process.exit(0);
      }
      const out = {
        hookSpecificOutput: {
          hookEventName: "PreToolUse",
          permissionDecision: "deny",
          permissionDecisionReason: bashBlocked
            ? "ctide plan gate: this " + tool + " command looks like a working-tree write (>, tee, sed -i, perl -i, truncate, dd of=, ln, git apply), so it is blocked while in plan mode. This is a best-effort heuristic — if the command is read-only, writes outside the working tree (e.g. to /tmp), or a dry run, present the plan via ExitPlanMode and run it after approval, or adjust it. Only obvious writes are caught, not all " + tool + " calls (e.g. interpreter one-liners slip), so do not use " + tool + " to modify the tree while planning regardless."
            : "ctide plan gate: file modifications are blocked while in plan mode. Present the plan via ExitPlanMode and get approval before implementing."
        }
      };
      debug("DENY");
      // write-then-exit: flush the deny JSON before exiting so a full buffer can't truncate it
      return process.stdout.write(JSON.stringify(out), () => process.exit(0));
    }
  } catch (e) { debug("error: " + (e && e.message)); }
  return process.exit(0);
});
