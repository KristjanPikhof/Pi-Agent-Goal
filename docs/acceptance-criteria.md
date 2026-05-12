# `/goal` extension acceptance criteria

This checklist records the implemented behavior and rollout verification status for the Pi `/goal` extension.

Status key:

- **Automated** means covered by unit or integration-style tests.
- **Manual smoke** means the code path has harness coverage, but the live TUI/session behavior still needs a real Pi session check before release.
- **Future work** means intentionally not implemented in this rollout.

## Command behavior

| Criterion                                                                                                                                 | Status                                          |
| ----------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------- |
| `/goal` shows usage when no goal exists.                                                                                                  | Automated                                       |
| `/goal` shows current objective, status, source docs, progress, and next actions when a goal exists.                                      | Automated                                       |
| `/goal <objective>` creates an active goal with a new `goalId`.                                                                           | Automated                                       |
| `/goal <objective>` stores context first and interactive Pi asks whether to start work now.                                               | Manual smoke pending                            |
| `/goal <objective>` strips recognized flags such as `--replace` and `--start` from the saved objective wherever they appear in the input. | Automated                                       |
| `/goal <objective>` asks before replacing an existing goal.                                                                               | Automated with harness confirmation             |
| `/goal start` starts the current active goal with a one-shot follow-up handoff.                                                           | Automated                                       |
| `--start` opts create, import, and resume flows into immediate start, and is required for non-interactive immediate start.                | Automated by parser and command lifecycle tests |
| `/goal edit` requires an existing goal and persists user-confirmed edits.                                                                 | Automated with harness editor                   |
| `/goal clear` removes the goal and hides status/widget UI.                                                                                | Automated                                       |
| `/goal pause` stops hidden context injection, continuation eligibility, completion, and progress updates.                                 | Automated                                       |
| `/goal resume` reactivates a paused goal without rewriting objective or criteria.                                                         | Automated                                       |
| `/goal complete` marks only active goals complete and records completion state.                                                           | Automated                                       |
| Complete goals stay terminal until cleared or replaced.                                                                                   | Automated                                       |
| Mutating commands avoid active-turn races with `waitForIdle()` and re-read before save.                                                   | Automated by command harness and source review  |

## PRD and docs input

| Criterion                                                                                                                                                       | Status    |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------- |
| `/goal import <file>` reads PRD/markdown/text files.                                                                                                            | Automated |
| File import extracts objective, constraints, acceptance criteria, source paths, risks, and open questions where headings are present.                           | Automated |
| `/goal import <directory>` scans supported docs without generated/vendor directories.                                                                           | Automated |
| Directory import fails with a clear overflow error when supported docs exceed `maxFiles`; it does not silently truncate.                                        | Automated |
| Imported state stores source paths plus compact briefs, not full repeated document text.                                                                        | Automated |
| Import creates a goal when none exists, and merges/dedupes source docs, constraints, and criteria into an existing active goal without rewriting the objective. | Automated |
| User confirms the extracted objective before activation, or uses `--yes` in non-interactive mode.                                                               | Automated |
| Import rejects paused or complete goals without mutation and tells the user to resume, clear, or replace first.                                                 | Automated |
| Missing, unreadable, binary, oversized, unsupported, out-of-workspace, or symlink-escaped paths produce clear errors after realpath checks.                     | Automated |

## Model tools

| Criterion                                                                                      | Status                        |
| ---------------------------------------------------------------------------------------------- | ----------------------------- |
| `get_goal` returns current goal state and source paths.                                        | Automated                     |
| `create_goal` works only when explicitly requested and fails if a goal already exists.         | Automated                     |
| `complete_goal` can only mark the current active goal complete.                                | Automated                     |
| `complete_goal` and `update_goal_progress` reject paused goals.                                | Automated                     |
| The model cannot silently rewrite objective, source docs, constraints, or acceptance criteria. | Automated by schema and tests |
| Tool results include enough details for state reconstruction and UI rendering.                 | Automated                     |
| Tool renderers are concise and readable.                                                       | Automated                     |

## Hidden context

| Criterion                                                                                                        | Status    |
| ---------------------------------------------------------------------------------------------------------------- | --------- |
| Active goals inject a hidden short context before turns.                                                         | Automated |
| Paused, complete, or cleared goals do not inject active-goal context.                                            | Automated |
| Hidden context includes objective, acceptance criteria, source paths/briefs, progress summary, and safety rules. | Automated |
| Stale hidden context from older branches or replaced goals is filtered out.                                      | Automated |

## State and persistence

| Criterion                                                               | Status                                                              |
| ----------------------------------------------------------------------- | ------------------------------------------------------------------- |
| Canonical state is persisted as Pi custom entries inside the session.   | Automated                                                           |
| State reconstructs from `ctx.sessionManager.getBranch()`.               | Automated                                                           |
| Branch navigation shows selected-branch state, not global latest state. | Automated with branch-shaped fixtures, live `/tree` is manual smoke |
| Replacing a goal produces a new `goalId`.                               | Automated                                                           |
| Stale updates for previous `goalId`s are ignored.                       | Automated                                                           |

## Compaction and continuation

