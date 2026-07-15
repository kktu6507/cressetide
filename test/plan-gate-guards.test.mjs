// Behavioral tests for the PreToolUse guard hooks: plan-gate (plan-mode write gate), destructive-guard
// (all-modes ask on unrecoverable commands), and contract-guard (contract.md / design.md tripwire).
// Split from test/hooks.test.mjs with test bodies preserved; the per-hook opt-out suites are
// table-driven). Hooks are CLI scripts that read a JSON event on stdin; we spawn them the same way
// Claude Code does.
import { test } from "node:test";
import assert from "node:assert";
import cp from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  CGUARD, DGUARD, GATE, HOOKS,
  cguard, contractMd, contractPath, dguard, gate, gateInProject, isolatedHome,
  mkCGuardProject, mkProjectWithSettings, runHook, writeContract,
} from "./support.mjs";

// --- plan-gate: anchoring + tool coverage ---

test("B3: repo-local .claude/plans path is NOT exempt (denied in plan mode)", () => {
  const repoPlan = path.join(os.tmpdir(), "somerepo", ".claude", "plans", "notes.md");
  assert.strictEqual(gate({ tool_name: "Write", permission_mode: "plan", tool_input: { file_path: repoPlan } }), "DENY");
});

test("home ~/.claude/plans path IS exempt (isolated home)", (t) => {
  const { home, env } = isolatedHome();
  t.after(() => { try { fs.rmSync(home, { recursive: true, force: true }); } catch (e) {} });
  const homePlan = path.join(home, ".claude", "plans", "plan-x.md");
  assert.strictEqual(gate({ tool_name: "Write", permission_mode: "plan", tool_input: { file_path: homePlan } }, env), "ALLOW");
});

test("plan-gate: a junction under ~/.claude/plans whose target escapes is NOT exempt (denied)", (t) => {
  // realpathDeepest must resolve a symlink/junction so a "plans"-named link can't redirect
  // a write outside the exemption. Uses a junction (no admin needed on Windows); EPERM-skip.
  // Isolated home so it never creates/writes the developer's real ~/.claude/plans.
  const { home, env } = isolatedHome();
  t.after(() => { try { fs.rmSync(home, { recursive: true, force: true }); } catch (e) {} });
  const plansDir = path.join(home, ".claude", "plans");
  let link;
  try {
    fs.mkdirSync(plansDir, { recursive: true });
    const target = fs.mkdtempSync(path.join(os.tmpdir(), "ctide-escape-"));
    link = path.join(plansDir, "ctide-test-junction");
    fs.symlinkSync(target, link, "junction");
  } catch (e) {
    return t.skip("cannot create a junction here: " + (e && e.code));
  }
  const escaped = path.join(link, "escaped.ts"); // resolves to <target>/escaped.ts, outside plans
  assert.strictEqual(
    gate({ tool_name: "Write", permission_mode: "plan", tool_input: { file_path: escaped } }, env),
    "DENY",
    "a junction whose target escapes ~/.claude/plans must not be exempt"
  );
});

test("plan-gate: a symlinked HOME still exempts ~/.claude/plans (realpath BOTH sides)", (t) => {
  // The exemption compares realpath(target) against realpath(~/.claude/plans). If HOME itself is
  // reached through a symlink (e.g. macOS, where the temp dir resolves via /var -> /private/var, or
  // any symlinked home), the root must be resolved too or the legitimate plan write is wrongly denied.
  // Fails on every platform if only the target is realpath-resolved. Skip where a dir symlink can't be
  // created (Windows without privilege).
  const realHome = fs.mkdtempSync(path.join(os.tmpdir(), "ctide-realhome-"));
  const linkParent = fs.mkdtempSync(path.join(os.tmpdir(), "ctide-linkhome-"));
  const linkHome = path.join(linkParent, "home-link");
  t.after(() => {
    try { fs.rmSync(realHome, { recursive: true, force: true }); } catch (e) {}
    try { fs.rmSync(linkParent, { recursive: true, force: true }); } catch (e) {}
  });
  try {
    fs.mkdirSync(path.join(realHome, ".claude", "plans"), { recursive: true });
    fs.symlinkSync(realHome, linkHome, "dir");
  } catch (e) {
    return t.skip("cannot create a directory symlink here: " + (e && e.code));
  }
  const env = { ...process.env, HOME: linkHome, USERPROFILE: linkHome };
  delete env.CLAUDE_PROJECT_DIR;
  const planFile = path.join(linkHome, ".claude", "plans", "p.md"); // under the SYMLINKED home
  assert.strictEqual(
    gate({ tool_name: "Write", permission_mode: "plan", tool_input: { file_path: planFile } }, env),
    "ALLOW",
    "a plan file under a symlinked home's ~/.claude/plans must stay exempt"
  );
});

test("plan-gate: on a case-sensitive FS, an uppercase ~/.claude/PLANS path is NOT exempt", (t) => {
  // The exemption folds case only on case-insensitive filesystems (Windows/macOS). On Linux a
  // real directory literally named PLANS must not inherit the lowercase 'plans' exemption.
  if (process.platform === "win32" || process.platform === "darwin") return t.skip("case-insensitive FS");
  const { home, env } = isolatedHome();
  t.after(() => { try { fs.rmSync(home, { recursive: true, force: true }); } catch (e) {} });
  const upper = path.join(home, ".claude", "PLANS", "x.md");
  assert.strictEqual(gate({ tool_name: "Write", permission_mode: "plan", tool_input: { file_path: upper } }, env), "DENY",
    "uppercase PLANS must not be exempt on a case-sensitive FS");
});

test("plan-gate: on a case-insensitive FS, an uppercase ~/.claude/PLANS path IS exempt (same dir)", (t) => {
  // Mirror of the case-sensitive test: empirical FS detection must treat PLANS == plans on a
  // case-insensitive volume (Windows/macOS), so a home-dir plan file under either casing is exempt.
  if (process.platform !== "win32" && process.platform !== "darwin") return t.skip("case-sensitive FS");
  const { home, env } = isolatedHome();
  t.after(() => { try { fs.rmSync(home, { recursive: true, force: true }); } catch (e) {} });
  fs.mkdirSync(path.join(home, ".claude", "plans"), { recursive: true }); // the probe samples this subtree
  const upper = path.join(home, ".claude", "PLANS", "plan-x.md");
  assert.strictEqual(gate({ tool_name: "Write", permission_mode: "plan", tool_input: { file_path: upper } }, env), "ALLOW",
    "uppercase PLANS must be exempt on a case-insensitive FS (it is the same directory as plans)");
  // The case-fold is scoped to the plans root: a same-home NON-plans uppercase path stays denied.
  const notes = path.join(home, ".claude", "NOTES", "x.md");
  assert.strictEqual(gate({ tool_name: "Write", permission_mode: "plan", tool_input: { file_path: notes } }, env), "DENY",
    "case-folding must be scoped to the plans root, not blanket-lowercasing every path into exemption");
});

test("normal file write is denied in plan mode, allowed otherwise", () => {
  const f = path.join(os.tmpdir(), "proj", "src", "app.ts");
  assert.strictEqual(gate({ tool_name: "Write", permission_mode: "plan", tool_input: { file_path: f } }), "DENY");
  assert.strictEqual(gate({ tool_name: "Write", permission_mode: "default", tool_input: { file_path: f } }), "ALLOW");
});

test("NotebookEdit is gated in plan mode", () => {
  const nb = path.join(os.tmpdir(), "proj", "nb.ipynb");
  assert.strictEqual(gate({ tool_name: "NotebookEdit", permission_mode: "plan", tool_input: { notebook_path: nb } }), "DENY");
});

test("Edit and MultiEdit are behaviorally gated in plan mode", () => {
  const f = path.join(os.tmpdir(), "proj", "app.ts");
  for (const tool of ["Edit", "MultiEdit"]) {
    assert.strictEqual(gate({ tool_name: tool, permission_mode: "plan", tool_input: { file_path: f } }), "DENY", `${tool} must be denied in plan mode`);
  }
});

test("Read is never gated", () => {
  assert.strictEqual(gate({ tool_name: "Read", permission_mode: "plan", tool_input: { file_path: "/x/y.ts" } }), "ALLOW");
});

test("Bash tripwire: obvious working-tree writes are denied in plan mode", () => {
  for (const command of [
    "echo hello > out.txt",
    "echo more >> log.md",
    "cat a b &> merged.txt",
    "cat a &>> merged.txt",          // &>> append-both
    "printf x | tee notes.txt",
    "printf x | tee -a notes.txt",   // tee -a (flag-skip path)
    "sed -i 's/a/b/' src/app.ts",
    "sed -i.bak 's/a/b/' app.ts",    // -i<suffix> (dominant GNU/BSD form)
    "sed --in-place 's/a/b/' app.ts",// GNU long form
    "git apply fix.patch",
    "echo x > out.txt 2>&1",         // real file redirect alongside a fd dup
    "   echo x > f",                 // leading whitespace (the ^ branch)
    "cat a >> OUTPUT.TXT",           // uppercase path (case-insensitive)
    "echo x > src/out.txt",          // redirect to a path with a directory
    "ls; echo x > f",                // redirect in the second chained command
    "git status; git apply fix.patch", // git apply mid-chain after ;
    "ls && git apply p.patch",       // git apply after &&
    "perl -i -pe 's/a/b/' app.ts",   // perl in-place edit
    "perl -i.bak -pe1 src/app.ts",   // perl -i<suffix>
    "perl -pi -e 's/x/y/' f.txt",    // perl -pi (combined flags)
    "truncate -s 0 build.log",       // truncate resizes/creates a file
    "truncate -s0 f",                // truncate, no space
    "dd if=/dev/zero of=out.bin bs=1 count=1", // dd writing via of=
    "(dd if=/dev/zero of=out.bin bs=1 count=1)", // dd via of= inside a subshell — `(` is an anchor too
    "((dd if=/dev/zero of=out.bin bs=1 count=1))", // nested subshell — the inner `(` still anchors (single-char class, no paren balancing)
    "ln -s ../secret link",          // symlink creation
    "ln target.txt hardlink.txt",    // hard link creation
    "ls; ln -sf a b",                // ln after a chain separator
  ]) {
    assert.strictEqual(gate({ tool_name: "Bash", permission_mode: "plan", tool_input: { command } }), "DENY", `should block: ${command}`);
  }
});

test("Bash tripwire: read-only / benign commands are allowed in plan mode", () => {
  for (const command of [
    "git status",
    "git diff HEAD~1",
    "git log --oneline -20",
    "git checkout main",            // branch nav — intentionally NOT blocked (usability)
    "git restore --staged .",       // intentionally NOT blocked
    "git apply --check fix.patch",  // dry run — writes nothing, exempt
    "git apply --stat fix.patch",   // report-only, exempt
    "ls -la src",
    "cat package.json",
    "rg --files",
    "grep -n 'foo > bar' app.ts",   // '>' is a quoted arg to grep, not a redirect
    "sed -n 'p' app.ts",            // sed without -i is read-only
    "node --check hooks/plan-gate.js",
    "echo hi > /dev/null",          // /dev/null excluded
    "ls 2>&1 | grep x",             // fd dup, not a file write
    "perl -ne 'print if /foo/' app.txt", // perl without -i is read-only
    "perl -pe 's/a/b/' app.txt",    // perl -pe (no -i) writes to stdout, not the file
    "dd if=/dev/zero of=/dev/null bs=1 count=1", // of=/dev/null excluded
    "(dd if=/dev/zero of=/dev/null bs=1 count=1)", // of=/dev/null exemption holds inside a subshell too
    "(dd if=/dev/zero of=NUL bs=1 count=1)", // of=NUL exemption holds inside a subshell too (Windows null device)
    "dd if=disk.img bs=1M | sha256sum", // dd without of= writes stdout, not a file
    "cat truncate.md",              // 'truncate' as an argument, not the command
    "grep -n println src/app.rs",   // 'ln' inside a word is not the ln command
  ]) {
    assert.strictEqual(gate({ tool_name: "Bash", permission_mode: "plan", tool_input: { command } }), "ALLOW", `should allow: ${command}`);
  }
});

test("Bash tripwire: only fires in plan mode (a write is allowed outside plan)", () => {
  assert.strictEqual(gate({ tool_name: "Bash", permission_mode: "default", tool_input: { command: "echo x > out.txt" } }), "ALLOW");
});

test("Bash tripwire: documented conservative misses stay allowed (boundary is intentional)", () => {
  // These can write but are deliberately NOT caught — tightening would add false positives
  // (e.g. arithmetic $((a>b))), which the design ranks as worse than a documented miss.
  // The workflow rule (no Bash tree-writes while planning) is the real guarantee, not this gate.
  for (const command of [
    "echo x>f",                     // no-space redirect glued to a word char
    "echo data>>app.log",           // no-space append
    "echo x >| forced.txt",         // >| noclobber-override redirect
    'echo x > "out file.txt"',      // quoted target stripped before the redirect match
    "echo x > $OUT",                // variable redirect target
    "echo can't > a.txt won't",     // paired word-internal apostrophes erase the redirect
  ]) {
    assert.strictEqual(gate({ tool_name: "Bash", permission_mode: "plan", tool_input: { command } }), "ALLOW", `documented miss should stay allowed: ${command}`);
  }
});

