# Implementing the Pi `/goal` extension

The extension makes long-running objectives explicit, persistent, and safe across compaction, branches, restarts, and optional model-driven continuation. It uses Pi session primitives instead of a separate database.

## Compatibility baseline

Release `2026.6.13` targets Pi `0.79.3`-era extension and TUI APIs and requires Node.js `>=22.19.0`. `package.json` keeps Pi core packages as open peer dependencies (`*`) because Pi should supply exactly one host runtime. Development dependencies pin `@earendil-works/pi-coding-agent` and `@earendil-works/pi-tui` to `^0.79.3` so local validation catches API drift without forcing those copies into the published package.

The package loads source TypeScript through `extensions/index.ts`. Package smoke checks must confirm that `extensions`, `src`, `README.md`, `docs`, and `LICENSE` are present in the tarball and that docs links remain relative.

## Implemented shape

- Extension entrypoint: `src/index.ts` registers the command, model tools, and runtime hooks.
- Canonical state: Pi custom entries named `goal-state`, handled by `src/state.ts`.
- User command surface: `/goal`, implemented in `src/commands.ts` with UI helpers in `src/ui.ts`.
- Source docs: stored as source paths plus extracted compact briefs, implemented in `src/import.ts`.
- Model tools: `get_goal`, `create_goal`, `propose_goal_draft`, `complete_goal`, and `update_goal_progress`, implemented in `src/tools.ts`.
- Hidden context and compaction: runtime hooks in `src/runtime.ts`, prompt rendering in `src/prompts.ts`.
- Start handoff: `/goal start` and `--start` queue a one-shot follow-up for the active goal.
- Autonomy: opt-in idle continuation behind the `goal-continuation` flag, separate from explicit start handoff.

## Install and local loading

From the repo root:

```bash
npm install
pi --no-extensions -e ./extensions/index.ts
```

Quick load checks:

```bash
pi --no-session --no-extensions -e ./extensions/index.ts -p /goal
pi --no-session --no-extensions -e ./extensions/index.ts --goal-continuation -p /goal
```

The package metadata exposes the extension through this source-extension layout:

```json
{
	"pi": {
		"extensions": ["./extensions/index.ts"]
	}
}
```

The extension folder is:

```text
extensions/index.ts
extensions/pi-goal/index.ts
```

## Codex comparison

| Area         | Codex behavior                                                                     | Pi Agent Goal behavior                                                                                                                                      |
| ------------ | ---------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Persistence  | SQLite `thread_goals` table keyed by thread.                                       | Pi custom session entries named `goal-state`, reconstructed from the current branch.                                                                        |
| Commands     | `/goal` supports setting, viewing, editing, clearing, pausing, and resuming goals. | Same main lifecycle, with explicit `/goal start`, non-interactive `--start`, confirmation flags, and clean flag parsing.                                    |
| Model tools  | `get_goal`, `create_goal`, `update_goal` limited to completion.                    | `get_goal`, `create_goal`, review-only `propose_goal_draft`, `complete_goal`, plus progress-only `update_goal_progress`. No general objective rewrite tool. |
| Compaction   | Codex preserves goal context through its compaction pipeline.                      | Pi `session_before_compact` appends active goal summary/details while canonical state stays in custom entries.                                              |
| Continuation | Codex runtime continues active goals while idle with runtime budget tracking.      | Pi continuation is opt-in, capped by max turns, and guarded by idle/pending-message/stale-goal/progress checks.                                             |
| UI           | Codex-specific menu and bottom-pane behavior.                                      | Pi compact active-goal widget, `/goal status` command output, and tool renderers.                                                                           |

Known parity gaps are intentional for this rollout: no Codex app-server RPC compatibility, no SQLite table, no exact token or wall-clock accounting, and no exact Codex menu UI.

## Runtime and harness alignment

The runtime uses current Pi input and follow-up conventions:

- `InputEvent.text` is the preferred source for user input, with compatibility fallbacks for older event shapes.
- Explicit agent handoffs use `sendUserMessage(..., { deliverAs: "followUp" })`. The older `streamingBehavior: "followUp"` shape is treated as compatibility input, not the primary outbound API.
- UI behavior is keyed from `ctx.mode`. The TUI path can install a themed widget component, while RPC, JSON, print, and older hosts receive plain rendered lines or status strings.

This keeps `/goal start`, `--start`, continuation turns, and user interrupts aligned with Pi's current harness semantics.

