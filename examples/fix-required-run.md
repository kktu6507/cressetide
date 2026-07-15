# FIX REQUIRED to READY example

Source: illustrative Cressetide repair-loop example. It is not a historical run and is not counted as evidence.

## Task

Add a release validation rule for archive contents.

## Initial finding

The implementation accepts the expected files but does not reject an unexpected extra file. The test suite covers the success path only.

## Initial verdict

`FIX REQUIRED`

## Repair

The implementer adds an exact-set check and regression tests for missing, duplicate, and extra entries. The affected reviewers re-check only the repaired release and test paths.

## Final verdict

`READY`

A real report must replace this illustration with observed commands, results, findings, and a reproducible run reference.
