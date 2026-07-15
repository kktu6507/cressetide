# Security policy

## Reporting a vulnerability

Do not open a public issue for a suspected vulnerability. Use
[GitHub Security Advisories](https://github.com/kktu6507/cressetide/security/advisories/new)
and include:

- the affected file, command, hook, or workflow;
- prerequisites and a minimal reproduction;
- expected and observed behavior;
- likely impact and exposed data classes;
- any safe containment already applied.

Do not include live credentials, tokens, personal data, production dumps, or
customer content. Replace sensitive values with clearly marked placeholders.

## Supported code

Security fixes target the current `main` development line. A version or release
asset is supported only when the repository explicitly identifies it as such.
Do not infer support from a package version, example artifact name, or local
archive.

## Security boundaries

Cressetide coordinates evidence-gated engineering work; it is not a sandbox or
an access-control system. In particular:

- hooks are fail-open and cannot replace operating-system permissions;
- settings are user-controlled workflow inputs, not an authorization boundary;
- Map content is repository-local evidence routing, not trusted production truth;
- agent prompts cannot grant credentials or production authority;
- `READY` and `ctide:delivery=shipped` are workflow conclusions, not proof of a
  Git push, deployment, or release;
- external model, browser, network, and CLI use must be disclosed and bounded by
  the operator's data-handling policy.

Keep repository, CI, cloud, signing, and deployment permissions independently
restricted. Require normal code review and branch protection around changes to
hooks, manifests, release scripts, workflows, and security policy.

## Sensitive data handling

`.ctide/` may hold repository evidence, incident observations, review packets,
or command output and is ignored by Git by default. Before sharing any artifact:

1. remove secrets, tokens, credentials, personal data, customer data, and raw
   environment values;
2. reduce logs to the minimum evidence needed;
3. preserve timestamps and source identity without exposing sensitive payloads;
4. apply the organization's incident and evidence-retention policy.

`CTIDE_HOOK_DEBUG=1` is intended for isolated diagnosis. Debug output uses the
`[ctide ...]` prefix and `ctide-hook.log`, and must never contain raw settings
values or environment contents.

## Incident safety

`/ctide:salvage` preserves a sanitized snapshot before state-changing action
and requires one decision card per production-affecting action. Security
incidents may require legal, privacy, forensics, or chain-of-custody procedures
that take precedence over plugin guidance. Destructive data repair requires
explicit authorization, backup and restore evidence, and validation queries.

## Release integrity

Expected release asset names are:

```text
ctide-vX.Y.Z-plugin.tar.gz
ctide-vX.Y.Z-plugin.tar.gz.sha256
```

Verify checksums and GitHub attestations against
`kktu6507/cressetide`; never trust a filename alone. See
[`RELEASING.md`](RELEASING.md) for the release evidence gate.
