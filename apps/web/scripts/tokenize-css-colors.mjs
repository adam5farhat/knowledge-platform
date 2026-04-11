import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

function walk(dir, acc = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory() && e.name !== "node_modules" && e.name !== ".next") walk(p, acc);
    else if (e.isFile() && p.endsWith(".module.css")) acc.push(p);
  }
  return acc;
}

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const files = [...walk(path.join(root, "app")), ...walk(path.join(root, "components"))];

const pairs = [
  [/background:\s*#fff\s*;/g, "background: var(--surface);"],
  [/background:\s*#ffffff\s*;/g, "background: var(--surface);"],
  [/background:\s*#fafbfc\s*;/g, "background: var(--surface-subtle);"],
  [/background:\s*#f8fafc\s*;/g, "background: var(--table-header-bg);"],
  [/background:\s*#f4f4f5\s*;/g, "background: var(--surface-muted);"],
  [/background:\s*#f1f5f9\s*;/g, "background: var(--surface-hover);"],
  [/background:\s*#eef4f8\s*;/g, "background: var(--surface-hover);"],
  [/background:\s*#dde8f0\s*;/g, "background: var(--surface-muted);"],
  [/border:\s*1px solid #e2e8f0\s*;/g, "border: 1px solid var(--nav-border);"],
  [/border-bottom:\s*1px solid #e2e8f0\s*;/g, "border-bottom: 1px solid var(--nav-border);"],
  [/border-top:\s*1px solid #e2e8f0\s*;/g, "border-top: 1px solid var(--nav-border);"],
  [/border-right:\s*1px solid #e2e8f0\s*;/g, "border-right: 1px solid var(--nav-border);"],
  [/border-left:\s*1px solid #e2e8f0\s*;/g, "border-left: 1px solid var(--nav-border);"],
  [/border:\s*1px solid #e4e4e7\s*;/g, "border: 1px solid var(--border);"],
];

let touched = 0;
for (const f of files) {
  let s = fs.readFileSync(f, "utf8");
  const orig = s;
  for (const [re, rep] of pairs) s = s.replace(re, rep);
  s = s.replace(/\.profileBtn\s*\{([\s\S]*?)\}/g, (match, inner) => {
    if (!/color:\s*#fff/.test(inner) && !/color:\s*#ffffff/.test(inner)) return match;
    return match
      .replace(/color:\s*#fff\s*;/g, "color: var(--on-interactive);")
      .replace(/color:\s*#ffffff\s*;/g, "color: var(--on-interactive);");
  });
  if (s !== orig) {
    fs.writeFileSync(f, s);
    touched++;
    console.log("updated", path.relative(root, f));
  }
}
console.log("files touched", touched);
