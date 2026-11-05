import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

// The zh window must never show mixed language: every t("…") literal in
// app.js must have a zh entry in i18n.js.
test("every app.js t() key has a zh translation", () => {
  const pageDir = join(dirname(fileURLToPath(import.meta.url)), "..", "page");
  const app = readFileSync(join(pageDir, "app.js"), "utf8");
  const i18n = readFileSync(join(pageDir, "i18n.js"), "utf8");

  const keys = new Set();
  for (const match of app.matchAll(/\bt\("((?:[^"\\]|\\.)*)"\)/g)) {
    keys.add(match[1].replace(/\\n/g, "\n"));
  }
  assert.ok(keys.size >= 30, "expected a substantial set of t() keys, got " + keys.size);

  const zhBlock = /zh: \{([\s\S]*?)\n    \},/.exec(i18n);
  assert.ok(zhBlock, "i18n.js must contain a zh table");
  const zhKeys = new Set();
  for (const match of zhBlock[1].matchAll(/"((?:[^"\\]|\\.)*)":/g)) {
    zhKeys.add(match[1].replace(/\\n/g, "\n"));
  }

  // FIELD_HELP descriptions are passed to t() through a variable, so collect
  // their literal `desc: "..."` values too.
  for (const match of app.matchAll(/desc:\s*"((?:[^"\\]|\\.)*)"/g)) {
    keys.add(match[1].replace(/\n/g, "\n"));
  }
  const missing = [...keys].filter((key) => !zhKeys.has(key));
  assert.deepEqual(missing, [], "app.js keys missing from the zh table");

  // Option labels are passed to t() dynamically, so the static scan above
  // cannot see them. Check every declared mode/source label explicitly.
  for (const literal of [
    "off — leave requests alone",
    "observe — compute changes, do not send them",
    "enforce — rewrite matching requests",
    "bundled — full armor.md shipped with this plugin",
    "compact — shorter armor.compact.md (fewer tokens)",
    "file — read a local .md/.txt on every request",
    "inline — text stored in this page's options",
    "Enabled and saved. Next:",
    "Go to OpenBot and chat once with any bot.",
    "Ask: “全局执行协议是否已加载？” It should answer yes.",
    "If it does not, check that the plugin is on and the armor source is not empty.",
  ]) {
    assert.ok(zhKeys.has(literal), "missing zh option label: " + literal);
  }
});

// The dropdown labels are rebuilt by app.js from these arrays; this locks the
// values to what the hook and lib expect.
test("mode and source option values match the lib contract", () => {
  const pageDir = join(dirname(fileURLToPath(import.meta.url)), "..", "page");
  const app = readFileSync(join(pageDir, "app.js"), "utf8");
  assert.match(app, /\["off", "off — leave requests alone"\]/);
  assert.match(app, /\["observe", "observe — compute changes, do not send them"\]/);
  assert.match(app, /\["enforce", "enforce — rewrite matching requests"\]/);
  assert.match(app, /\["bundled", "bundled — full armor\.md shipped with this plugin"\]/);
  assert.match(app, /\["compact", "compact — shorter armor\.compact\.md \(fewer tokens\)"\]/);
  assert.match(app, /\["file", "file — read a local \.md\/\.txt on every request"\]/);
  assert.match(app, /\["inline", "inline — text stored in this page's options"\]/);
});
