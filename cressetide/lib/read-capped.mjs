// Bounded file reads for the plugin's scripts. Node built-ins only.
import fs from "node:fs";

// Reads at most `cap` bytes of `file` and returns them decoded as UTF-8: the first `cap` bytes
// (from: "head", the default) or the last `cap` bytes (from: "tail"). A file of `cap` bytes or fewer is
// read whole. Open, size and read all go through one file descriptor (fstat, not stat), so the size is
// that of the file actually being read even if the path is replaced in between.
//
// Decoding is Buffer#toString("utf8"), the same as the readFileSync(file, "utf8") /
// buffer.toString("utf8", 0, n) reads it replaces. When the cut falls inside a multi-byte character the
// partial sequence is not dropped but decoded as U+FFFD: a head read that ends inside a character gets
// one U+FFFD for the incomplete sequence at its end; a tail read that starts inside a character gets one
// U+FFFD per orphaned continuation byte at its start. A byte-order mark is kept as U+FEFF.
//
// onError: "throw" (the default) rethrows a filesystem error (ENOENT, EACCES, EPERM, EISDIR, …), so the
// caller can tell a missing file from an unreadable one; "empty" returns "" for any of them. Invalid
// options are a programming error and throw a TypeError whatever `onError` says.
export function readCapped(file, { cap, from = "head", onError = "throw" } = {}) {
  if (!Number.isSafeInteger(cap) || cap < 1) throw new TypeError("readCapped: cap must be a positive integer");
  if (from !== "head" && from !== "tail") throw new TypeError('readCapped: from must be "head" or "tail"');
  if (onError !== "throw" && onError !== "empty") throw new TypeError('readCapped: onError must be "throw" or "empty"');
  let fd;
  try {
    fd = fs.openSync(file, "r");
    const stat = fs.fstatSync(fd);
    // Windows opens a directory and reports size 0; fail like readFileSync does everywhere.
    if (stat.isDirectory()) throw Object.assign(new Error("EISDIR: illegal operation on a directory, read"), { code: "EISDIR", syscall: "read" });
    const size = stat.size;
    const length = Math.min(size, cap);
    const start = from === "tail" ? size - length : 0;
    const buffer = Buffer.alloc(length);
    let filled = 0;
    while (filled < length) {
      const read = fs.readSync(fd, buffer, filled, length - filled, start + filled);
      if (read === 0) break; // the file shrank after fstat
      filled += read;
    }
    return buffer.toString("utf8", 0, filled);
  } catch (error) {
    if (onError === "empty") return "";
    throw error;
  } finally {
    if (fd !== undefined) {
      try { fs.closeSync(fd); } catch { /* a close failure does not change what was read */ }
    }
  }
}
