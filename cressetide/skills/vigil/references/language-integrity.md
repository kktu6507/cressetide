# Language And Text Integrity

The full language and text-integrity contract for the workflow. `SKILL.md` keeps only the always-on essentials (user-language communication, the never-translate token list); this reference carries the complete rules for language selection, verbatim technical contracts, and text-integrity checks.

## Language selection

For human-readable repository content, follow the file's and repository's existing language and the user's language; default to English when none is determinable.

The workflow's own **user-facing communication** — the plan presented at the plan gate, AskUserQuestion prompts, reviewer findings surfaced to the user, and the final summary — **follows the language the user is communicating in** (default to English when undeterminable). This is language-adaptive, not a fixed language: match the user rather than defaulting to English when the user writes in another language.

## Verbatim technical contracts

Preserve technical contracts **verbatim regardless of the surrounding language**: identifiers, API fields, database objects, configuration keys, file names, commands, protocol values, and reviewer/agent names. In particular, **never translate the machine-checked tokens** — the severity labels `blocker` / `major` / `minor`, the verdict `READY` / `FIX REQUIRED` / `NOT READY`, and the sentinel tokens `ctide:delivery=held|shipped`, `ctide:verify=pass|fail|unrun|na`, and `ctide:panel=full|substituted:<names>` — they are matched literally by tooling (e.g. the Stop orchestration-check hook) and a translation silently breaks the contract.

## Text-integrity checks

When touching human-readable text, check for mojibake, replacement characters, broken mixed encodings, unsafe localization of technical contracts, and inconsistent rendering of the target language. Prefer the smallest safe text fix and do not force broad encoding conversion unless the root cause and compatibility risk are understood.
