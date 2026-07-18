#!/usr/bin/env node
import { chmod } from "node:fs/promises";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

const packageJson = JSON.parse(await readFile("package.json", "utf8"));
const binTargets = Object.values(packageJson.bin ?? {});

if (binTargets.length === 0) {
  process.exit(0);
}

await Promise.all(
  binTargets.map(async (target) => {
    const path = join(process.cwd(), target);
    await chmod(path, 0o755);
  })
);

console.log(`chmod 755 ${binTargets.join(" ")}`);
