// Unit tests for cressetide/lib/read-capped.mjs: the cap boundary from the head and the tail, the UTF-8
// decoding of a multi-byte character split by the cut, both onError modes for a missing, an unreadable
// (EACCES/EPERM) and a directory path, the short-read loop and the size taken from the open descriptor.
// The last two patch properties of the `fs` default export: read-capped.mjs imports that same object and
// reads fs.readSync / fs.fstatSync from it at call time.
import assert from "node:assert/strict";
import cp from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { tempDir, test } from "./helpers.mjs";
import { readCapped } from "../cressetide/lib/read-capped.mjs";

// Built from code points so this source file itself carries no replacement character or byte-order mark.
const REPLACEMENT = String.fromCodePoint(0xfffd);
const BOM = String.fromCodePoint(0xfeff);
const EURO = String.fromCodePoint(0x20ac); // UTF-8: e2 82 ac

function fileWith(bytes, name = "data.txt") {
  const file = path.join(tempDir("ctide-lib-read-capped-"), name);
  fs.writeFileSync(file, Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes, "utf8"));
  return file;
}

test("readCapped(): a file of exactly cap bytes is read whole, from the head and from the tail", () => {
  const file = fileWith("0123456789");
  assert.equal(readCapped(file, { cap: 10 }), "0123456789");
  assert.equal(readCapped(file, { cap: 10, from: "tail" }), "0123456789");
  assert.equal(readCapped(file, { cap: 64 }), "0123456789", "smaller than the cap");
  assert.equal(readCapped(file, { cap: 64, from: "tail" }), "0123456789");
});

test("readCapped(): a file of cap + 1 bytes loses its last byte from the head and its first from the tail", () => {
  const file = fileWith("0123456789A");
  assert.equal(readCapped(file, { cap: 10 }), "0123456789");
  assert.equal(readCapped(file, { cap: 10, from: "head" }), "0123456789");
  assert.equal(readCapped(file, { cap: 10, from: "tail" }), "123456789A");
});

test("readCapped(): an empty file is the empty string", () => {
  const file = fileWith("");
  assert.equal(readCapped(file, { cap: 4 }), "");
  assert.equal(readCapped(file, { cap: 4, from: "tail" }), "");
});

// The documented decoding: Buffer#toString("utf8") of the bytes read — an incomplete sequence at the end of
// a head read is one U+FFFD; each orphaned continuation byte at the start of a tail read is one U+FFFD.
test("readCapped(): a multi-byte character split by the cut decodes as U+FFFD, exactly like Buffer#toString", () => {
  const file = fileWith(`x${EURO}y`); // 78 | e2 82 ac | 79
  const bytes = fs.readFileSync(file);
  assert.equal(bytes.length, 5, "fixture sanity: a three-byte character between two ASCII bytes");
  for (const [options, expected] of [
    [{ cap: 4 }, `x${EURO}`],
    [{ cap: 3 }, `x${REPLACEMENT}`],
    [{ cap: 2 }, `x${REPLACEMENT}`],
    [{ cap: 4, from: "tail" }, `${EURO}y`],
    [{ cap: 3, from: "tail" }, `${REPLACEMENT}${REPLACEMENT}y`],
    [{ cap: 2, from: "tail" }, `${REPLACEMENT}y`],
  ]) {
    const actual = readCapped(file, options);
    assert.equal(actual, expected, JSON.stringify(options));
    const slice = options.from === "tail" ? bytes.subarray(bytes.length - options.cap) : bytes.subarray(0, options.cap);
    assert.equal(actual, slice.toString("utf8"), "same as decoding the byte slice with Buffer#toString");
  }
});

test("readCapped(): a byte-order mark is kept", () => {
  const file = fileWith(Buffer.from([0xef, 0xbb, 0xbf, 0x61]));
  assert.equal(readCapped(file, { cap: 16 }), `${BOM}a`);
});

test("readCapped(): a missing file throws ENOENT with onError \"throw\" (the default) and is \"\" with \"empty\"", () => {
  const missing = path.join(tempDir("ctide-lib-read-capped-"), "missing.txt");
  assert.throws(() => readCapped(missing, { cap: 8 }), { code: "ENOENT" });
  assert.throws(() => readCapped(missing, { cap: 8, onError: "throw" }), { code: "ENOENT" });
  assert.equal(readCapped(missing, { cap: 8, onError: "empty" }), "");
  assert.equal(readCapped(missing, { cap: 8, from: "tail", onError: "empty" }), "");
});

test("readCapped(): a directory throws EISDIR with onError \"throw\" and is \"\" with \"empty\"", () => {
  const dir = tempDir("ctide-lib-read-capped-dir-");
  assert.throws(() => fs.readFileSync(dir, "utf8"), { code: "EISDIR" }, "fixture sanity: what the reads this replaces did");
  for (const from of ["head", "tail"]) {
    assert.throws(() => readCapped(dir, { cap: 8, from }), { code: "EISDIR" }, from);
    assert.equal(readCapped(dir, { cap: 8, from, onError: "empty" }), "", from);
  }
});

