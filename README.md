# Pi Goal Extension

Scaffold for a TypeScript Pi extension that will add Codex-style `/goal` behavior to Pi.

This first foundation step intentionally only provides a loadable `/goal` placeholder. The planned product behavior, state model, commands, model tools, compaction handling, and continuation safeguards are documented in [`docs/implementation.md`](docs/implementation.md) and tracked against [`docs/acceptance-criteria.md`](docs/acceptance-criteria.md).

## Local development

```bash
npm install
npm run typecheck
npm run lint
npm run format
npm test
```

## Loading in Pi

For quick local testing from this repository:

```bash
pi -e ./src/index.ts
```

For project-local auto-discovery, copy or symlink this repository into a Pi project extension location such as:

```text
.pi/extensions/pi-goal/
```

The package also declares Pi extension metadata:

```json
{
  "pi": {
    "extensions": ["./src/index.ts"]
  }
}
```

## Current placeholder behavior

- `/goal` registers successfully when the extension loads.
- Running `/goal` shows an informational placeholder message.
- No goal state, model tools, hidden context, compaction behavior, or continuation behavior is implemented yet.

## Planned implementation phases

1. Core state reducer and `/goal` command lifecycle.
2. Model tools and hidden goal context.
3. PRD/docs import flow.
4. Compaction and branch hardening.
5. Runtime continuation guardrails.
6. Tests and UI polish.
