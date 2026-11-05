import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import vm from "node:vm";
import { DEFAULTS as LIB_DEFAULTS } from "../lib/options.mjs";

// package.json is the source of truth for a fresh install; lib and page each
// have a copy the sandbox cannot import. Three copies must never drift.
test("package, lib and page defaults are identical", () => {
  const root = join(dirname(fileURLToPath(import.meta.url)), "..");
  const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
  const page = readFileSync(join(root, "page", "app.js"), "utf8");
  const match = /var DEFAULTS = (\{[\s\S]*?\n  \});/.exec(page);
  assert.ok(match);
  const pageDefaults = JSON.parse(JSON.stringify(vm.runInNewContext("(" + match[1] + ")", {})));
  const pkgDefaults = pkg.magpie.options;

  assert.deepEqual(Object.keys(pkgDefaults).sort(), Object.keys(LIB_DEFAULTS).sort());
  assert.deepEqual(Object.keys(pkgDefaults).sort(), Object.keys(pageDefaults).sort());
  for (const key of Object.keys(pkgDefaults)) {
    assert.deepEqual(pkgDefaults[key], LIB_DEFAULTS[key], `lib ${key}`);
    assert.deepEqual(pkgDefaults[key], pageDefaults[key], `page ${key}`);
  }

  // Every option must have a row in the page's field-help table.
  const fieldKeys = [...page.matchAll(/\{ key: "([^"]+)"/g)].map((match) => match[1]).sort();
  assert.deepEqual(fieldKeys, Object.keys(pkgDefaults).sort());
});