## Tool errors and refusals

Model tools distinguish execution failures from expected policy refusals. Invalid model-provided schema data and unexpected runtime failures are hard errors. Normal permission or state boundaries return a soft refusal with readable content and structured details, for example `details.status: "refused"` plus a reason such as `permission_denied`, `goal_exists`, `no_goal`, `goal_inactive`, or `already_complete`.

Soft refusal is intentional for model control flow. The model can explain the next user action without treating a safe denial as a crashed tool call.

## State model

Every mutation appends a custom entry with custom type `goal-state`. State is reconstructed from `ctx.sessionManager.getBranch()`, not from all session entries, so branch navigation and forks do not leak global latest state.

```typescript
type GoalStatus = "active" | "paused" | "complete";

type GoalState = {
	version: 1;
	goalId: string;
	objective: string;
	status: GoalStatus;
	sourceDocs: GoalSourceDoc[];
	constraints: string[];
	acceptanceCriteria: string[];
	progress: {
		done: string[];
		current?: string;
		blocked: string[];
		lastSummary: string;
	};
	createdAt: number;
	updatedAt: number;
	completedAt?: number;
	owner: "user" | "model";
};
```

Supported events are `create`, `replace`, `edit`, `pause`, `resume`, `clear`, `complete`, `progress`, and `import-docs`. Replacing a goal creates a new `goalId`; later mutations for stale IDs are ignored. Complete goals are terminal until cleared or replaced. Paused goals can only resume, report status, or clear. Objectives are trimmed, non-empty, and limited to 4000 characters.

## Command behavior

| Command                                 | Implemented behavior                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `/goal`                                 | Shows usage with no goal, otherwise current summary.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `/goal <objective> [--start]`           | Validates the user's text, confirms replacement when needed, then sends a follow-up prompt asking the chat agent to call `propose_goal_draft` exactly once. The tool proposal must include objective, acceptance criteria, and optional source paths. It may include a short description for result metadata, but that text is not persisted unless the user folds it into the reviewed objective or criteria. Nothing is saved until the callback review finishes. Interactive review uses `ctx.ui.select` and `ctx.ui.editor`: Start saves the reviewed draft and queues the one-shot handoff, Edit opens a prefilled modal markdown editor for objective and acceptance criteria, and Cancel saves nothing. Recognized flags are removed from the objective, so `--replace ship`, `ship --replace`, and `ship --start` send objective `ship` to the drafting prompt. If a goal exists, interactive mode confirms replacement and non-interactive mode requires `--replace`. |
| `/goal start`                           | Starts the existing active goal by sending a one-shot follow-up prompt. It re-reads state before sending and rejects missing, paused, complete, or changed goals. This handoff is not automatic continuation.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `/goal status`                          | Shows expanded state: criteria, constraints, progress, blocked items, source docs, and next commands.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `/goal import <path> [--yes] [--start]` | Imports a supported docs file or folder. Interactive mode confirms and can start after storing. Non-interactive mode requires `--yes`, and immediate start also requires `--start`. With no current goal it creates an active goal from imported docs; with an existing active goal it appends imported docs and merges extracted constraints and criteria without replacing the objective. Paused or complete goals reject import without mutation.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `/goal edit`                            | Opens the interactive editor. Non-interactive mode returns an actionable fallback.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `/goal pause`                           | Sets an active goal to `paused`. Paused goals do not receive hidden context, continuation, completion, or progress updates.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `/goal resume [--start]`                | Sets a paused goal to `active`. Complete goals are not resumed; clear or replace them instead. Non-interactive immediate start after resume requires `--start`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `/goal complete [--yes]`                | Marks an active goal complete after confirmation or `--yes`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `/goal clear [--yes]`                   | Clears current state after confirmation or `--yes`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |

Mutating commands call `ctx.waitForIdle()` before writing and reload current branch state before saving. This avoids racing with an active agent turn or a goal replacement.

## Explicit start handoff

Plain text goal input asks the chat agent to draft the goal first. `renderGoalAgentDraftingPrompt` tells the model not to answer in prose and to call `propose_goal_draft` with a concise objective, concrete acceptance criteria, and any source paths the user named. A short description can travel as result metadata, but the current goal state persists only objective, acceptance criteria, and source docs. Setting or importing a goal is a state change. Starting a goal is a separate handoff that tells Pi to begin work from the saved goal context.

