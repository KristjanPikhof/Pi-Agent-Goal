# `/goal` acceptance criteria

This checklist records release status for the Pi `/goal` extension.

Status key:

- **Automated**: covered by unit or integration-style tests.
- **Manual smoke**: harness coverage exists, but a real Pi TUI check is still required.
- **Future work**: intentionally not implemented in this rollout.

## Release baseline and packaging

| Criterion                                                                 | Status                                                        |
| ------------------------------------------------------------------------- | ------------------------------------------------------------- |
| Release version is `2026.6.14`.                                           | Automated by package metadata and docs review                 |
| Runtime requires Node.js `>=22.19.0`.                                     | Automated by package metadata and docs review                 |
| Coding-agent peer range is `>=0.80.5 <0.81.0`.                            | Automated by package metadata and tests                       |
| Pi TUI peer range is `>=0.79.3 <0.81.0`.                                  | Automated by package metadata and tests                       |
| Development validation targets Pi packages `^0.80.7`.                     | Automated by package metadata and tests                       |
| Package includes `extensions`, `src`, `README.md`, `docs`, and `LICENSE`. | Automated by `npm pack --dry-run` and `npm run smoke:package` |
| Internal docs links are relative.                                         | Automated by package smoke and docs review                    |

## Command behavior

| Criterion                                                                                                               | Status                                         |
| ----------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------- |
| `/goal` shows usage when no goal exists.                                                                                | Automated                                      |
| `/goal` shows objective, status, source docs, progress, and next actions when a goal exists.                            | Automated                                      |
| `/goal <objective>` asks the chat agent to call `propose_goal_draft` with objective and acceptance criteria.            | Automated                                      |
| `propose_goal_draft` validates objective and at least one acceptance criterion before review.                           | Automated                                      |
| Interactive review uses public Pi `select`, `editor`, and `confirm` APIs.                                               | Automated by harness, live TUI is manual smoke |
| Start saves and starts, Edit opens a prefilled markdown draft, and Cancel saves nothing.                                | Automated by harness, live TUI is manual smoke |
| Recognized flags such as `--replace` and `--start` are stripped from the objective wherever they appear.                | Automated                                      |
| Replacing an existing goal requires confirmation or `--replace` where appropriate.                                      | Automated                                      |
| `/goal start` queues one explicit handoff for the current active goal.                                                  | Automated                                      |
| `--start` opts create, import, and resume flows into immediate start.                                                   | Automated                                      |
| Non-interactive immediate start requires an approved path such as import with `--yes --start` or resume with `--start`. | Automated                                      |
| Plain non-interactive `/goal <objective> --start` only queues drafting/review and does not save or start by itself.     | Automated                                      |
| `/goal edit` requires an existing goal and persists confirmed edits.                                                    | Automated with harness editor                  |
| `/goal clear` removes the goal and hides active-goal UI.                                                                | Automated                                      |
| `/goal pause` stops hidden context, continuation eligibility, completion, and progress updates.                         | Automated                                      |
| `/goal resume` reactivates a paused goal without rewriting objective or criteria.                                       | Automated                                      |
| `/goal complete` marks only active goals complete.                                                                      | Automated                                      |
| Complete goals stay terminal until cleared or replaced.                                                                 | Automated                                      |
| Mutating commands wait for idle and re-read before save.                                                                | Automated by command harness and source review |

## PRD and docs input

| Criterion                                                                                                                                   | Status    |
| ------------------------------------------------------------------------------------------------------------------------------------------- | --------- |
| `/goal import <file>` reads PRD, markdown, and text files.                                                                                  | Automated |
| File import extracts objective, constraints, acceptance criteria, source paths, risks, and open questions where headings are present.       | Automated |
| `/goal import <directory>` scans supported docs and skips generated/vendor directories.                                                     | Automated |
| Directory import fails clearly when supported docs exceed `maxFiles`; it does not silently truncate.                                        | Automated |
| Imported state stores source paths and compact briefs, not repeated full document text.                                                     | Automated |
| Import creates a goal when none exists.                                                                                                     | Automated |
| Import merges and dedupes source docs, constraints, and criteria into an existing active goal without rewriting the objective.              | Automated |
| Interactive import confirms the extracted objective before activation.                                                                      | Automated |
| Non-interactive import requires `--yes`.                                                                                                    | Automated |
| Import rejects paused or complete goals without mutation and tells the user to resume, clear, or replace first.                             | Automated |
| Missing, unreadable, binary, oversized, unsupported, out-of-workspace, and symlink-escaped paths return clear errors after realpath checks. | Automated |

## Model tools

