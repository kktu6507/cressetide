// Offline parser for Claude Code `--output-format stream-json` transcripts, used by the
// L1b measurement driver. Pure: no I/O, no process access, no network, no side effects on
// import.
//
// METADATA ONLY. The returned record never carries message text, thinking, tool inputs, or
// command content — only names, counts, identifiers, durations and numbers.
//
// Usage/cost scope (https://code.claude.com/docs/en/agent-sdk/cost-tracking):
//   * the result's `usage` covers the main loop only;
//   * `modelUsage` and `total_cost_usd` cover the whole query, INCLUDING children;
//   * per-message `output_tokens` is a placeholder — the final result is authoritative, so
//     per-message numbers are kept for diagnostics and are never summed;
//   * `total_cost_usd` and per-model `costUSD` are client-side estimates computed from the
//     CLI's bundled pricing table. They are not provider billing.
// Because the two surfaces have different scopes, a generic record must NOT require them to
// agree when child activity exists. Equality is asserted only by `strictZeroChildFaults()`,
// which applies to the L1b strict zero-child profile where the scopes are expected to
// coincide. Child cost attribution is not supported by this parser.

export const COST_BASIS = 'cli-bundled-price-table-estimate'
export const CHILD_ATTRIBUTION = 'unsupported'

const TOKEN_ALIASES = Object.freeze({
  inputTokens: ['input_tokens', 'inputTokens'],
  cacheCreationInputTokens: ['cache_creation_input_tokens', 'cacheCreationInputTokens'],
  cacheReadInputTokens: ['cache_read_input_tokens', 'cacheReadInputTokens'],
  outputTokens: ['output_tokens', 'outputTokens'],
})

export const TOKEN_KEYS = Object.freeze(Object.keys(TOKEN_ALIASES))

// The real CLI 2.1.263 `subagent_stats` shape: named counters, several of which overlap.
// `spawned` alone is the child COUNT; the others are activity evidence and must never be
// summed with it or with each other, and never enter a cost figure.
export const SUBAGENT_COUNTER_PATHS = Object.freeze([
  'spawned',
  'completed',
  'failed',
  'spawned_by_subagents',
  'started_in_background',
  'max_depth',
  'requested.background',
  'requested.foreground',
  'requested.unset',
  'killed.parent',
  'killed.user',
  'killed.system',
  'refused.depth_limit',
  'refused.concurrency_limit',
  'refused.budget',
])

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function pick(source, aliases) {
  for (const key of aliases) {
    if (Object.prototype.hasOwnProperty.call(source, key)) return source[key]
  }
  return undefined
}

function getPath(source, dotted) {
  let cursor = source
  for (const key of dotted.split('.')) {
    if (!isPlainObject(cursor)) return undefined
    cursor = cursor[key]
  }
  return cursor
}

// A missing non-negative numeric field is `null`, never 0. A present-but-invalid field is
// also `null` and additionally records a fault, so an invalid value can never be mistaken
// for a measured zero.
function readCountValue(raw, label, faults) {
  if (raw === undefined || raw === null) return null
  if (typeof raw !== 'number' || !Number.isFinite(raw)) {
    faults.push(`non-numeric:${label}`)
    return null
  }
  if (!Number.isInteger(raw)) {
    faults.push(`non-integer:${label}`)
    return null
  }
  if (raw < 0) {
    faults.push(`negative:${label}`)
    return null
  }
  return raw
}

function readCount(source, aliases, label, faults) {
  return readCountValue(pick(source, aliases), label, faults)
}

function readAmount(source, aliases, label, faults) {
  const raw = pick(source, aliases)
  if (raw === undefined || raw === null) return null
  if (typeof raw !== 'number' || !Number.isFinite(raw)) {
    faults.push(`non-numeric:${label}`)
    return null
  }
  if (raw < 0) {
    faults.push(`negative:${label}`)
    return null
  }
  return raw
}

function blankTokens() {
  const out = {}
  for (const key of TOKEN_KEYS) out[key] = null
  return out
}

export function readTokenBlock(source, label, faults) {
  if (!isPlainObject(source)) return null
  const out = {}
  for (const key of TOKEN_KEYS) {
    out[key] = readCount(source, TOKEN_ALIASES[key], `${label}.${key}`, faults)
  }
  return out
}

/**
 * Three states, never two. `absent` means the field was not emitted; `unrecognized` means it
 * was emitted in a shape this parser does not understand. Neither may read as "no children".
 */
