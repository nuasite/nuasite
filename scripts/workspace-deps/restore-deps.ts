import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const pkgDir = process.cwd();
const pkgFile = path.join(pkgDir, "package.json");
const ledgerDir = path.join(os.tmpdir(), "ws-ledgers");
const ledgerPath = path.join(ledgerDir, Buffer.from(pkgDir).toString("base64url") + ".json");

if (fs.existsSync(ledgerPath)) {
  const original = fs.readFileSync(ledgerPath, "utf8");
  fs.writeFileSync(pkgFile, original);
  fs.rmSync(ledgerPath);
  console.error(`[workspace-deps] restored ${path.basename(pkgDir)}`);
}
