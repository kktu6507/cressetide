// Unit tests for cressetide/lib/redact.mjs: the redaction chain doctor.mjs and publish-release.mjs each
// carried a copy of — credential shapes, multi-line private keys, the fixed rule order, temp/home paths
// (with regex characters in them), non-string input and the length limit.
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { test } from "./helpers.mjs";
import { redactDiagnostic } from "../cressetide/lib/redact.mjs";
import { redactReleaseDiagnostic } from "../.github/scripts/publish-release.mjs";

const SECRET = "CTIDE_SENTINEL_SECRET";

// The credential shapes test/release-doctor.test.mjs feeds the doctor probe-detail guard.
const SENTINELS = [
  `Authorization: Bearer ${SECRET}`,
  `Authorization: "Bearer ${SECRET}"`,
  `authorization:   Basic ${SECRET}`,
  `API_KEY=${SECRET}`,
  `API key: ${SECRET}`,
  `private-key: ${SECRET}`,
  `private key: ${SECRET}`,
  `private key: -----BEGIN PRIVATE KEY-----\n${SECRET}\n-----END PRIVATE KEY-----`,
  `Bearer ${SECRET}`,
  `Bearer "${SECRET}"`,
  `{"token":"${SECRET}"}`,
  `{"authorization":"Bearer ${SECRET}"}`,
  `GH_TOKEN=${SECRET}`,
  `password = '${SECRET}'`,
  `secret: ${SECRET}`,
];

// Sets process.env entries for the duration of fn only (os.tmpdir()/os.homedir() read them per call).
function withEnv(vars, fn) {
  const saved = Object.keys(vars).map((key) => [key, process.env[key]]);
  for (const [key, value] of Object.entries(vars)) process.env[key] = value;
  try { return fn(); } finally {
    for (const [key, value] of saved) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
  }
}

