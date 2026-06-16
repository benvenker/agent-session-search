export const repoCommands = {
  lint: "npm run check",
  test: "npm test",
  coverage: null,
} as const;

export default { repoCommands };