test("Bash tripwire: a quoted redirection target is a literal, not a real write", () => {
  assert.strictEqual(gate({ tool_name: "Bash", permission_mode: "plan", tool_input: { command: "echo 'value > threshold'" } }), "ALLOW");
});

test("Bash tripwire: the deny reason names the heuristic and the escape hatch", () => {
  const out = runHook(GATE, { tool_name: "Bash", permission_mode: "plan", tool_input: { command: "sed -i 's/a/b/' app.ts" } });
  assert.match(out, /"deny"/);
  assert.match(out, /best-effort|ExitPlanMode/, "bash deny reason should be actionable");
});

test("malformed stdin fails open (no deny, no crash)", () => {
  const out = cp.execFileSync("node", [GATE], { input: "not json {{{" }).toString();
  assert.strictEqual(out.trim(), "");
});

test("hooks.json PreToolUse matcher actually covers every gated tool", () => {
  const hj = JSON.parse(fs.readFileSync(path.join(HOOKS, "hooks.json"), "utf8"));
  const matcher = hj.hooks.PreToolUse[0].matcher;
  for (const tool of ["Write", "Edit", "MultiEdit", "NotebookEdit", "Bash", "PowerShell"]) {
    assert.ok(new RegExp(`^(?:${matcher})$`).test(tool), `${tool} must be in the matcher (else the gate never fires for it)`);
  }
});

// --- plan-gate: field alias + stdin cap (findings I/J) ---

test("plan-gate honors camelCase permissionMode alias", () => {
  const f = path.join(os.tmpdir(), "proj", "app.ts");
  assert.strictEqual(gate({ tool_name: "Write", permissionMode: "plan", tool_input: { file_path: f } }), "DENY");
});

test("plan-gate fails open (allow) on oversized stdin", () => {
  // The hook caps stdin and exits early, which can EPIPE the parent's write — use
  // spawnSync (tolerant of the early close) and assert it did not deny (fail-open).
  const big = "x".repeat(6 * 1024 * 1024);
  const input = JSON.stringify({ tool_name: "Write", permission_mode: "plan", tool_input: { file_path: "/p/app.ts", content: big } });
  const r = cp.spawnSync("node", [GATE], { input, maxBuffer: 64 * 1024 * 1024 });
  assert.strictEqual((r.stdout || "").toString().includes('"deny"'), false, "over-cap stdin must fail open, not deny");
});

test("plan-gate deny JSON is fully flushed even with a large payload", () => {
  const big = "y".repeat(2 * 1024 * 1024); // under the 5MB cap
  const input = JSON.stringify({ tool_name: "Write", permission_mode: "plan", tool_input: { file_path: "/p/app.ts", content: big } });
  const out = cp.execFileSync("node", [GATE], { input, maxBuffer: 64 * 1024 * 1024 }).toString();
  const j = JSON.parse(out); // must be complete, parseable JSON (not truncated)
  assert.strictEqual(j.hookSpecificOutput.permissionDecision, "deny");
});

// --- plan-gate: project opt-out ---

const PLAN_WRITE = { tool_name: "Write", permission_mode: "plan", tool_input: { file_path: path.join(os.tmpdir(), "proj", "app.ts") } };

// Table-driven: the five same-shape settings-variant tests share one body; each row
// keeps its original test name and assertion message.
for (const row of [
  { name: "plan-gate: ctide.planGate=false in settings.json allows in plan mode",
    settings: { ctide: { planGate: false } }, expected: "ALLOW",
    msg: "the opt-out must disable the gate for this project" },
  { name: "plan-gate: settings.local.json opt-out overrides settings.json",
    settings: { ctide: { planGate: true } },                                  // project: enforce
    localSettings: { ctide: { planGate: false } },                            // local: disable (higher precedence)
    expected: "ALLOW", msg: "the local override must take precedence" },
  { name: "plan-gate: no flag still denies in plan mode (default enforce)",
    settings: { permissions: { allow: [] } },                                  // unrelated settings, no ctide key
    expected: "DENY", msg: "an absent flag must keep the gate on" },
  { name: "plan-gate: planGate=true explicitly enforces (deny)",
    settings: { ctide: { planGate: true } }, expected: "DENY" },
  { name: "plan-gate: malformed project settings fail safe to enforce (deny)",
    settings: "{ not: valid json ", expected: "DENY",
    msg: "a broken settings file must not silently drop the gate" },
]) {
  test(row.name, () => {
    const dir = mkProjectWithSettings(row.settings);
    if (row.localSettings) {
      fs.writeFileSync(path.join(dir, ".claude", "settings.local.json"), JSON.stringify(row.localSettings), "utf8");
    }
    assert.strictEqual(gateInProject(PLAN_WRITE, dir), row.expected, row.msg);
  });
}

test("plan-gate: the opt-out resolves from the event cwd when CLAUDE_PROJECT_DIR is unset", () => {
  const dir = mkProjectWithSettings({ ctide: { planGate: false } });
  const env = { ...process.env }; delete env.CLAUDE_PROJECT_DIR;
  assert.strictEqual(gate({ ...PLAN_WRITE, cwd: dir }, env), "ALLOW", "the cwd fallback must locate the project opt-out");
});

// readPlanGateFlag / planGateDisabledForProject reader-alignment: a bare-false "ctide" value (or a
// bare-false document root) must not collapse into an accidental planGate:false opt-out via
// `cfg && cfg.ctide && cfg.ctide.planGate`'s falsy short-circuit -- `cfg?.ctide?.planGate` only
// short-circuits on null/undefined, so it correctly reads no explicit claim instead.
test("plan-gate: a bare {\"ctide\":false} settings.json on disk does not suppress plan-mode enforcement (readPlanGateFlag must not misread it as planGate:false)", () => {
  const dir = mkProjectWithSettings({ ctide: false });
  assert.strictEqual(gateInProject(PLAN_WRITE, dir), "DENY", "a bare-false ctide value must be a genuine no-op for the opt-out check -- it must not silently disable the plan gate");
});

test("plan-gate: a bare root-level `false` settings.json document also does not suppress plan-mode enforcement", () => {
  const dir = mkProjectWithSettings("false");
  assert.strictEqual(gateInProject(PLAN_WRITE, dir), "DENY");
});

// --- destructive-guard: all-modes "ask" on unrecoverable Bash commands (item 11) ---

test("destructive-guard: ASKS on unrecoverable commands in ANY mode (incl. default — the gap plan-gate misses)", () => {
  for (const command of [
    "git reset --hard HEAD~3",
    "git reset HEAD~1 --hard",          // flag after the ref
    "git push --force",
    "git push -f origin main",
    "git push origin main --force-with-lease",
    "rm -rf build",
    "rm -fr ./dist",                    // -fr order
    "ls && rm -rf node_modules",        // after a chain separator
    "find . -name '*.tmp' -delete",
    "dd if=/dev/zero of=/dev/sda bs=1M",// of=<real device>
    "(dd if=/dev/zero of=/dev/sda bs=1M)", // of=<real device> inside a subshell — `(` anchor
    "mkfs.ext4 /dev/sdb1",
    "shred -u secret.key",
  ]) {
    assert.strictEqual(dguard({ tool_name: "Bash", permission_mode: "default", tool_input: { command } }), "ASK", `should ask: ${command}`);
  }
  // Fires in ALL modes — the same command in plan mode also asks (this is the post-approval gap plan-gate misses).
  assert.strictEqual(dguard({ tool_name: "Bash", permission_mode: "plan", tool_input: { command: "git reset --hard" } }), "ASK");
});

test("destructive-guard: ALLOWS benign / recoverable / quoted commands (narrow deny-list, no FP)", () => {
  for (const command of [
    "git status",
    "git push origin main",            // no force
    "git reset --soft HEAD~1",         // soft reset is recoverable
    "git restore --staged .",          // deferred from v1 — must NOT ask
    "git clean -n",                    // dry-run / deferred from v1
    "rm file.txt",                     // no -rf
    "rm -r dir",                       // -r without -f
    "find . -name '*.tmp'",            // no -delete
    "dd if=disk.img of=/dev/null bs=1M",  // of=/dev/null exempt
    "(dd if=disk.img of=/dev/null bs=1M)", // of=/dev/null exemption holds inside a subshell too
    "echo \"rm -rf /\"",               // quoted literal, not a real command
    "git log --oneline -20",
  ]) {
    assert.strictEqual(dguard({ tool_name: "Bash", permission_mode: "default", tool_input: { command } }), "ALLOW", `should allow: ${command}`);
  }
});

test("destructive-guard: only Bash is in scope (a Write whose content contains rm -rf is never its concern)", () => {
  assert.strictEqual(dguard({ tool_name: "Write", permission_mode: "default", tool_input: { file_path: "/x/y.ts", content: "rm -rf /" } }), "ALLOW");
});

// Table-driven: the three settings-variant tests share one body; each row keeps its
// original test name and assertion message.
for (const row of [
  { name: "destructive-guard: project opt-out ctide.destructiveGuard=false allows",
    settings: { ctide: { destructiveGuard: false } }, command: "git reset --hard", expected: "ALLOW" },
  { name: "destructive-guard: settings.local.json opt-out overrides settings.json",
    settings: { ctide: { destructiveGuard: true } },
    localSettings: { ctide: { destructiveGuard: false } },
    command: "rm -rf x", expected: "ALLOW", msg: "local override must take precedence" },
  { name: "destructive-guard: malformed project settings fail safe to ASK (a broken file never drops the net on a match)",
    settings: "{ not: valid json ", command: "git reset --hard", expected: "ASK",
    msg: "broken settings must fail-closed-to-ask on a matched command" },
]) {
  test(row.name, () => {
    const dir = mkProjectWithSettings(row.settings);
    if (row.localSettings) {
      fs.writeFileSync(path.join(dir, ".claude", "settings.local.json"), JSON.stringify(row.localSettings), "utf8");
    }
    const env = { ...process.env, CLAUDE_PROJECT_DIR: dir };
    assert.strictEqual(dguard({ tool_name: "Bash", permission_mode: "default", tool_input: { command: row.command } }, env), row.expected, row.msg);
  });
}

// readGuardFlag / destructiveGuardDisabledForProject reader-alignment: a bare-false "ctide" value (or
// a bare-false document root) must not collapse into an accidental destructiveGuard:false opt-out via
// `cfg && cfg.ctide && cfg.ctide.destructiveGuard`'s falsy short-circuit -- `cfg?.ctide?.destructiveGuard`
// only short-circuits on null/undefined, so it correctly reads no explicit claim instead.
test("destructive-guard: a bare {\"ctide\":false} settings.json on disk does not suppress the destructive-command ask (readGuardFlag must not misread it as destructiveGuard:false)", () => {
  const dir = mkProjectWithSettings({ ctide: false });
  const env = { ...process.env, CLAUDE_PROJECT_DIR: dir };
  assert.strictEqual(dguard({ tool_name: "Bash", permission_mode: "default", tool_input: { command: "git reset --hard" } }, env), "ASK", "a bare-false ctide value must be a genuine no-op for the opt-out check");
});

test("destructive-guard: a bare root-level `false` settings.json document also does not suppress the ask", () => {
  const dir = mkProjectWithSettings("false");
  const env = { ...process.env, CLAUDE_PROJECT_DIR: dir };
  assert.strictEqual(dguard({ tool_name: "Bash", permission_mode: "default", tool_input: { command: "git reset --hard" } }, env), "ASK");
});

test("destructive-guard: the ASK reason warns an AI agent against self-authoring the destructiveGuard opt-out reactively", () => {
  // Regression pin: an agent must not self-author the opt-out to defeat a guard's ASK under
  // "do not ask for confirmation" phrasing; destructive-guard's ASK carries the identical opt-out mention,
  // so it needs the same warning. Hermetic env (no ambient CLAUDE_PROJECT_DIR opt-out) so the command reliably ASKs.
  const env = { ...process.env }; delete env.CLAUDE_PROJECT_DIR;
  const out = runHook(DGUARD, { tool_name: "Bash", permission_mode: "default", tool_input: { command: "git reset --hard" } }, env);
  const j = JSON.parse(out);
  const reason = (j.hookSpecificOutput && j.hookSpecificOutput.permissionDecisionReason) || "";
  assert.match(reason, /AI agent/i, "the ASK reason must address an AI agent reading it");
  assert.match(reason, /self-author/i, "the ASK reason must name self-authoring the opt-out as invalid");
  assert.match(reason, /standing human decision/i, "the ASK reason must frame the opt-out as a standing human decision, not a same-turn reaction");
});

