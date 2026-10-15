// The plan gate (PreToolUse): while the permission mode is "plan", deny structured edits (Write, Edit,
// NotebookEdit) except Claude Code's own plan files under ~/.claude/plans/, and deny Bash/PowerShell
// commands that obviously write the working tree. The command check is a narrow tripwire for the common
// cases — not full shell classification; it defaults to allow. Per-project opt-out:
// "ctide": { "planGate": false } in .claude/settings.json or .claude/settings.local.json.
// Node built-ins only; no subprocess.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { guardDisabled } from "../settings.mjs";
import { DD_OF_WRITE, stripQuotes } from "./shell.mjs";

const CHECK = "plan-gate";
const EDIT_TOOLS = new Set(["Write", "Edit", "NotebookEdit"]);
const SHELL_TOOLS = new Set(["Bash", "PowerShell"]);
const noDebug = () => {};

// Conservative, defaults to allow — false positives are worse than the documented miss list. It does NOT
// catch: no-space redirects (echo x>f), `>|`, $VAR/~ targets, cp/mv, or interpreter one-liners
// (node -e fs.writeFileSync / python -c open(...,'w') / xargs touch) — unbounded to classify, and
// tightening the redirect form would false-positive on arithmetic like $((a>b)). git checkout/restore and
// read-only commands stay allowed. A safety net, not a guarantee: the workflow rule (no Bash/PowerShell
// tree-writes while planning) plus a default plan mode are the real guard.
const PLAN_WRITE_PATTERNS = [
  // redirect to a file (>, >>, &>) after start/space/separator; exempt fd-dups (2>&1), /dev/null, NUL.
  // The target must be a literal path/word (so > $VAR and > ~ slip — accepted).
  /(?:^|[\s;&|])(?:\d?>|>>|&>)\s*(?!&?\d\b|\/dev\/null\b|NUL\b)(?:\.{0,2}[\\/]|[A-Za-z]:[\\/]|[A-Za-z0-9_.][A-Za-z0-9_.-]*)/i,
  // tee writing to a file (skipping flags); /dev/null and NUL exempt.
  /(?:^|[\s;&|])tee\s+(?:-[A-Za-z]+\s+)*(?!\/dev\/null\b|NUL\b)(?:\.{0,2}[\\/]|[A-Za-z]:[\\/]|[A-Za-z0-9_.][A-Za-z0-9_.-]*)/i,
  // sed in place: bare -i, -i<suffix> (e.g. -i.bak), or --in-place, within the sed argument span.
  // {0,200}-bounded: an unbounded run rescans to the end at every "sed" anchor (quadratic, a ReDoS).
  /(?:^|[\s;&|])sed\b(?=[^;&|]{0,200}\s(?:-[A-Za-z]*i[\w.-]*|--in-place\b))/i,
  // perl in place: -i / -i.bak / -pi / -ni etc. {0,200}-bounded for the same reason.
  /(?:^|[\s;&|])perl\b(?=[^;&|]{0,200}\s-[A-Za-z]*i)/i,
  // truncate: always resizes (and creates) the named file.
  /(?:^|[\s;&|])truncate\s+\S/i,
  // dd writing a file through of= (shared with the destructive guard).
  DD_OF_WRITE,
  // ln creating a link (symbolic or hard) — a new directory entry in the tree.
  /(?:^|[\s;&|])ln\s+(?:-[A-Za-z]+\s+)*\S/i,
  // git apply that actually applies — dry-run / report-only flags exempt. {0,200}-bounded (negative
  // lookahead form) for the same reason as sed.
  /(?:^|[\s;&|])git\s+apply\b(?![^;&|]{0,200}\s--(?:check|stat|numstat|summary)\b)/i,
];

// Does this Bash/PowerShell command obviously write the working tree? Matched against the quote-stripped
// command, so a ">" inside quotes does not count.
export function looksLikePlanWrite(command) {
  const unquoted = stripQuotes(command);
  return PLAN_WRITE_PATTERNS.some((pattern) => pattern.test(unquoted));
}

