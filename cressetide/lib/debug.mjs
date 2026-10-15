// Opt-in diagnostics for the hooks: one switch, one line format, one log. Node built-ins only; nothing
// here throws.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { redactDiagnostic } from "./redact.mjs";

// The on values of a ctide boolean environment switch (CTIDE_HOOK_DEBUG here; CTIDE_ENFORCE_STOP uses the
// same rule): 1, true, yes or on, in any case, and nothing else — unset, empty, 0, false, off and every
// other value are off.
export const SWITCH_ON = /^(1|true|yes|on)$/i;

export const LOG_NAME = "ctide-hook.log";
// At or past this size the log is cleared before the next line is written.
export const LOG_MAX_BYTES = 1024 * 1024;
// The most characters of a message one line keeps (after redaction).
const LINE_LIMIT = 1000;

export function debugEnabled() {
  return SWITCH_ON.test(process.env.CTIDE_HOOK_DEBUG ?? "");
}

// A debug function for the hook entry `entry` (e.g. "pre-tool-use"): debug(check, message) writes
// "[ctide <entry>] <check>: <line>" to the log in the OS temp directory and to stderr, where <line> is
// redactDiagnostic(message, 1000) — redacted, then cut — so a credential in a command or a path never
// reaches either sink. Does nothing unless debugEnabled(). Never throws.
export function createDebug(entry) {
  return function debug(check, message) {
    try {
      if (!debugEnabled()) return;
      const line = `[ctide ${entry}] ${check}: ${redactDiagnostic(message, LINE_LIMIT)}\n`;
      try { appendLog(line); } catch { /* the log is best-effort */ }
      try { process.stderr.write(line); } catch { /* so is stderr */ }
    } catch { /* never let diagnostics break a hook */ }
  };
}

// Appends `line` to <temp>/ctide-hook.log, clearing the file first once it has reached LOG_MAX_BYTES.
// Writes only to a regular file of that name (owned by this user, where the platform has owners): a
// symlink, directory or other non-regular entry at that path is left alone (checked with lstat, and again
// on the opened descriptor; where the platform has O_NOFOLLOW the open itself refuses a final symlink), and
// a FIFO does not block the open (O_NONBLOCK) — so clearing the log can never truncate some other file.
function appendLog(line) {
  const file = path.join(os.tmpdir(), LOG_NAME);
  const { O_WRONLY, O_CREAT, O_APPEND, O_NOFOLLOW = 0, O_NONBLOCK = 0 } = fs.constants;
  const guard = O_NOFOLLOW | O_NONBLOCK;
  if (!regularOrAbsent(file)) return;
  let clear = false;
  const fd = fs.openSync(file, O_WRONLY | O_CREAT | O_APPEND | guard, 0o600);
  try {
    const stat = fs.fstatSync(fd);
    if (!ownRegularFile(stat)) return;
    if (stat.size < LOG_MAX_BYTES) {
      fs.writeSync(fd, line);
      return;
    }
    clear = true;
  } finally {
    fs.closeSync(fd);
  }
  // Cleared through a second descriptor without O_APPEND: Windows refuses to truncate an append-only one.
  if (!clear || !regularOrAbsent(file)) return;
  const again = fs.openSync(file, O_WRONLY | guard);
  try {
    if (!ownRegularFile(fs.fstatSync(again))) return;
    fs.ftruncateSync(again, 0);
    fs.writeSync(again, line, 0);
  } finally {
    fs.closeSync(again);
  }
}

// True when nothing is at `file` yet, or a regular file is (lstat: a symlink is not followed).
function regularOrAbsent(file) {
  try {
    return fs.lstatSync(file).isFile();
  } catch (error) {
    return error?.code === "ENOENT";
  }
}

function ownRegularFile(stat) {
  return stat.isFile() && (typeof process.getuid !== "function" || stat.uid === process.getuid());
}
