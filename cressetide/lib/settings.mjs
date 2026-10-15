// The ctide.* guard flags in a project's Claude Code settings, and the project root they are read from.
// Node built-ins only; nothing here throws.
import fs from "node:fs";
import path from "node:path";

// The four per-project switches, each on unless a settings file sets it to the boolean false.
export const GUARD_KEYS = Object.freeze(["planGate", "destructiveGuard", "contractGuard", "preserveOnCompact"]);
// The two settings files under <root>/.claude/, highest precedence first.
export const SETTINGS_FILES = Object.freeze(["settings.local.json", "settings.json"]);
// A settings file larger than this is not read (bytes).
export const SETTINGS_MAX_BYTES = 1024 * 1024;

// true or false for those exact booleans; undefined (no claim) for anything else.
export function triState(value) {
  return value === false ? false : value === true ? true : undefined;
}

// The project root a hook event is about: CLAUDE_PROJECT_DIR, else the event's own cwd (when it is a
// non-empty string), else — only for a caller that asks, i.e. the SessionStart hooks, whose event may carry
// no cwd — process.cwd(). "" when there is none.
export function projectRoot(input, { processCwdFallback = false } = {}) {
  const fromEnv = process.env.CLAUDE_PROJECT_DIR;
  if (fromEnv) return fromEnv;
  const cwd = input?.cwd;
  if (typeof cwd === "string" && cwd) return cwd;
  return processCwdFallback ? process.cwd() : "";
}

// A settings file's text, or null when it is missing, unreadable, or larger than SETTINGS_MAX_BYTES. The
// size is checked (stat) before anything is read, so an oversized file is never read at all.
export function readSettingsFile(file) {
  try {
    if (fs.statSync(file).size > SETTINGS_MAX_BYTES) return null;
    return fs.readFileSync(file, "utf8");
  } catch {
    return null;
  }
}

// The tri-state value of each guard flag in settings `content` (text): { planGate, destructiveGuard, ... },
// {} when the text is not JSON. `cfg?.ctide?.[key]`, never `cfg && cfg.ctide && ...`: a bare `false` as
// the "ctide" value or as the whole document is no claim, not an explicit false for every key.
export function guardFlags(content) {
  if (typeof content !== "string") return {};
  let cfg;
  try { cfg = JSON.parse(content); } catch { return {}; }
  const flags = {};
  for (const key of GUARD_KEYS) flags[key] = triState(cfg?.ctide?.[key]);
  return flags;
}

// ctide.<key> (one of GUARD_KEYS) in one settings file: true, false, or undefined (not set, or the file is
// missing, oversized, not JSON, or unreadable).
export function readGuardFlag(file, key) {
  return guardFlags(readSettingsFile(file))[key];
}

// True only when the higher-precedence settings file that sets ctide.<key> sets it to false
// (settings.local.json over settings.json; a file that does not set it defers to the next). Fails safe
// toward the guard: no root, a missing, broken or oversized file, or any error counts as not disabled.
export function guardDisabled(input, key, { processCwdFallback = false } = {}) {
  try {
    const root = projectRoot(input, { processCwdFallback });
    if (!root) return false;
    for (const name of SETTINGS_FILES) {
      const value = readGuardFlag(path.join(root, ".claude", name), key);
      if (value === false) return true;
      if (value === true) return false;
    }
  } catch { /* not disabled */ }
  return false;
}