test("destructive-guard: the ASK reason names settings.local.json alongside settings.json (higher-precedence, gitignored, diff-invisible)", () => {
  // `destructiveGuardDisabledForProject` reads settings.local.json at higher
  // precedence than settings.json (unchanged here), but settings.local.json is gitignored — a project
  // opt-out written there never shows up in a diff review. The ASK's pre-existing "Disable for this
  // project with..." sentence named only settings.json; it must also name settings.local.json so a
  // reader knows both files control this decision. Hermetic env so the command reliably ASKs.
  const env = { ...process.env }; delete env.CLAUDE_PROJECT_DIR;
  const out = runHook(DGUARD, { tool_name: "Bash", permission_mode: "default", tool_input: { command: "git reset --hard" } }, env);
  const j = JSON.parse(out);
  const reason = (j.hookSpecificOutput && j.hookSpecificOutput.permissionDecisionReason) || "";
  assert.match(reason, /settings\.local\.json/, "the ASK reason must name settings.local.json alongside settings.json");
});

test("destructive-guard: malformed stdin fails open (no ask, no crash)", () => {
  const out = cp.execFileSync("node", [DGUARD], { input: "not json {{{" }).toString();
  assert.strictEqual(out.trim(), "", "unparseable input -> fail open (allow), never crash");
});

test("destructive-guard: oversized stdin fails open (allow)", () => {
  const big = "x".repeat(6 * 1024 * 1024);
  const input = JSON.stringify({ tool_name: "Bash", tool_input: { command: "rm -rf x #" + big } });
  const r = cp.spawnSync("node", [DGUARD], { input, maxBuffer: 64 * 1024 * 1024 });
  assert.strictEqual((r.stdout || "").toString().includes('"ask"'), false, "over-cap stdin must fail open, not ask");
});

test("destructive-guard: separated rm flags (rm -r -f / rm -f -r / long forms) now ASK, while single-token rm -rf still asks", () => {
  // Separated recursive+force flags in any order/spacing are an unrecoverable recursive
  // force-delete, the same intent the combined rm -rf pattern already owns — high-confidence, so it ASKs.
  for (const command of [
    "rm -r -f build",
    "rm -f -r ./dist",
    "rm --recursive --force x",
    "rm -f --recursive x",
    "rm -r --force x",
    "ls && rm -r -f node_modules",     // after a chain separator
    "rm -r -f -v build",               // extra unrelated flag between/around them
  ]) {
    assert.strictEqual(dguard({ tool_name: "Bash", permission_mode: "default", tool_input: { command } }), "ASK", `should ask: ${command}`);
  }
  assert.strictEqual(dguard({ tool_name: "Bash", permission_mode: "default", tool_input: { command: "rm -rf x" } }), "ASK", "single-token rm -rf still asks");
});

test("destructive-guard: a single rm flag (recursive-only or force-only) stays ALLOW — no FP from the split-flag rule", () => {
  // The split-flag rule requires BOTH a recursive AND a force flag; one alone, or the two split across a
  // chain boundary, must NOT ask. Pins the high-confidence boundary so the new patterns can't creep into FPs.
  for (const command of [
    "rm -r dir",                       // recursive only
    "rm -f file",                      // force only
    "rm -rv dir",                      // recursive + verbose, no force
    "rm -i file",                      // interactive, neither
    "rm file.txt",                     // no flags
    "rm report-final.txt",             // filename with r/f letters, not flags
    "rm -r dir; rm -f file",           // r and f split across ';' -> not one recursive-force delete
  ]) {
    assert.strictEqual(dguard({ tool_name: "Bash", permission_mode: "default", tool_input: { command } }), "ALLOW", `should allow: ${command}`);
  }
});

test("destructive-guard: separated-flag fail-open preserved (malformed stdin still no ask, no crash)", () => {
  const out = cp.execFileSync("node", [DGUARD], { input: "not json {{{" }).toString();
  assert.strictEqual(out.trim(), "", "unparseable input -> fail open (allow), never crash");
});

test("destructive-guard F1: bounded separated-flag patterns still ASK on realistic forms (correctness preserved)", () => {
  // The {0,200} inter-flag bound (added to stop O(n^2) ReDoS backtracking) narrows the two separated-flag
  // patterns but must not drop any realistic recursive+force delete — a real one carries both flags within a
  // couple hundred chars, so every separated form (incl. one with ~100 chars between the flags) still asks.
  for (const command of [
    "rm -r -f x",
    "rm -f -r x",
    "rm --recursive --force x",
    `rm -r ${"a ".repeat(50)} -f`,      // ~100 chars between the two flags — comfortably within the 200 bound
  ]) {
    assert.strictEqual(dguard({ tool_name: "Bash", permission_mode: "default", tool_input: { command } }), "ASK", `should ask: ${command.slice(0, 40)}`);
  }
});

test("destructive-guard F1: a pathological rm input returns a decision quickly (linear, not quadratic ReDoS)", () => {
  // Pre-fix each separated-flag pattern had two unbounded [^;&|]* runs, so many whitespace/newline-separated
  // `rm ` anchors drove O(n^2) backtracking (~15s+ at this size — the synchronous regex ran to completion
  // before the 5s stdin watchdog could fire). The {0,200} bound makes it linear: the hook now returns a
  // decision well under this GENEROUS wall-clock bound. Large margin (node startup + a ~300KB parse) avoids CI flakiness.
  const command = "rm f\n".repeat(60000); // ~300KB of newline-separated `rm ` anchors, none carrying a flag
  const t0 = Date.now();
  const decision = dguard({ tool_name: "Bash", permission_mode: "default", tool_input: { command } });
  const elapsed = Date.now() - t0;
  assert.strictEqual(decision, "ALLOW", "`rm f` carries no recursive+force flags, so the guard must not ask");
  assert.ok(elapsed < 3000, `bounded pattern must return quickly (linear); took ${elapsed}ms`);
});

test("destructive-guard: PowerShell-native destructive forms (Windows/Copilot) ASK", () => {
  // On Windows the model rewrites POSIX into cmdlets, so `rm -rf` runs as `Remove-Item -Recurse -Force`.
  for (const command of [
    "Remove-Item -Recurse -Force 'C:\\Temp\\x' -ErrorAction SilentlyContinue", // the exact Copilot-on-Windows rewrite of rm -rf
    "Remove-Item -Recurse C:\\build",          // recursive delete, no -Force (still recursive)
    "remove-item -r -fo .\\dist",              // lowercase + abbreviated flags
    "ri -Recurse -Force node_modules",         // ri alias
    "Format-Volume -DriveLetter D",
    "Clear-Disk -Number 1 -RemoveData",
    "Get-ChildItem; Remove-Item -Recurse C:\\tmp", // after a statement separator
  ]) {
    assert.strictEqual(dguard({ tool_name: "Bash", permission_mode: "default", tool_input: { command } }), "ASK", `should ask: ${command}`);
  }
});

test("destructive-guard: non-recursive / non-destructive PowerShell stays ALLOW (no FP)", () => {
  for (const command of [
    "Remove-Item 'C:\\Temp\\one.txt'",         // single file, no -Recurse
    "Remove-Item -Force 'C:\\Temp\\one.txt'",  // -Force but not recursive
    "Get-ChildItem -Recurse -Filter *.log",    // recurse but not a delete cmdlet
    "ri config.json",                          // alias, single file
    "Format-Table -AutoSize",                  // Format-* but not Format-Volume
  ]) {
    assert.strictEqual(dguard({ tool_name: "Bash", permission_mode: "default", tool_input: { command } }), "ALLOW", `should allow: ${command}`);
  }
});

test("destructive-guard: git push --force-fast (a non-flag) does NOT false-ask, but --force / --force-with-lease still do", () => {
  // The --force(?![\w-]) tighten removes the false-ask on a hypothetical --force-<suffix> while keeping
  // the two real force flags via their own alternation branches.
  assert.strictEqual(dguard({ tool_name: "Bash", permission_mode: "default", tool_input: { command: "git push --force-fast origin main" } }), "ALLOW", "a non-existent --force-<suffix> flag must not false-ask");
  assert.strictEqual(dguard({ tool_name: "Bash", permission_mode: "default", tool_input: { command: "git push --force" } }), "ASK", "real --force still asks");
  assert.strictEqual(dguard({ tool_name: "Bash", permission_mode: "default", tool_input: { command: "git push --force-with-lease" } }), "ASK", "real --force-with-lease still asks");
});

test("destructive-guard A4: a parenthesized subshell running a destructive command ASKS; a benign paren does NOT", () => {
  // A4: the POSIX-pattern leading anchor now includes '(' so a subshell like `(rm -rf /tmp/x)` is caught
  // (previously the '(' before `rm` blocked the start/space/separator anchor and it slipped). Char-class
  // addition only: a '(' immediately before a destructive keyword IS a subshell running it, so asking is
  // correct — while a paren with NO destructive keyword must still not ask (guard against over-broadening).
  assert.strictEqual(dguard({ tool_name: "Bash", permission_mode: "default", tool_input: { command: "(rm -rf /tmp/x)" } }), "ASK", "a parenthesized subshell rm -rf must ask");
  assert.strictEqual(dguard({ tool_name: "Bash", permission_mode: "default", tool_input: { command: "(cd build && make)" } }), "ALLOW", "a subshell with no destructive keyword must not ask");
});

test("destructive-guard A4: the '(' subshell anchor fires beyond rm (non-rm destructive commands ASK)", () => {
  // The '(' leading anchor is shared by every POSIX pattern, not just rm — prove it catches a non-rm
  // destructive keyword inside a subshell too, so the anchor's coverage is not silently rm-only.
  assert.strictEqual(dguard({ tool_name: "Bash", permission_mode: "default", tool_input: { command: "(git reset --hard)" } }), "ASK", "a subshell git reset --hard must ask");
  assert.strictEqual(dguard({ tool_name: "Bash", permission_mode: "default", tool_input: { command: "(mkfs.ext4 /dev/sda1)" } }), "ASK", "a subshell mkfs must ask");
});

// --- tool_name:"PowerShell" coverage (plan-gate + destructive-guard) ---
// Distinct from the Copilot-CLI quirk above (tool_name:"Bash" + PowerShell-syntax command): this is
// Claude Code's own PowerShell tool call, tool_name:"PowerShell" itself, which previously bypassed both
// guards entirely (hooks.json never matched it, and each hook's own tool check exited early on anything
// but "Bash"). bashLooksDestructive() / bashLooksLikePlanWrite() are reused verbatim against
// tool_input.command, so both POSIX and PowerShell-syntax patterns must still match under this tool name.

test("destructive-guard: tool_name:\"PowerShell\" + destructive command ASKS like Bash, and the reason names PowerShell", () => {
  for (const command of [
    "Remove-Item -Recurse -Force 'C:\\Temp\\x'",   // PowerShell-native destructive form
    "Format-Volume -DriveLetter D",                // PowerShell-native destructive form
    "git reset --hard HEAD~3",                     // shared POSIX pattern, reused verbatim
  ]) {
    assert.strictEqual(dguard({ tool_name: "PowerShell", permission_mode: "default", tool_input: { command } }), "ASK", `should ask: ${command}`);
  }
  const env = { ...process.env }; delete env.CLAUDE_PROJECT_DIR;
  const out = runHook(DGUARD, { tool_name: "PowerShell", permission_mode: "default", tool_input: { command: "Remove-Item -Recurse -Force build" } }, env);
  const reason = JSON.parse(out).hookSpecificOutput.permissionDecisionReason;
  assert.match(reason, /this PowerShell command/i, "the ASK reason must describe the actual triggering tool, not hard-coded \"Bash\"");
});

test("destructive-guard: tool_name:\"PowerShell\" + benign command stays ALLOW", () => {
  for (const command of [
    "Get-ChildItem -Recurse -Filter *.log",
    "Remove-Item 'C:\\Temp\\one.txt'",  // single file, no -Recurse
    "git status",
  ]) {
    assert.strictEqual(dguard({ tool_name: "PowerShell", permission_mode: "default", tool_input: { command } }), "ALLOW", `should allow: ${command}`);
  }
});

test("plan-gate: tool_name:\"PowerShell\" write-looking commands are DENIED and the reason names PowerShell", () => {
  for (const command of [
    "echo hello > out.txt",
    "printf x | tee notes.txt",
    "sed -i 's/a/b/' src/app.ts",
    "git apply fix.patch",
  ]) {
    assert.strictEqual(gate({ tool_name: "PowerShell", permission_mode: "plan", tool_input: { command } }), "DENY", `should block: ${command}`);
  }
  const out = runHook(GATE, { tool_name: "PowerShell", permission_mode: "plan", tool_input: { command: "echo x > out.txt" } });
  assert.match(out, /"deny"/);
  assert.match(out, /this PowerShell command/i, "the deny reason must describe the actual triggering tool, not hard-coded \"Bash\"");
});

test("plan-gate: tool_name:\"PowerShell\" benign/read-only commands stay ALLOW in plan mode", () => {
  for (const command of [
    "git status",
    "Get-ChildItem -Recurse -Filter *.log",
    "node --check hooks/plan-gate.js",
  ]) {
    assert.strictEqual(gate({ tool_name: "PowerShell", permission_mode: "plan", tool_input: { command } }), "ALLOW", `should allow: ${command}`);
  }
});