| Criterion                                                                                                                         | Status                        |
| --------------------------------------------------------------------------------------------------------------------------------- | ----------------------------- |
| `get_goal` returns current goal state and source paths.                                                                           | Automated                     |
| `create_goal` works only with explicit approval and fails if a goal already exists.                                               | Automated                     |
| `propose_goal_draft` is the review-only path for agent-drafted `/goal` proposals.                                                 | Automated                     |
| `propose_goal_draft` saves only after Start.                                                                                      | Automated                     |
| `propose_goal_draft` returns `review_ui_unavailable` and saves nothing when review UI is missing.                                 | Automated                     |
| `complete_goal` can only mark the current active goal complete.                                                                   | Automated                     |
| `complete_goal` and `update_goal_progress` reject paused goals.                                                                   | Automated                     |
| The model cannot silently rewrite objective, source docs, constraints, or acceptance criteria.                                    | Automated by schema and tests |
| Tool results include enough details for state reconstruction and UI rendering.                                                    | Automated                     |
| Tool renderers are concise and readable.                                                                                          | Automated                     |
| Expected denials return soft refusals with `details.status: "refused"`; invalid input and unexpected failures remain hard errors. | Automated                     |

## Runtime, theme, and UI

| Criterion                                                                                          | Status                                            |
| -------------------------------------------------------------------------------------------------- | ------------------------------------------------- |
| Runtime reads current `InputEvent.text` and keeps compatibility fallbacks for older input shapes.  | Automated                                         |
| Explicit handoffs use follow-up delivery for `/goal start`, `--start`, and continuation turns.     | Automated                                         |
| Tool renderers use semantic theme tokens and remain readable without a theme.                      | Automated                                         |
| Active-goal widget uses themed TUI components when `ctx.mode` is `tui`.                            | Automated, live TUI is manual smoke               |
| RPC, JSON, print, and no-widget hosts receive readable plain-text/status fallback.                 | Automated                                         |
| No legacy footer status is rendered; goal state appears in the compact widget and `/goal status`.  | Automated, live TUI is manual smoke               |
| Widget shows short active-goal progress and disappears when not useful.                            | Automated, live TUI is manual smoke               |
| `/goal status` works interactively and degrades when `ctx.hasUI` is false.                         | Automated                                         |
| Errors are actionable and name the next command or flag where relevant.                            | Automated                                         |
| Project-trust-specific config and `getSystemPromptOptions` are intentionally not used.             | Automated by source and docs review               |
| Basic `/goal` subcommand argument completions are implemented; richer autocomplete is future work. | Automated by command registration and docs review |

## Hidden context, state, and compaction

| Criterion                                                                                                        | Status                                                       |
| ---------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| Active goals inject a hidden short context before turns.                                                         | Automated                                                    |
| Paused, complete, or cleared goals do not inject active-goal context.                                            | Automated                                                    |
| Hidden context includes objective, acceptance criteria, source paths/briefs, progress summary, and safety rules. | Automated                                                    |
| Stale hidden context from older branches or replaced goals is filtered out.                                      | Automated                                                    |
| Canonical state is persisted as Pi custom entries inside the session.                                            | Automated                                                    |
| State reconstructs from `ctx.sessionManager.getBranch()`.                                                        | Automated                                                    |
| Branch navigation shows selected-branch state, not global latest state.                                          | Automated with branch fixtures, live `/tree` is manual smoke |
| Replacing a goal produces a new `goalId`.                                                                        | Automated                                                    |
| Stale updates for previous `goalId`s are ignored.                                                                | Automated                                                    |
| Manual `/compact` preserves objective, criteria, source brief, and progress.                                     | Hook automated, live command is manual smoke                 |
| Auto-compaction preserves the same state.                                                                        | Hook automated, live auto-compaction is manual smoke         |
| After compaction, `/goal status` still works from canonical entries.                                             | Automated by reconstruction, live command is manual smoke    |
| After compaction, the next model turn receives correct short goal context.                                       | Automated by hook/context tests, live turn is manual smoke   |

## Continuation and Codex parity

| Criterion                                                                                                                                                                | Status        |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------- |
| Explicit start handoff remains separate from automatic idle continuation.                                                                                                | Source review |
| `/goal start` and `--start` do not enable background work.                                                                                                               | Source review |
| Continuation finalizes and schedules on `agent_settled`, not `agent_end`, after retries and queued continuations settle.                                                 | Automated     |
| Runtime continuation only runs when the goal is active, Pi is idle, and no pending user messages exist.                                                                  | Automated     |
| Continuation re-checks `goalId` before queuing and before starting work.                                                                                                 | Automated     |
| Continuation stops on no progress, completion, pause, clear, user interrupt, replacement, duplicate queue, pending messages, busy state, disabled flag, or max-turn cap. | Automated     |
| Exact Codex token/time budget accounting.                                                                                                                                | Future work   |
| Codex SQLite `thread_goals` table and app-server RPC compatibility.                                                                                                      | Future work   |
| Exact Codex goal menu UI.                                                                                                                                                | Future work   |

