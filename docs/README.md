# Pi `/goal` extension docs

The `/goal` extension is implemented as a Pi extension in `src/index.ts`. These docs describe the shipped behavior, acceptance status, and remaining rollout checks.

Read in this order:

1. [`../README.md`](../README.md), install, loading, command reference, model tools, autonomy opt-in, and troubleshooting.
2. [`implementation.md`](implementation.md), implementation details for state, commands, import, tools, context, compaction, continuation, UI, and Codex parity gaps.
3. [`acceptance-criteria.md`](acceptance-criteria.md), acceptance checklist with automated and manual verification status.

## What shipped

- Branch-aware canonical goal state in Pi custom entries named `goal-state`.
- `/goal` command lifecycle: create, replace with confirmation, status, edit, pause, resume, complete, clear, and import.
- Markdown/text PRD and docs-folder import with workspace path validation, generated/vendor ignores, binary and size checks, and compact source briefs.
- Model tools: `get_goal`, `create_goal`, `complete_goal`, and `update_goal_progress` with narrow permissions.
- Hidden active-goal context injection plus stale context filtering.
- `session_before_compact` goal summary/details preservation.
- Footer status, active-goal widget, actionable command errors, and concise tool renderers.
- Opt-in safe idle continuation behind `--goal-continuation`.
- Unit and integration-style tests covering reducer, command, import, tools, prompts, compaction hooks, continuation guards, UI, branch-shaped reconstruction, stale `goalId` behavior, and session lifecycle harness flows.

## Rollout smoke commands

Run from the repository root:

```bash
npm run typecheck
npm run lint
npm run format
npm test
pi --no-session --no-extensions -e ./src/index.ts -p /goal
pi --no-session --no-extensions -e ./src/index.ts --goal-continuation -p /goal
```

For live TUI lifecycle verification, use the manual checklist in [`acceptance-criteria.md`](acceptance-criteria.md#manual-session-lifecycle-smoke-checklist). Those checks cover interactive UI and session manager behavior that is not practical to fully automate in the current test harness.

## Future work

The implementation intentionally does not include Codex app-server RPC compatibility, Codex SQLite persistence, exact token/time accounting, or Codex's exact goal menu UI. Those are future work only if Pi needs strict Codex compatibility rather than Pi-native behavior.
