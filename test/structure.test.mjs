import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { root, run } from "./helpers.mjs";

test("structure validator passes the complete repository", () => {
  const result = run(process.execPath, [".github/scripts/validate-structure.mjs"]);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /validation passed/);
});

test("marketplace, plugin, and package versions agree", () => {
  const market = JSON.parse(fs.readFileSync(path.join(root, ".claude-plugin", "marketplace.json"), "utf8"));
  const plugin = JSON.parse(fs.readFileSync(path.join(root, "cressetide", ".claude-plugin", "plugin.json"), "utf8"));
  const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
  assert.equal(market.name, "kktu");
  assert.equal(market.plugins[0].source, "./cressetide");
  assert.deepEqual([market.plugins[0].version, plugin.version], [pkg.version, pkg.version]);
});

test("public skill and agent inventories are exact", () => {
  const skills = fs.readdirSync(path.join(root, "cressetide", "skills"), { withFileTypes: true })
    .filter(entry => entry.isDirectory()).map(entry => entry.name).sort();
  assert.deepEqual(skills, ["doctor", "map", "salvage", "vigil"]);
  const agents = fs.readdirSync(path.join(root, "cressetide", "agents")).sort();
  assert.equal(agents.length, 11);
  assert.ok(agents.every(name => name.endsWith(".agent.md")));
});

test("multilingual READMEs preserve command and state tokens", () => {
  const names = ["README.md", "README.zh-TW.md", "README.ja.md"];
  const documents = names.map(name => fs.readFileSync(path.join(root, name), "utf8"));
  for (const token of ["/ctide:vigil", "/ctide:salvage", "/ctide:map", "/ctide:doctor", ".ctide/", "ctide@kktu"]) {
    assert.ok(documents.every(document => document.includes(token)), token);
  }
  assert.equal(new Set(documents.map(document => (document.match(/^##\s+/gm) || []).length)).size, 1);
});