test("destructive-guard: the existing Bash-tool PowerShell-syntax path still ASKS unchanged", () => {
  // Widening tool coverage to a real "PowerShell" tool_name must not disturb the
  // pre-existing quirk path where PowerShell-syntax commands arrive under tool_name:"Bash".
  assert.strictEqual(dguard({ tool_name: "Bash", permission_mode: "default", tool_input: { command: "Remove-Item -Recurse -Force 'C:\\Temp\\x' -ErrorAction SilentlyContinue" } }), "ASK");
});

test("destructive-guard: tool_name:\"Bash\" ASK reason uses the live tool value", () => {
  const env = { ...process.env }; delete env.CLAUDE_PROJECT_DIR;
  const out = runHook(DGUARD, { tool_name: "Bash", permission_mode: "default", tool_input: { command: "git reset --hard" } }, env);
  const reason = JSON.parse(out).hookSpecificOutput.permissionDecisionReason;
  assert.match(reason, /this Bash command/i, "the ASK reason must still read \"this Bash command\" for tool_name:\"Bash\"");
});

test("plan-gate: tool_name:\"Bash\" deny reason uses the live tool value", () => {
  const out = runHook(GATE, { tool_name: "Bash", permission_mode: "plan", tool_input: { command: "echo x > out.txt" } });
  assert.match(out, /"deny"/);
  assert.match(out, /this Bash command/i, "the deny reason must still read \"this Bash command\" for tool_name:\"Bash\"");
});

// --- contract-guard: content-based Write/Edit/MultiEdit tripwire on contract.md + design.md (new hook) ---
// PreToolUse only ever sees tool_name/tool_input/cwd/permission_mode — this hook is content-based, not
// actor-based (it cannot tell WHO is editing). It simulates the tool's proposed result locally (never
// invokes the tool) and asks (never denies) only when the simulated diff would drop previously recorded
// contract.md content or wholesale-delete a design.md section.

test("contract-guard: pure-append to contract.md (new AC added, everything old intact) is allowed", () => {
  const dir = mkCGuardProject();
  writeContract(dir, contractMd());
  const oldMd = contractMd();
  const newMd = oldMd.replace(
    '"mustNotChange": [\n    "public signature of AuthService.request"\n  ]',
    '"mustNotChange": [\n    "public signature of AuthService.request"\n  ],\n  "extra": "note"'
  );
  const input = { tool_name: "Edit", cwd: dir, tool_input: { file_path: contractPath(dir), old_string: oldMd, new_string: newMd } };
  const r = cguard(input, { ...process.env, CLAUDE_PROJECT_DIR: dir });
  assert.strictEqual(r.decision, "ALLOW", "a pure-append edit that keeps every old field must be allowed");
});

test("contract-guard: silently altering an existing AC's text/verification asks, naming the AC id", () => {
  const dir = mkCGuardProject();
  const oldMd = contractMd();
  writeContract(dir, oldMd);
  const newMd = contractMd({ acceptanceCriteria: [{ id: "AC-1", text: "token refreshed EVENTUALLY", behaviorChanging: true, verification: "test/auth.test.mjs::refreshes once" }] });
  const input = { tool_name: "Write", cwd: dir, tool_input: { file_path: contractPath(dir), content: newMd } };
  const r = cguard(input, { ...process.env, CLAUDE_PROJECT_DIR: dir });
  assert.strictEqual(r.decision, "ASK");
  assert.match(r.reason, /AC-1/, "the ask must name the altered criterion's id");
  assert.match(r.reason, /text would change/i);
});

test("contract-guard: a verification mapping silently altered on the same AC also asks", () => {
  const dir = mkCGuardProject();
  writeContract(dir, contractMd());
  const newMd = contractMd({ acceptanceCriteria: [{ id: "AC-1", text: "expired token refreshed once", behaviorChanging: true, verification: "test/auth.test.mjs::DIFFERENT" }] });
  const input = { tool_name: "Write", cwd: dir, tool_input: { file_path: contractPath(dir), content: newMd } };
  const r = cguard(input, { ...process.env, CLAUDE_PROJECT_DIR: dir });
  assert.strictEqual(r.decision, "ASK");
  assert.match(r.reason, /AC-1/);
  assert.match(r.reason, /verification would change/i);
});

test("contract-guard: dropping an existing AC id entirely (not just editing it) asks, naming it as removed", () => {
  const dir = mkCGuardProject();
  writeContract(dir, contractMd());
  const newMd = contractMd({ acceptanceCriteria: [] }); // AC-1 is gone entirely from the new content
  const input = { tool_name: "Write", cwd: dir, tool_input: { file_path: contractPath(dir), content: newMd } };
  const r = cguard(input, { ...process.env, CLAUDE_PROJECT_DIR: dir });
  assert.strictEqual(r.decision, "ASK");
  assert.match(r.reason, /acceptance criterion "AC-1" would be removed/, "a dropped AC id must be named with the removal wording, not a field-change wording");
});

test("contract-guard: flipping behaviorChanging true->false on a retained AC id asks, naming that field specifically", () => {
  const dir = mkCGuardProject();
  writeContract(dir, contractMd());
  const newMd = contractMd({ acceptanceCriteria: [{ id: "AC-1", text: "expired token refreshed once", behaviorChanging: false, verification: "test/auth.test.mjs::refreshes once" }] });
  const input = { tool_name: "Write", cwd: dir, tool_input: { file_path: contractPath(dir), content: newMd } };
  const r = cguard(input, { ...process.env, CLAUDE_PROJECT_DIR: dir });
  assert.strictEqual(r.decision, "ASK");
  assert.match(r.reason, /AC-1/);
  assert.match(r.reason, /behaviorChanging would change \(true -> false\)/i, "the ask must name the behaviorChanging field specifically, not just text/verification");
});

test("contract-guard A3: dropping an id-LESS acceptance criterion (matched by text) asks, naming it as removed", () => {
  // task-contract.md does not require an `id`. An id-less AC still records a promise, so a REMOVAL must be
  // caught — matched by exact text and flagged when that text no longer appears in any new AC.
  const dir = mkCGuardProject();
  writeContract(dir, contractMd({ acceptanceCriteria: [{ text: "id-less alpha" }, { text: "id-less beta" }] }));
  const newMd = contractMd({ acceptanceCriteria: [{ text: "id-less alpha" }] }); // beta dropped entirely
  const input = { tool_name: "Write", cwd: dir, tool_input: { file_path: contractPath(dir), content: newMd } };
  const r = cguard(input, { ...process.env, CLAUDE_PROJECT_DIR: dir });
  assert.strictEqual(r.decision, "ASK");
  assert.match(r.reason, /acceptance criterion "id-less beta" would be removed/, "an id-less removal must be named by its text");
});

test("contract-guard A3: a benign reorder of id-less ACs (same texts, different order) does NOT ask", () => {
  // Matching by content (not position) => a pure reorder that preserves every text is not a removal.
  const dir = mkCGuardProject();
  writeContract(dir, contractMd({ acceptanceCriteria: [{ text: "id-less alpha" }, { text: "id-less beta" }] }));
  const reordered = contractMd({ acceptanceCriteria: [{ text: "id-less beta" }, { text: "id-less alpha" }] });
  const input = { tool_name: "Write", cwd: dir, tool_input: { file_path: contractPath(dir), content: reordered } };
  const r = cguard(input, { ...process.env, CLAUDE_PROJECT_DIR: dir });
  assert.strictEqual(r.decision, "ALLOW", "reordering id-less ACs while keeping every text must not ask");
});

test("contract-guard: removing a mustNotChange entry asks", () => {
  const dir = mkCGuardProject();
  writeContract(dir, contractMd());
  const newMd = contractMd({ mustNotChange: [] });
  const input = { tool_name: "Write", cwd: dir, tool_input: { file_path: contractPath(dir), content: newMd } };
  const r = cguard(input, { ...process.env, CLAUDE_PROJECT_DIR: dir });
  assert.strictEqual(r.decision, "ASK");
  assert.match(r.reason, /mustNotChange entry "public signature of AuthService\.request" would be removed/);
});

test("contract-guard: removing a forbiddenPaths entry asks", () => {
  const dir = mkCGuardProject();
  writeContract(dir, contractMd());
  const newMd = contractMd({ forbiddenPaths: [] });
  const input = { tool_name: "Write", cwd: dir, tool_input: { file_path: contractPath(dir), content: newMd } };
  const r = cguard(input, { ...process.env, CLAUDE_PROJECT_DIR: dir });
  assert.strictEqual(r.decision, "ASK");
  assert.match(r.reason, /forbiddenPaths entry "src\/billing\/\*\*" would be removed/);
});

test("contract-guard: removing an allowedPaths entry asks", () => {
  const dir = mkCGuardProject();
  writeContract(dir, contractMd());
  const newMd = contractMd({ allowedPaths: [] });
  const input = { tool_name: "Write", cwd: dir, tool_input: { file_path: contractPath(dir), content: newMd } };
  const r = cguard(input, { ...process.env, CLAUDE_PROJECT_DIR: dir });
  assert.strictEqual(r.decision, "ASK");
  assert.match(r.reason, /allowedPaths entry "src\/auth\/\*\*" would be removed/);
});

test("contract-guard: risk downgraded high->low asks; risk increased medium->high is allowed", () => {
  const dir = mkCGuardProject();
  writeContract(dir, contractMd({ risk: "high" }));
  const downgraded = contractMd({ risk: "low" });
  let r = cguard({ tool_name: "Write", cwd: dir, tool_input: { file_path: contractPath(dir), content: downgraded } }, { ...process.env, CLAUDE_PROJECT_DIR: dir });
  assert.strictEqual(r.decision, "ASK", "a risk downgrade must ask");
  assert.match(r.reason, /risk would be downgraded \("high" -> "low"\)/);

  writeContract(dir, contractMd({ risk: "medium" }));
  const upgraded = contractMd({ risk: "high" });
  r = cguard({ tool_name: "Write", cwd: dir, tool_input: { file_path: contractPath(dir), content: upgraded } }, { ...process.env, CLAUDE_PROJECT_DIR: dir });
  assert.strictEqual(r.decision, "ALLOW", "a risk increase must never be flagged");
});

test("contract-guard M1: a non-canonical-cased risk downgrade (high->\"Low\") still asks (ordinal lookup is case/whitespace-normalized)", () => {
  // Before the fix, RISK_ORDINAL["Low"] misses (the map only has lowercase keys), so newOrd is
  // undefined, the "typeof newOrd === 'number'" guard fails, and the downgrade silently ALLOWS.
  const dir = mkCGuardProject();
  writeContract(dir, contractMd({ risk: "high" }));
  const downgraded = contractMd({ risk: "Low" }); // non-canonical casing
  const r = cguard({ tool_name: "Write", cwd: dir, tool_input: { file_path: contractPath(dir), content: downgraded } }, { ...process.env, CLAUDE_PROJECT_DIR: dir });
  assert.strictEqual(r.decision, "ASK", "a downgrade must be caught regardless of the new value's casing");
  assert.match(r.reason, /risk would be downgraded \("high" -> "Low"\)/, "the ask must quote the risk values exactly as written, unnormalized");
});

test("contract-guard: contract.md first-ever write (no prior file, no populated sibling) allows regardless of content", () => {
  const dir = mkCGuardProject(); // no .ctide/legacy-output/contract.md written at all
  const input = { tool_name: "Write", cwd: dir, tool_input: { file_path: contractPath(dir), content: contractMd({ risk: "low", mustNotChange: [] }) } };
  const r = cguard(input, { ...process.env, CLAUDE_PROJECT_DIR: dir });
  assert.strictEqual(r.decision, "ALLOW", "the sanctioned first-ever write (references/task-contract.md) must never be flagged");
});

test("contract-guard: contract.md whose prior content has no parseable JSON block also allows (no populated sibling)", () => {
  const dir = mkCGuardProject();
  writeContract(dir, "# Task contract\n\nNo machine block yet, just prose.\n");
  const input = { tool_name: "Write", cwd: dir, tool_input: { file_path: contractPath(dir), content: contractMd({ risk: "low" }) } };
  const r = cguard(input, { ...process.env, CLAUDE_PROJECT_DIR: dir });
  assert.strictEqual(r.decision, "ALLOW", "an unparseable/absent OLD block means there is nothing to have lost");
});

test("contract-guard: an already-populated contract.md whose new content drops the JSON block entirely asks", () => {
  // Distinct from the first-write case above: here the OLD content DID have a parseable block, so a
  // wholesale loss in the new content is a real finding, not a fail-open case.
  const dir = mkCGuardProject();
  writeContract(dir, contractMd());
  const newMd = "# Task contract\n\nSomehow the machine block got wiped in this rewrite.\n";
  const input = { tool_name: "Write", cwd: dir, tool_input: { file_path: contractPath(dir), content: newMd } };
  const r = cguard(input, { ...process.env, CLAUDE_PROJECT_DIR: dir });
  assert.strictEqual(r.decision, "ASK", "losing the JSON block on an already-populated contract must be flagged");
  assert.match(r.reason, /json block would be lost entirely/i);
});

