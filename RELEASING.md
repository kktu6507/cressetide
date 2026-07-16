# Releasing Cressetide

This document defines the release procedure. It does not record that any step,
tag, asset, attestation, or publication has occurred.

## Release contract

- The release identity is read from the explicit tag's Git blobs, never from
  mutable working-tree manifests. The version is identical in the tagged
  `package.json` and the tagged `cressetide/.claude-plugin/plugin.json`.
- The tag is `vX.Y.Z`.
- The archive is `ctide-vX.Y.Z-plugin.tar.gz`.
- The checksum is `ctide-vX.Y.Z-plugin.tar.gz.sha256`.
- The archive contains the nested `cressetide/` plugin payload. The
  `ctide` marketplace entry that references this repository lives in the
  separate `kktu6507/plugins` marketplace, not in this repository.
- Archives are deterministic: fixed ordering, normalized timestamps, and
  normalized modes produce identical bytes for identical source input.
- A release must contain exactly the archive and checksum above. Missing,
  duplicate, or extra assets block publication.
- Published assets are immutable. Authentication, network, rate-limit, and
  other transport failures retain their stderr and block publication; they are
  never interpreted as asset drift. A bounded retry is allowed for transient
  download failures.
- Repair is possible only after both exact assets download successfully and
  the downloaded bytes prove drift. It additionally requires
  `CTIDE_REPAIR_PUBLISHED_RELEASE_ASSETS=true` and review of the resulting
  evidence. Missing assets and transport failures never enter repair.

## Preconditions

1. Confirm the intended repository and remote:

   ```bash
   git rev-parse --show-toplevel
   git remote -v
   git status --short
   ```

2. Confirm the exact immutable `vX.Y.Z` tag. Verify that its root package and
   nested plugin manifest have exact version parity. The tagged commit must be
   checked out at `HEAD`.
3. Run the complete local check set:

   ```bash
   npm test
   npm run validate
   npm run eval
   ```

4. Review security-sensitive changes to hooks, release tooling, workflows,
   manifests, path containment, and secret handling.
5. Require tracked release inputs (`package.json` and `cressetide/`) to match
   the explicit tag before producing release evidence. Archive bytes are still
   read directly from that tag's Git blob objects.

## Build and compare archives

Build the archive from a clean checkout:

```bash
npm run release:archive
```

For version `0.1.0`, the expected outputs are:

```text
ctide-v0.1.0-plugin.tar.gz
ctide-v0.1.0-plugin.tar.gz.sha256
```

Build twice from the same source in separate empty output directories and
compare both archive SHA-256 digests. Inspect the archive boundary before
signing or uploading it. Do not include `.git/`, `.ctide/`, tests, evaluation
output, local logs, or credentials in the plugin archive unless the publisher
contract explicitly requires them.

## Tag and publish

Tagging, pushing, and publication require explicit maintainer authorization.
Use the version selected in the manifests:

```bash
git tag -s v0.1.0 -m "Cressetide v0.1.0"
git push origin v0.1.0
```

Use the repository release workflow or the publisher only after the tag ref,
archive digest, checksum, and intended GitHub repository have been confirmed:

```bash
npm run release:publish -- --tag v0.1.0
```

The workflow runs read-only validation first, then a separate publication job
with only `contents: write`, followed by an independent provenance job with
`contents: read`, `id-token: write`, and `attestations: write`. `GH_TOKEN` is
provided only to the individual steps that call `gh`; checkout credentials are
not persisted.

Do not describe the release as complete until the final tag commit has a green
required check set and GitHub exposes the expected immutable assets and
attestation.

## Verify published evidence

Download the asset and checksum from the exact GitHub release. Verify the
exact two-name asset allowlist, checksum, archive boundary, and attestation:

```bash
gh attestation verify ctide-v0.1.0-plugin.tar.gz \
  --repo kktu6507/cressetide
```

Also verify that the tagged ref contains the complete `cressetide/` plugin,
then exercise marketplace discovery via the `kktu6507/plugins` marketplace and
`/ctide:doctor` in an isolated Claude Code environment. Local validation
cannot substitute for this published-ref check.

## Failure handling

Stop when a digest, asset set, tag ref, manifest version, attestation, or final
commit check differs from the approved release input. Do not treat a failed
download or release query as proof that an asset or release is missing. Do not
overwrite a published asset by default. Preserve sanitized stderr and other
evidence, identify the mismatch, and require a separately reviewed recovery
decision.
