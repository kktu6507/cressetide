// One raw JSON duplicate-member scanner, shared by the registry loader and the S3 explicit-config
// reader so the two cannot drift apart.
//
// WHY IT EXISTS. test-provenance approved v1.11 gives §11b.3 and §11b.4 the same rule in their own
// words: no JSON object in either carrier may repeat a member name, names are compared after escape
// decoding, and the check must happen "while every member occurrence is still observable".
// JSON.parse is last-write-wins -- by the time it returns, the earlier occurrence is gone -- so a
// check after it cannot satisfy the rule. This runs before it.
//
// SCOPE. It answers exactly one question and returns nothing. It does not parse values, does not
// know either caller's schema, and does not own either caller's error codes: it throws its own
// typed error with a `kind`, and the caller re-raises it under E_REGISTRY_DUPLICATE_MEMBER /
// E_REGISTRY_SHAPE or E_CONFIG_DUPLICATE_MEMBER / E_CONFIG_SHAPE. It never sorts, de-duplicates,
// repairs or re-serialises anything: the bytes it was handed are the bytes the caller keeps.
//
// It is deliberately NOT the scanner inside changed-test-inventory.mjs. That one is private to the
// canonical v2 reader, whose duplicate authority is upstream SM v1.14 and whose scope is a
// ChangedTestInventoryV2 document; reaching into it would couple two contracts that approved text
// keeps separate.

export class JsonMemberScanError extends Error {
  constructor(kind, message, detail) {
    super(message);
    this.name = "JsonMemberScanError";
    this.kind = kind; // "malformed" | "duplicate"
    if (detail !== undefined) this.detail = detail;
  }
}

const WHITESPACE = new Set([0x20, 0x09, 0x0a, 0x0d]);

/**
 * Refuse a document that repeats a member name inside any of its objects.
 *
 * @param {string} text the raw document, exactly as read.
 * @param {string} what a label for messages, e.g. a file path.
 * @returns {void} nothing: this is an assertion, not a parser.
 */
export function assertUniqueJsonMembers(text, what) {
  if (typeof text !== "string") {
    throw new JsonMemberScanError("malformed", `${what} must be a string to be scanned`);
  }
  let i = 0;

  const malformed = (why, at = i) => {
    throw new JsonMemberScanError("malformed", `${what} is not valid JSON: ${why} at offset ${at}`, { offset: at });
  };

  const skipWhitespace = () => {
    while (i < text.length && WHITESPACE.has(text.charCodeAt(i))) i += 1;
  };

  const word = (literal) => {
    if (text.slice(i, i + literal.length) !== literal) malformed(`expected ${literal}`);
    i += literal.length;
  };

  const digit = () => text[i] >= "0" && text[i] <= "9";

  // Returns the DECODED string value, which is what member names are compared by: "path" and
  // "\u0070ath" are one name, and no normalization or case folding is applied to either.
  function scanString() {
    if (text[i] !== "\"") malformed("expected a string");
    const opened = i;
    i += 1;
    let out = "";
    for (;;) {
      if (i >= text.length) malformed("unterminated string", opened);
      const c = text[i];
      if (c === "\"") { i += 1; return out; }
      if (c === "\\") {
        i += 1;
        const e = text[i];
        if (e === "\"" || e === "\\" || e === "/") { out += e; i += 1; continue; }
        if (e === "b") { out += "\b"; i += 1; continue; }
        if (e === "f") { out += "\f"; i += 1; continue; }
        if (e === "n") { out += "\n"; i += 1; continue; }
        if (e === "r") { out += "\r"; i += 1; continue; }
        if (e === "t") { out += "\t"; i += 1; continue; }
        if (e === "u") {
          const hex = text.slice(i + 1, i + 5);
          if (!/^[0-9a-fA-F]{4}$/.test(hex)) malformed("a \\u escape needs four hex digits");
          out += String.fromCharCode(parseInt(hex, 16));
          i += 5;
          continue;
        }
        malformed(e === undefined ? "unterminated escape" : `unknown escape \\${e}`);
      }
      if (text.charCodeAt(i) < 0x20) malformed("an unescaped control character in a string");
      out += c;
      i += 1;
    }
  }

  function scanNumber() {
    if (text[i] === "-") i += 1;
    if (text[i] === "0") i += 1;
    else if (digit()) { while (digit()) i += 1; }
    else malformed("a number needs at least one digit");
    if (text[i] === ".") {
      i += 1;
      if (!digit()) malformed("a fraction needs at least one digit");
      while (digit()) i += 1;
    }
    if (text[i] === "e" || text[i] === "E") {
      i += 1;
      if (text[i] === "+" || text[i] === "-") i += 1;
      if (!digit()) malformed("an exponent needs at least one digit");
      while (digit()) i += 1;
    }
  }

  // Each object is judged on its own: an array may hold many objects, and a name repeated across
  // two sibling objects is not a duplicate. Nesting depth carries no state either.
  function scanObject(where) {
    i += 1;
    const seen = new Set();
    skipWhitespace();
    if (text[i] === "}") { i += 1; return; }
    for (;;) {
      skipWhitespace();
      const nameAt = i;
      const name = scanString();
      if (seen.has(name)) {
        throw new JsonMemberScanError("duplicate",
          `${what} repeats the member name ${JSON.stringify(name)} in one object at ${where} (offset ${nameAt}). `
          + "Duplicate member names are refused here, while every occurrence is still observable -- JSON.parse "
          + "would silently keep the last one. Names are compared by their DECODED value, so \"a\" and "
          + "\"\\u0061\" are the same name",
          { name, offset: nameAt, at: where });
      }
      seen.add(name);
      skipWhitespace();
      if (text[i] !== ":") malformed("expected \":\" after a member name");
      i += 1;
      scanValue(`${where}.${name}`);
      skipWhitespace();
      if (text[i] === ",") { i += 1; continue; }
      if (text[i] === "}") { i += 1; return; }
      malformed("expected \",\" or \"}\" in an object");
    }
  }

  function scanArray(where) {
    i += 1;
    let index = 0;
    skipWhitespace();
    if (text[i] === "]") { i += 1; return; }
    for (;;) {
      scanValue(`${where}[${index}]`);
      index += 1;
      skipWhitespace();
      if (text[i] === ",") { i += 1; continue; }
      if (text[i] === "]") { i += 1; return; }
      malformed("expected \",\" or \"]\" in an array");
    }
  }

  function scanValue(where) {
    skipWhitespace();
    const c = text[i];
    if (c === "{") return scanObject(where);
    if (c === "[") return scanArray(where);
    if (c === "\"") { scanString(); return; }
    if (c === "t") { word("true"); return; }
    if (c === "f") { word("false"); return; }
    if (c === "n") { word("null"); return; }
    if (c === "-" || (c >= "0" && c <= "9")) { scanNumber(); return; }
    malformed(c === undefined ? "unexpected end of document" : `unexpected character ${JSON.stringify(c)}`);
  }

  scanValue("<root>");
  skipWhitespace();
  if (i !== text.length) malformed("trailing content after the document");
}
