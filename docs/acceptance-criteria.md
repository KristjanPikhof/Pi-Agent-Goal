# `/goal` extension acceptance criteria

Use this checklist to decide whether the Pi `/goal` extension is implementation-ready and complete.

## Command behavior

- `/goal` shows usage when no goal exists.
- `/goal` shows the current objective, status, source docs, progress, and next actions when a goal exists.
- `/goal <objective>` creates an active goal with a new `goalId`.
- `/goal <objective>` asks before replacing an existing goal.
- `/goal edit` requires an existing goal and persists user-confirmed edits.
- `/goal clear` removes the goal and hides status/widget UI.
- `/goal pause` stops hidden context injection and continuation.
- `/goal resume` reactivates the goal without rewriting objective or criteria.
- `/goal complete` marks the goal complete and records evidence or confirmation.
- Mutating commands behave safely while a task is running: wait for idle, queue safely, or reject with a clear message.

## PRD and docs input

- `/goal import <file>` reads a PRD/markdown file and extracts objective, constraints, acceptance criteria, source paths, and risks.
- `/goal import <directory>` scans relevant docs without importing generated/vendor files.
- Imported state stores source paths plus compact briefs, not full repeated document text.
- User confirms the extracted objective before it becomes active.
- Missing, unreadable, binary, oversized, or out-of-workspace paths produce clear errors.

## Model tools

- `get_goal` returns current goal state and source paths.
- `create_goal` works only when explicitly requested and fails if a goal already exists.
- `complete_goal` can only mark the active goal complete.
- The model cannot silently rewrite objective, source docs, or acceptance criteria.
- Tool results include enough details for state reconstruction and UI rendering.
- Tool renderers are concise and readable in Pi TUI.

## Hidden context

- Active goals inject a hidden short context before turns.
- Paused, complete, or cleared goals do not inject active-goal context.
- Hidden context includes objective, acceptance criteria, source paths/briefs, progress summary, and safety rules.
- Stale hidden context from older branches or replaced goals is filtered out.

## State and persistence

- Canonical state is persisted as Pi custom entries inside the session.
- State reconstructs from `ctx.sessionManager.getBranch()` on `session_start`, `session_tree`, reload, resume, fork, and clone.
- Branch navigation shows the goal state for the selected branch, not a global latest goal.
- Replacing a goal produces a new `goalId`; stale updates for previous `goalId`s are ignored.

## Compaction and continuation

- Manual `/compact` preserves the active goal objective, criteria, source-doc brief, and progress.
- Auto-compaction preserves the same state.
- After compaction, `/goal status` still works from canonical entries.
- After compaction, the next model turn receives a correct short goal context.
- Runtime continuation only runs when the goal is active, Pi is idle, and no pending user messages exist.
- Continuation re-checks `goalId` before queuing work.
- Continuation stops on no progress, completion, pause, clear, user interrupt, or replacement.

## UI and status

- Footer status reflects active/paused/complete state.
- Widget shows short active-goal progress and disappears when not useful.
- `/goal status` works in interactive mode and degrades gracefully when `ctx.hasUI` is false.
- Errors are actionable: say what failed and what command to run next.

## Testing checklist

- Unit tests for state reducer and branch reconstruction.
- Unit tests for doc extraction from PRD and docs folder.
- Unit tests for tool permission boundaries.
- Integration/manual tests for `/goal` command lifecycle.
- Integration/manual tests for `/reload`, `/resume`, `/tree`, `/fork`, and `/compact`.
- Continuation tests for idle continuation, no-progress stop, and stale `goalId` prevention.

## Manual session lifecycle smoke checklist

Automation covers reducer, command, import, tools, hidden context, compaction hooks, continuation guards, UI renderers, and branch-shaped reconstruction. The following checks document the remaining interactive Pi lifecycle verification that should be run before release in a real TUI session:

1. Start Pi with the extension: `pi --no-extensions -e ./src/index.ts`.
2. Run `/goal` and confirm usage renders without starting an agent turn.
3. Run `/goal Ship a multi-turn verification goal`, then confirm footer shows `goal: active` and the active-goal widget appears.
4. Run `/goal status`, `/goal pause`, `/goal resume`, `/goal complete --yes`, and `/goal clear --yes`; confirm status/widget update or disappear at each step.
5. Create `docs/prd.md`, run `/goal import docs/prd.md`, review the confirmation, and confirm `/goal status` shows source docs and extracted criteria.
6. Trigger `/compact`; confirm `/goal status` still shows objective, criteria, source brief, and progress, then send a normal prompt and verify hidden goal context is regenerated for the active goal.
7. Run `/reload` or restart/resume the session; confirm footer/widget and `/goal status` reconstruct from current branch custom entries.
8. Use `/fork` or `/tree` to navigate between branches with different goal mutations; confirm the selected branch shows its own goal state and stale context from the other branch is absent.
9. With `--goal-continuation`, update progress through `update_goal_progress`, then let an idle continuation queue; confirm it stops after no progress or max-turn cap and does not duplicate queue.
10. In non-interactive/print smoke, run commands with `--yes` where required and confirm actionable errors are printed when confirmation flags are missing.

## Definition of done

The extension is done when a user can start a long-running goal from a prompt or docs folder, let the agent work across multiple turns and compactions, resume the session later, branch safely, and have the model mark the goal complete only when the acceptance criteria are actually satisfied.