test("contract-guard: an Edit whose old_string does not match current content is allowed (cannot simulate)", () => {
  const dir = mkCGuardProject();
  writeContract(dir, contractMd());
  const input = { tool_name: "Edit", cwd: dir, tool_input: { file_path: contractPath(dir), old_string: "this text is not in the file", new_string: "whatever" } };
  const r = cguard(input, { ...process.env, CLAUDE_PROJECT_DIR: dir });
  assert.strictEqual(r.decision, "ALLOW", "an old_string mismatch must fail open, not guess");
});

test("contract-guard: a MultiEdit whose later step's old_string is not found fails open for the WHOLE call", () => {
  const dir = mkCGuardProject();
  const oldMd = contractMd();
  writeContract(dir, oldMd);
  const input = {
    tool_name: "MultiEdit", cwd: dir,
    tool_input: {
      file_path: contractPath(dir),
      edits: [
        { old_string: '"mustNotChange": [\n    "public signature of AuthService.request"\n  ]', new_string: '"mustNotChange": []' }, // this step WOULD match and WOULD be a finding
        { old_string: "this later step does not exist in the file", new_string: "x" }, // but this step never matches
      ],
    },
  };
  const r = cguard(input, { ...process.env, CLAUDE_PROJECT_DIR: dir });
  assert.strictEqual(r.decision, "ALLOW", "any step failing to match must fail open for the entire MultiEdit, not partial-simulate");
});

// Two ACs sharing an identical `verification` string, verbatim in the raw JSON text.
const SHARED_VERIFICATION_MD = "# Task contract\n\n```json\n" + JSON.stringify({
  ctideContract: 1,
  risk: "high",
  acceptanceCriteria: [
    { id: "AC-1", text: "first behavior", behaviorChanging: true, verification: "shared::check" },
    { id: "AC-2", text: "second behavior", behaviorChanging: true, verification: "shared::check" },
  ],
  allowedPaths: ["src/**"],
  forbiddenPaths: [],
  mustNotChange: [],
}, null, 2) + "\n```\n";

test("contract-guard M2: an Edit whose old_string matches a value shared by two ACs only simulates the FIRST occurrence (real Edit semantics)", () => {
  // Before the fix, current.split(old_string).join(new_string) rewrites EVERY occurrence of the raw
  // text '"verification": "shared::check"' — both AC-1's (the intended, first) and AC-2's (untouched
  // in the real tool, which replaces only the first match by default) — so diffContractJson would
  // wrongly report AC-2's verification as "changed" too (a spurious ask on an untouched entry).
  const dir = mkCGuardProject();
  writeContract(dir, SHARED_VERIFICATION_MD);
  const input = {
    tool_name: "Edit", cwd: dir,
    tool_input: {
      file_path: contractPath(dir),
      old_string: '"verification": "shared::check"',
      new_string: '"verification": "shared::RENAMED"',
    },
  };
  const r = cguard(input, { ...process.env, CLAUDE_PROJECT_DIR: dir });
  assert.strictEqual(r.decision, "ASK", "AC-1's verification genuinely changed and must still be caught");
  assert.match(r.reason, /acceptance criterion "AC-1" verification would change/, "AC-1 (the actually-edited entry) must be named");
  assert.ok(!/acceptance criterion "AC-2"/.test(r.reason), "AC-2 (untouched by a real first-occurrence-only Edit) must NOT be flagged as changed");
});

test("contract-guard: an edit to some unrelated file never invokes any comparison (no-op)", () => {
  const dir = mkCGuardProject();
  const input = { tool_name: "Write", cwd: dir, tool_input: { file_path: path.join(dir, "src", "app.ts"), content: "console.log('hi')" } };
  const r = cguard(input, { ...process.env, CLAUDE_PROJECT_DIR: dir });
  assert.strictEqual(r.decision, "ALLOW");
});

// Table-driven: the three settings-variant tests share one body; each row keeps its
// original test name and assertion message.
for (const row of [
  { name: "contract-guard: project opt-out ctide.contractGuard=false suppresses an otherwise-real finding",
    settings: JSON.stringify({ ctide: { contractGuard: false } }), expected: "ALLOW",
    msg: "the opt-out must suppress an otherwise-real finding" },
  { name: "contract-guard: settings.local.json opt-out overrides settings.json (local-overrides-project precedence)",
    settings: JSON.stringify({ ctide: { contractGuard: true } }),
    localSettings: JSON.stringify({ ctide: { contractGuard: false } }), expected: "ALLOW",
    msg: "the local override must take precedence over the project-level setting" },
  { name: "contract-guard: malformed project settings fail safe to keep asking (a broken file must not silently drop the guard)",
    settings: "{ not: valid json ", expected: "ASK",
    msg: "a broken settings file must not silently drop the guard on a matched finding" },
]) {
  test(row.name, () => {
    const dir = mkCGuardProject();
    writeContract(dir, contractMd());
    fs.mkdirSync(path.join(dir, ".claude"), { recursive: true });
    fs.writeFileSync(path.join(dir, ".claude", "settings.json"), row.settings, "utf8");
    if (row.localSettings) fs.writeFileSync(path.join(dir, ".claude", "settings.local.json"), row.localSettings, "utf8");
    const newMd = contractMd({ mustNotChange: [] });
    const input = { tool_name: "Write", cwd: dir, tool_input: { file_path: contractPath(dir), content: newMd } };
    const r = cguard(input, { ...process.env, CLAUDE_PROJECT_DIR: dir });
    assert.strictEqual(r.decision, row.expected, row.msg);
  });
}

// readGuardFlag / contractGuardDisabledForProject reader-alignment: a bare-false "ctide" value (or a
// bare-false document root) must not collapse into an accidental contractGuard:false opt-out via
// `cfg && cfg.ctide && cfg.ctide.contractGuard`'s falsy short-circuit -- `cfg?.ctide?.contractGuard`
// only short-circuits on null/undefined, so it correctly reads no explicit claim instead.
test("contract-guard: a bare {\"ctide\":false} settings.json on disk does not suppress a genuine contract.md-weakening ask (readGuardFlag must not misread it as contractGuard:false)", () => {
  const dir = mkCGuardProject();
  writeContract(dir, contractMd());
  fs.mkdirSync(path.join(dir, ".claude"), { recursive: true });
  fs.writeFileSync(path.join(dir, ".claude", "settings.json"), JSON.stringify({ ctide: false }), "utf8");
  const newMd = contractMd({ mustNotChange: [] });
  const input = { tool_name: "Write", cwd: dir, tool_input: { file_path: contractPath(dir), content: newMd } };
  const r = cguard(input, { ...process.env, CLAUDE_PROJECT_DIR: dir });
  assert.strictEqual(r.decision, "ASK", "a bare-false ctide value must be a genuine no-op for the opt-out check -- it must not silently disable contract-guard's own protection");
});

test("contract-guard: a bare root-level `false` settings.json document also does not suppress a genuine ask", () => {
  const dir = mkCGuardProject();
  writeContract(dir, contractMd());
  fs.mkdirSync(path.join(dir, ".claude"), { recursive: true });
  fs.writeFileSync(path.join(dir, ".claude", "settings.json"), "false", "utf8");
  const newMd = contractMd({ mustNotChange: [] });
  const input = { tool_name: "Write", cwd: dir, tool_input: { file_path: contractPath(dir), content: newMd } };
  const r = cguard(input, { ...process.env, CLAUDE_PROJECT_DIR: dir });
  assert.strictEqual(r.decision, "ASK");
});

test("contract-guard control: {\"ctide\":0} (not the literal boolean false) behaves identically before/after this fix -- isolates literal `false` as the specific value ever misread", () => {
  const dir = mkCGuardProject();
  writeContract(dir, contractMd());
  fs.mkdirSync(path.join(dir, ".claude"), { recursive: true });
  fs.writeFileSync(path.join(dir, ".claude", "settings.json"), JSON.stringify({ ctide: 0 }), "utf8");
  const newMd = contractMd({ mustNotChange: [] });
  const input = { tool_name: "Write", cwd: dir, tool_input: { file_path: contractPath(dir), content: newMd } };
  const r = cguard(input, { ...process.env, CLAUDE_PROJECT_DIR: dir });
  assert.strictEqual(r.decision, "ASK", "ctide:0 was never the buggy value (0 !== false strictly) -- both && and ?. already read this as no claim, so behavior here is unaffected by the fix");
});

test("contract-guard: the ASK reason warns an AI agent against self-authoring the contractGuard opt-out reactively", () => {
  // Regression pin: an agent can hit this ASK (mustNotChange removal), reason that a "do not ask
  // for confirmation" task phrase authorized bypassing it, and self-author a NEW .claude/settings.json with
  // contractGuard:false to retry successfully. The ASK reason must now name that response as invalid.
  const dir = mkCGuardProject();
  writeContract(dir, contractMd());
  const newMd = contractMd({ mustNotChange: [] });
  const input = { tool_name: "Write", cwd: dir, tool_input: { file_path: contractPath(dir), content: newMd } };
  const r = cguard(input, { ...process.env, CLAUDE_PROJECT_DIR: dir });
  assert.strictEqual(r.decision, "ASK");
  assert.match(r.reason, /AI agent/i, "the ASK reason must address an AI agent reading it");
  assert.match(r.reason, /self-author/i, "the ASK reason must name self-authoring the opt-out as invalid");
  assert.match(r.reason, /standing human decision/i, "the ASK reason must frame the opt-out as a standing human decision, not a same-turn reaction");
});

test("contract-guard: the ASK reason names settings.local.json alongside settings.json (higher-precedence, gitignored, diff-invisible)", () => {
  // `contractGuardDisabledForProject` reads settings.local.json at higher
  // precedence than settings.json (unchanged here), but settings.local.json is gitignored — a project
  // opt-out written there never shows up in a diff review. The ASK's pre-existing "Disable for this
  // project with..." sentence named only settings.json; it must also name settings.local.json so a
  // reader knows both files control this decision.
  const dir = mkCGuardProject();
  writeContract(dir, contractMd());
  const newMd = contractMd({ mustNotChange: [] });
  const input = { tool_name: "Write", cwd: dir, tool_input: { file_path: contractPath(dir), content: newMd } };
  const r = cguard(input, { ...process.env, CLAUDE_PROJECT_DIR: dir });
  assert.strictEqual(r.decision, "ASK");
  assert.match(r.reason, /settings\.local\.json/, "the ASK reason must name settings.local.json alongside settings.json");
});

test("contract-guard: oversized stdin fails open (allow)", () => {
  const big = "x".repeat(6 * 1024 * 1024);
  const input = JSON.stringify({ tool_name: "Write", tool_input: { file_path: ".ctide/legacy-output/contract.md", content: big } });
  const r = cp.spawnSync("node", [CGUARD], { input, maxBuffer: 64 * 1024 * 1024 });
  assert.strictEqual((r.stdout || "").toString().includes('"ask"'), false, "over-cap stdin must fail open, not ask");
});

test("contract-guard: malformed stdin fails open (no ask, no crash)", () => {
  const out = cp.execFileSync("node", [CGUARD], { input: "not json {{{" }).toString();
  assert.strictEqual(out.trim(), "", "unparseable input -> fail open (allow), never crash");
});

test("contract-guard: an unreadable target file (e.g. a directory at that path) fails open", () => {
  const dir = mkCGuardProject();
  fs.mkdirSync(contractPath(dir), { recursive: true }); // a DIRECTORY at the contract.md path, not a file
  const input = { tool_name: "Write", cwd: dir, tool_input: { file_path: contractPath(dir), content: contractMd() } };
  const r = cguard(input, { ...process.env, CLAUDE_PROJECT_DIR: dir });
  assert.strictEqual(r.decision, "ALLOW", "an unreadable old path must be treated as no-old-content, never block");
});

// --- contract-guard: design.md whole-section-deletion tripwire (narrow, exact-heading-match only) ---

const DESIGN_MD = [
  "# Project Design",
  "",
  "## Visual Theme & Atmosphere",
  "Warm, editorial.",
  "",
  "## Color Palette & Roles",
  "primary: #123456",
  "",
  "## Do's and Don'ts",
  "Never use pure black on white.",
  "",
].join("\n");

test("design.md: a section body edited/expanded with the heading kept is allowed", () => {
  const dir = mkCGuardProject();
  const designPath = path.join(dir, "design.md");
  fs.writeFileSync(designPath, DESIGN_MD, "utf8");
  const expanded = DESIGN_MD.replace("primary: #123456", "primary: #123456\nsecondary: #abcdef\nsurface: #ffffff");
  const input = { tool_name: "Write", cwd: dir, tool_input: { file_path: designPath, content: expanded } };
  const r = cguard(input, { ...process.env, CLAUDE_PROJECT_DIR: dir });
  assert.strictEqual(r.decision, "ALLOW", "expanding a section body while keeping its heading must not be flagged");
});

