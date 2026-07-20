import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

export const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export function temporary(prefix = "ctide-test-") {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

export function run(command, args, options = {}) {
  return spawnSync(command, args, {
    cwd: options.cwd || root,
    encoding: "utf8",
    timeout: options.timeout || 10000,
    input: options.input,
    env: { ...process.env, ...(options.env || {}) },
  });
}

export function runHook(name, event, options = {}) {
  const cwd = options.cwd || temporary();
  const result = run(process.execPath, [path.join(root, "cressetide", "hooks", name)], {
    cwd,
    input: typeof event === "string" ? event : JSON.stringify(event),
    env: { CLAUDE_PROJECT_DIR: cwd, ...(options.env || {}) },
  });
  let output = null;
  if (result.stdout.trim()) output = JSON.parse(result.stdout);
  return { ...result, output, cwd };
}

export function write(file, content) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content, "utf8");
}

export function hardenGitSigning(cwd) {
  for (const args of [["config", "commit.gpgsign", "false"], ["config", "tag.gpgSign", "false"]]) {
    const result = spawnSync("git", args, { cwd, encoding: "utf8" });
    if (result.error || result.status !== 0) {
      throw new Error(`hardenGitSigning: git ${args.join(" ")} failed in ${cwd}: ${result.error || result.stderr}`);
    }
  }
}
