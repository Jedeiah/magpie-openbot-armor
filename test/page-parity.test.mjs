import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { DEFAULTS as LIB_DEFAULTS } from "../lib/options.mjs";

// The sandboxed page cannot import lib modules, so it keeps its own copy of
// the option defaults. This test fails when the two copies drift.
test("page DEFAULTS stay in sync with lib options DEFAULTS", () => {
  const pageDir = join(dirname(fileURLToPath(import.meta.url)), "..", "page");
  const source = readFileSync(join(pageDir, "app.js"), "utf8");
  const match = /var DEFAULTS = (\{[\s\S]*?\n  \});/.exec(source);
  assert.ok(match, "page/app.js must declare a var DEFAULTS object literal");
  const pageDefaults = new Function(`return ${match[1]};`)();

  const libKeys = Object.keys(LIB_DEFAULTS).sort();
  const pageKeys = Object.keys(pageDefaults).sort();
  assert.deepEqual(pageKeys, libKeys);
  for (const key of libKeys) {
    assert.deepEqual(pageDefaults[key], LIB_DEFAULTS[key], `DEFAULTS.${key} drifted`);
  }
});
