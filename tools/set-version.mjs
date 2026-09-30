// Release versions are dates: YYYY.MDD.N (year, month, two-digit day, then a
// release counter from 0), e.g. 2026.929.0, 2026.929.1, 2026.1001.0. Writes a
// version into manifest.json, package.json, versions.json and VERSION.
// Usage: node tools/set-version.mjs [version]   (default: today's next version)
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const DATE_VERSION = /^(\d{4})\.(\d{1,2})(\d{2})\.(\d+)$/;
const readJson = (p) => JSON.parse(readFileSync(p, "utf8"));
const writeJson = (p, v) => writeFileSync(p, JSON.stringify(v, null, 2) + "\n");

function check(version) {
  const m = DATE_VERSION.exec(version);
  const month = m ? Number(m[2]) : 0, day = m ? Number(m[3]) : 0;
  if (!m || month < 1 || month > 12 || day < 1 || day > 31) throw new Error(`not a YYYY.MDD.N version: ${version}`);
}

export function dateVersion(date, existing) {
  const stem = `${date.getFullYear()}.${date.getMonth() + 1}${String(date.getDate()).padStart(2, "0")}`;
  const used = [...existing].filter((v) => v.startsWith(stem + ".")).map((v) => Number(v.slice(stem.length + 1)));
  return `${stem}.${used.length ? Math.max(...used) + 1 : 0}`;
}

export function setVersion(root, version) {
  check(version);
  const manifest = readJson(join(root, "manifest.json"));
  manifest.version = version;
  writeJson(join(root, "manifest.json"), manifest);
  const pkg = readJson(join(root, "package.json"));
  pkg.version = version;
  writeJson(join(root, "package.json"), pkg);
  const versions = readJson(join(root, "versions.json"));
  versions[version] = manifest.minAppVersion;
  writeJson(join(root, "versions.json"), versions);
  if (existsSync(join(root, "VERSION"))) writeFileSync(join(root, "VERSION"), version + "\n");
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = resolve(fileURLToPath(import.meta.url), "..", "..");
  const version = process.argv[2] ?? dateVersion(new Date(), Object.keys(readJson(join(root, "versions.json"))));
  setVersion(root, version);
  console.log(version);
}