Use these forms:

```text
/goal Ship the onboarding cleanup
/goal start
/goal import docs/prd.md --yes --start
/goal resume --start
```

`/goal start` is for an already active goal. `--start` is for create, import, and resume flows that should start immediately, especially in non-interactive `-p` runs where Pi cannot ask a follow-up question.

The start handoff queues a single follow-up prompt for the current active `goalId`. It does not enable recurring idle work, does not bypass paused or complete states, and does not replace the `--goal-continuation` runtime flag.

## PRD and docs import

`/goal import` accepts `.md`, `.markdown`, and `.txt` files. Directory import scans supported files, ignores generated/vendor directories, and enforces configurable file count and size limits. If a directory contains more supported files than `maxFiles`, import fails with an overflow error instead of silently truncating the set.

Extracted fields:

- objective,
- constraints,
- acceptance criteria,
- risks,
- open questions,
- referenced source paths,
- source document hash and compact brief.

Path rules are intentionally strict. Relative paths must first resolve inside the workspace, then both the workspace and import target are checked with `realpath`. Symlinks that escape the workspace are rejected for files and directories. Missing, unreadable, unsupported, binary, oversized, or out-of-workspace paths return clear errors. Imported docs are read-only inputs; the extension never edits the source files.

Multiple imported docs are combined with deterministic dedupe. The first non-empty imported objective is used when creating a goal. Later imports into an existing active goal merge source docs by path (new hash/brief wins for that path) and dedupe constraints and acceptance criteria. They do not rewrite the current objective. Paused or complete goals reject docs import before saving; resume a paused goal first, or clear/replace a complete goal.

## Model tool behavior

| Tool                   | Permission boundary                                                                                                                                                                                                                                 |
| ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `get_goal`             | Reads current state and source paths.                                                                                                                                                                                                               |
| `create_goal`          | Requires `explicit_request: true` and fails if a goal exists. It is for already-approved persistence, not agent-drafted `/goal` proposals.                                                                                                          |
| `propose_goal_draft`   | Requires a non-empty objective and at least one acceptance criterion, confirms replacement, opens Start/Edit/Cancel review, and saves only after Start. It returns `review_ui_unavailable` and saves nothing when interactive review UI is missing. |
| `complete_goal`        | Only marks the current active goal complete, with optional evidence in the entry reason. It rejects paused and already complete goals.                                                                                                              |
| `update_goal_progress` | Updates progress fields only on active goals. It rejects paused or complete goals and cannot rewrite objective, source docs, constraints, or acceptance criteria.                                                                                   |

This keeps user-owned scope under user control. There is no general model tool that can rewrite the objective.

## Hidden context and compaction

Active goals inject one hidden custom message with custom type `goal-context` before an agent turn. Paused, complete, or cleared goals do not inject active-goal context.

The context hook removes stale `goal-context` messages from old branches or replaced goals and keeps only the latest message for the current active `goalId`.

During `session_before_compact`, active goals preserve:

- objective,
- goal ID and status,
- acceptance criteria,
- source doc paths and briefs,
- progress summary, current work, done items, and blockers.

Canonical state still comes from `goal-state` custom entries after compaction. The compaction summary/details are a model-context aid, not the source of truth.

## Runtime continuation

Automatic continuation is disabled by default and is separate from `/goal start` or `--start`. The start handoff queues one explicit turn. Continuation can queue later turns only when the runtime flag is enabled and the idle guards pass.

Enable continuation with:

```bash
pi --no-extensions -e ./extensions/index.ts --goal-continuation
```

Set the cap with:

```bash
pi --no-extensions -e ./extensions/index.ts --goal-continuation --goal-continuation-max-turns 3
```

Continuation queues only when all checks pass:

- flag enabled,
- current branch has an active goal,
- Pi reports idle,
- no pending user messages,
- no queued or running continuation exists,
- max-turn cap is not reached,
- goal ID still matches after a re-read.

It records `goal-continuation` custom entries for queued, started, completed-turn, and stopped events. It stops on stale goal, pause, clear, complete, replacement, user interrupt, no progress, duplicate queue, pending messages, busy state, disabled flag, or max-turn cap.

## UI behavior

The UI layer is theme-aware but still works without TUI-only APIs:

- plain text `/goal` input uses the chat agent plus `propose_goal_draft` to produce objective and acceptance criteria before review,
- draft review uses public Pi UI primitives only: `ctx.ui.select`, `ctx.ui.editor`, and `ctx.ui.confirm`,
- Start saves the draft and queues the one-shot handoff, Edit opens a prefilled modal markdown editor, and Cancel saves nothing,
- no legacy footer status is rendered; active goal state is represented by the compact active-goal widget and `/goal status` command output,
- TUI mode uses Pi themed widget components and semantic theme tokens,
- RPC, JSON, print, and hosts without widget support fall back to readable plain text/status output,
- active widget is intentionally compact: it shows objective, criteria count, blocker count when blocked, and a current-work line when `progress.current` is set; it does not render source hints or fall back to `lastSummary`,
- `/goal status` is readable in command output,
- missing UI methods no-op safely,
- non-interactive errors tell the user which flag or command to run next,
- tool renderers are concise.

## Optional Pi features not adopted

This rollout intentionally avoids a few current Pi extension surfaces:

| Pi feature                    | Why it is not used yet                                                                                                                                                              |
| ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Project-trust-specific config | `/goal` state is stored in the session branch and existing command confirmations already guard risky mutations. There is no separate trusted/untrusted behavior to configure.       |
| `getSystemPromptOptions`      | The extension already injects active-goal context through the runtime hook and compaction path. A dynamic system-prompt option would duplicate that context without a current need. |
| Autocomplete triggers         | The command set is small and documented in `/goal` usage. Adding autocomplete is useful only if users report command discovery friction.                                            |

Add these only when a concrete pi-goal workflow needs them.

## Acceptance and verification status

Automated coverage includes reducer transitions, branch reconstruction, command parsing and lifecycle, docs import safety and merge behavior, model tool boundaries, prompt rendering, hidden context filtering, compaction details, continuation stop conditions, UI rendering, and integration-style session lifecycle flows.

Current verification commands for rollout:

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

The remaining live TUI coverage is documented in [`acceptance-criteria.md`](acceptance-criteria.md#manual-session-lifecycle-smoke-checklist). It covers interactive `/compact`, `/reload`, `/resume`, `/tree`, `/fork`, and visible active-goal widget plus `/goal status` lifecycle checks. Record those smoke results before release, or mark the release blocked instead of treating automated harness tests as live TUI evidence.

## Troubleshooting

| Symptom                                             | Cause and fix                                                                                                                                                                                         |
| --------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Import path rejected as outside workspace           | Run Pi from the workspace root or import a file inside the workspace. Symlinks are checked by realpath and cannot point outside the workspace.                                                        |
| Directory import reports too many docs              | Narrow the directory path or raise the configured `maxFiles` limit. The import fails rather than silently dropping docs.                                                                              |
| Import requires `--yes`                             | Non-interactive mode cannot confirm. Review the source, then rerun with `--yes`. Add `--start` only if that import should immediately hand work to the agent.                                         |
| Goal replacement rejected                           | Use interactive confirmation or rerun with `--replace`. The flag is stripped from the saved objective. Add `--start` only when the replacement should begin immediately.                              |
| `edit` fails                                        | `/goal edit` needs interactive UI. Use `/goal <objective> --replace` without UI.                                                                                                                      |
| `/goal <text>` queued a draft but no review appears | The command only asks the chat agent to draft. The agent must call `propose_goal_draft`; a prose answer saves nothing. Ask the agent to call the tool with objective and acceptance criteria.         |
| `propose_goal_draft` cannot review                  | The tool requires interactive `select` and `editor` UI. Without them it returns `review_ui_unavailable`, terminates the drafting turn, and saves nothing. Use the Pi TUI for this review path.        |
| `/goal start` does not queue                        | Confirm a goal exists, is active, and the follow-up messaging API is available. Resume paused goals first; clear or replace complete goals.                                                           |
| Continuation does not queue                         | Enable `--goal-continuation`, keep the goal active, wait until Pi is idle, and ensure no pending user messages exist. Do not confuse this with `/goal start`, which queues only one explicit handoff. |
| Goal appears branch-stale                           | Run `/goal status` on the selected branch. The source of truth is the branch's `goal-state` entries.                                                                                                  |

## Future work

- Optional richer Pi TUI popup if users need more than the compact active-goal widget plus `/goal status` command output.
- Optional stricter Codex parity features, such as token/time accounting or RPC compatibility, if Pi users need them.
