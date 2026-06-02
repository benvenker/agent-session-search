# Contribution Policy

Bug reports are welcome.

This project does not accept direct outside contributions. You may open an issue, and you may open a PR if it is the clearest way to show a proposed fix, but submitted PRs are not merged directly. Maintainers may inspect them with local tooling and then decide whether to implement the change independently.

For local development:

```bash
npm install
npm run check
npm test
npm run build
```

Run `npm run check:fff` or `agent-session-search-doctor` when changing FFF setup, MCP startup, or real search behavior.
