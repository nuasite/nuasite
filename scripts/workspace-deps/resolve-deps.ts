import fs from "node:fs";
import path from "node:path";
import os from "node:os";

type J = Record<string, any>;
const FIELDS = ["dependencies","devDependencies","peerDependencies","optionalDependencies"] as const;

const pkgDir = process.cwd();
const pkgFile = path.join(pkgDir, "package.json");

function readJSON(p: string): J { return JSON.parse(fs.readFileSync(p, "utf8")); }
function hasWorkspaces(dir: string) {
  try { const j = readJSON(path.join(dir, "package.json")); return !!j.workspaces; } catch { return false; }
}
function findRepoRoot(start: string) {
  let d = start;
  for (;;) {
    if (fs.existsSync(path.join(d, "pnpm-workspace.yaml")) || hasWorkspaces(d) || fs.existsSync(path.join(d, ".git"))) return d;
    const p = path.dirname(d); if (p === d) return start; d = p;
  }
}
function listWorkspacePackageDirs(root: string) {
  const out = new Set<string>();
  try {
    const j = readJSON(path.join(root, "package.json"));
    const ws = (j.workspaces?.packages ?? j.workspaces) as string[] | undefined;
    if (Array.isArray(ws)) {
      for (const pat of ws) {
        if (!pat.endsWith("/*")) continue;
        const base = path.join(root, pat.slice(0, -2));
        if (!fs.existsSync(base)) continue;
        for (const e of fs.readdirSync(base)) {
          const d = path.join(base, e);
          if (fs.existsSync(path.join(d, "package.json"))) out.add(d);
        }
      }
    }
  } catch {}
  // simple fallbacks
  for (const base of ["packages", "apps"]) {
    const b = path.join(root, base);
    if (!fs.existsSync(b)) continue;
    for (const e of fs.readdirSync(b)) {
      const d = path.join(b, e);
      if (fs.existsSync(path.join(d, "package.json"))) out.add(d);
    }
  }
  return [...out];
}
function collectVersions(root: string) {
  const map = new Map<string,string>();
  for (const d of listWorkspacePackageDirs(root)) {
    try { const j = readJSON(path.join(d, "package.json")); if (j.name && j.version) map.set(j.name, String(j.version)); } catch {}
  }
  return map;
}
function rewriteManifest(pkgFile: string, versions: Map<string,string>) {
  const json = readJSON(pkgFile);
  const unresolved: string[] = [];
  for (const f of FIELDS) {
    const deps = json[f]; if (!deps) continue;
    for (const [name, range] of Object.entries(deps)) {
      const r = String(range);
      if (!r.startsWith("workspace:")) continue;
      const v = versions.get(name); if (!v) { unresolved.push(`${f}:${name}`); continue; }
      const tag = r.slice("workspace:".length); // "", "*", "^", "~"
      (deps as any)[name] = tag === "^" ? `^${v}` : tag === "~" ? `~${v}` : v; // exact for "" or "*"
    }
  }
  fs.writeFileSync(pkgFile, JSON.stringify(json, null, 2) + "\n");
  return unresolved;
}

// main
const repoRoot = findRepoRoot(pkgDir);
const versions = collectVersions(repoRoot);

// backup to OS temp so it never leaks into tarball
const ledgerDir = path.join(os.tmpdir(), "ws-ledgers");
fs.mkdirSync(ledgerDir, { recursive: true });
const ledgerPath = path.join(ledgerDir, Buffer.from(pkgDir).toString("base64url") + ".json");
fs.writeFileSync(ledgerPath, fs.readFileSync(pkgFile, "utf8"));

const unresolved = rewriteManifest(pkgFile, versions);

// fail-fast if any workspace remains
const after = fs.readFileSync(pkgFile, "utf8");
if (/\"workspace:/.test(after) || unresolved.length) {
  console.error(`[workspace-deps] FAILED in ${path.basename(pkgDir)} | root=${repoRoot} | versions=${versions.size}`);
  if (unresolved.length) console.error(`unresolved: ${unresolved.join(", ")}`);
  process.exit(1);
} else {
  console.error(`[workspace-deps] OK in ${path.basename(pkgDir)}`);
}
