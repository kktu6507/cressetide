// Shell-command text helpers shared by the PreToolUse guards (plan-gate.mjs, destructive.mjs). Node
// built-ins only.

// `command` with every single- or double-quoted span replaced by a space, so a pattern inside quotes
// (echo "rm -rf /", grep 'a > b') does not count. Deliberately simple and non-recursive, so a multi-MB
// hostile string cannot overflow the regex stack; a stray word-internal apostrophe can mis-pair and blank
// an unquoted span (an accepted, documented miss of both guards).
export function stripQuotes(command) {
  return String(command || "").replace(/'[^']*'|"[^"]*"/g, " ");
}

// dd writing a file through of= (of=/dev/null and of=NUL are exempt; without of= dd writes stdout). The
// anchor class includes "(" so a subshell's dd counts. A plan-mode working-tree write for the plan gate and
// an unrecoverable write for the destructive guard: the one copy both use. Each [^;&|] run is bounded to
// 200 characters: an unbounded run scans to the end of the command at every "dd " anchor (quadratic, a
// ReDoS); a malformed double of= with /dev/null within the bound is exempted, and last-of= wins anyway.
export const DD_OF_WRITE = /(?:^|[\s;&|(])dd\s(?=[^;&|]{0,200}\bof=)(?![^;&|]{0,200}\bof=(?:\/dev\/null\b|NUL\b))/i;
