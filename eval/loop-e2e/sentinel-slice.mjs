// The main thread's byte-exact review-batch slice, as a callable pure function.
//
// A SECOND IMPLEMENTATION, stated plainly. The product assigns this slicing to the MAIN THREAD as
// PROSE (`cressetide/skills/vigil/references/review-packet.md`, "Persisting the returned batch",
// lines 152-183). Nothing under `cressetide/**` performs it, and this file does not become a product
// contract by existing: it is E2E evidence infrastructure that lets a harness reproduce the
// documented boundary mechanically. Green tests here show the transport is byte-exactly
// implementable and that one real reviewer's bytes survive it end to end. They do NOT show that a
// model executing that prose slices identically, and nothing here may be cited as if they did.
//
// BYTE DOMAIN ONLY. The captured reviewer response arrives as a Buffer and stays one: no decode, no
// re-encode, no normalisation, no trimming. That is the whole point — the controller hashes the
// persisted FILE, so a transcode here would silently change the artefact that the emission, the
// admission's `reviewRawDigest`, the committed batch and the ledger are all bound to.

const BEGIN_TOKEN = "CTIDE_TEST_SEMANTIC_REVIEW_BATCH_BEGIN";
const END_TOKEN = "CTIDE_TEST_SEMANTIC_REVIEW_BATCH_END";

export const SENTINEL_BEGIN = BEGIN_TOKEN;
export const SENTINEL_END = END_TOKEN;

// The four contract cases at review-packet.md:174 — "If a sentinel is missing, duplicated or
// misordered, or the slice is empty". A closed set: no fifth kind is invented here, and in
// particular a BOM is NOT a fault. review-packet.md:168-169 forbids the main thread from inserting
// OR REMOVING a BOM, so a BOM inside the slice is copied through and whether the controller's parser
// later refuses it is the controller's decision, made on the persisted bytes.
export const FAULT_KINDS = Object.freeze(["duplicated", "missing", "misordered", "empty"]);

// PRECEDENCE IS THIS FILE'S CHOICE, NOT THE PROSE'S. review-packet.md lists the four cases without
// ordering them, and it gives all four the SAME consequence — the output is unusable and the
// panel-gap rule applies — so precedence changes only which reason is reported, never the outcome.
// The order below is `duplicated` > `missing` > `misordered` > `empty`, because a duplicated token
// makes "the" BEGIN/END ambiguous and therefore makes ordering and emptiness ill-posed questions.
// No information is lost either way: every fault carries the full begin/end counts and line indexes,
// so a caller that prefers another order can re-derive it from `detail`.
const PRECEDENCE = Object.freeze(["duplicated", "missing", "misordered", "empty"]);
export const FAULT_PRECEDENCE = PRECEDENCE;

const BEGIN_BYTES = Buffer.from(BEGIN_TOKEN, "ascii");
const END_BYTES = Buffer.from(END_TOKEN, "ascii");

const LF = 0x0a;
const CR = 0x0d;

// Split into byte lines. A line ends at LF, optionally preceded by CR (review-packet.md:162 names
// both forms). `contentEnd` excludes the terminator; `termLen` is 2 for CRLF, 1 for a bare LF, and 0
// for a final line the capture ended without terminating. Nothing is decoded.
export function scanLines(buffer) {
  const lines = [];
  let start = 0;
  for (let i = 0; i < buffer.length; i += 1) {
    if (buffer[i] !== LF) continue;
    const crlf = i > start && buffer[i - 1] === CR;
    lines.push({ start, contentEnd: crlf ? i - 1 : i, termLen: crlf ? 2 : 1 });
    start = i + 1;
  }
  if (start < buffer.length) lines.push({ start, contentEnd: buffer.length, termLen: 0 });
  return lines;
}

const fault = (kind, message, detail) => Object.freeze({
  ok: false, kind, message, detail: Object.freeze(detail),
});

/**
 * Slice the reviewer's returned batch out of a captured response.
 *
 * @param {Buffer} captured the reviewer process's raw stdout, undecoded
 * @returns {{ok: true, slice: Buffer, from: number, to: number, beginLine: number, endLine: number}
 *          |{ok: false, kind: string, message: string, detail: object}}
 */
export function sliceReviewBatch(captured) {
  if (!Buffer.isBuffer(captured)) {
    throw new TypeError(
      "sliceReviewBatch takes a Buffer: the captured reviewer response must reach this function "
      + "undecoded, because decoding it would already have changed the bytes under test",
    );
  }

  const lines = scanLines(captured);
  const beginAt = [];
  const endAt = [];
  for (let n = 0; n < lines.length; n += 1) {
    // "each a line whose content is exactly that token" (review-packet.md:160-161). EXACTLY: a
    // leading BOM, a leading space, or any trailing byte makes the line something else, so it is not
    // a sentinel at all. That is why a BOM before BEGIN surfaces as `missing` rather than as its own
    // fault kind — there is simply no BEGIN line.
    const content = captured.subarray(lines[n].start, lines[n].contentEnd);
    if (content.equals(BEGIN_BYTES)) beginAt.push(n);
    else if (content.equals(END_BYTES)) endAt.push(n);
  }

  const counts = { begin: beginAt.length, end: endAt.length };
  const where = { beginLines: [...beginAt], endLines: [...endAt], lineCount: lines.length };

  if (counts.begin > 1 || counts.end > 1) {
    return fault("duplicated",
      `the response carries ${counts.begin} BEGIN and ${counts.end} END sentinel lines; exactly one of each is required`,
      { counts, ...where });
  }
  if (counts.begin === 0 || counts.end === 0) {
    return fault("missing",
      `the response carries ${counts.begin} BEGIN and ${counts.end} END sentinel lines; exactly one of each is required`,
      { counts, ...where });
  }
  if (endAt[0] < beginAt[0]) {
    return fault("misordered",
      `the END sentinel is on line ${endAt[0]} and BEGIN on line ${beginAt[0]}; BEGIN must come first`,
      { counts, ...where });
  }

  const open = beginAt[0];
  const close = endAt[0];
  // From the first byte AFTER BEGIN's own terminator, to the byte immediately BEFORE the terminator
  // that precedes END. That preceding terminator belongs to the line before END, so its content end
  // IS the exclusive upper bound — and it is neither retained nor re-added (review-packet.md:162-164).
  const from = lines[open].contentEnd + lines[open].termLen;
  const to = lines[close - 1].contentEnd;

  if (to <= from) {
    return fault("empty",
      "the byte range between the sentinels is empty; there is no batch document to persist",
      { counts, ...where, from, to });
  }

  // A COPY, not a view. The slice is evidence whose digest is compared against the persisted file and
  // against the admission's `reviewRawDigest`; a view would alias the capture buffer and could be
  // mutated behind the receipt's back.
  return Object.freeze({
    ok: true,
    slice: Buffer.from(captured.subarray(from, to)),
    from,
    to,
    beginLine: open,
    endLine: close,
  });
}
