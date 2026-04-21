/**
 * Lightweight in-process feature-flag / A-B testing helper.
 *
 * Why not LaunchDarkly / Statsig?
 *   - Those are great but require an external service, an SDK, and a paid
 *     account. For our use case (try prompt v2 vs v3 on 50%% of users, see
 *     which scores better on feedback) we just need:
 *
 *       1. A stable per-user variant assignment (same user → same variant).
 *       2. A way to declare flags via env vars (no UI churn, no extra infra).
 *       3. The chosen variant returned to the caller so feedback can be
 *          joined to it later.
 *
 *   This module does exactly that and nothing more.
 *
 * Defining a flag:
 *   In .env, set `FLAG_<UPPERCASE_NAME>=variantA:weightA,variantB:weightB`.
 *   Weights don't have to sum to 1 — they're normalised. Example:
 *
 *       FLAG_PROMPT=v3:1            # everyone gets v3 (default)
 *       FLAG_PROMPT=v2:1,v3:1       # 50/50 split between v2 and v3
 *       FLAG_PROMPT=v3:8,v2:2       # 80/20 split
 *
 *   Then in code:
 *
 *       const variant = pickVariant("prompt", userId) ?? config.rag.promptVersion;
 *
 * The variant is deterministic per `userId` so a user keeps seeing the same
 * variant across requests — essential for clean A/B comparison.
 */

import { createHash } from "node:crypto";

interface FlagDef {
  variants: { name: string; weight: number }[];
  total: number;
}

const cache = new Map<string, FlagDef | null>();

function readFlag(name: string): FlagDef | null {
  const envKey = `FLAG_${name.toUpperCase()}`;
  const raw = process.env[envKey];
  if (!raw) return null;

  const parts = raw
    .split(",")
    .map((p) => p.trim())
    .filter(Boolean);

  const variants: { name: string; weight: number }[] = [];
  for (const p of parts) {
    const [n, w] = p.split(":");
    if (!n) continue;
    const weight = w ? Number(w) : 1;
    if (!Number.isFinite(weight) || weight <= 0) continue;
    variants.push({ name: n.trim(), weight });
  }
  if (variants.length === 0) return null;
  return { variants, total: variants.reduce((s, v) => s + v.weight, 0) };
}

function getFlag(name: string): FlagDef | null {
  if (!cache.has(name)) cache.set(name, readFlag(name));
  return cache.get(name) ?? null;
}

/**
 * Stable hash-based variant pick for `(flagName, subjectKey)`. Returns
 * `null` if the flag is undefined, allowing callers to fall through to a
 * static default.
 *
 * @param flagName  e.g. "prompt"
 * @param subjectKey usually a userId; falls back to "anon" when unknown.
 *                   Same subjectKey + same env config = same variant always.
 */
export function pickVariant(flagName: string, subjectKey: string | null | undefined): string | null {
  const flag = getFlag(flagName);
  if (!flag) return null;
  if (flag.variants.length === 1) return flag.variants[0]!.name;

  const hash = createHash("sha1")
    .update(`${flagName}:${subjectKey ?? "anon"}`)
    .digest();
  // Use the first 4 bytes as an unsigned int → map to [0, total).
  const intVal = hash.readUInt32BE(0);
  const point = (intVal / 0xffffffff) * flag.total;

  let cum = 0;
  for (const v of flag.variants) {
    cum += v.weight;
    if (point <= cum) return v.name;
  }
  return flag.variants[flag.variants.length - 1]!.name;
}

/** Test-only: forget cached env reads so unit tests can mutate process.env. */
export function _resetFlagCacheForTests(): void {
  cache.clear();
}
