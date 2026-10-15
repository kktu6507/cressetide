// The PreToolUse guards, and the one order they run in. Node built-ins only; no subprocess.
import { contract } from "./contract.mjs";
import { destructive } from "./destructive.mjs";
import { planGate } from "./plan-gate.mjs";

export { contract, destructive, planGate };

// The checks a PreToolUse event goes through, in order. The plan gate is first: it is the only one that
// denies, and a deny outranks an ask, so a plan-mode write that also looks destructive is denied, not
// asked about. destructive (Bash/PowerShell) and contract (Write/Edit) never see the same tool.
export const PRE_TOOL_USE_CHECKS = Object.freeze([
  ["plan-gate", planGate],
  ["destructive-guard", destructive],
  ["contract-guard", contract],
]);

const noDebug = () => {};

// The first decision among the checks, as { decision, reason, check }, or null when none has one (never
// an allow: that is left to Claude Code). Each check runs in its own try/catch, so one that throws is
// skipped — fail-open for that check only — and the checks after it still run. Options (debug, home) are
// passed through to every check.
export function preToolUse(input, options = {}) {
  const debug = options.debug || noDebug;
  for (const [check, run] of PRE_TOOL_USE_CHECKS) {
    let result = null;
    try {
      result = run(input, options);
    } catch (error) {
      try { debug(check, "error: " + (error?.message ?? error)); } catch { /* diagnostics only */ }
    }
    if (result) return { ...result, check };
  }
  return null;
}