for (const diagnostic of SENTINELS) {
  test(`redactDiagnostic(): hides the value in ${JSON.stringify(diagnostic.split(/[ :=]/)[0])}…`, () => {
    const redacted = redactDiagnostic(diagnostic);
    assert.ok(!redacted.includes(SECRET), redacted);
    assert.match(redacted, /\[redacted/);
  });
}

test("redactDiagnostic(): GitHub token shapes are redacted wherever they stand", () => {
  for (const token of ["ghp_1234567890abcdefghijklmnopqrstuv", "gho_abcdefghijklmnopqrstuvwxyz", "github_pat_1234567890abcdefghijklmnopqrstuv"]) {
    assert.equal(redactDiagnostic(`push failed with ${token} in the URL`), "push failed with [redacted] in the URL");
  }
  assert.equal(redactDiagnostic("ghp_short"), "ghp_short", "too short to be a token");
});

test("redactDiagnostic(): the combined release diagnostic from release-doctor.test", () => {
  const diagnostic = redactDiagnostic(
    `${path.join(os.tmpdir(), "ctide-secret")}; GH_TOKEN=CTIDE_GH_SECRET; `
    + "github_pat_1234567890abcdefghijklmnop; Authorization: 'Bearer CTIDE_AUTH_SECRET'; "
    + '{"token":"CTIDE_JSON_TOKEN_SECRET","authorization":"Bearer CTIDE_JSON_AUTH_SECRET"}',
  );
  assert.match(diagnostic, /<temp>/);
  assert.match(diagnostic, /GH_TOKEN=\[redacted\]/i);
  assert.doesNotMatch(diagnostic, /CTIDE_(?:GH|AUTH)_SECRET|CTIDE_JSON_(?:TOKEN|AUTH)_SECRET|github_pat_1234567890abcdefghijklmnop/);
  assert.ok(!diagnostic.toLowerCase().includes(os.tmpdir().toLowerCase()));
});

test("redactDiagnostic(): multi-line private keys — RSA/EC/OPENSSH labels, CRLF, two blocks — become one marker each", () => {
  const key = (label, eol) => [`-----BEGIN ${label}PRIVATE KEY-----`, "MIIEvQIBADANBg", "kqhkiG9w0BAQEF", `-----END ${label}PRIVATE KEY-----`].join(eol);
  assert.equal(redactDiagnostic(`before\n${key("RSA ", "\n")}\nafter`), "before [redacted private key] after");
  assert.equal(redactDiagnostic(key("EC ", "\r\n")), "[redacted private key]");
  assert.equal(redactDiagnostic(`${key("OPENSSH ", "\n")} middle ${key("", "\n")}`), "[redacted private key] middle [redacted private key]");
  assert.ok(!redactDiagnostic(key("", "\n")).includes("MIIE"));
});

// Rule order: the private-key block is replaced before the "private key: <value>" rule runs, whose value
// stops at a comma — the other way round, key material after a comma in the body would survive.
test("redactDiagnostic(): the key block goes before the key-value rule, so a comma inside the key leaks nothing", () => {
  const redacted = redactDiagnostic("private key: -----BEGIN PRIVATE KEY-----\nAAAA,BBBB;CCCC\n-----END PRIVATE KEY----- done");
  assert.equal(redacted, "private key: [redacted]");
  assert.doesNotMatch(redacted, /AAAA|BBBB|CCCC/);
});

test("redactDiagnostic(): newlines and tabs collapse to single spaces, ends trimmed", () => {
  assert.equal(redactDiagnostic("\n\tfirst line\r\n\r\nsecond\tline\n"), "first line second line");
});

test("redactDiagnostic(): temp then home paths are shortened, regex characters in them taken literally", () => {
  const home = process.platform === "win32" ? "C:\\Users\\a+b(c)[d]$e^f.g" : "/home/a+b(c)[d]$e^f.g";
  const temp = path.join(home, "AppData", "Temp.(x)");
  withEnv({ HOME: home, USERPROFILE: home, TEMP: temp, TMP: temp, TMPDIR: temp }, () => {
    assert.equal(os.homedir(), home, "fixture sanity: os.homedir() follows the environment");
    assert.equal(os.tmpdir(), temp, "fixture sanity: os.tmpdir() follows the environment");
    assert.equal(redactDiagnostic(`open ${path.join(temp, "x.txt")} and ${path.join(home, "y.txt")}`), `open ${path.join("<temp>", "x.txt")} and ${path.join("~", "y.txt")}`);
    const lookalike = home.replace("a+b", "aab");
    assert.equal(redactDiagnostic(lookalike), lookalike, "+ is not a regex quantifier here");
    const cased = home.toUpperCase();
    assert.equal(redactDiagnostic(cased), process.platform === "win32" ? "~" : cased, "case-insensitive on Windows only");
  });
});

test("redactDiagnostic(): non-string input is converted, null and undefined are empty", () => {
  assert.equal(redactDiagnostic(null), "");
  assert.equal(redactDiagnostic(undefined), "");
  assert.equal(redactDiagnostic(42), "42");
  assert.equal(redactDiagnostic(new Error(`token=${SECRET}`)), "Error: token=[redacted]");
  assert.equal(redactDiagnostic(Buffer.from(`Bearer ${SECRET}`)), "Bearer [redacted]");
  assert.equal(redactDiagnostic({ toString: () => `secret=${SECRET}` }), "secret=[redacted]");
});

test("redactDiagnostic(): cut to the limit after redaction — 2000 by default", () => {
  assert.equal(redactDiagnostic("x".repeat(5000)).length, 2000);
  assert.equal(redactDiagnostic(`${"x".repeat(5)} Bearer ${SECRET}`, 12), "xxxxx Bearer");
});

// P4 review T-5: cutting first would keep the part of a secret before the limit, too short or too broken to
// match any rule.
test("redactDiagnostic(): a private key or a token straddling the 2000-character limit leaves no fragment", () => {
  const body = ["MIIEvQIBADANBgkqhkiG9w0BAQEFAASC", "SECRETKEYMATERIAL0123456789abcdef", "moreKeyMaterialLinesHere"];
  const pem = ["-----BEGIN RSA PRIVATE KEY-----", ...body, "-----END RSA PRIVATE KEY-----"].join("\n");
  const prefix = "x".repeat(1940);
  assert.ok(prefix.length + 1 + 31 < 2000 && prefix.length + 1 + pem.length > 2000, "fixture sanity: BEGIN fits under the limit, the key does not");
  const keyed = redactDiagnostic(`${prefix} ${pem}`);
  for (const line of body) assert.ok(!keyed.includes(line.slice(0, 8)), `no key material: ${line.slice(0, 8)}`);
  assert.equal(keyed, `${prefix} [redacted private key]`);

  const token = `ghp_${"A1b2C3d4E5".repeat(4)}`;
  const tokenPrefix = "y".repeat(1990);
  const tokened = redactDiagnostic(`${tokenPrefix} ${token} trailing text`);
  assert.equal(tokened.length, 2000);
  assert.ok(!tokened.includes("ghp_") && !tokened.includes("A1b2C3"), tokened.slice(1980));
  assert.ok(`${tokenPrefix} [redacted] trailing text`.startsWith(tokened), tokened.slice(1980));
});

// P4 review: a BEGIN line with no END after it used to leave the key body in place.
test("redactDiagnostic(): a private key with no END line is redacted through to the end", () => {
  const unterminated = redactDiagnostic(`load failed: -----BEGIN PRIVATE KEY-----\nMIIEvQIBADANBg\n${SECRET}\nno end line`);
  assert.equal(unterminated, "load failed: [redacted private key]");
  assert.equal(redactDiagnostic(`-----BEGIN EC PRIVATE KEY-----\r\n${SECRET}`), "[redacted private key]");
});

// publish-release.mjs keeps exporting its old name for the release tests, as lib's function itself — one
// copy, not a second implementation that merely agrees on these inputs.
test("publish-release's exported redactReleaseDiagnostic is cressetide/lib/redact.mjs's redactDiagnostic itself", () => {
  assert.equal(redactReleaseDiagnostic, redactDiagnostic);
  for (const input of [...SENTINELS, "plain text", `${os.tmpdir()}${path.sep}f`, `${os.homedir()}${path.sep}f`, "x".repeat(3000), null, 42]) {
    assert.equal(redactReleaseDiagnostic(input), redactDiagnostic(input), JSON.stringify(input).slice(0, 80));
  }
});
