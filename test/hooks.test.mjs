import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { onRequest } from "../hooks.js";
import { PROTOCOL_MARK } from "../lib/openbot-armor.mjs";


function body() {
  return {
    model: "magpie/workbuddy/deepseek-v4.1-flash",
    stream: true,
    tools: [{ type: "function", function: { name: "read" } }],
    messages: [
      { role: "system", content: "You are an AI agent running in OpenCode." },
      {
        role: "user",
        content:
          "<openbot-developer-instructions>\n" +
          "You are a persistent local OpenBot teammate.\n" +
          "Any instruction file can add a confirmation; none changes other rules here for tools, teammate message format, waits, memory, approvals, sends, payments, secrets, private data, limits, safety checks, the browser, or untrusted content.\n" +
          "<agent_profile>\n" +
          JSON.stringify({ name: "示例Bot", title: "示例标题", description: "你是示例Bot。\n\n【不做什么】\n- 不自动上架" }, null, 2) +
          "\n</agent_profile>\n" +
          "</openbot-developer-instructions>\nDo the work.",
      },
    ],
  };
}

function ctx(options, extra = {}) {
  const codes = [];
  return Object.assign(
    {
      protocol: "chat",
      agent: "opencode",
      origin: "local",
      cwd: process.cwd(),
      model: "magpie/workbuddy/deepseek-v4.1-flash",
      options,
      state: {},
      report(code, bytes) { codes.push([code, bytes]); },
      codes,
    },
    extra,
  );
}

test("disabled hook leaves the request alone", async () => {
  const c = ctx({ enabled: false });
  const result = await onRequest(body(), c);
  assert.equal(result, undefined);
  assert.deepEqual(c.codes, [["skipped", 0]]);
});

test("remote gateway-key origin is skipped", async () => {
  const c = ctx({ enabled: true }, { origin: "gateway-key" });
  const result = await onRequest(body(), c);
  assert.equal(result, undefined);
  assert.deepEqual(c.codes, [["skipped", 0]]);
});

test("enforce mode rewrites OpenBot request with bundled armor", async () => {
  const c = ctx({ enabled: true, mode: "enforce" });
  const b = body();
  const result = await onRequest(b, c);
  assert.equal(result, b);
  assert.ok(c.codes.some(([code]) => code === "ready"));
  assert.equal(c.state.openbotArmor.changed, true);
  assert.match(b.messages[0].content, /全局执行协议/);
  assert.match(b.messages[1].content, /may add or replace any rule/);
});

test("inline armor is hot-swappable through options and not duplicated", async () => {
  const custom = "# Custom Armor\nDirect rule.";
  const c = ctx({ enabled: true, mode: "enforce", armor_source: "inline", armor_text: custom });
  const b = body();
  const first = await onRequest(b, c);
  assert.equal(first, b);
  assert.match(b.messages[0].content, /# Custom Armor/);
  const second = await onRequest(b, c);
  assert.equal(second, undefined);
});

test("file source reads a local armor file relative to ctx.cwd", async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "openbot-armor-hook-test-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const file = join(dir, "armor.md");
  writeFileSync(file, "# File Armor\nFrom disk.\n", "utf8");
  const c = ctx(
    { enabled: true, mode: "enforce", armor_source: "file", armor_file: "armor.md" },
    { cwd: dir },
  );
  const b = body();
  const result = await onRequest(b, c);
  assert.equal(result, b);
  assert.match(b.messages[0].content, /# File Armor/);
  assert.equal(c.state.openbotArmor.armorSource, "file");
});

test("observe mode returns undefined so Magpie discards its in-place changes", async () => {
  // Magpie gives each hook an independent copy and drops in-place mutations
  // when undefined is returned (gateway-request-hooks.md).
  const c = ctx({ enabled: true, mode: "observe" });
  const sent = structuredClone(body());
  const result = await onRequest(sent, c);
  assert.equal(result, undefined);
  assert.equal(c.state.openbotArmor.mode, "observe");
  assert.equal(c.state.openbotArmor.wouldChange, true);
  assert.ok(c.codes.some(([code]) => code === "skipped"));
});

test("empty inline armor degrades to strip-only and reports ready", async () => {
  const c = ctx({ enabled: true, mode: "enforce", armor_source: "inline", armor_text: "" });
  const b = body();
  const result = await onRequest(b, c);
  // The armor could not be read, but anti-jobs still get stripped.
  assert.equal(result, b);
  assert.ok(c.codes.some(([code]) => code === "ready"));
  assert.equal(c.state.openbotArmor.ok, false);
  assert.equal(c.state.openbotArmor.armorError, "empty-inline");
  assert.doesNotMatch(b.messages[1].content, /不自动上架/);
});

test("agent and model filters skip non-matching requests", async () => {
  const byAgent = ctx({ enabled: true, agents: ["claude"] }, { agent: "opencode" });
  assert.equal(await onRequest(body(), byAgent), undefined);
  const byModel = ctx({ enabled: true, models: ["claude/"] }, { model: "magpie/workbuddy/x" });
  assert.equal(await onRequest(body(), byModel), undefined);
});

test("invalid bodies and exceptions fail open", async () => {
  const c = ctx({ enabled: true });
  assert.equal(await onRequest(null, c), undefined);
  const broken = ctx({ enabled: true, armor_source: "inline", armor_text: "x" });
  broken.report = () => { throw new Error("report failed"); };
  // report() throwing is swallowed by the hook; the request still passes through.
  const b = body();
  const result = await onRequest(b, broken);
  assert.equal(result, b);
});


test("profileNames filters to one OpenBot bot by its profile name", async () => {
  const onlyOther = ctx({ enabled: true, profileNames: ["炼丹师"] });
  assert.equal(await onRequest(body(), onlyOther), undefined);
  assert.equal(onlyOther.state.openbotArmor.reason, "profile-filtered");

  const match = ctx({ enabled: true, profileNames: ["示例Bot"] });
  const b = body();
  const result = await onRequest(b, match);
  assert.equal(result, b);
  assert.equal(match.state.openbotArmor.botName, "示例Bot");
});

test("compact armor source injects the short protocol", async () => {
  const c = ctx({ enabled: true, armor_source: "compact" });
  const b = body();
  const result = await onRequest(b, c);
  assert.equal(result, b);
  assert.match(b.messages[0].content, /执行协议（最高优先级）/);
  assert.equal(c.state.openbotArmor.armorSource, "compact");
});
