/**
 * Second-pass: map remaining common hex literals to globals.css design tokens.
 * Run from repo root: node apps/web/scripts/extend-dark-tokens.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

function walk(dir, acc = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory() && e.name !== "node_modules" && e.name !== ".next") walk(p, acc);
    else if (e.isFile() && p.endsWith(".module.css")) acc.push(p);
  }
  return acc;
}

const files = [...walk(path.join(root, "app")), ...walk(path.join(root, "components"))];

/** [regex, replacement] — order: specific multi-word first */
const pairs = [
  [/background:\s*#18181b\s*;/g, "background: var(--solid-cta-bg);"],
  [/color:\s*#fafafa\s*;/g, "color: var(--solid-cta-fg);"],
  [/background:\s*#f4f4f6\s*;/g, "background: var(--slab-bg);"],
  [/background:\s*#fafafa\s*;/g, "background: var(--slab-bg-elevated);"],
  [/background:\s*#f8fbff\s*;/g, "background: var(--accent-ice);"],
  [/background:\s*#eff6ff\s*;/g, "background: var(--tint-info);"],
  [/background:\s*#f0fdf4\s*;/g, "background: var(--tint-success);"],
  [/background:\s*#fef2f2\s*;/g, "background: var(--tint-danger);"],
  [/background:\s*#fee2e2\s*;/g, "background: var(--tint-danger-strong);"],
  [/background:\s*#e4e4e7\s*;/g, "background: var(--neutral-pressable);"],
  [/background:\s*#1d4ed8\s*;/g, "background: var(--accent-blue-strong);"],
  [/color:\s*#18181b\s*;/g, "color: var(--text);"],
  [/color:\s*#71717a\s*;/g, "color: var(--muted);"],
  [/color:\s*#a1a1aa\s*;/g, "color: var(--muted);"],
  [/border:\s*1px solid #18181b\s*;/g, "border: 1px solid var(--solid-cta-bg);"],
];

let touched = 0;
for (const f of files) {
  let s = fs.readFileSync(f, "utf8");
  const orig = s;
  for (const [re, rep] of pairs) s = s.replace(re, rep);
  if (s !== orig) {
    fs.writeFileSync(f, s);
    touched++;
    console.log(path.relative(root, f));
  }
}
console.log("files touched:", touched);
