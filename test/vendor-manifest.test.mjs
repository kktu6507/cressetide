// Offline provenance check for the vendored third-party sources.
//
// cressetide/skills/vigil/vendor/vendor-manifest.json is the sole canonical machine-readable
// authority for the authorized dependency packet (the ADR is the human governance record and is
// deliberately NOT parsed here). Every expectation below is therefore READ FROM the manifest --
// no member path, byte count or digest is restated in this file, because a second copy would be a
// second authority and the two could drift apart silently.
//
// No network access: the tarballs were verified against their manifest SRI during acquisition, and
// what this file proves is that the bytes sitting in the tree are still exactly the bytes the
// manifest authorizes, on any machine, offline, forever.
import assert from "node:assert";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { root } from "./support.mjs";

const VENDOR_DIR = path.join(root, "cressetide", "skills", "vigil", "vendor");
const MANIFEST_REL = "cressetide/skills/vigil/vendor/vendor-manifest.json";
const MANIFEST_PATH = path.join(root, MANIFEST_REL);
const VENDOR_PREFIX = "cressetide/skills/vigil/vendor/";

const manifestText = fs.readFileSync(MANIFEST_PATH, "utf8");

test("vendor manifest: parses as JSON", () => {
  assert.doesNotThrow(() => JSON.parse(manifestText), "the shipped manifest must be machine-readable");
});

const manifest = JSON.parse(manifestText);
const members = manifest.packages.flatMap((p) => p.members);

test("vendor manifest: authorization state reflects vendored artifacts", () => {
  assert.strictEqual(manifest.authorization.status, "selection-authorized-artifacts-vendored");
  assert.strictEqual(manifest.authorization.canonicalAuthority, "this-file",
    "the manifest must name itself as the canonical authority, not a docs path absent from the release archive");
  assert.strictEqual(manifest.authorization.runtimeInstall, false, "runtime package installation is not authorized");
  assert.strictEqual(manifest.authorization.runtimeNetwork, false, "runtime network access is not authorized");
});

test("vendor manifest: declares exactly four vendored members", () => {
  assert.strictEqual(members.length, 4, "the authorized packet is exactly four members");
  for (const m of members) {
    assert.strictEqual(m.state, "vendored", `${m.target} must be marked vendored`);
  }
});

test("vendor manifest: every target is a unique canonical path confined to the vendor directory", () => {
  const seen = new Set();
  for (const m of members) {
    const t = m.target;
    assert.strictEqual(typeof t, "string");
    assert.ok(!path.isAbsolute(t), `${t} must be repository-relative`);
    assert.ok(!t.includes("\\"), `${t} must use POSIX separators`);
    assert.strictEqual(path.posix.normalize(t), t, `${t} must already be canonical (no . or .. segments)`);
    assert.ok(t.startsWith(VENDOR_PREFIX), `${t} must live under ${VENDOR_PREFIX}`);
    assert.ok(!seen.has(t), `${t} is declared more than once`);
    seen.add(t);

    // Belt and braces: resolving the target must not escape the vendor directory on this platform.
    const resolved = path.resolve(root, t);
    const rel = path.relative(VENDOR_DIR, resolved);
    assert.ok(rel && !rel.startsWith("..") && !path.isAbsolute(rel), `${t} escapes the vendor directory`);
  }
});

test("vendor manifest: every declared member exists as a regular file with the authorized bytes", () => {
  for (const m of members) {
    const abs = path.join(root, m.target);
    const st = fs.lstatSync(abs); // lstat, so a symlink pointing at the right bytes still fails
    assert.ok(st.isFile(), `${m.target} must exist as a regular file`);
    assert.ok(!st.isSymbolicLink(), `${m.target} must not be a symlink`);

    const bytes = fs.readFileSync(abs);
    assert.strictEqual(bytes.length, m.bytes, `${m.target} raw byte length must equal the manifest`);
    assert.strictEqual(crypto.createHash("sha256").update(bytes).digest("hex"), m.sha256,
      `${m.target} raw SHA-256 must equal the manifest`);
  }
});

test("vendor manifest: the vendor directory holds the manifest and the declared members and nothing else", () => {
  // Walks the whole subtree, so an unlisted tarball, extracted package tree or stray scratch file
  // anywhere beneath vendor/ is caught, not just one at the top level.
  const found = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const abs = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(abs);
      else found.push(path.relative(root, abs).split(path.sep).join("/"));
    }
  };
  walk(VENDOR_DIR);

  const expected = [MANIFEST_REL, ...members.map((m) => m.target)].sort();
  assert.deepStrictEqual(found.sort(), expected,
    "the vendor directory must contain exactly the manifest plus its declared members -- no unlisted third-party bytes");
});
