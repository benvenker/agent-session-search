import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export type PackageVersion = `${number}.${number}.${number}`;

export function packageVersion(): PackageVersion {
  const packageJsonPath = join(
    dirname(fileURLToPath(import.meta.url)),
    "..",
    "package.json"
  );
  const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf8")) as {
    version?: unknown;
  };
  return isPackageVersion(packageJson.version) ? packageJson.version : "0.0.0";
}

function isPackageVersion(value: unknown): value is PackageVersion {
  return typeof value === "string" && /^\d+\.\d+\.\d+$/.test(value);
}
