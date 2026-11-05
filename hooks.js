// Magpie asynchronous gateway hook for OpenBot.
//
// Runs in Magpie's Bun plugin host, so node:fs is available and the page can
// hot-swap options. It returns a modified body only when it actually changed
// a request; every failure path keeps the original request. It never changes
// tools, tool_choice, model or stream: Magpie rejects a hook that does.
import {
  allowedAgent,
  allowedModel,
  allowedOrigin,
  armorBytes,
  normalizeOptions,
  resolveArmor,
} from "./lib/options.mjs";
import { applyToRequest, looksLikeOpenBot } from "./lib/openbot-armor.mjs";

function report(ctx, code, bytes = 0) {
  try {
    ctx?.report?.(code, bytes);
  } catch {
    /* reporting must never break the request */
  }
}

function setState(ctx, status) {
  try {
    if (ctx?.state && typeof ctx.state === "object") {
      ctx.state.openbotArmor = status;
    }
  } catch {
    /* state is optional diagnostics, never a request path */
  }
}


export async function onRequest(body, ctx) {
  try {
    const options = normalizeOptions(ctx?.options);
    const origin = typeof ctx?.origin === "string" && ctx.origin ? ctx.origin : "unknown";
    const protocol = ctx?.protocol;
    if (options.enabled !== true || options.mode === "off") {
      report(ctx, "skipped", 0);
      return;
    }
    if (!allowedOrigin(options, origin)) {
      report(ctx, "skipped", 0);
      return;
    }
    if (!allowedAgent(options, ctx?.agent) || !allowedModel(options, body, ctx || {})) {
      report(ctx, "skipped", 0);
      return;
    }

    // Only touch requests that are actually OpenBot: resolving a bad armor
    // file for every unrelated OpenCode/Magpie request would report errors
    // and read the disk for nothing.
    const agentName = String(ctx?.agent || "").toLowerCase();
    const target =
      looksLikeOpenBot(body, protocol) ||
      (options.targetAllOpenCode === true && (agentName === "opencode" || agentName === "openbot"));
    if (!target) {
      report(ctx, "skipped", 0);
      return;
    }

    // Armor source. If it fails we do NOT abandon the request: anti-job
    // stripping still runs, and the failure is reported as "invalid".
    let armorText = "";
    let armorSource = "none";
    let armorError = "";
    if (options.injectArmor !== false) {
      const armor = resolveArmor(options, ctx || {});
      if (armor.ok) {
        armorText = armor.text;
        armorSource = armor.source;
      } else {
        armorError = armor.reason;
        armorSource = armor.source;
      }
    }

    if (options.mode === "observe") {
      // Magpie hands each hook an independent copy and discards in-place
      // mutations when undefined is returned, so no extra clone is needed.
      const result = applyToRequest(
        body,
        protocol,
        Object.assign({}, options, { mode: "enforce" }),
        armorText,
        ctx || {},
      );
      setState(ctx, {
        ok: true,
        mode: "observe",
        wouldChange: result.changed,
        reason: result.reason || "",
        armorSource,
        armorError,
        armorBytes: armorBytes(armorText),
      });
      report(ctx, armorError ? "invalid" : "skipped", armorBytes(armorText));
      return;
    }

    const result = applyToRequest(body, protocol, options, armorText, ctx || {});
    setState(ctx, {
      ok: !armorError,
      mode: options.mode,
      changed: result.changed,
      reason: result.reason || "",
      openbot: result.openbot,
      botName: result.botName || "",
      fallbackOpenCode: result.fallbackOpenCode,
      armorSource,
      armorError,
      armorBytes: armorBytes(armorText),
      origin,
    });
    // A missing armor file is not a failed request: stripping still ran.
    if (result.changed) report(ctx, "ready", armorBytes(armorText));
    else if (armorError) report(ctx, "invalid", 0);
    else report(ctx, "skipped", 0);

    if (result.changed) return body;
    return;
  } catch {
    report(ctx, "invalid", 0);
    setState(ctx, { ok: false, reason: "exception" });
    return;
  }
}