test("design.md: a whole heading (## Do's and Don'ts) removed asks, naming that section", () => {
  const dir = mkCGuardProject();
  const designPath = path.join(dir, "design.md");
  fs.writeFileSync(designPath, DESIGN_MD, "utf8");
  const withoutSection = DESIGN_MD.replace("\n## Do's and Don'ts\nNever use pure black on white.\n", "\n");
  const input = { tool_name: "Write", cwd: dir, tool_input: { file_path: designPath, content: withoutSection } };
  const r = cguard(input, { ...process.env, CLAUDE_PROJECT_DIR: dir });
  assert.strictEqual(r.decision, "ASK");
  assert.match(r.reason, /## Do's and Don'ts/, "the ask must name the removed section's heading");
});

test("design.md: a section reduced to an 'n/a' placeholder with the heading kept is allowed", () => {
  const dir = mkCGuardProject();
  const designPath = path.join(dir, "design.md");
  fs.writeFileSync(designPath, DESIGN_MD, "utf8");
  const reduced = DESIGN_MD.replace("primary: #123456", "n/a");
  const input = { tool_name: "Write", cwd: dir, tool_input: { file_path: designPath, content: reduced } };
  const r = cguard(input, { ...process.env, CLAUDE_PROJECT_DIR: dir });
  assert.strictEqual(r.decision, "ALLOW", "reducing a section body to the sanctioned 'n/a' placeholder must not be flagged (heading presence only, never body content)");
});

test("design.md: exact-normalized heading match only — '## Color' must not match inside '## Color Palette & Roles'", () => {
  // If the guard used substring/fuzzy heading matching, removing "## Color Palette & Roles" and adding an
  // unrelated "## Color" heading could be misread as "the old heading survived" (false negative). Exact
  // normalized match must treat these as DIFFERENT headings, so the real deletion is still caught.
  const dir = mkCGuardProject();
  const designPath = path.join(dir, "design.md");
  fs.writeFileSync(designPath, DESIGN_MD, "utf8");
  const renamed = DESIGN_MD.replace("## Color Palette & Roles", "## Color");
  const input = { tool_name: "Write", cwd: dir, tool_input: { file_path: designPath, content: renamed } };
  const r = cguard(input, { ...process.env, CLAUDE_PROJECT_DIR: dir });
  assert.strictEqual(r.decision, "ASK");
  assert.match(r.reason, /## Color Palette & Roles/, "the full original heading must be named as removed, not silently matched against '## Color'");
});

test("design.md: a design.md matched by basename at a non-root path is still guarded (not root-anchored)", () => {
  // design-spec.md sanctions a documented non-root path for design.md — unlike contract.md, this hook
  // matches by basename wherever the tool targets it, not anchored to the project root.
  const dir = mkCGuardProject();
  const nestedDir = path.join(dir, "docs", "nested");
  fs.mkdirSync(nestedDir, { recursive: true });
  const designPath = path.join(nestedDir, "design.md");
  fs.writeFileSync(designPath, DESIGN_MD, "utf8");
  const withoutSection = DESIGN_MD.replace("\n## Do's and Don'ts\nNever use pure black on white.\n", "\n");
  const input = { tool_name: "Write", cwd: dir, tool_input: { file_path: designPath, content: withoutSection } };
  const r = cguard(input, { ...process.env, CLAUDE_PROJECT_DIR: dir });
  assert.strictEqual(r.decision, "ASK", "a design.md at a non-root path must still be guarded by basename match");
});

test("design.md: first-ever write (no prior file) is allowed (nothing to have lost)", () => {
  const dir = mkCGuardProject();
  const designPath = path.join(dir, "design.md"); // never written before
  const input = { tool_name: "Write", cwd: dir, tool_input: { file_path: designPath, content: DESIGN_MD } };
  const r = cguard(input, { ...process.env, CLAUDE_PROJECT_DIR: dir });
  assert.strictEqual(r.decision, "ALLOW");
});

test("design.md A2: a whole section removed from a differently-cased basename (Design.md) still asks", () => {
  // isDesignMdPath folds case, so a tool targeting "Design.md" (or DESIGN.MD) is guarded exactly like
  // "design.md" — a case-only spelling must not slip a whole-section deletion past the tripwire.
  const dir = mkCGuardProject();
  const designPath = path.join(dir, "Design.md"); // differing case, matched by lower-cased basename
  fs.writeFileSync(designPath, DESIGN_MD, "utf8");
  const withoutSection = DESIGN_MD.replace("\n## Do's and Don'ts\nNever use pure black on white.\n", "\n");
  const input = { tool_name: "Write", cwd: dir, tool_input: { file_path: designPath, content: withoutSection } };
  const r = cguard(input, { ...process.env, CLAUDE_PROJECT_DIR: dir });
  assert.strictEqual(r.decision, "ASK", "a case-variant Design.md must be guarded like design.md");
  assert.match(r.reason, /## Do's and Don'ts/, "the ask must name the removed section");
});

// --- contract-guard: .ctide/output/contract.md is guarded alongside the compatibility path ---

function newContractPath(dir) { return path.join(dir, ".ctide", "output", "contract.md"); }
function writeNewContract(dir, markdown) {
  fs.mkdirSync(path.join(dir, ".ctide", "output"), { recursive: true });
  fs.writeFileSync(newContractPath(dir), markdown, "utf8");
}

test("contract-guard: a weakening Write to the current .ctide/output/contract.md path asks", () => {
  // Discriminating: a compatibility-only guard would root-anchor only .ctide/legacy-output/contract.md, so this exact
  // input was silently ALLOWED — reverting the both-paths match turns this red.
  const dir = mkCGuardProject();
  writeNewContract(dir, contractMd());
  const input = { tool_name: "Write", cwd: dir, tool_input: { file_path: newContractPath(dir), content: contractMd({ mustNotChange: [] }) } };
  const r = cguard(input, { ...process.env, CLAUDE_PROJECT_DIR: dir });
  assert.strictEqual(r.decision, "ASK", "the new-layout contract path must be guarded (a guard watching only the legacy path allows this)");
  assert.match(r.reason, /.ctide\/output\/contract\.md/, "the ask label must name the matched (new) path");
});

test("contract-guard: the same weakening Write at the compatibility .ctide/legacy-output/contract.md path still asks (control)", () => {
  const dir = mkCGuardProject();
  writeContract(dir, contractMd());
  const input = { tool_name: "Write", cwd: dir, tool_input: { file_path: contractPath(dir), content: contractMd({ mustNotChange: [] }) } };
  const r = cguard(input, { ...process.env, CLAUDE_PROJECT_DIR: dir });
  assert.strictEqual(r.decision, "ASK", "pre-migration runs still write the legacy path; it must stay guarded");
  assert.match(r.reason, /\.ctide\/legacy-output\/contract\.md/, "the ask label must name the matched (legacy) path");
});

test("contract-guard: design.md at its current .ctide/design/ home is guarded by basename (whole-section deletion asks)", () => {
  // The basename match is location-independent by design, so this is a regression pin for the new
  // documented home (references/design-spec.md), not a behavior change.
  const dir = mkCGuardProject();
  const designPath = path.join(dir, ".ctide", "design", "design.md");
  fs.mkdirSync(path.dirname(designPath), { recursive: true });
  fs.writeFileSync(designPath, DESIGN_MD, "utf8");
  const withoutSection = DESIGN_MD.replace("\n## Do's and Don'ts\nNever use pure black on white.\n", "\n");
  const input = { tool_name: "Write", cwd: dir, tool_input: { file_path: designPath, content: withoutSection } };
  const r = cguard(input, { ...process.env, CLAUDE_PROJECT_DIR: dir });
  assert.strictEqual(r.decision, "ASK");
  assert.match(r.reason, /## Do's and Don'ts/, "the basename design.md guard must cover the .ctide/design/ home");
});

// --- contract-guard: a fresh write to one watched path is diffed against a populated sibling ---
// For a first write the target is ABSENT, so Edit/MultiEdit fail open (no current content to apply
// old_string against — simulateResult returns null) and only Write reaches the fresh-target branch;
// an Edit/MultiEdit on an EXISTING prose-only target also reaches this branch and correctly asks
// (block-lost vs the sibling), so Write is the sufficient and representative case used below.

test("contract-guard sibling baseline (a): fresh weakened Write to the current path with a populated compatibility sibling asks, naming the lost entry and sibling", () => {
  // Discriminating: an unconditional first-write branch would allow any fresh write,
  // so during the migration window a weakened contract at the preferred .ctide path could silently
  // shadow the populated legacy one. Reverting the sibling check turns this red.
  const dir = mkCGuardProject();
  writeContract(dir, contractMd()); // populated LEGACY .ctide/legacy-output/contract.md
  const input = { tool_name: "Write", cwd: dir, tool_input: { file_path: newContractPath(dir), content: contractMd({ mustNotChange: [] }) } };
  const r = cguard(input, { ...process.env, CLAUDE_PROJECT_DIR: dir });
  assert.strictEqual(r.decision, "ASK", "a fresh write shadowing a populated sibling contract must ask (an unconditional first-write allow lets this through)");
  assert.match(r.reason, /public signature of AuthService\.request/, "the ask must name the mustNotChange entry the fresh write would lose vs the sibling baseline");
  assert.match(r.reason, /\.ctide\/legacy-output\/contract\.md/, "the ask must name the sibling baseline path");
});

test("contract-guard sibling baseline (b): fresh weakened Write to the compatibility path with a populated current sibling asks (reverse direction)", () => {
  const dir = mkCGuardProject();
  writeNewContract(dir, contractMd()); // populated NEW .ctide/output/contract.md
  const input = { tool_name: "Write", cwd: dir, tool_input: { file_path: contractPath(dir), content: contractMd({ mustNotChange: [] }) } };
  const r = cguard(input, { ...process.env, CLAUDE_PROJECT_DIR: dir });
  assert.strictEqual(r.decision, "ASK", "the sibling check must be symmetric — a fresh legacy-path write diverging from the populated .ctide contract must ask");
  assert.match(r.reason, /public signature of AuthService\.request/, "the ask must name the mustNotChange entry the fresh write would lose vs the sibling baseline");
  assert.match(r.reason, /.ctide\/output\/contract\.md/, "the ask must name the sibling baseline path");
});

test("contract-guard sibling baseline (c): a true first write (no sibling anywhere) stays allowed at both watched paths", () => {
  // Control: the sanctioned first-ever write case must survive the sibling check — an empty project
  // gets no ask even for a minimal, hostile-looking contract (nothing exists to have been weakened).
  const minimal = "# Task contract\n\n```json\n" + JSON.stringify({ ctideContract: 1, risk: "low", acceptanceCriteria: [], mustNotChange: [] }) + "\n```\n";
  for (const target of [newContractPath, contractPath]) {
    const dir = mkCGuardProject();
    const input = { tool_name: "Write", cwd: dir, tool_input: { file_path: target(dir), content: minimal } };
    const r = cguard(input, { ...process.env, CLAUDE_PROJECT_DIR: dir });
    assert.strictEqual(r.decision, "ALLOW", `a true first write at ${path.relative(dir, target(dir))} must stay allowed (no sibling baseline exists)`);
  }
});

test("contract-guard sibling baseline (d): a fresh Write that is a strict superset of the populated sibling stays allowed", () => {
  // Control: the sibling is a diff BASELINE, not a freeze — extending the contract at the new path
  // (add one AC, keep every recorded item) must not ask, or every legitimate migration would prompt.
  const dir = mkCGuardProject();
  writeContract(dir, contractMd()); // populated LEGACY sibling
  const superset = contractMd({
    acceptanceCriteria: [
      { id: "AC-1", text: "expired token refreshed once", behaviorChanging: true, verification: "test/auth.test.mjs::refreshes once" },
      { id: "AC-2", text: "a second criterion added on top", behaviorChanging: false, verification: "command: node --test" },
    ],
  });
  const input = { tool_name: "Write", cwd: dir, tool_input: { file_path: newContractPath(dir), content: superset } };
  const r = cguard(input, { ...process.env, CLAUDE_PROJECT_DIR: dir });
  assert.strictEqual(r.decision, "ALLOW", "a pure-superset fresh write vs the sibling baseline must not ask");
});

test("contract-guard sibling baseline (e): a prose-only sibling (no JSON block) does not become a baseline — fresh write stays allowed (fail-open)", () => {
  const dir = mkCGuardProject();
  writeContract(dir, "# Task contract\n\nProse only — no machine block was ever recorded here.\n"); // unparseable LEGACY sibling
  const input = { tool_name: "Write", cwd: dir, tool_input: { file_path: newContractPath(dir), content: contractMd({ mustNotChange: [] }) } };
  const r = cguard(input, { ...process.env, CLAUDE_PROJECT_DIR: dir });
  assert.strictEqual(r.decision, "ALLOW", "an unparseable sibling has no recorded contract content to lose — the fresh write must fail open");
});

test("contract-guard sibling baseline (f): project opt-out ctide.contractGuard=false suppresses the sibling-baseline ask too", () => {
  // Pins the README-documented opt-out contract over the NEW ask path: the sibling finding flows
  // through the same shared opt-out gate — a refactor emitting the sibling ask before that gate
  // would break the opt-out with no other test noticing.
  const dir = mkCGuardProject();
  writeContract(dir, contractMd()); // populated LEGACY sibling
  fs.mkdirSync(path.join(dir, ".claude"), { recursive: true });
  fs.writeFileSync(path.join(dir, ".claude", "settings.json"), JSON.stringify({ ctide: { contractGuard: false } }), "utf8");
  const input = { tool_name: "Write", cwd: dir, tool_input: { file_path: newContractPath(dir), content: contractMd({ mustNotChange: [] }) } };
  const r = cguard(input, { ...process.env, CLAUDE_PROJECT_DIR: dir });
  assert.strictEqual(r.decision, "ALLOW", "the documented opt-out must suppress the sibling-baseline ask exactly like the target-based ask");
});

// --- contract-guard: settings-file guard-flag protection (Phase 1, new) ---------------------------
// Extends the same content-based tripwire to the guard hooks' own on/off switches: a Write/Edit/
// MultiEdit to .claude/settings.json or .claude/settings.local.json that would flip the EFFECTIVE,
// precedence-resolved value of any of the four ctide.* guard flags from enabled/default-on to
// disabled asks — including via a brand-new settings file (a fresh file
// defeating a block, which a same-path diff would miss since the target has no "old" to compare).

function localSettingsPath(dir) { return path.join(dir, ".claude", "settings.local.json"); }
function projectSettingsPath(dir) { return path.join(dir, ".claude", "settings.json"); }

test("contract-guard settings-guard (a): a fresh settings.json Write introducing contractGuard:false, where neither settings file existed before, asks", () => {
  const dir = mkCGuardProject(); // no .claude/ directory at all yet — the real exploit shape
  const input = { tool_name: "Write", cwd: dir, tool_input: { file_path: projectSettingsPath(dir), content: JSON.stringify({ ctide: { contractGuard: false } }) } };
  const r = cguard(input, { ...process.env, CLAUDE_PROJECT_DIR: dir });
  assert.strictEqual(r.decision, "ASK", "a fresh settings.json write flipping a guard flag off must ask even though the file itself never existed before — a same-path diff would wrongly allow this because the target has no old content to compare");
  assert.match(r.reason, /ctide\.contractGuard would become disabled/, "the ask must name the flipped key");
  assert.match(r.reason, /\.claude\/settings\.json/, "the ask must name the settings file being written");
});

test("contract-guard settings-guard (b): settings.local.json already has contractGuard:false; an unrelated Edit sets the SAME key false again in settings.json (redundant, no effective change) does not ask", () => {
  const dir = mkCGuardProject();
  fs.mkdirSync(path.join(dir, ".claude"), { recursive: true });
  fs.writeFileSync(localSettingsPath(dir), JSON.stringify({ ctide: { contractGuard: false } }), "utf8");
  const oldContent = JSON.stringify({ permissions: { allow: [] } });
  fs.writeFileSync(projectSettingsPath(dir), oldContent, "utf8");
  const newContent = JSON.stringify({ permissions: { allow: [] }, ctide: { contractGuard: false } });
  const input = { tool_name: "Edit", cwd: dir, tool_input: { file_path: projectSettingsPath(dir), old_string: oldContent, new_string: newContent } };
  const r = cguard(input, { ...process.env, CLAUDE_PROJECT_DIR: dir });
  assert.strictEqual(r.decision, "ALLOW", "settings.local.json already pins contractGuard:false at higher precedence, so writing the same value into the lower-precedence file changes nothing EFFECTIVE — must not false-ask");
});

test("contract-guard settings-guard (c): a flag flip false -> true (re-enabling protection) does not ask", () => {
  const dir = mkCGuardProject();
  fs.mkdirSync(path.join(dir, ".claude"), { recursive: true });
  const oldContent = JSON.stringify({ ctide: { destructiveGuard: false } });
  fs.writeFileSync(projectSettingsPath(dir), oldContent, "utf8");
  const newContent = JSON.stringify({ ctide: { destructiveGuard: true } });
  const input = { tool_name: "Write", cwd: dir, tool_input: { file_path: projectSettingsPath(dir), content: newContent } };
  const r = cguard(input, { ...process.env, CLAUDE_PROJECT_DIR: dir });
  assert.strictEqual(r.decision, "ALLOW", "re-enabling a guard flag must never be flagged");
});

test("contract-guard settings-guard (d): an edit touching only unrelated keys (e.g. permissions.allow) does not ask (no-op)", () => {
  const dir = mkCGuardProject();
  fs.mkdirSync(path.join(dir, ".claude"), { recursive: true });
  const oldContent = JSON.stringify({ permissions: { allow: ["Bash(git status)"] } });
  fs.writeFileSync(projectSettingsPath(dir), oldContent, "utf8");
  const newContent = JSON.stringify({ permissions: { allow: ["Bash(git status)", "Bash(git diff)"] } });
  const input = { tool_name: "Edit", cwd: dir, tool_input: { file_path: projectSettingsPath(dir), old_string: oldContent, new_string: newContent } };
  const r = cguard(input, { ...process.env, CLAUDE_PROJECT_DIR: dir });
  assert.strictEqual(r.decision, "ALLOW", "an edit that never touches any of the four ctide.* guard keys must be a pure no-op");
});

test("contract-guard settings-guard (e): the existing ctide.contractGuard:false opt-out also suppresses this NEW settings-file ask", () => {
  const dir = mkCGuardProject();
  fs.mkdirSync(path.join(dir, ".claude"), { recursive: true });
  fs.writeFileSync(localSettingsPath(dir), JSON.stringify({ ctide: { contractGuard: false } }), "utf8");
  const input = { tool_name: "Write", cwd: dir, tool_input: { file_path: projectSettingsPath(dir), content: JSON.stringify({ ctide: { planGate: false } }) } };
  const r = cguard(input, { ...process.env, CLAUDE_PROJECT_DIR: dir });
  assert.strictEqual(r.decision, "ALLOW", "the standing ctide.contractGuard=false opt-out must suppress the settings-file ask exactly like it already suppresses the contract.md/design.md asks");
});

test("contract-guard settings-guard (f1): malformed JSON in the SIBLING settings file does not mask a real flip in the file actually being written", () => {
  const dir = mkCGuardProject();
  fs.mkdirSync(path.join(dir, ".claude"), { recursive: true });
  fs.writeFileSync(localSettingsPath(dir), "{ not valid json", "utf8");
  const input = { tool_name: "Write", cwd: dir, tool_input: { file_path: projectSettingsPath(dir), content: JSON.stringify({ ctide: { contractGuard: false } }) } };
  const r = cguard(input, { ...process.env, CLAUDE_PROJECT_DIR: dir });
  assert.strictEqual(r.decision, "ASK", "a malformed sibling contributes no explicit value (fail-open for ITS OWN read only) but must not mask a real flip in the target being written");
});

test("contract-guard settings-guard (f2): malformed JSON in the TARGET's proposed content fails open (no ask, no crash)", () => {
  const dir = mkCGuardProject();
  fs.mkdirSync(path.join(dir, ".claude"), { recursive: true });
  const input = { tool_name: "Write", cwd: dir, tool_input: { file_path: projectSettingsPath(dir), content: "{ not valid json" } };
  const r = cguard(input, { ...process.env, CLAUDE_PROJECT_DIR: dir });
  assert.strictEqual(r.decision, "ALLOW", "a proposed write that is not parseable JSON cannot be confidently read for a flag flip — fail open");
});

test("contract-guard settings-guard: settings.local.json itself is also watched (not just settings.json) — a fresh local-only write flipping a flag asks", () => {
  const dir = mkCGuardProject();
  const input = { tool_name: "Write", cwd: dir, tool_input: { file_path: localSettingsPath(dir), content: JSON.stringify({ ctide: { destructiveGuard: false } }) } };
  const r = cguard(input, { ...process.env, CLAUDE_PROJECT_DIR: dir });
  assert.strictEqual(r.decision, "ASK", "settings.local.json is one of the two watched paths, symmetric with settings.json");
  assert.match(r.reason, /ctide\.destructiveGuard would become disabled/);
});

test("contract-guard settings-guard: an unrelated file write (not either settings path) is never affected (no-op)", () => {
  const dir = mkCGuardProject();
  const input = { tool_name: "Write", cwd: dir, tool_input: { file_path: path.join(dir, "src", "app.ts"), content: "console.log('hi')" } };
  const r = cguard(input, { ...process.env, CLAUDE_PROJECT_DIR: dir });
  assert.strictEqual(r.decision, "ALLOW");
});

// --- contract-guard settings-guard: arbiter repair round (deep-mode Tier 2, adversarially confirmed) ---
// BLOCKER: simulateResult ignored replace_all on Edit/MultiEdit, always doing first-occurrence-only
// replacement. A real replace_all:true Edit genuinely replaces EVERY occurrence -- if an earlier
// same-text boolean token precedes the guard flag's own occurrence, a first-occurrence-only simulation
// under-reports the proposed content and silently misses the flip.

test("contract-guard settings-guard BLOCKER-fix: an Edit with replace_all:true genuinely flips a guard flag when an earlier same-text boolean token precedes it in the file (real replace_all semantics, not first-occurrence-only simulation)", () => {
  const dir = mkCGuardProject();
  fs.mkdirSync(path.join(dir, ".claude"), { recursive: true });
  const oldContent = JSON.stringify({ includeCoAuthoredBy: true, ctide: { contractGuard: true } });
  fs.writeFileSync(projectSettingsPath(dir), oldContent, "utf8");
  const input = {
    tool_name: "Edit", cwd: dir,
    tool_input: { file_path: projectSettingsPath(dir), old_string: "true", new_string: "false", replace_all: true },
  };
  const r = cguard(input, { ...process.env, CLAUDE_PROJECT_DIR: dir });
  assert.strictEqual(r.decision, "ASK", "a replace_all:true Edit that flips EVERY 'true' occurrence (including the guard flag's own, via an earlier unrelated boolean token) must be simulated with real replace_all semantics, not first-occurrence-only");
  assert.match(r.reason, /ctide\.contractGuard would become disabled/);
});

test("contract-guard settings-guard BLOCKER-fix: a MultiEdit step with its OWN replace_all:true also genuinely flips the guard flag (per-step semantics)", () => {
  const dir = mkCGuardProject();
  fs.mkdirSync(path.join(dir, ".claude"), { recursive: true });
  const oldContent = JSON.stringify({ a: true, b: true, ctide: { destructiveGuard: true } });
  fs.writeFileSync(projectSettingsPath(dir), oldContent, "utf8");
  const input = {
    tool_name: "MultiEdit", cwd: dir,
    tool_input: { file_path: projectSettingsPath(dir), edits: [{ old_string: "true", new_string: "false", replace_all: true }] },
  };
  const r = cguard(input, { ...process.env, CLAUDE_PROJECT_DIR: dir });
  assert.strictEqual(r.decision, "ASK", "a MultiEdit step's own replace_all:true must also be honored");
  assert.match(r.reason, /ctide\.destructiveGuard would become disabled/);
});

test("contract-guard settings-guard BLOCKER-fix control: the SAME earlier-boolean-token Edit WITHOUT replace_all stays first-occurrence-only (does not ask) -- proves the fix is replace_all-gated, not a behavior change for the default case", () => {
  const dir = mkCGuardProject();
  fs.mkdirSync(path.join(dir, ".claude"), { recursive: true });
  const oldContent = JSON.stringify({ includeCoAuthoredBy: true, ctide: { contractGuard: true } });
  fs.writeFileSync(projectSettingsPath(dir), oldContent, "utf8");
  const input = {
    tool_name: "Edit", cwd: dir,
    tool_input: { file_path: projectSettingsPath(dir), old_string: "true", new_string: "false" }, // no replace_all
  };
  const r = cguard(input, { ...process.env, CLAUDE_PROJECT_DIR: dir });
  assert.strictEqual(r.decision, "ALLOW", "without replace_all, only the FIRST 'true' (includeCoAuthoredBy's, not the guard flag's) is simulated as replaced -- unchanged prior semantics");
});

// MAJOR #1: extractGuardFlags's `u && u.key` short-circuited to literal `false` for EVERY key whenever
// `u` (cfg.ctide, or cfg itself) was the bare boolean `false` -- masking a genuine flip in the OTHER
// file whenever the degenerate file supplies the higher-precedence (local) value. The target explicitly
// sets contractGuard:true so the contractGuardDisabledForProject/readGuardFlag opt-out check -- which
// always reads settings.local.json first for its OWN purposes -- resolves and short-circuits on that
// first read, never touching the degenerate sibling -- isolating this test to extractGuardFlags's own
// fix.

test("contract-guard settings-guard MAJOR1-fix: a sibling settings file where 'ctide' itself is the bare boolean false does not mask a fresh guard-flag introduction in the target", () => {
  const dir = mkCGuardProject();
  fs.mkdirSync(path.join(dir, ".claude"), { recursive: true });
  fs.writeFileSync(projectSettingsPath(dir), JSON.stringify({ ctide: false }), "utf8"); // degenerate sibling
  const oldLocal = JSON.stringify({ ctide: { contractGuard: true } }); // avoids the opt-out confound; no destructiveGuard yet
  fs.writeFileSync(localSettingsPath(dir), oldLocal, "utf8");
  const newLocal = JSON.stringify({ ctide: { contractGuard: true, destructiveGuard: false } });
  const input = { tool_name: "Write", cwd: dir, tool_input: { file_path: localSettingsPath(dir), content: newLocal } };
  const r = cguard(input, { ...process.env, CLAUDE_PROJECT_DIR: dir });
  assert.strictEqual(r.decision, "ASK", "a degenerate {ctide:false} sibling must resolve to NO explicit value (not a false positive that masks the target's own fresh false introduction)");
  assert.match(r.reason, /ctide\.destructiveGuard would become disabled/);
});

test("contract-guard settings-guard MAJOR1-fix: a sibling settings file whose ENTIRE content is the bare boolean false (root-level, not wrapped in an object) also does not mask a fresh guard-flag introduction", () => {
  const dir = mkCGuardProject();
  fs.mkdirSync(path.join(dir, ".claude"), { recursive: true });
  fs.writeFileSync(projectSettingsPath(dir), "false", "utf8"); // whole document is the literal `false`
  const oldLocal = JSON.stringify({ ctide: { contractGuard: true } });
  fs.writeFileSync(localSettingsPath(dir), oldLocal, "utf8");
  const newLocal = JSON.stringify({ ctide: { contractGuard: true, planGate: false } });
  const input = { tool_name: "Write", cwd: dir, tool_input: { file_path: localSettingsPath(dir), content: newLocal } };
  const r = cguard(input, { ...process.env, CLAUDE_PROJECT_DIR: dir });
  assert.strictEqual(r.decision, "ASK", "a root-level bare `false` sibling document must also resolve to NO explicit value, not a masking false positive");
  assert.match(r.reason, /ctide\.planGate would become disabled/);
});

// MAJOR #2: coverage gap -- only contractGuard/destructiveGuard reached an ASK+reason assertion;
// planGate's own ASK path and preserveOnCompact were never independently exercised (mutation-testable:
// a typo on either hand-typed extractGuardFlags line would silently and permanently disable protection
// for that flag while the suite stayed green). Plus the arbiter's explicit additional cases.

test("contract-guard settings-guard MAJOR2: a fresh settings.json Write introducing planGate:false, where neither settings file existed before, asks (planGate's own ASK path, not just inside an opt-out-suppressed ALLOW test)", () => {
  const dir = mkCGuardProject();
  const input = { tool_name: "Write", cwd: dir, tool_input: { file_path: projectSettingsPath(dir), content: JSON.stringify({ ctide: { planGate: false } }) } };
  const r = cguard(input, { ...process.env, CLAUDE_PROJECT_DIR: dir });
  assert.strictEqual(r.decision, "ASK");
  assert.match(r.reason, /ctide\.planGate would become disabled/);
});

test("contract-guard settings-guard MAJOR2: a fresh settings.json Write introducing preserveOnCompact:false, where neither settings file existed before, asks (preserveOnCompact's own ASK path)", () => {
  const dir = mkCGuardProject();
  const input = { tool_name: "Write", cwd: dir, tool_input: { file_path: projectSettingsPath(dir), content: JSON.stringify({ ctide: { preserveOnCompact: false } }) } };
  const r = cguard(input, { ...process.env, CLAUDE_PROJECT_DIR: dir });
  assert.strictEqual(r.decision, "ASK");
  assert.match(r.reason, /ctide\.preserveOnCompact would become disabled/);
});

test("contract-guard settings-guard MAJOR2: a settings-file MultiEdit whose later step's old_string is not found fails open for the WHOLE call", () => {
  const dir = mkCGuardProject();
  fs.mkdirSync(path.join(dir, ".claude"), { recursive: true });
  const oldContent = JSON.stringify({ ctide: { contractGuard: true } });
  fs.writeFileSync(projectSettingsPath(dir), oldContent, "utf8");
  const input = {
    tool_name: "MultiEdit", cwd: dir,
    tool_input: {
      file_path: projectSettingsPath(dir),
      edits: [
        { old_string: '"contractGuard":true', new_string: '"contractGuard":false' }, // this step WOULD match and WOULD be a finding
        { old_string: "this later step does not exist in the file", new_string: "x" }, // but this step never matches
      ],
    },
  };
  const r = cguard(input, { ...process.env, CLAUDE_PROJECT_DIR: dir });
  assert.strictEqual(r.decision, "ALLOW", "any MultiEdit step failing to match must fail open for the entire call, no crash");
});

test("contract-guard settings-guard MAJOR2: a single Write flipping 2+ guard flags at once names ALL of them in the ask reason (and never names a flag that was enabled, not disabled)", () => {
  const dir = mkCGuardProject();
  const input = { tool_name: "Write", cwd: dir, tool_input: { file_path: projectSettingsPath(dir), content: JSON.stringify({ ctide: { contractGuard: false, destructiveGuard: false, planGate: true } }) } };
  const r = cguard(input, { ...process.env, CLAUDE_PROJECT_DIR: dir });
  assert.strictEqual(r.decision, "ASK");
  assert.match(r.reason, /ctide\.contractGuard would become disabled/);
  assert.match(r.reason, /ctide\.destructiveGuard would become disabled/);
  assert.ok(!/ctide\.planGate would become disabled/.test(r.reason), "planGate was set to true (enabling), not disabled -- must not be named as a disable");
});

test("contract-guard settings-guard MAJOR2: a proposed settings content that is valid JSON but not an object (e.g. an array) does not ask, no crash", () => {
  const dir = mkCGuardProject();
  fs.mkdirSync(path.join(dir, ".claude"), { recursive: true });
  fs.writeFileSync(projectSettingsPath(dir), JSON.stringify({ ctide: { contractGuard: true } }), "utf8");
  const input = { tool_name: "Write", cwd: dir, tool_input: { file_path: projectSettingsPath(dir), content: JSON.stringify([1, 2, 3]) } };
  const r = cguard(input, { ...process.env, CLAUDE_PROJECT_DIR: dir });
  assert.strictEqual(r.decision, "ALLOW", "a non-object-but-valid-JSON proposed content (e.g. an array) must not crash and must not false-ask");
});

// MINOR 1: the settings branch's two on-disk reads (target + sibling) are now size-capped at 1MB,
// mirroring readGuardFlag's own established cap on this file class ("so a pathological settings file
// can't stall the hook"). Discriminating construction: the on-disk file for real ALREADY says
// contractGuard:false and the proposed write says the same (a true no-op IF the old value could be
// verified) -- capped, the guard cannot verify that anymore and conservatively treats it like a fresh
// introduction. This is an intentional precision-for-safety tradeoff on a pathological (>1MB) settings
// file, matching the existing readGuardFlag precedent, not a "bug" in the BLOCKER/MAJOR sense.

test("contract-guard settings-guard MINOR1: an oversized (>1MB) on-disk settings file's real prior value is no longer read once capped -- a proposed value matching what the file may already (unverifiably) say still asks, where the same input was correctly a no-op before the cap existed", () => {
  const dir = mkCGuardProject();
  fs.mkdirSync(path.join(dir, ".claude"), { recursive: true });
  const big = JSON.stringify({ ctide: { contractGuard: false }, pad: "x".repeat(2 * 1024 * 1024) });
  fs.writeFileSync(projectSettingsPath(dir), big, "utf8");
  const input = { tool_name: "Write", cwd: dir, tool_input: { file_path: projectSettingsPath(dir), content: JSON.stringify({ ctide: { contractGuard: false } }) } };
  const r = cguard(input, { ...process.env, CLAUDE_PROJECT_DIR: dir });
  assert.strictEqual(r.decision, "ASK", "capped, the guard cannot confirm the old value already matched -- it conservatively asks rather than trusting an unread, oversized file (matching readGuardFlag's own cap discipline)");
});

// --- contract-guard settings-guard: bare-false "ctide" is a genuine no-op (root cause lives in the 4
// runtime opt-out readers, not in this detector) ---
// A prior investigation into this detector found it treating a bare-false "ctide" value (or a bare-
// false document root) inconsistently depending on whether it appeared in the target or the sibling
// file. The root cause was NOT in this detector: the four RUNTIME opt-out readers (this hook's own
// readGuardFlag; the identical pattern in plan-gate.js / destructive-guard.js / compact-fidelity.js)
// used to read `cfg && cfg.ctide && cfg.ctide.KEY` (short-circuits on ANY falsy value, including the
// literal boolean `false`) instead of `cfg?.ctide?.KEY` (short-circuits only on null/undefined), so a
// bare-false "ctide" value collapsed each reader into seeing an explicit `false` for its own key,
// silently disabling protection. All four readers are now aligned to `?.` (see each hook's own
// readGuardFlag/readPlanGateFlag/readPreserveFlag and their dedicated tests below / in
// session-memory-hooks.test.mjs), which makes a bare-false "ctide" value a genuine no-op EVERYWHERE —
// it disables nothing at runtime — so extractGuardFlags' `cfg?.ctide?.key` resolution (used uniformly
// for target and sibling reads alike, no role-based special-casing) correctly does not ask about it either.

test("contract-guard settings-guard: an edit that leaves an already-degenerate ctide:false value untouched (only an unrelated key changes) stays a no-op (ALLOW)", () => {
  const dir = mkCGuardProject();
  fs.mkdirSync(path.join(dir, ".claude"), { recursive: true });
  const oldContent = JSON.stringify({ ctide: false, unrelated: "old" });
  fs.writeFileSync(projectSettingsPath(dir), oldContent, "utf8");
  const input = { tool_name: "Edit", cwd: dir, tool_input: { file_path: projectSettingsPath(dir), old_string: '"old"', new_string: '"new"' } };
  const r = cguard(input, { ...process.env, CLAUDE_PROJECT_DIR: dir });
  assert.strictEqual(r.decision, "ALLOW", "an edit that never touches the ctide key must not manufacture a new ask -- before and after both resolve to no explicit claim (a bare-false ctide value reads as undefined, not false), so there is no transition either way");
});

test("contract-guard settings-guard: re-proposing an unchanged root-level bare `false` document stays a no-op (ALLOW)", () => {
  const dir = mkCGuardProject();
  fs.mkdirSync(path.join(dir, ".claude"), { recursive: true });
  fs.writeFileSync(projectSettingsPath(dir), "false", "utf8");
  const input = { tool_name: "Write", cwd: dir, tool_input: { file_path: projectSettingsPath(dir), content: "false" } };
  const r = cguard(input, { ...process.env, CLAUDE_PROJECT_DIR: dir });
  assert.strictEqual(r.decision, "ALLOW", "re-proposing the identical bare-false content must not ask -- both before and after resolve to no explicit claim");
});

// --- contract-guard: wiring ---

test("hooks.json wires contract-guard.js under PreToolUse with a matcher covering Write/Edit/MultiEdit", () => {
  const hj = JSON.parse(fs.readFileSync(path.join(HOOKS, "hooks.json"), "utf8"));
  const entry = (hj.hooks.PreToolUse || []).find((e) => (e.hooks || []).some((x) => /contract-guard\.js/.test(x.command || "")));
  assert.ok(entry, "PreToolUse must invoke contract-guard.js");
  for (const tool of ["Write", "Edit", "MultiEdit"]) {
    assert.ok(new RegExp(`^(?:${entry.matcher})$`).test(tool), `${tool} must be covered by contract-guard.js's matcher`);
  }
});

test("contract-guard settings-guard (g): the settings-file guard rides the EXISTING contract-guard.js wiring — hooks.json still has exactly one contract-guard.js entry and the hook count stays 6", () => {
  const hj = JSON.parse(fs.readFileSync(path.join(HOOKS, "hooks.json"), "utf8"));
  const cguardEntries = (hj.hooks.PreToolUse || []).filter((e) => (e.hooks || []).some((x) => /contract-guard\.js/.test(x.command || "")));
  assert.strictEqual(cguardEntries.length, 1, "the settings-file guard must ride the existing contract-guard.js PreToolUse entry, not add a second one");
  const allHookFiles = new Set();
  for (const eventEntries of Object.values(hj.hooks)) {
    for (const entry of eventEntries) {
      for (const h of entry.hooks || []) {
        const m = /hooks\/([\w.-]+\.js)/.exec(h.command || "");
        if (m) allHookFiles.add(m[1]);
      }
    }
  }
  assert.strictEqual(allHookFiles.size, 6, "hook count must stay 6 — no new hook file was wired for the settings-file guard");
});
