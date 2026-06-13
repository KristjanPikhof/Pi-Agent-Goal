# AGENTS.md

Repo facts:
- Package: `pi-agent-goal`; Node `>=22.19.0`.
- Public entry: `extensions/index.ts` -> `extensions/pi-goal/index.ts` -> `src/index.ts`.
- Source is TypeScript; do not assume or target `dist/`.
- Published files allowlist: `extensions`, `src`, `README.md`, `docs`, `LICENSE`.

Source map:
- `src/index.ts`: extension registration/export surface.
- `src/commands.ts`: `/goal` parsing, review, save, start handoff.
- `src/state.ts`: canonical goal state/events; use `ctx.sessionManager.getBranch()` for branch-aware entries.
- `src/runtime.ts`: context, compaction, queued/opt-in continuation.
- `src/tools.ts`: agent-callable goal tools.
- `src/import.ts`: read-only, path-safe source imports.
- `src/ui.ts`: interactive TUI helpers.
- `src/prompts.ts`: rendered agent prompts/context.
- `src/goal-prep.ts`, `src/types.ts`: draft prep and shared types.

Commands:
- Core: `npm run typecheck`, `npm run lint`, `npm run format`, `npm test`.
- Extra/release: `npm run test:coverage`, `npm pack --dry-run`, `npm run smoke:pi`, `npm run smoke:package`.
- Manual Pi smoke: `pi --no-extensions -e ./extensions/index.ts`.
- Continuation smoke: add `--goal-continuation --goal-continuation-max-turns 3`.

Behavior to preserve:
- Plain non-interactive `/goal <objective> --start` queues draft/review; import/resume are approved start paths.
- `--start` queues one handoff only.
- Continuation is opt-in via `--goal-continuation`; do not make it default automatic behavior.
- Imports stay read-only and path-safe.
- Keep manual TUI smoke as a release gate for command/UI changes.

Avoid obsolete claims:
- No SQLite, Codex RPC, `getSystemPromptOptions`, default auto-continuation, repeated full-doc injection, or automated TUI lifecycle assumptions.
