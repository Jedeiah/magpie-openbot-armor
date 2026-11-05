// Shared option normalization and armor source resolution for the hook.
// The page keeps its own copy of DEFAULTS because Magpie plugin pages are
// sandboxed classic scripts and cannot import ES modules from lib/.
import { COMPACT_ARMOR_FILE, DEFAULT_ARMOR_FILE, readArmorFile, readBundledArmor, readCompactArmor } from "./armor.mjs";

export const MODES = ["off", "observe", "enforce"];
export const ARMOR_SOURCES = ["bundled", "compact", "file", "inline"];
export const DEFAULT_ALLOWED_ORIGINS = ["local", "magpie-key", "unknown"];

export const DEFAULTS = {
  enabled: false,
  mode: "enforce",
  gatewayTimeoutMs: 3000,
  armor_source: "bundled",
  armor_file: "",
  armor_text: "",
  injectArmor: true,
  stripPersonaSections: true,
  stripTaskBullets: true,
  stripEnglishAntiJobs: true,
  stripEnglishSections: true,
  targetAllOpenCode: false,
  allowedOrigins: DEFAULT_ALLOWED_ORIGINS.slice(),
  agents: [],
  models: [],
  profileNames: [],
};

function asBoolean(value, fallback) {
  if (value === undefined || value === null) return fallback;
  if (typeof value === "boolean") return value;
  if (value === "true") return true;
  if (value === "false") return false;
  return fallback;
}

function asStringArray(value) {
  if (typeof value === "string") {
    return value
      .split(/[,，\n]/)
      .map((item) => item.trim())
      .filter(Boolean);
  }
  if (!Array.isArray(value)) return [];
  return value
    .filter((item) => typeof item === "string")
    .map((item) => item.trim())
    .filter(Boolean);
}

export function firstString(options, names) {
  for (const name of names) {
    const value = options && options[name];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}

export function normalizeOptions(raw) {
  const input = raw && typeof raw === "object" ? raw : {};
  const opts = Object.assign({}, DEFAULTS, input);
  opts.enabled = asBoolean(opts.enabled, DEFAULTS.enabled);
  opts.mode = MODES.includes(opts.mode) ? opts.mode : DEFAULTS.mode;
  opts.armor_source = ARMOR_SOURCES.includes(input.armor_source)
    ? input.armor_source
    : ARMOR_SOURCES.includes(input.armorSource)
      ? input.armorSource
      : DEFAULTS.armor_source;
  opts.armor_text =
    typeof input.armor_text === "string"
      ? input.armor_text
      : typeof input.armorText === "string"
        ? input.armorText
        : DEFAULTS.armor_text;
  opts.armor_file = firstString(opts, [
    "armor_file",
    "armorFile",
    "prompt_file",
    "persona_file",
  ]);
  opts.injectArmor = asBoolean(opts.injectArmor, DEFAULTS.injectArmor);
  opts.stripPersonaSections = asBoolean(opts.stripPersonaSections, DEFAULTS.stripPersonaSections);
  opts.stripTaskBullets = asBoolean(opts.stripTaskBullets, DEFAULTS.stripTaskBullets);
  opts.stripEnglishAntiJobs = asBoolean(opts.stripEnglishAntiJobs, DEFAULTS.stripEnglishAntiJobs);
  opts.stripEnglishSections = asBoolean(opts.stripEnglishSections, DEFAULTS.stripEnglishSections);
  opts.targetAllOpenCode = asBoolean(opts.targetAllOpenCode, DEFAULTS.targetAllOpenCode);
  opts.allowedOrigins = asStringArray(opts.allowedOrigins);
  if (!opts.allowedOrigins.length) opts.allowedOrigins = DEFAULT_ALLOWED_ORIGINS.slice();
  opts.agents = asStringArray(opts.agents);
  opts.models = asStringArray(opts.models);
  opts.profileNames = asStringArray(opts.profileNames);
  opts.gatewayTimeoutMs =
    Number.isInteger(opts.gatewayTimeoutMs) &&
    opts.gatewayTimeoutMs >= 100 &&
    opts.gatewayTimeoutMs <= 10000
      ? opts.gatewayTimeoutMs
      : DEFAULTS.gatewayTimeoutMs;
  return opts;
}

export function resolveArmor(options, ctx = {}) {
  const opts = normalizeOptions(options);
  if (opts.injectArmor === false) {
    return { ok: true, text: "", source: "none", file: "", reason: "" };
  }

  if (opts.armor_source === "inline") {
    const text = opts.armor_text.trim();
    return text
      ? { ok: true, text, source: "inline", file: "", reason: "" }
      : { ok: false, text: "", source: "inline", file: "", reason: "empty-inline" };
  }

  if (opts.armor_source === "file") {
    if (!opts.armor_file) {
      return { ok: false, text: "", source: "file", file: "", reason: "empty-path" };
    }
    const got = readArmorFile(opts.armor_file, ctx.cwd);
    const text = got.text.trim();
    return got.ok && text
      ? { ok: true, text, source: "file", file: got.file, reason: "" }
      : { ok: false, text: "", source: "file", file: got.file, reason: "unreadable-file" };
  }

  if (opts.armor_source === "compact") {
    const got = readCompactArmor();
    const text = got.text.trim();
    return got.ok && text
      ? { ok: true, text, source: "compact", file: got.file || COMPACT_ARMOR_FILE, reason: "" }
      : { ok: false, text: "", source: "compact", file: COMPACT_ARMOR_FILE, reason: "missing-compact" };
  }

  const got = readBundledArmor();
  const text = got.text.trim();
  return got.ok && text
    ? { ok: true, text, source: "bundled", file: got.file || DEFAULT_ARMOR_FILE, reason: "" }
    : { ok: false, text: "", source: "bundled", file: DEFAULT_ARMOR_FILE, reason: "missing-bundled" };
}

export function allowedOrigin(options, origin) {
  const value = String(origin || "unknown");
  const opts = normalizeOptions(options);
  return opts.allowedOrigins.includes(value);
}

export function allowedAgent(options, agent) {
  const opts = normalizeOptions(options);
  if (!opts.agents.length) return true;
  return opts.agents.includes(String(agent || ""));
}

export function allowedModel(options, body, ctx = {}) {
  const opts = normalizeOptions(options);
  if (!opts.models.length) return true;
  const model = String((body && body.model) ?? ctx.model ?? "");
  return opts.models.some((prefix) => model.startsWith(prefix));
}

export function armorBytes(text) {
  return new TextEncoder().encode(String(text ?? "")).length;
}

export function cloneBody(body) {
  if (typeof structuredClone === "function") return structuredClone(body);
  return JSON.parse(JSON.stringify(body));
}