export function readSubagentStats(raw, faults) {
  const blank = { evidence: 'absent', spawned: null, counters: null, byTypeKeys: null, activity: null }
  if (raw === undefined || raw === null) return blank
  if (!isPlainObject(raw)) return { ...blank, evidence: 'unrecognized' }

  const counters = {}
  let recognized = 0
  for (const dotted of SUBAGENT_COUNTER_PATHS) {
    const value = getPath(raw, dotted)
    if (value === undefined) {
      counters[dotted] = null
      continue
    }
    counters[dotted] = readCountValue(value, `subagent_stats.${dotted}`, faults)
    recognized += 1
  }
  const byType = raw.by_type ?? raw.byType
  const byTypeKeys = isPlainObject(byType) ? Object.keys(byType).sort() : null
  if (recognized === 0 && byTypeKeys === null) return { ...blank, evidence: 'unrecognized' }

  const activity =
    SUBAGENT_COUNTER_PATHS.some((dotted) => typeof counters[dotted] === 'number' && counters[dotted] > 0) ||
    (byTypeKeys !== null && byTypeKeys.length > 0)

  return { evidence: 'counters', spawned: counters.spawned, counters, byTypeKeys, activity }
}

// Shared JSONL splitter (also used by protocol.extractStructuredOutput) so the raw stream is
// tokenized exactly one way. Tolerates CRLF and blank lines; reports unparseable lines.
export function splitJsonLines(text) {
  const events = []
  let malformed = 0
  for (const line of String(text ?? '').split('\n')) {
    const raw = line.endsWith('\r') ? line.slice(0, -1) : line
    if (raw.trim() === '') continue
    let parsed
    try {
      parsed = JSON.parse(raw)
    } catch {
      malformed += 1
      continue
    }
    if (!isPlainObject(parsed)) {
      malformed += 1
      continue
    }
    events.push(parsed)
  }
  return { events, malformed }
}

// A present-but-malformed list is UNRECOGNIZED, never silently reduced to an empty list: an
// element this parser cannot read means the surface is unknown, not deliberately empty.
export const UNRECOGNIZED_LIST = 'unrecognized'

function summarizeInit(event) {
  const names = (value) => {
    if (!Array.isArray(value)) return null
    const out = []
    for (const entry of value) {
      if (typeof entry === 'string') {
        out.push(entry)
        continue
      }
      if (isPlainObject(entry) && typeof entry.name === 'string') {
        out.push(typeof entry.status === 'string' ? `${entry.name}:${entry.status}` : entry.name)
        continue
      }
      return UNRECOGNIZED_LIST
    }
    return out.sort()
  }
  const str = (value) => (typeof value === 'string' ? value : null)
  return {
    model: str(event.model),
    permissionMode: str(event.permissionMode) ?? str(event.permission_mode),
    apiKeySource: str(event.apiKeySource) ?? str(event.apiKeySource),
    outputStyle: str(event.output_style) ?? str(event.outputStyle),
    cwd: str(event.cwd),
    tools: names(event.tools),
    agents: names(event.agents),
    plugins: names(event.plugins),
    mcpServers: names(event.mcp_servers) ?? names(event.mcpServers),
    slashCommands: names(event.slash_commands) ?? names(event.slashCommands),
  }
}

function summarizeResult(event, faults) {
  const modelUsage = {}
  const rawModelUsage = event.modelUsage ?? event.model_usage
  if (isPlainObject(rawModelUsage)) {
    for (const [model, entry] of Object.entries(rawModelUsage)) {
      const tokens = readTokenBlock(entry, `modelUsage.${model}`, faults) ?? blankTokens()
      modelUsage[model] = {
        ...tokens,
        costUsd: isPlainObject(entry)
          ? readAmount(entry, ['costUSD', 'costUsd', 'cost_usd'], `modelUsage.${model}.costUSD`, faults)
          : null,
        costBasis: isPlainObject(entry) && typeof entry.costBasis === 'string' ? entry.costBasis : null,
        provider: isPlainObject(entry) && typeof entry.provider === 'string' ? entry.provider : null,
      }
    }
  }

  return {
    subtype: typeof event.subtype === 'string' ? event.subtype : null,
    isError: event.is_error === true || event.isError === true,
    numTurns: readCount(event, ['num_turns', 'numTurns'], 'result.num_turns', faults),
    durationMs: readCount(event, ['duration_ms', 'durationMs'], 'result.duration_ms', faults),
    durationApiMs: readCount(event, ['duration_api_ms', 'durationApiMs'], 'result.duration_api_ms', faults),
    totalCostUsd: readAmount(event, ['total_cost_usd', 'totalCostUsd'], 'result.total_cost_usd', faults),
    costBasis: COST_BASIS,
    usage: readTokenBlock(event.usage, 'result.usage', faults),
    modelUsage,
    subagent: readSubagentStats(event.subagent_stats ?? event.subagentStats, faults),
    permissionDenialCount: Array.isArray(event.permission_denials) ? event.permission_denials.length : null,
    structuredOutputPresent:
      event.structured_output !== undefined || event.structuredOutput !== undefined,
  }
}

