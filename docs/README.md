# Pi `/goal` extension docs

The Pi Agent Goal package uses a source-extension shape: `extensions/index.ts` loads `extensions/pi-goal/index.ts`, which wires the implementation from `src/index.ts`. These docs describe the shipped behavior, acceptance status, and remaining rollout checks.


## Release compatibility

Release `2026.6.13` raises the runtime baseline to Node.js `>=22.19.0` and validates against Pi `0.79.3` APIs. Pi core packages stay as open peer dependencies in `package.json`; dev dependencies pin the validation floor, while the installed Pi host provides the actual runtime.

The docs and package layout are part of the release contract. `npm pack --dry-run` and `npm run smoke:package` must show that `README.md`, `docs`, `extensions`, `src`, and `LICENSE` are included, with relative docs links intact.

Read in this order:

1. [`../README.md`](../README.md), quick start, command reference, model tools, autonomy opt-in, and troubleshooting.
2. [`setup.md`](setup.md), package install, project-local install, one-off runs, local-checkout development, and package entry points.
3. [`implementation.md`](implementation.md), implementation details for state, commands, import, tools, context, compaction, continuation, UI, and Codex parity gaps.
4. [`acceptance-criteria.md`](acceptance-criteria.md), acceptance checklist with automated and manual verification status.

## What shipped

- Branch-aware canonical goal state in Pi custom entries named `goal-state`.
- `/goal` command lifecycle: plain text asks the chat agent to draft objective and acceptance criteria through `propose_goal_draft`; Start/Edit/Cancel review runs through public Pi UI APIs before persistence; clean `--replace` parsing, replace with confirmation, status, edit, pause, resume, complete, clear, and import.
- Markdown/text PRD and docs-folder import with workspace realpath validation, symlink escape rejection, generated/vendor ignores, binary and size checks, directory `maxFiles` overflow errors, and compact source briefs.
- Import semantics that create from docs when no goal exists, then merge and dedupe source docs, constraints, and criteria for an existing goal without rewriting the objective.
- Model tools: `get_goal`, `create_goal`, `propose_goal_draft`, `complete_goal`, and `update_goal_progress` with narrow permissions. Draft proposals save only after Start; completion and progress tools reject paused goals.
- Hidden active-goal context injection plus stale context filtering.
- `session_before_compact` goal summary/details preservation.
- Compact active-goal widget, `/goal status` command output, actionable command errors, and concise tool renderers.
- Opt-in safe idle continuation behind `--goal-continuation`.
- Unit and integration-style tests covering reducer, command parsing and lifecycle, import safety and merge behavior, tools, prompts, compaction hooks, continuation guards, UI, branch-shaped reconstruction, stale `goalId` behavior, and session lifecycle harness flows.

## Rollout smoke commands

Run from the repository root:

```bash
npm run typecheck
npm run lint
npm run format
npm test
npm run test:coverage
npm pack --dry-run
npm run smoke:pi
npm run smoke:package
pi --no-session --no-extensions -e ./extensions/index.ts -p /goal
pi --no-session --no-extensions -e ./extensions/index.ts --goal-continuation -p /goal
```

For live TUI lifecycle verification, use the manual checklist in [`acceptance-criteria.md`](acceptance-criteria.md#manual-session-lifecycle-smoke-checklist). Those checks cover interactive UI and session manager behavior that is not fully proven by the current test harness. Record the smoke evidence before release, or mark the release blocked.

## Future work

The implementation intentionally does not include Codex app-server RPC compatibility, Codex SQLite persistence, exact token/time accounting, or Codex's exact goal menu UI. Those are future work only if Pi needs strict Codex compatibility rather than Pi-native behavior.
