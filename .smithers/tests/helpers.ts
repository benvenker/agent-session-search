import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = new URL("..", import.meta.url).pathname;

export function read(path: string) {
  return readFileSync(join(root, path), "utf8");
}
