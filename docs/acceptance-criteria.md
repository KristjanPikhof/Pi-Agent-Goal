# `/goal` extension acceptance criteria

This checklist records the implemented behavior and rollout verification status for the Pi `/goal` extension.

Status key:

- **Automated** means covered by unit or integration-style tests.
- **Manual smoke** means the code path has harness coverage, but the live TUI/session behavior still needs a real Pi session check before release.
- **Future work** means intentionally not implemented in this rollout.

## Release baseline and packaging

| Criterion                                                                                                   | Status                                                                      |
| ----------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| Release version is `2026.6.13`.                                                                             | Automated by package metadata and docs review                               |
| Runtime requires Node.js `>=22.19.0`.                                                                       | Automated by package metadata and docs review                               |
| Pi core packages use open peer dependency ranges, while dev validation targets Pi `^0.79.3`.                | Automated by package metadata and docs review                               |
| Package includes `extensions`, `src`, `README.md`, `docs`, and `LICENSE`; internal docs links are relative. | Automated by `npm pack --dry-run`, `npm run smoke:package`, and docs review |

## Command behavior

| Criterion                                                                                                                                                                                                 | Status                                              |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------- |
| `/goal` shows usage when no goal exists.                                                                                                                                                                  | Automated                                           |
| `/goal` shows current objective, status, source docs, progress, and next actions when a goal exists.                                                                                                      | Automated                                           |
| `/goal <objective>` sends the plain text to the chat agent with instructions to call `propose_goal_draft` with objective and acceptance criteria.                                                         | Automated                                           |
| `propose_goal_draft` validates objective and at least one acceptance criterion before review.                                                                                                             | Automated                                           |
| Interactive draft review can show Start/Edit/Cancel with public Pi `select`, `editor`, and `confirm` APIs; Start saves and starts, Edit opens a prefilled modal markdown draft, and Cancel saves nothing. | Automated by tool harness, live TUI is manual smoke |
| `/goal <objective>` strips recognized flags such as `--replace` and `--start` from the saved objective wherever they appear in the input.                                                                 | Automated                                           |
| `/goal <objective>` asks before replacing an existing goal.                                                                                                                                               | Automated with harness confirmation                 |
| `/goal start` starts the current active goal with a one-shot follow-up handoff.                                                                                                                           | Automated                                           |
| `--start` opts create, import, and resume flows into immediate start, and is required for non-interactive immediate start.                                                                                | Automated by parser and command lifecycle tests     |
| `/goal edit` requires an existing goal and persists user-confirmed edits.                                                                                                                                 | Automated with harness editor                       |
| `/goal clear` removes the goal and hides active-goal widget UI.                                                                                                                                           | Automated                                           |
| `/goal pause` stops hidden context injection, continuation eligibility, completion, and progress updates.                                                                                                 | Automated                                           |
| `/goal resume` reactivates a paused goal without rewriting objective or criteria.                                                                                                                         | Automated                                           |
| `/goal complete` marks only active goals complete and records completion state.                                                                                                                           | Automated                                           |
| Complete goals stay terminal until cleared or replaced.                                                                                                                                                   | Automated                                           |
| Mutating commands avoid active-turn races with `waitForIdle()` and re-read before save.                                                                                                                   | Automated by command harness and source review      |

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

| Criterion                                                                                                     | Status                        |
| ------------------------------------------------------------------------------------------------------------- | ----------------------------- |
| `get_goal` returns current goal state and source paths.                                                       | Automated                     |
| `create_goal` works only when explicitly requested and fails if a goal already exists.                        | Automated                     |
| `propose_goal_draft` is the review-only path for agent-drafted `/goal` proposals and saves only after Start.  | Automated                     |
| `propose_goal_draft` returns `review_ui_unavailable` and saves nothing when interactive review UI is missing. | Automated                     |
| `complete_goal` can only mark the current active goal complete.                                               | Automated                     |
| `complete_goal` and `update_goal_progress` reject paused goals.                                               | Automated                     |
| The model cannot silently rewrite objective, source docs, constraints, or acceptance criteria.                | Automated by schema and tests |
| Tool results include enough details for state reconstruction and UI rendering.                                | Automated                     |
| Tool renderers are concise and readable.                                                                      | Automated                     |

## Harness and theme alignment

| Criterion                                                                                                                                                   | Status                              |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------- |
| Runtime reads current `InputEvent.text` and keeps compatibility fallbacks for older input shapes.                                                           | Automated                           |
| Explicit handoffs use follow-up delivery for `/goal start`, `--start`, and continuation turns.                                                              | Automated                           |
| Tool policy denials return soft refusals with `details.status: "refused"`; invalid input and unexpected failures remain hard errors.                        | Automated                           |
| Tool renderers use semantic theme tokens and remain readable without a theme.                                                                               | Automated                           |
| Active-goal widget uses themed TUI components when `ctx.mode` is `tui`.                                                                                     | Automated, live TUI is manual smoke |
| RPC, JSON, print, and no-widget hosts receive readable plain-text/status fallback.                                                                          | Automated                           |
| Project-trust-specific config, `getSystemPromptOptions`, and autocomplete triggers are intentionally not used until a concrete pi-goal workflow needs them. | Source review and docs review       |

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

| Criterion                                                                                                            | Status                              |
| -------------------------------------------------------------------------------------------------------------------- | ----------------------------------- |
| No legacy footer status is rendered; goal state is represented by the compact active-goal widget and `/goal status`. | Automated, live TUI is manual smoke |
| Widget shows short active-goal progress and disappears when not useful.                                              | Automated, live TUI is manual smoke |
| `/goal status` works in interactive mode and degrades gracefully when `ctx.hasUI` is false.                          | Automated                           |
| Errors are actionable and include the next command or flag where relevant.                                           | Automated                           |

