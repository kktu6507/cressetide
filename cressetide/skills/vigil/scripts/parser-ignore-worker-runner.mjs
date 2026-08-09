// Worker lifecycle for the vendored parser / ignore engines.
//
// Owns three things and nothing else: choosing the execArgv the platform actually supports,
// starting one worker per job from in-memory entry bytes, and serializing every job through a
// single lane so at most one worker is alive at a time. All operational numbers (resource limits,
// timeouts) are passed in by the coordinator, which reads them from the shipped manifest; this
// file restates none of them.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Worker } from "node:worker_threads";

export class WorkerRunnerError extends Error {
  constructor(code, message, detail) {
    super(message);
    this.name = "WorkerRunnerError";
    this.code = code;
    if (detail !== undefined) this.detail = detail;
  }
}

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const WORKER_ENTRY_PATH = path.join(HERE, "parser-ignore-worker.mjs");

// The coordinator reads the worker's own bytes so the worker -- which runs without filesystem
// authority -- never has to read its own entry file.
let cachedEntry = null;
export function readWorkerEntry() {
  if (cachedEntry === null) cachedEntry = fs.readFileSync(WORKER_ENTRY_PATH, "utf8");
  return cachedEntry;
}

// Node 22+ spells the permission model --permission; Node 20 spells it --experimental-permission.
// Neither present means this build cannot give the worker least authority, which is a fail-closed
// condition rather than something to run without.
export function resolveExecArgv(allowedFlags = process.allowedNodeEnvironmentFlags) {
  const has = (flag) => allowedFlags.has(flag);
  let permission = null;
  if (has("--permission")) permission = "--permission";
  else if (has("--experimental-permission")) permission = "--experimental-permission";
  if (permission === null) {
    throw new WorkerRunnerError("E_ENV_UNSUPPORTED",
      "this Node build supports neither --permission nor --experimental-permission, so the dependency worker cannot be run with least authority");
  }
  if (!has("--experimental-vm-modules")) {
    throw new WorkerRunnerError("E_ENV_UNSUPPORTED",
      "this Node build does not support --experimental-vm-modules, so the vendored ESM parser cannot be evaluated in an isolated context");
  }
  // Explicit and complete: the worker inherits no flags from the parent process.
  const argv = [permission, "--experimental-vm-modules"];
  if (has("--no-warnings")) argv.push("--no-warnings");
  return argv;
}

// --- concurrency-one lane -------------------------------------------------------------------------

let lane = Promise.resolve();
let active = 0;
let peakActive = 0;

export function laneStats() {
  return { active, peakActive };
}
export function resetLaneStats() {
  peakActive = active;
}

// A rejected job settles the lane without poisoning it: the next caller queues behind a resolved
// promise, not a rejected one.
export function serialize(job) {
  const run = lane.then(async () => {
    active += 1;
    if (active > peakActive) peakActive = active;
    try {
      return await job();
    } finally {
      active -= 1;
    }
  });
  lane = run.then(() => undefined, () => undefined);
  return run;
}

// --- one worker per job ----------------------------------------------------------------------------

function entryUrl(source) {
  return new URL(`data:text/javascript,${encodeURIComponent(source)}`);
}

// Settles on exit rather than on the first message. That is what makes "the worker sent a second
// message" detectable at all: settling early would consume message one and never see message two.
export function runWorkerJob({ workerData, resourceLimits, timeoutMs, execArgv, workerSource }) {
  return serialize(() => new Promise((resolve, reject) => {
    const source = workerSource ?? readWorkerEntry();
    let settled = false;
    let timer = null;
    let worker = null;
    const messages = [];

    const settle = (fn, value) => {
      if (settled) return;
      settled = true;
      if (timer !== null) { clearTimeout(timer); timer = null; }
      if (worker !== null) {
        worker.removeAllListeners();
        worker.terminate().catch(() => {});
      }
      fn(value);
    };

    try {
      worker = new Worker(entryUrl(source), {
        execArgv,
        env: {},
        resourceLimits,
        workerData,
        stdin: false,
      });
    } catch (e) {
      return settle(reject, new WorkerRunnerError("E_WORKER_SPAWN", `could not start the dependency worker: ${e.message}`));
    }

    timer = setTimeout(() => {
      settle(reject, new WorkerRunnerError("E_WORKER_TIMEOUT", `the dependency worker exceeded its ${timeoutMs} ms wall budget`, { timeoutMs }));
    }, timeoutMs);
    if (typeof timer.unref === "function") timer.unref();

    worker.on("message", (message) => messages.push(message));
    worker.on("messageerror", (e) => settle(reject, new WorkerRunnerError("E_WORKER_MESSAGE", `the dependency worker sent an undeserializable message: ${e.message}`)));
    worker.on("error", (e) => settle(reject, new WorkerRunnerError("E_WORKER_ERROR", `the dependency worker threw: ${e.message}`)));
    worker.on("exit", (code) => {
      if (messages.length === 0) {
        return settle(reject, new WorkerRunnerError("E_WORKER_EXIT", `the dependency worker exited with code ${code} without producing a result`, { code }));
      }
      if (messages.length > 1) {
        return settle(reject, new WorkerRunnerError("E_WORKER_MESSAGE", `the dependency worker sent ${messages.length} messages; exactly one is the protocol`, { count: messages.length }));
      }
      const message = messages[0];
      if (message === null || typeof message !== "object" || typeof message.ok !== "boolean") {
        return settle(reject, new WorkerRunnerError("E_WORKER_RESULT", "the dependency worker returned a malformed result envelope"));
      }
      if (message.ok === false) {
        const error = message.error || {};
        return settle(reject, new WorkerRunnerError(typeof error.code === "string" ? error.code : "E_WORKER_RESULT",
          typeof error.message === "string" ? error.message : "the dependency worker reported an unspecified failure", error.detail));
      }
      if (message.result === null || typeof message.result !== "object") {
        return settle(reject, new WorkerRunnerError("E_WORKER_RESULT", "the dependency worker returned no result body"));
      }
      settle(resolve, message.result);
    });
  }));
}
