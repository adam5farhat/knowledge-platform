#!/usr/bin/env node
/**
 * Remove apps/web/.next so dev server chunk manifests and RSC payloads stay in sync.
 * Fixes "Cannot find module './611.js'", "__webpack_modules__[moduleId] is not a function",
 * and similar webpack-runtime / RSC flight desync after HMR, turbopack↔webpack switches, or crashes.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const nextDir = path.join(repoRoot, "apps", "web", ".next");

try {
  fs.rmSync(nextDir, { recursive: true, force: true });
  console.log(`Removed ${nextDir}`);
} catch (e) {
  const err = /** @type {NodeJS.ErrnoException} */ (e);
  if (err.code !== "ENOENT") throw err;
  console.log(`Nothing to remove (${nextDir})`);
}