## Validation commands

Latest validation evidence for this release lane:

```bash
npm run typecheck        # passed
npm run lint             # passed
npm run format           # passed
npm test                 # passed
npm run test:coverage    # passed
npm pack --dry-run       # passed
npm run smoke:pi         # passed
npm run smoke:package    # passed
```

Live interactive TUI lifecycle checks are a **release-blocking evidence gap until recorded in a real terminal**. Do not count automated harness tests as proof for `/reload`, `/resume`, `/tree`, `/fork`, `/compact`, or the visible widget in a real TUI session.

## Testing checklist

| Area                                                                                                                 | Status                                                          |
| -------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| Unit tests for state reducer and branch reconstruction.                                                              | Automated                                                       |
| Unit tests for doc extraction from PRD and docs folder.                                                              | Automated                                                       |
| Unit tests for tool permission boundaries and `propose_goal_draft` Start/Edit/Cancel behavior.                       | Automated                                                       |
| Integration-style tests for `/goal` command lifecycle.                                                               | Automated                                                       |
| Integration-style tests for reload/resume/tree/fork reconstruction behavior.                                         | Automated with simulated session events and branch fixtures     |
| Compaction hook tests.                                                                                               | Automated                                                       |
| Continuation guard tests for idle continuation, no-progress stop, stale `goalId`, duplicate queue, and max-turn cap. | Automated                                                       |
| Live TUI tests for `/reload`, `/resume`, `/tree`, `/fork`, `/compact`, and the visible active-goal widget.           | **Blocked for release until manual smoke evidence is recorded** |

## Manual session lifecycle smoke checklist

Automation covers reducer, command parsing, import safety and merge behavior, tools, hidden context, compaction hooks, continuation guards, UI renderers, and branch-shaped reconstruction. It does not prove the live TUI. Run these checks in a real TUI session before release and record the evidence, or mark release blocked. Evidence should include the command sequence, expected state before and after each lifecycle action, observed result, Pi/package version, terminal mode, and screenshots or transcript snippets when available:

1. Start Pi with the extension:

   ```bash
   pi --no-extensions -e ./extensions/index.ts
   ```

2. Run `/goal` and confirm usage renders without starting an agent turn.
3. Run `/goal Ship a multi-turn verification goal`, confirm the command asks the chat agent to draft with `propose_goal_draft`, and wait for the review UI. Choose Cancel and confirm no goal is saved. Run it again, choose Edit, confirm the modal markdown draft is prefilled with the objective and acceptance criteria fields, change one criterion, then choose Start and confirm one follow-up agent turn is queued.
4. Run `/goal start` and confirm one follow-up agent turn is queued for the active goal.
5. Run `/goal status`, `/goal pause`, `/goal resume --start`, `/goal complete --yes`, and `/goal clear --yes`; confirm `/goal status` output and active-goal widget update or disappear at each step and that `--start` on resume queues only the explicit handoff.
6. Create `docs/prd.md`, run `/goal import docs/prd.md`, review the confirmation, and confirm `/goal status` shows source docs and extracted criteria. Then import a second doc into the same goal and confirm source docs, constraints, and criteria merge without replacing the objective. Repeat a non-interactive import with `--yes --start` and confirm it starts immediately.
7. Trigger `/compact`; confirm `/goal status` still shows objective, criteria, source brief, and progress, then send a normal prompt and verify hidden goal context is regenerated for the active goal.
8. Run `/reload` or restart/resume the session; confirm the active-goal widget and `/goal status` reconstruct from current branch custom entries.
9. Use `/fork` or `/tree` to navigate between branches with different goal mutations; confirm the selected branch shows its own goal state and stale context from the other branch is absent.
10. Start Pi with continuation enabled:

```bash
pi --no-extensions -e ./extensions/index.ts --goal-continuation --goal-continuation-max-turns 3
```

Update progress through `update_goal_progress`, then let an idle continuation queue. Confirm it stops after no progress or the max-turn cap and does not duplicate the queue.

11. Confirm this automatic continuation path is distinct from `/goal start` and `--start`: it should only queue while Pi is idle and the continuation flag is enabled.

12. Run quick non-interactive load checks (automated by `npm run smoke:pi`):

    ```bash
    pi --no-session --no-extensions -e ./extensions/index.ts -p /goal
    pi --no-session --no-extensions -e ./extensions/index.ts --goal-continuation -p /goal
    ```

13. Run package contents/load metadata checks (automated by `npm run smoke:package`) and targeted module coverage for `src/runtime.ts`, `src/tools.ts`, `src/ui.ts`, `src/state.ts`, and `src/import.ts` (automated by `npm run test:coverage`).

## Definition of done status

The rollout acceptance is met when automated checks pass, package contents are verified, docs links are reviewed, and the docs accurately mark live TUI lifecycle checks as manual smoke rather than automated proof. Release readiness is currently blocked until live TUI smoke evidence is recorded for `/reload`, `/resume`, `/tree`, `/fork`, `/compact`, and the visible active-goal widget. The extension currently supports agent-mediated drafting from plain `/goal` text through `propose_goal_draft`, Start/Edit/Cancel review before persistence, importing criteria from docs, starting saved goals through an explicit one-shot handoff, preserving state through branch-aware session entries and compaction hooks, exposing narrow tools, and optionally continuing while idle behind a separate explicit opt-in.

Remaining future work is Codex-exact compatibility: app-server RPC, SQLite persistence, exact token/time budgets, and exact Codex goal menu UI.