| Criterion                                                                                                                                                                | Status                                                          |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------- |
| Manual `/compact` preserves active goal objective, criteria, source-doc brief, and progress.                                                                             | Hook automated, live command is manual smoke                    |
| Auto-compaction preserves the same state.                                                                                                                                | Hook automated, live auto-compaction is manual smoke            |
| After compaction, `/goal status` still works from canonical entries.                                                                                                     | Automated by state reconstruction, live command is manual smoke |
| After compaction, the next model turn receives a correct short goal context.                                                                                             | Automated by hook/context tests, live turn is manual smoke      |
| Explicit start handoff (`/goal start` or `--start`) remains separate from automatic idle continuation and does not enable background work.                               | Source review                                                   |
| Runtime continuation only runs when the goal is active, Pi is idle, and no pending user messages exist.                                                                  | Automated                                                       |
| Continuation re-checks `goalId` before queuing and before starting work.                                                                                                 | Automated                                                       |
| Continuation stops on no progress, completion, pause, clear, user interrupt, replacement, duplicate queue, pending messages, busy state, disabled flag, or max-turn cap. | Automated                                                       |
| Exact Codex token/time budget accounting.                                                                                                                                | Future work                                                     |

## UI and status

| Criterion                                                                                   | Status                              |
| ------------------------------------------------------------------------------------------- | ----------------------------------- |
| Footer status reflects active, paused, complete, and no-goal states.                        | Automated, live TUI is manual smoke |
| Widget shows short active-goal progress and disappears when not useful.                     | Automated, live TUI is manual smoke |
| `/goal status` works in interactive mode and degrades gracefully when `ctx.hasUI` is false. | Automated                           |
| Errors are actionable and include the next command or flag where relevant.                  | Automated                           |

## Testing checklist

| Area                                                                                                                 | Status                                                                           |
| -------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| Unit tests for state reducer and branch reconstruction.                                                              | Automated                                                                        |
| Unit tests for doc extraction from PRD and docs folder.                                                              | Automated                                                                        |
| Unit tests for tool permission boundaries.                                                                           | Automated                                                                        |
| Integration-style tests for `/goal` command lifecycle.                                                               | Automated                                                                        |
| Integration-style tests for reload/resume/tree/fork reconstruction behavior.                                         | Automated with simulated session events and branch fixtures                      |
| Compaction hook tests.                                                                                               | Automated                                                                        |
| Continuation guard tests for idle continuation, no-progress stop, stale `goalId`, duplicate queue, and max-turn cap. | Automated                                                                        |
| Live TUI tests for `/reload`, `/resume`, `/tree`, `/fork`, and `/compact`.                                           | Manual smoke, evidence must be recorded before release or release marked blocked |

## Manual session lifecycle smoke checklist

Automation covers reducer, command parsing, import safety and merge behavior, tools, hidden context, compaction hooks, continuation guards, UI renderers, and branch-shaped reconstruction. It does not prove the live TUI. Run these checks in a real TUI session before release and record the evidence, or mark release blocked:

1. Start Pi with the extension:

   ```bash
   pi --no-extensions -e ./extensions/index.ts
   ```

2. Run `/goal` and confirm usage renders without starting an agent turn.
3. Run `/goal Ship a multi-turn verification goal`, confirm the goal is stored, and confirm the interactive flow asks whether to start now. Decline the start handoff, then confirm footer shows `goal: active` and the active-goal widget appears without an agent turn.
4. Run `/goal start` and confirm one follow-up agent turn is queued for the active goal.
5. Run `/goal status`, `/goal pause`, `/goal resume --start`, `/goal complete --yes`, and `/goal clear --yes`; confirm status/widget update or disappear at each step and that `--start` on resume queues only the explicit handoff.
6. Create `docs/prd.md`, run `/goal import docs/prd.md`, review the confirmation, and confirm `/goal status` shows source docs and extracted criteria. Then import a second doc into the same goal and confirm source docs, constraints, and criteria merge without replacing the objective. Repeat a non-interactive import with `--yes --start` and confirm it starts immediately.
7. Trigger `/compact`; confirm `/goal status` still shows objective, criteria, source brief, and progress, then send a normal prompt and verify hidden goal context is regenerated for the active goal.
8. Run `/reload` or restart/resume the session; confirm footer/widget and `/goal status` reconstruct from current branch custom entries.
9. Use `/fork` or `/tree` to navigate between branches with different goal mutations; confirm the selected branch shows its own goal state and stale context from the other branch is absent.
10. Start Pi with continuation enabled:

```bash
pi --no-extensions -e ./extensions/index.ts --goal-continuation --goal-continuation-max-turns 3
```

Update progress through `update_goal_progress`, then let an idle continuation queue. Confirm it stops after no progress or the max-turn cap and does not duplicate the queue.

11. Confirm this automatic continuation path is distinct from `/goal start` and `--start`: it should only queue while Pi is idle and the continuation flag is enabled.

12. Run quick non-interactive load checks:

    ```bash
    pi --no-session --no-extensions -e ./extensions/index.ts -p /goal
    pi --no-session --no-extensions -e ./extensions/index.ts --goal-continuation -p /goal
    ```

## Definition of done status

The rollout acceptance is met when automated checks pass and the docs accurately mark live TUI lifecycle checks as manual smoke rather than automated proof. Release readiness also requires recorded live TUI smoke evidence, or an explicit blocked status for that evidence. The extension currently supports storing a long-running goal from a prompt or docs folder, starting it through an explicit one-shot handoff, preserving state through branch-aware session entries and compaction hooks, exposing narrow tools, and optionally continuing while idle behind a separate explicit opt-in.

Remaining future work is Codex-exact compatibility: app-server RPC, SQLite persistence, exact token/time budgets, and exact Codex goal menu UI.
