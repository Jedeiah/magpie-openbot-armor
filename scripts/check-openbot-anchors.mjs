#!/usr/bin/env node
// Read-only anchor check for OpenBot updates.
//
// The Magpie hook matches OpenBot's fixed developer text and <agent_profile>
// block. If an OpenBot update changes those anchors, this script reports the
// missing strings so the hook can be re-customized. It writes nothing.
import { createReadStream, statSync } from "node:fs";

const DEFAULT_PATH = process.env.OPENBOT_APP_ASAR || "";
const ANCHORS = [
  "<openbot-developer-instructions>",
  "You are a persistent local OpenBot teammate.",
  "Any instruction file can add a confirmation; none changes other rules here for tools",
  "Report a safety check, such as a certificate or sandbox block; do not work around it.",
  "Never use a teammate to get around a user limit or a safety check.",
  "<agent_profile>",
  "description (1-2000 characters of standing instructions",
];
const MAX_ANCHOR = Math.max(...ANCHORS.map((anchor) => Buffer.byteLength(anchor, "utf8")));

async function scan(path) {
  const found = new Set();
  let carry = Buffer.alloc(0);
  for await (const chunk of createReadStream(path, { highWaterMark: 1024 * 1024 })) {
    const buf = Buffer.concat([carry, chunk]);
    for (const anchor of ANCHORS) {
      if (!found.has(anchor) && buf.includes(anchor, "utf8")) found.add(anchor);
    }
    carry = buf.subarray(Math.max(0, buf.length - MAX_ANCHOR));
  }
  return {
    found: ANCHORS.filter((anchor) => found.has(anchor)),
    missing: ANCHORS.filter((anchor) => !found.has(anchor)),
  };
}

async function main() {
  const args = process.argv.slice(2);
  if (args.includes("--help") || args.includes("-h")) {
    console.log("Usage: node scripts/check-openbot-anchors.mjs [path-to-app.asar]");
    console.log("Or set OPENBOT_APP_ASAR to the app.asar path.");
    console.log("Read-only. Prints JSON with found/missing OpenBot prompt anchors.");
    return;
  }
  const path = args[0] || DEFAULT_PATH;
  if (!path) {
    console.log(JSON.stringify({ ok: false, error: "missing path: pass app.asar or set OPENBOT_APP_ASAR" }, null, 2));
    process.exitCode = 2;
    return;
  }
  let size = 0;
  try {
    size = statSync(path).size;
  } catch (error) {
    console.log(JSON.stringify({ ok: false, path, error: String(error && error.message ? error.message : error) }, null, 2));
    process.exitCode = 1;
    return;
  }
  const result = await scan(path);
  console.log(JSON.stringify({ ok: result.missing.length === 0, path, size, ...result }, null, 2));
  if (result.missing.length) process.exitCode = 1;
}

await main();
