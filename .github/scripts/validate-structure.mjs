#!/usr/bin/env node
// Composite validator: run the core structural contract, then Cressetide's
// identity, Map, release, inventory, runtime-state, and text-integrity checks.
await import("./validate-structure-core.mjs");
await import("./validate-cressetide-extensions.mjs");
