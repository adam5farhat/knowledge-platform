#!/usr/bin/env node
/**
 * Run Next from apps/web with a guaranteed cwd so `.next` and `/_next/static/*`
 * always resolve (fixes 404 on layout.css / chunks when npm/concurrently cwd differs).
 *
 * Default is Webpack (`next dev`). Turbopack can error on Windows with a broken
 * `.next/server/pages/_document.js` require (`[turbopack]_runtime.js` missing) during
 * error overlay / HMR. Opt in with NEXT_TURBOPACK_DEV=1 if you want `--turbopack`.
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const webDir = path.join(repoRoot, "apps", "web");

if (!fs.existsSync(path.join(webDir, "package.json"))) {
  console.error("dev-web.mjs: apps/web/package.json not found (wrong repo root?).");
  process.exit(1);
}

console.error(`[kp dev-web] cwd=${webDir}`);
console.error(
  `[kp dev-web] If console shows "RSC payload … dev … client … production" or prefetch errors: you have PRODUCTION _next chunks cached while on DEV. Fix: stop "next start", run only "npm run dev", then Chrome → DevTools → Application → Clear site data for localhost (or use a private window), then hard-refresh.`,
);
console.error(
  `[kp dev-web] Missing chunk (./402.js) / CSS 404: "npm run clean:web", restart dev, one server on this port.`,
);

/** Match API `PUBLIC_API_URL` when only one of the two is set (avatar URLs + `next/image` remotePatterns). */
const alignedPublicApi =
  (process.env.NEXT_PUBLIC_API_URL || process.env.PUBLIC_API_URL || "http://localhost:3001").replace(/\/$/, "");

/** Web dev port; ignore shell `PORT` so it never collides with API when using `npm run dev`. */
const env = {
  ...process.env,
  PORT: process.env.WEB_PORT || "3000",
  NEXT_PUBLIC_API_URL: process.env.NEXT_PUBLIC_API_URL?.replace(/\/$/, "") || alignedPublicApi,
};

const devArgs = env.NEXT_TURBOPACK_DEV === "1" ? ["next", "dev", "--turbopack"] : ["next", "dev"];
if (env.NEXT_TURBOPACK_DEV === "1") {
  console.error("[kp dev-web] NEXT_TURBOPACK_DEV=1: using Turbopack (Webpack is the default).");
}

const proc = spawn("npx", devArgs, {
  cwd: webDir,
  stdio: "inherit",
  shell: true,
  env,
});

proc.on("exit", (code, signal) => {
  if (signal) process.exit(1);
  process.exit(code ?? 0);
});
