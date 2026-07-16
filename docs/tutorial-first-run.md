# Your first ctide run, end to end

This is a hands-on walkthrough. You will install ctide, hand it one small task, approve its plan, and watch it change code, verify the change, review it, and decide whether the result is ready to ship. By the end you will recognize every stage of a `/ctide:vigil` and know how to read the verdict at the bottom.

It takes about ten minutes, and you do not need to understand ctide's internals first — follow the steps and the flow will explain itself.

If you want reference material instead of a guided tour, see [`task-writing-guide.md`](task-writing-guide.md) and [`how-to-read-verdicts.md`](how-to-read-verdicts.md). This page is the tour; those are the maps.

## What you'll need

- **Claude Code**, running in a project directory — any small repo where you can safely make a trivial change.
- **`node` on your `PATH`.** ctide's hooks are Node scripts; with no Node they silently no-op and you would miss half the guardrails. Check with `node --version`.

That is all — no API keys, no services, no configuration.

## 1. Install and enable ctide

Inside Claude Code, in your project directory, run:

```text
/plugin marketplace add kktu6507/plugins
/plugin install ctide@kktu
# ctide ships DISABLED - enable it: /plugin -> Installed -> toggle ctide on
#   or: claude plugin enable ctide@kktu
/reload-plugins
```

Two things newcomers miss:

- **Installing does not enable it.** Until you toggle ctide on (or run `claude plugin enable ctide@kktu`), its hooks and skills do nothing.
- **The marketplace is named `kktu`; the install id is `ctide@kktu`.**

Run `/ctide:doctor` once if you want to confirm the hooks are wired and Node is visible — it prints a short health check.

## 2. Hand ctide one small task

Pick something small and concrete with a clear right answer. For this tutorial, imagine your project has a `parseTags` helper that splits a comma-separated string, and it carries a classic bug: `parseTags("")` returns `[""]` instead of an empty array, because `"".split(",")` is `[""]`.

Give ctide the task:

```text
/ctide:vigil Fix parseTags(input) so an empty string returns [] instead of [""]. Keep non-empty parsing unchanged.
```

Notice the shape of that request: it states the **intended behavior**, one **acceptance criterion** (empty in, empty array out), and a **must-not-change** boundary (non-empty parsing stays the same). ctide works best when you hand it a contract like this rather than "fix the tags thing." More on writing good tasks in [`task-writing-guide.md`](task-writing-guide.md).

## 3. Read the restated requirement

ctide does **not** start editing. First it restates, in its own words, what it thinks you asked for. Read this carefully — it is your cheapest chance to catch a misunderstanding. If the task were ambiguous in a way that changes behavior, contracts, security, or UX, ctide would ask you a question here instead of guessing. This task is unambiguous, so it moves on to planning.

## 4. Approve the plan — this is the human-in-the-loop moment

Still no code changes. ctide stays read-only, reads the real code, and presents a short **plan** plus the **acceptance criteria** it will hold the change to — something like:

- return `[]` from `parseTags` when the input is empty
- keep the existing split for non-empty input
- acceptance: `parseTags("")` is `[]`; `parseTags("a,b")` is `["a","b"]` (unchanged)

Then it stops and waits for **you**. This is the gate that makes ctide different from "just let the AI edit": nothing is written until you approve the plan and its criteria. Read the criteria closely — they are the exact yardstick the verdict at the end is measured against. If something is wrong or missing, reject and refine. If it looks right, approve.

## 5. Watch the smallest change get made

Once you approve, the `implementer` makes the **smallest safe change** that satisfies the plan — here, a one-line guard so an empty string returns `[]`. It does not refactor the file, rename things, or "improve" unrelated code. It also writes a small per-run contract to `.ctide/output/contract.md` recording the criteria and scope. Importantly, the implementer never certifies its own work as correct — that is deliberately someone else's job.

## 6. Watch it get verified

ctide runs the project's real checks — build, tests, lint, whatever applies — and treats the **command's exit status as the authority**, not a confident-sounding summary. For our fix it adds and runs a test that `parseTags("")` is `[]`, and confirms the existing non-empty test still passes. If a command fails, that is a fact the run cannot talk its way around.

## 7. Watch the risk-selected reviewers

You do not pick reviewers; ctide assembles the panel by **risk**. A typo engages none. A small helper fix like this engages a small core panel — the spec reviewer checking the change against your stated requirement, the test reviewer checking the tests and edge cases, plus a code-review pass (its own reviewer, or folded into the arbiter for a tiny diff like this one). An authentication change would additionally pull in the security reviewer; a schema migration would pull in others. Review is proportional to risk, so small changes stay cheap.

Each reviewer inspects the change against your intent and reports findings rated `blocker`, `major`, or `minor`. They propose fixes; they do not edit.

## 8. Read the verdict

Finally the `arbiter` aggregates every finding, re-rates each by real impact, checks **each acceptance criterion** one by one, and issues one of three verdicts:

- **`READY`** — the criteria are met, verification evidence is present, and no blocker or major finding remains. Responsible to ship under the stated scope.
- **`FIX REQUIRED`** — a concrete issue blocks readiness; a repair loop is expected to fix it and re-verify.
- **`NOT READY`** — ctide cannot responsibly deliver in the current state (for example the requirement is too ambiguous, or a required verification path is unavailable).

For our small fix you should see `READY`. At the very bottom of a substantial report is a machine-readable footer:

```text
ctide:verify=pass
ctide:delivery=shipped
ctide:panel=full
```

In order, these say: verification passed, the change is being delivered, and the full selected panel ran. ctide's Stop hook reads these exact literals, so they stay stable. (The panel line can instead name an evidence-substituted reviewer on small low-risk runs — that and the full meaning of each verdict are covered in [`how-to-read-verdicts.md`](how-to-read-verdicts.md).)

That is a complete run: task, restated requirement, approved plan, smallest change, verification, risk-selected review, verdict.

## What to try next

- **Give it a bigger task.** Something with several acceptance criteria and a real must-not-change boundary — see [`task-writing-guide.md`](task-writing-guide.md) for bad / better / best examples. The more contract you give ctide, the more the reviewers and arbiter can actually verify.
- **Turn up the scrutiny with `--deep`.** `/ctide:vigil --deep <task>` opts into adversarial verification of findings and maximum reasoning effort for the arbiter and security reviewer. It costs more; reach for it when the change is high-risk.
- **Keep `/ctide:doctor` handy.** If the gate never seems to block, the hooks seem silent, or Node might be missing, run it to check your setup.

Now hand ctide a real change from your own project, and read its verdict with the map in [`how-to-read-verdicts.md`](how-to-read-verdicts.md).