/**
 * Parse one transcript into a metadata-only record.
 * `ok` is true only when the transcript is a single well-formed init/result/session with a
 * successful terminal. A malformed, duplicated, error or missing terminal keeps whatever
 * cost is known on the record and blocks success.
 */
export function parseStream(text) {
  const faults = []
  const { events, malformed } = splitJsonLines(text)
  if (malformed > 0) faults.push('malformed-json-line')
  if (events.length === 0) faults.push('no-events')

  const initEvents = events.filter((e) => e.type === 'system' && e.subtype === 'init')
  const resultEvents = events.filter((e) => e.type === 'result')
  if (initEvents.length === 0) faults.push('missing-init')
  if (initEvents.length > 1) faults.push('duplicate-init')
  if (resultEvents.length === 0) faults.push('missing-result')
  if (resultEvents.length > 1) faults.push('duplicate-result')

  const firstResultIndex = events.findIndex((e) => e.type === 'result')
  if (firstResultIndex >= 0 && firstResultIndex !== events.length - 1) faults.push('events-after-result')

  // Fresh-session binding: the two REQUIRED events must each carry their own non-empty id and
  // must agree. A terminal with no id is never attributed from init (or the reverse); auxiliary
  // statistics events may omit it.
  const idOf = (event) => {
    const id = event?.session_id ?? event?.sessionId
    return typeof id === 'string' && id !== '' ? id : null
  }
  const sessionIds = new Set()
  for (const event of events) {
    const id = idOf(event)
    if (id !== null) sessionIds.add(id)
  }
  const initSession = initEvents.length === 1 ? idOf(initEvents[0]) : null
  const resultSession = resultEvents.length >= 1 ? idOf(resultEvents[0]) : null
  if (initEvents.length === 1 && initSession === null) faults.push('init-session-id-missing')
  if (resultEvents.length >= 1 && resultSession === null) faults.push('result-session-id-missing')
  if (sessionIds.size > 1) faults.push('session-id-inconsistent')
  const boundSession =
    initSession !== null && initSession === resultSession && sessionIds.size === 1 ? initSession : null

  const observedTools = new Set()
  const messageOutputs = new Map()
  let childActivity = false
  for (const event of events) {
    const parent = event.parent_tool_use_id ?? event.parentToolUseId
    if (parent !== undefined && parent !== null) childActivity = true
    if (event.type !== 'assistant') continue
    const message = event.message
    if (!isPlainObject(message)) continue
    if (typeof message.id === 'string' && message.id !== '') {
      const seen = messageOutputs.get(message.id) ?? { id: message.id, samples: 0, lastOutputTokens: null }
      seen.samples += 1
      // Per-message usage is a documented placeholder: read it for diagnostics with a
      // throwaway fault sink, never sum it, and never let it fault the record.
      const tokens = readTokenBlock(message.usage, 'message.usage', [])
      seen.lastOutputTokens = tokens ? tokens.outputTokens : null
      messageOutputs.set(message.id, seen)
    }
    const content = Array.isArray(message.content) ? message.content : []
    for (const part of content) {
      if (!isPlainObject(part)) continue
      if (part.type !== 'tool_use' && part.type !== 'server_tool_use') continue
      if (typeof part.name === 'string') observedTools.add(part.name)
    }
  }
  if (observedTools.has('Task')) childActivity = true

  const init = initEvents.length === 1 ? summarizeInit(initEvents[0]) : null
  const result = resultEvents.length >= 1 ? summarizeResult(resultEvents[0], faults) : null
  if (result) {
    if (result.isError) faults.push('result-is-error')
    if (result.subtype !== 'success') faults.push('result-subtype-not-success')
    // Only positive counters are child evidence. `absent` and `unrecognized` are unknown, and
    // unknown must not read as "no children" — `strictZeroChildFaults` handles that.
    if (result.subagent.activity === true) childActivity = true
  }

  return {
    ok: faults.length === 0,
    faults,
    malformedLines: malformed,
    eventCount: events.length,
    sessionId: boundSession,
    childActivity,
    childAttribution: CHILD_ATTRIBUTION,
    init,
    result,
    observedTools: [...observedTools].sort(),
    assistantMessages: [...messageOutputs.values()],
  }
}

