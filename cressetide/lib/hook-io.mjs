// Hook input and output plumbing shared by the plugin's hook entry files: the one bounded stdin reader, the
// role-marker neutralizer and the nonce fence around hook-injected context. Node built-ins only; nothing
// here throws.
import crypto from "node:crypto";

// The most stdin a hook buffers (bytes). A larger event is not read: the caller fails open.
export const MAX_STDIN = 5 * 1024 * 1024;

// Reads one hook event (a JSON object) from `stream` and resolves — never rejects — to
// { ok: true, value } or { ok: false, reason }, where reason is one of:
//   "over-cap"      more than `cap` bytes arrived (exactly `cap` is still read); the stream is destroyed;
//   "malformed"     the text is not JSON;
//   "not-an-object" the JSON is null, an array, a string, a number or a boolean;
//   "timeout"       the stream did not end within `timeoutMs` (the watchdog is unref'd, so it never keeps
//                   a process alive on its own);
//   "stream-error"  the stream emitted an error, or could not be listened to.
// Chunks are kept as bytes and decoded once at the end, so a multi-byte UTF-8 character split across
// chunks decodes intact. A leading byte-order mark is not dropped: such an event is malformed (Claude Code
// never sends one, and the hooks have always failed open on it). An empty or whitespace-only event reads
// as {} (an event that carries no fields).
export function readHookEvent({ stream = process.stdin, cap = MAX_STDIN, timeoutMs = 5000 } = {}) {
  return new Promise((resolve) => {
    const chunks = [];
    let bytes = 0;
    let settled = false;
    let watchdog;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(watchdog);
      try { stream.removeListener("data", onData); } catch { /* already detached */ }
      resolve(result);
    };
    const onData = (chunk) => {
      if (settled) return;
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk), "utf8");
      bytes += buffer.length;
      if (bytes > cap) {
        try { stream.destroy(); } catch { /* nothing more to read either way */ }
        finish({ ok: false, reason: "over-cap" });
        return;
      }
      chunks.push(buffer);
    };
    watchdog = setTimeout(() => finish({ ok: false, reason: "timeout" }), timeoutMs);
    if (typeof watchdog.unref === "function") watchdog.unref();
    try {
      // The error listener stays attached after the event is read: an error emitted later (or by the
      // destroy above) must not become an unhandled 'error' event.
      stream.on("error", () => finish({ ok: false, reason: "stream-error" }));
      stream.on("data", onData);
      stream.once("end", () => finish(parseEvent(Buffer.concat(chunks, bytes))));
    } catch {
      finish({ ok: false, reason: "stream-error" });
    }
  });
}

function parseEvent(buffer) {
  const text = buffer.toString("utf8");
  if (!text.trim()) return { ok: true, value: {} };
  let value;
  try {
    value = JSON.parse(text);
  } catch {
    return { ok: false, reason: "malformed" };
  }
  if (value === null || typeof value !== "object" || Array.isArray(value)) return { ok: false, reason: "not-an-object" };
  return { ok: true, value };
}

// Neutralizes lines that could act as a conversational role marker or an instruction-block tag inside
// injected context (on top of the nonce fence). The optional leading list marker ([-*]) matters because a
// digest title is rendered as "- <title>", so a hostile title like "system: ..." would otherwise slip past
// a strictly line-anchored role pattern.
export function neutralize(text) {
  return String(text).split(/\r?\n/).map((line) => {
    if (/^\s*[-*]?\s*(?:system|assistant|user|human)\s*:/i.test(line)) return line.replace(/:/, "："); // a fullwidth colon breaks the role marker
    if (/^\s*[-*]?\s*<\/?\s*(?:system|assistant|user|human|instructions?)\b/i.test(line)) return "· " + line.replace(/[<>]/g, "");
    return line;
  }).join("\n");
}

// Wraps `body` (neutralized) in an unforgeable per-call fence: "<<CTIDE_<tag>_<nonce>>>" and
// "<<END_CTIDE_<tag>_<nonce>>>" around it, the nonce 16 random hex digits. Returns { nonce, open, text }:
// `open` is the opening marker (for a header that names it), `text` the fenced block.
export function fence(tag, body) {
  const nonce = crypto.randomBytes(8).toString("hex");
  const open = `<<CTIDE_${tag}_${nonce}>>`;
  return { nonce, open, text: `${open}\n${neutralize(body)}\n<<END_CTIDE_${tag}_${nonce}>>` };
}
