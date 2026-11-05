// Reads armor protocol files. The bundled armor.md is the default source;
// armor.compact.md is the shorter variant; an explicit file path is resolved
// against Magpie's request cwd (or ~).
import { readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const LIB_DIR = dirname(fileURLToPath(import.meta.url));
export const DEFAULT_ARMOR_FILE = resolve(LIB_DIR, "..", "armor.md");
export const COMPACT_ARMOR_FILE = resolve(LIB_DIR, "..", "armor.compact.md");

export function expandHome(value, cwd = process.cwd()) {
  const text = String(value ?? "").trim();
  if (!text) return "";
  if (text === "~") return homedir();
  if (text.startsWith("~/") || text.startsWith("~\\")) {
    return resolve(homedir(), text.slice(2));
  }
  return isAbsolute(text) ? text : resolve(cwd || process.cwd(), text);
}

const FRONTMATTER = /^---[ \t]*\r?\n[\s\S]*?\r?\n---[ \t]*(?:\r?\n|$)/;
const cache = new Map();

export function readArmorFile(file, cwd) {
  const path = expandHome(file, cwd);
  if (!path) return { ok: false, file: "", text: "" };
  try {
    const stat = statSync(path);
    const hit = cache.get(path);
    if (hit && hit.mtimeMs === stat.mtimeMs && hit.size === stat.size) {
      return { ok: true, file: path, text: hit.text };
    }
    const text = readFileSync(path, "utf8").replace(/^\uFEFF/, "").replace(FRONTMATTER, "").trim();
    cache.set(path, { mtimeMs: stat.mtimeMs, size: stat.size, text });
    return { ok: true, file: path, text };
  } catch {
    return { ok: false, file: path, text: "" };
  }
}

export function readBundledArmor() {
  return readArmorFile(DEFAULT_ARMOR_FILE, process.cwd());
}

export function readCompactArmor() {
  return readArmorFile(COMPACT_ARMOR_FILE, process.cwd());
}