/**
 * Faults specific to the L1b strict profile: exactly one expected model, no child activity,
 * and main-loop `usage` equal to whole-query `modelUsage` (which is only expected to hold
 * when there are no children). Returning a non-empty list halts the NEXT paid dispatch; it
 * does not erase an already recorded semantic grade, and it does not prove that whole-tree
 * accounting is impossible in general.
 *
 * `subagent_stats` absent is NOT a fault: the zero-child scope rests on the deliberately
 * closed `--tools` surface, with the counters as corroboration when the CLI emits them.
 * An unrecognized shape IS a fault, because we then know nothing.
 */
export function strictZeroChildFaults(record, options = {}) {
  const expectedModel = options.expectedModel
  if (!record || !record.result) return ['strict-no-result']

  const faults = []
  if (record.childActivity) faults.push('strict-child-activity')

  const subagent = record.result.subagent
  if (subagent.evidence === 'unrecognized') faults.push('strict-subagent-stats-unrecognized')
  if (subagent.evidence === 'counters' && subagent.spawned === null) faults.push('strict-subagent-spawned-unknown')
  if (subagent.evidence === 'counters' && typeof subagent.spawned === 'number' && subagent.spawned > 0) {
    faults.push(`strict-subagent-spawned:${subagent.spawned}`)
  }

  const models = Object.keys(record.result.modelUsage)
  if (models.length === 0) faults.push('strict-model-usage-missing')
  if (models.length > 1) faults.push('strict-multiple-models')
  if (typeof expectedModel === 'string' && expectedModel !== '') {
    for (const model of models) {
      if (model !== expectedModel) faults.push(`strict-unexpected-model:${model}`)
    }
  }

  if (!record.result.usage) {
    faults.push('strict-usage-missing')
  } else if (models.length === 1) {
    const mainLoop = record.result.usage
    const wholeQuery = record.result.modelUsage[models[0]]
    for (const key of TOKEN_KEYS) {
      if (mainLoop[key] === null || wholeQuery[key] === null) {
        faults.push(`strict-incomparable:${key}`)
        continue
      }
      if (mainLoop[key] !== wholeQuery[key]) faults.push(`strict-scope-mismatch:${key}`)
    }
  }

  return faults
}

/**
 * Faults from comparing the `init` event against the frozen expectation. `init` in CLI
 * 2.1.263 does not report a selected agent identity or system prompt, so this checks only
 * what it does report — and every required field must be PRESENT: a missing field is a fault,
 * never a silent pass. It runs after the call, so it blocks the next dispatch rather than
 * preventing the current one.
 */
export function initFaults(record, expectation = {}) {
  if (!record || !record.init) return ['init-missing']
  const init = record.init
  const faults = []

  if (init.model === null) faults.push('init-model-missing')
  else if (typeof expectation.model === 'string' && init.model !== expectation.model) {
    faults.push(`init-model:${init.model}`)
  }

  // Optional, and only meaningful when the caller pins it: the CLI reports the canonical mode,
  // which may differ in name from the alias that was requested on the command line.
  if (typeof expectation.permissionMode === 'string') {
    if (init.permissionMode === null) faults.push('init-permission-mode-missing')
    else if (init.permissionMode !== expectation.permissionMode) {
      faults.push(`init-permission-mode:${init.permissionMode}`)
    }
  }

  const allowed = Array.isArray(expectation.tools) ? new Set(expectation.tools) : null
  if (init.tools === null) faults.push('init-tools-missing')
  else if (init.tools === UNRECOGNIZED_LIST) faults.push('init-tools-unrecognized')
  else if (allowed !== null) {
    for (const tool of init.tools) {
      if (!allowed.has(tool)) faults.push(`init-unexpected-tool:${tool}`)
    }
  }
  if (allowed !== null) {
    for (const tool of record.observedTools) {
      if (!allowed.has(tool)) faults.push(`observed-unexpected-tool:${tool}`)
    }
  }

  for (const [field, key] of [
    ['mcpServers', 'mcp'],
    ['slashCommands', 'slash-commands'],
    ['plugins', 'plugins'],
  ]) {
    if (init[field] === null) faults.push(`init-${key}-missing`)
    else if (init[field] === UNRECOGNIZED_LIST) faults.push(`init-${key}-unrecognized`)
    else if (init[field].length > 0) faults.push(`init-${key}-not-empty`)
  }

  return faults
}