// Denies read access the platform's own way: an Everyone deny-read-data ACE on Windows (icacls), mode 000
// elsewhere. Returns { restore } or { skip: reason }.
function denyRead(file) {
  if (process.platform === "win32") {
    const deny = cp.spawnSync("icacls", [file, "/deny", "*S-1-1-0:(RD)"], { encoding: "utf8" });
    if (deny.status !== 0) return { skip: `icacls could not deny read: ${(deny.stderr || deny.stdout || deny.error?.message || "").trim()}` };
    return { restore: () => cp.spawnSync("icacls", [file, "/remove:d", "*S-1-1-0"], { encoding: "utf8" }) };
  }
  if (typeof process.getuid === "function" && process.getuid() === 0) return { skip: "running as root, which reads a mode-000 file anyway" };
  fs.chmodSync(file, 0o000);
  return { restore: () => fs.chmodSync(file, 0o600) };
}

test("readCapped(): an unreadable file (EACCES/EPERM) throws with onError \"throw\" and is \"\" with \"empty\"", (t) => {
  const file = fileWith("secret contents\n");
  const denied = denyRead(file);
  if (denied.skip) { t.skip(denied.skip); return; }
  try {
    assert.throws(() => fs.readFileSync(file), (error) => /^(EACCES|EPERM)$/.test(error.code), "fixture sanity: the file really is unreadable");
    for (const from of ["head", "tail"]) {
      assert.throws(() => readCapped(file, { cap: 4, from }), (error) => /^(EACCES|EPERM)$/.test(error.code), from);
      assert.throws(() => readCapped(file, { cap: 4, from, onError: "throw" }), (error) => /^(EACCES|EPERM)$/.test(error.code), from);
      assert.equal(readCapped(file, { cap: 4, from, onError: "empty" }), "", from);
    }
  } finally {
    denied.restore();
  }
});

// Replaces fs[name] with make(original) for the duration of fn only.
function withPatchedFs(name, make, fn) {
  const original = fs[name];
  fs[name] = make(original);
  try { return fn(); } finally { fs[name] = original; }
}

// P4 review: the short-read loop. fs.readSync may return fewer bytes than asked for; patched here to return
// at most one byte per call, the whole capped range must still be read — each byte into its own place in the
// buffer, from its own file position — from the head and from the tail.
test("readCapped(): reads that return one byte at a time still fill the whole range, each byte at its own offset", () => {
  const file = fileWith("0123456789AB");
  let calls = 0;
  const oneByte = (readSync) => function oneByteReadSync(fd, buffer, offset, length, position) {
    if (++calls > 1000) throw new Error("runaway read loop");
    return readSync.call(fs, fd, buffer, offset, Math.min(length, 1), position);
  };
  for (const [options, expected] of [
    [{ cap: 10 }, "0123456789"],
    [{ cap: 10, from: "tail" }, "23456789AB"],
    [{ cap: 64 }, "0123456789AB"],
    [{ cap: 64, from: "tail" }, "0123456789AB"],
  ]) {
    calls = 0;
    assert.equal(withPatchedFs("readSync", oneByte, () => readCapped(file, options)), expected, JSON.stringify(options));
    assert.equal(calls, expected.length, `${JSON.stringify(options)}: one patched read per byte`);
  }
});

// A read that returns 0 before the range is full (the file shrank after fstat) ends the loop, and only the
// bytes actually read are decoded — never the unfilled rest of the buffer.
test("readCapped(): a read that returns 0 early ends the loop with the bytes read so far", () => {
  const file = fileWith("0123456789");
  let calls = 0;
  const shrinking = (readSync) => function shrinkingReadSync(fd, buffer, offset, length, position) {
    if (++calls > 1000) throw new Error("runaway read loop");
    return calls <= 4 ? readSync.call(fs, fd, buffer, offset, Math.min(length, 1), position) : 0;
  };
  for (const [options, expected] of [[{ cap: 10 }, "0123"], [{ cap: 8, from: "tail" }, "2345"]]) {
    calls = 0;
    assert.equal(withPatchedFs("readSync", shrinking, () => readCapped(file, options)), expected, JSON.stringify(options));
    assert.equal(calls, 5, `${JSON.stringify(options)}: four one-byte reads, then the 0 that ends the loop`);
  }
});

// The size comes from the open descriptor (fstat), not from the path a second time (stat): with fs.statSync
// throwing, nothing changes.
test("readCapped(): the size comes from the open file descriptor — fs.statSync throwing changes nothing", () => {
  const file = fileWith("0123456789A");
  const throwing = () => function throwingStatSync() {
    throw Object.assign(new Error("statSync is patched to throw"), { code: "EPATCHED" });
  };
  withPatchedFs("statSync", throwing, () => {
    assert.throws(() => fs.statSync(file), { code: "EPATCHED" }, "fixture sanity: the patch is in place");
    assert.equal(readCapped(file, { cap: 10 }), "0123456789");
    assert.equal(readCapped(file, { cap: 10, from: "tail" }), "123456789A");
    assert.equal(readCapped(file, { cap: 64 }), "0123456789A");
  });
});

test("readCapped(): invalid options are a TypeError whatever onError says", () => {
  const file = fileWith("abc");
  for (const options of [
    {}, { cap: 0 }, { cap: -1 }, { cap: 1.5 }, { cap: "4" },
    { cap: 4, from: "middle" }, { cap: 4, onError: "ignore" },
    { cap: 0, onError: "empty" }, { cap: 4, from: "middle", onError: "empty" },
  ]) {
    assert.throws(() => readCapped(file, options), TypeError, JSON.stringify(options));
  }
  assert.throws(() => readCapped(file), TypeError, "no options at all");
});
