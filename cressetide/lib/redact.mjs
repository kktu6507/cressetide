// Diagnostic redaction for text a script prints or reports (doctor's check details, the release
// publisher's subprocess errors): one implementation of the chain both used to carry. Node built-ins only.
import os from "node:os";

// Replaces every occurrence of `sensitivePath` (as a literal, never as a pattern — regex characters in it
// are escaped) with `replacement`; case-insensitively on Windows, where paths are.
function replaceSensitivePath(text, sensitivePath, replacement) {
  if (!sensitivePath) return text;
  const escaped = sensitivePath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return text.replace(new RegExp(escaped, process.platform === "win32" ? "gi" : "g"), replacement);
}

// `value` as a single redacted line of at most `limit` characters. The order matters and is fixed:
//   1. a PEM private-key block is replaced whole — before newlines are collapsed, so the BEGIN/END pair
//      is still matched across lines; a BEGIN line with no END after it is replaced through to the end;
//   2. runs of CR/LF/TAB become one space and the ends are trimmed;
//   3. authorization / api-key / private-key / gh-token / token / secret / password values after ":" or
//      "=" (bare, or a whole quoted string), Bearer tokens, and GitHub token shapes become [redacted];
//   4. the OS temp directory becomes "<temp>", then the home directory "~" (temp first: on most systems it
//      sits under home);
//   5. the result is cut to `limit` characters.
// A non-string value is converted with String(); null and undefined become "".
export function redactDiagnostic(value, limit = 2000) {
  let text = String(value ?? "")
    .replace(/-----BEGIN [^-\r\n]*PRIVATE KEY-----(?:[\s\S]*?-----END [^-\r\n]*PRIVATE KEY-----|[\s\S]*$)/gi, "[redacted private key]")
    .replace(/[\r\n\t]+/g, " ").trim()
    .replace(/(["']?\bauthorization\b["']?\s*[:=]\s*)(?:"[^"]*"|'[^']*'|[^,;|]+)/gi, "$1[redacted]")
    .replace(/(["']?\b(?:api(?:[_-]|\s+)?key|private(?:[_-]|\s+)?key|gh(?:[_-]|\s+)?token|token|secret|password)\b["']?\s*[:=]\s*)(?:"[^"]*"|'[^']*'|[^,;|]+)/gi, "$1[redacted]")
    .replace(/\bbearer\s+["']?[A-Za-z0-9._~+/=-]+["']?/gi, "Bearer [redacted]")
    .replace(/\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})\b/g, "[redacted]");
  text = replaceSensitivePath(text, os.tmpdir(), "<temp>");
  text = replaceSensitivePath(text, os.homedir(), "~");
  return text.slice(0, limit);
}