## Validation commands

Run this checklist before release:

```bash
npm run typecheck
npm run lint
npm run format
npm test
npm run test:coverage
npm pack --dry-run
npm run smoke:pi
npm run smoke:package
```

Live interactive TUI lifecycle checks are a **release-blocking evidence gap until recorded in a real terminal**. Do not count automated harness tests as proof for `/reload`, `/resume`, `/tree`, `/fork`, `/compact`, or the visible widget in a real TUI session.

## Test coverage map

| Area                                                                                                       | Status                                                          |
| ---------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| State reducer and branch reconstruction.                                                                   | Automated                                                       |
| Doc extraction from PRD and docs folder.                                                                   | Automated                                                       |
| Tool permission boundaries and `propose_goal_draft` Start/Edit/Cancel behavior.                            | Automated                                                       |
| `/goal` command lifecycle.                                                                                 | Automated                                                       |
| Reload, resume, tree, and fork reconstruction behavior.                                                    | Automated with simulated session events and branch fixtures     |
| Compaction hook behavior.                                                                                  | Automated                                                       |
| `agent_settled` finalization plus idle, no-progress, stale `goalId`, duplicate queue, and max-turn guards. | Automated                                                       |
| Live TUI tests for `/reload`, `/resume`, `/tree`, `/fork`, `/compact`, and the visible active-goal widget. | **Blocked for release until manual smoke evidence is recorded** |

## Manual session lifecycle smoke checklist

Automation covers reducer, command parsing, import safety and merge behavior, tools, hidden context, compaction hooks, continuation guards, UI renderers, and branch-shaped reconstruction. It does not prove the live TUI.

Before release, run these checks in a real TUI session and record command sequence, expected state, observed result, Pi/package version, terminal mode, and screenshots or transcript snippets when available.

1. Start Pi with the extension:

   ```bash
   pi --no-extensions -e ./extensions/index.ts
   ```

2. Run `/goal` and confirm usage renders without starting an agent turn.
3. Run `/goal Ship a multi-turn verification goal`. Confirm the command asks the chat agent to draft with `propose_goal_draft` and wait for review UI.
4. Choose Cancel and confirm no goal is saved.
5. Run the goal command again, choose Edit, confirm the modal markdown draft has objective and acceptance criteria fields, change one criterion, then choose Start and confirm one follow-up agent turn is queued.
6. Run `/goal start` and confirm one follow-up agent turn is queued for the active goal.
7. Run `/goal status`, `/goal pause`, `/goal resume --start`, `/goal complete --yes`, and `/goal clear --yes`. Confirm status output and active-goal widget update or disappear at each step. Confirm resume `--start` queues only the explicit handoff.
8. Create `docs/prd.md`, run `/goal import docs/prd.md`, review confirmation, and confirm `/goal status` shows source docs and extracted criteria.
9. Import a second doc into the same goal and confirm source docs, constraints, and criteria merge without replacing the objective.
10. Repeat a non-interactive import with `--yes --start` and confirm it starts immediately.
11. Trigger `/compact`; confirm `/goal status` still shows objective, criteria, source brief, and progress. Then send a normal prompt and verify hidden goal context is regenerated for the active goal.
12. Run `/reload` or restart/resume the session. Confirm the active-goal widget and `/goal status` reconstruct from current branch custom entries.
13. Use `/fork` or `/tree` to navigate between branches with different goal mutations. Confirm each branch shows its own goal state and stale context from the other branch is absent.
14. Start Pi with continuation enabled:

    ```bash
    pi --no-extensions -e ./extensions/index.ts --goal-continuation --goal-continuation-max-turns 3
    ```

15. Update progress through `update_goal_progress`, then let idle continuation queue. Confirm it stops after no progress or the max-turn cap and does not duplicate the queue.
16. Confirm automatic continuation is distinct from `/goal start` and `--start`; it should queue only while Pi is idle and the continuation flag is enabled.
17. Run quick non-interactive load checks:

    ```bash
    pi --no-session --no-extensions -e ./extensions/index.ts -p /goal
    pi --no-session --no-extensions -e ./extensions/index.ts --goal-continuation -p /goal
    ```

18. Run package and targeted coverage checks:

    ```bash
    npm run smoke:package
    npm run test:coverage
    ```

## Definition of done

The rollout is ready when automated checks pass, package contents are verified, docs links are reviewed, and live TUI lifecycle evidence is recorded.

Release readiness is currently blocked until live TUI smoke evidence is recorded for `/reload`, `/resume`, `/tree`, `/fork`, `/compact`, and the visible active-goal widget.

Future work remains Codex-exact compatibility: app-server RPC, SQLite persistence, exact token/time budgets, and exact Codex goal menu UI.
