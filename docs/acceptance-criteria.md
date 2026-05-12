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

## Definition of done

The extension is done when a user can start a long-running goal from a prompt or docs folder, let the agent work across multiple turns and compactions, resume the session later, branch safely, and have the model mark the goal complete only when the acceptance criteria are actually satisfied.
