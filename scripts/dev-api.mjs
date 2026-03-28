#!/usr/bin/env node
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const apiDir = path.join(repoRoot, "apps", "api");

/** Do not inherit a shared `PORT` from the shell (e.g. monorepo dev) — API must stay off the web port. */
const env = { ...process.env, PORT: process.env.API_PORT || "3001" };

const proc = spawn("npx", ["tsx", "watch", "src/index.ts"], {
  cwd: apiDir,
  stdio: "inherit",
  shell: true,
  env,
});

proc.on("exit", (code, signal) => {
  if (signal) process.exit(1);
  process.exit(code ?? 0);
});
