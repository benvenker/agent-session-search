# Release Process

Publishing is tag-driven through GitHub Actions and npm trusted publishing. There is no npm token in this repo.

## Local Verification

From the repository root:

```bash
npm install
npm run check
npm test
npm run build
npm run smoke
```

`npm run smoke` exercises the stdio MCP path against a fixture root. Run it locally when changing `src/server.ts`, MCP result behavior, or package entry points.

## Verify The Packed Package

```bash
npm pack --dry-run --json
tmpdir="$(mktemp -d)"
npm pack --pack-destination "$tmpdir"
mkdir "$tmpdir/app"
cd "$tmpdir/app"
npm init -y
npm install --foreground-scripts --no-audit --no-fund "$tmpdir"/agent-session-search-*.tgz
npx agent-session-search-doctor
npx agent-session-search "auth token timeout" --json
```

`npx agent-session-search-mcp` starts a stdio server and waits for MCP input, so run it only when you are intentionally testing MCP startup.

## One-Time npm Setup

On npmjs.com, add a trusted publisher for `@benvenker/agent-session-search` using:

- provider: GitHub Actions
- repository: `benvenker/agent-session-search`
- workflow: `.github/workflows/publish.yml`

The workflow uses `id-token: write` and `npm publish --access public`.

## Publish

```bash
npm version patch   # or minor / major
git push origin main --follow-tags
```

The pushed `vX.Y.Z` tag runs CI, checks that the tag matches `package.json`, publishes that version to npm, and creates the GitHub Release marked as latest.

The publish workflow runs the tests that do not require a locally installed `fff-mcp`; local smoke testing covers the stdio MCP path.
