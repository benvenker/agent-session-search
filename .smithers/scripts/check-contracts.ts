const proc = Bun.spawnSync({
  cmd: ["bun", "test", "tests"],
  stdout: "inherit",
  stderr: "inherit",
});

if (!proc.success) {
  process.exit(proc.exitCode ?? 1);
}