// Resolves symlinks on the deepest existing ancestor (the target file may not exist yet), so a symlink
// under a "plans" path cannot redirect the exemption elsewhere.
function realpathDeepest(p) {
  let current = p;
  for (let i = 0; i < 64; i++) {
    if (fs.existsSync(current)) {
      const real = fs.realpathSync(current);
      const rest = path.relative(current, p);
      return rest ? path.join(real, rest) : real;
    }
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return p;
}

// Whether the filesystem holding `p` is case-insensitive, decided empirically rather than from the OS (a
// case-sensitive APFS or a case-insensitive Linux mount would fool a platform guess): flip the case of the
// deepest existing ancestor's basename and test whether that variant exists. true/false, or null when
// undeterminable (no cased characters, or any error) so the caller can fall back to the platform default.
function fsCaseInsensitiveNear(p) {
  try {
    let current = path.resolve(String(p));
    for (let i = 0; i < 64; i++) {
      if (fs.existsSync(current)) break;
      const parent = path.dirname(current);
      if (parent === current) return null;
      current = parent;
    }
    if (!fs.existsSync(current)) return null;
    const base = path.basename(current);
    const flipped = base === base.toLowerCase() ? base.toUpperCase() : base.toLowerCase();
    if (flipped === base) return null;
    return fs.existsSync(path.join(path.dirname(current), flipped));
  } catch {
    return null;
  }
}

// Is `target` inside <home>/.claude/plans/? Both sides are compared in realpath space (a junction under
// plans/ that escapes it is not exempt; a plan file under a symlinked home is), case-insensitively only on
// a case-insensitive filesystem, probed at the exemption subtree itself. Any error: false.
export function isPlanFile(target, { home = os.homedir() } = {}) {
  if (!target) return false;
  try {
    const plansRoot = path.join(home, ".claude", "plans");
    const probed = fsCaseInsensitiveNear(plansRoot);
    const caseInsensitive = probed === null ? (process.platform === "win32" || process.platform === "darwin") : probed;
    const normalize = (s) => {
      const forward = s.replace(/\\/g, "/");
      return caseInsensitive ? forward.toLowerCase() : forward;
    };
    let resolved = path.resolve(String(target));
    try { resolved = realpathDeepest(resolved); } catch { /* compare the unresolved path */ }
    let realRoot = plansRoot;
    try { realRoot = realpathDeepest(realRoot); } catch { /* compare the unresolved root */ }
    return normalize(resolved).startsWith(normalize(realRoot) + "/");
  } catch {
    return false;
  }
}

const EDIT_DENY_REASON = "ctide plan gate: file modifications are blocked while in plan mode. Present the plan via ExitPlanMode and get approval before implementing.";

function shellDenyReason(tool) {
  return "ctide plan gate: this " + tool + " command looks like a working-tree write (>, tee, sed -i, perl -i, truncate, dd of=, ln, git apply), so it is blocked while in plan mode. This is a best-effort heuristic — if the command is read-only, writes outside the working tree (e.g. to /tmp), or a dry run, present the plan via ExitPlanMode and run it after approval, or adjust it. Only obvious writes are caught, not all " + tool + " calls (e.g. interpreter one-liners slip), so do not use " + tool + " to modify the tree while planning regardless.";
}

// { decision: "deny", reason } for a gated write in plan mode, else null. The permission mode is checked
// first (only the event's permission_mode field), so nothing else runs outside plan mode. `home` is the
// directory whose .claude/plans/ is exempt.
export function planGate(input, { debug = noDebug, home = os.homedir() } = {}) {
  if (input?.permission_mode !== "plan") return null;
  const tool = input.tool_name || "";
  const toolInput = input.tool_input || {};
  const editBlocked = EDIT_TOOLS.has(tool);
  const shellBlocked = SHELL_TOOLS.has(tool) && looksLikePlanWrite(toolInput.command);
  if (!editBlocked && !shellBlocked) {
    debug(CHECK, `tool=${tool}: not a gated write; allowing`);
    return null;
  }
  if (editBlocked && isPlanFile(toolInput.file_path || toolInput.path || toolInput.notebook_path || "", { home })) {
    debug(CHECK, `tool=${tool}: a ~/.claude/plans file; allowing`);
    return null;
  }
  if (guardDisabled(input, "planGate")) {
    debug(CHECK, "disabled for this project (ctide.planGate=false); allowing");
    return null;
  }
  debug(CHECK, `DENY tool=${tool}`);
  return { decision: "deny", reason: shellBlocked ? shellDenyReason(tool) : EDIT_DENY_REASON };
}
