# Implementing the Pi `/goal` extension

The extension makes long-running objectives explicit, persistent, and safe across compaction, branches, restarts, and optional model-driven continuation. It uses Pi session primitives instead of a separate database.

## Implemented shape

- Extension entrypoint: `src/index.ts` registers the command, model tools, and runtime hooks.
- Canonical state: Pi custom entries named `goal-state`, handled by `src/state.ts`.
- User command surface: `/goal`, implemented in `src/commands.ts` with UI helpers in `src/ui.ts`.
- Source docs: stored as source paths plus extracted compact briefs, implemented in `src/import.ts`.
- Model tools: `get_goal`, `create_goal`, `complete_goal`, and `update_goal_progress`, implemented in `src/tools.ts`.
- Hidden context and compaction: runtime hooks in `src/runtime.ts`, prompt rendering in `src/prompts.ts`.
- Autonomy: opt-in idle continuation behind the `goal-continuation` flag.

## Install and local loading

From the repo root:

```bash
npm install
pi --no-extensions -e ./src/index.ts
```

Quick load checks:

```bash
pi --no-session --no-extensions -e ./src/index.ts -p /goal
pi --no-session --no-extensions -e ./src/index.ts --goal-continuation -p /goal
```

The package metadata exposes the extension through:

```json
{
	"pi": {
		"extensions": ["./src/index.ts"]
	}
}
```

## Codex comparison

| Area | Codex behavior | Pi Goal behavior |
| --- | --- | --- |
| Persistence | SQLite `thread_goals` table keyed by thread. | Pi custom session entries named `goal-state`, reconstructed from the current branch. |
| Commands | `/goal` supports setting, viewing, editing, clearing, pausing, and resuming goals. | Same main lifecycle, with non-interactive flags for confirmation paths. |
| Model tools | `get_goal`, `create_goal`, `update_goal` limited to completion. | `get_goal`, `create_goal`, `complete_goal`, plus progress-only `update_goal_progress`. No general objective rewrite tool. |
| Compaction | Codex preserves goal context through its compaction pipeline. | Pi `session_before_compact` appends active goal summary/details while canonical state stays in custom entries. |
| Continuation | Codex runtime continues active goals while idle with runtime budget tracking. | Pi continuation is opt-in, capped by max turns, and guarded by idle/pending-message/stale-goal/progress checks. |
| UI | Codex-specific menu and bottom-pane behavior. | Pi footer status, active-goal widget, command output, and tool renderers. |

Known parity gaps are intentional for this rollout: no Codex app-server RPC compatibility, no SQLite table, no exact token or wall-clock accounting, and no exact Codex menu UI.

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

Supported events are `create`, `replace`, `edit`, `pause`, `resume`, `clear`, `complete`, `progress`, and `import-docs`. Replacing a goal creates a new `goalId`; later mutations for stale IDs are ignored. Objectives are trimmed, non-empty, and limited to 4000 characters.

## Command behavior

| Command | Implemented behavior |
| --- | --- |
| `/goal` | Shows usage with no goal, otherwise current summary. |
| `/goal <objective>` | Creates a goal. If one exists, interactive mode confirms replacement, non-interactive mode requires `--replace`. |
| `/goal status` | Shows expanded state: criteria, constraints, progress, blocked items, source docs, and next commands. |
| `/goal import <path> [--yes]` | Imports a supported docs file or folder. Interactive mode confirms. Non-interactive mode requires `--yes`. |
| `/goal edit` | Opens the interactive editor. Non-interactive mode returns an actionable fallback. |
| `/goal pause` | Sets status to `paused`. |
| `/goal resume` | Sets status to `active`. |
| `/goal complete [--yes]` | Marks complete after confirmation or `--yes`. |
| `/goal clear [--yes]` | Clears current state after confirmation or `--yes`. |

Mutating commands call `ctx.waitForIdle()` before writing and reload current branch state before saving. This avoids racing with an active agent turn or a goal replacement.

## PRD and docs import

`/goal import` accepts `.md`, `.markdown`, and `.txt` files. Directory import scans supported files, ignores generated/vendor directories, and enforces configurable file count and size limits.

Extracted fields:

- objective,
- constraints,
- acceptance criteria,
- risks,
- open questions,
- referenced source paths,
- source document hash and compact brief.

Path rules are intentionally strict. Relative paths must resolve inside the current workspace. Missing, unreadable, unsupported, binary, oversized, or out-of-workspace paths return clear errors. Imported docs are read-only inputs; the extension never edits the source files.

## Model tool behavior

| Tool | Permission boundary |
| --- | --- |
| `get_goal` | Reads current state and source paths. |
| `create_goal` | Requires `explicit_request: true` and fails if a goal exists. |
| `complete_goal` | Only marks the current goal complete, with optional evidence in the entry reason. |
| `update_goal_progress` | Updates progress fields only. It cannot rewrite objective, source docs, constraints, or acceptance criteria. |

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

Automatic continuation is disabled by default. Enable it with:

```bash
pi --no-extensions -e ./src/index.ts --goal-continuation
```

Set the cap with:

```bash
pi --no-extensions -e ./src/index.ts --goal-continuation --goal-continuation-max-turns 3
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

The UI layer is lightweight:

- footer status shows `goal: active`, `goal: paused`, or `goal: complete`, and clears when no goal exists,
- active widget shows objective, current/progress summary, criteria count, source hints, and blocker count,
- `/goal status` is readable in command output,
- missing UI methods no-op safely,
- non-interactive errors tell the user which flag or command to run next,
- tool renderers are concise.

## Acceptance and verification status

Automated coverage includes reducer transitions, branch reconstruction, command parsing and lifecycle, docs import, model tool boundaries, prompt rendering, hidden context filtering, compaction details, continuation stop conditions, UI rendering, and integration-style session lifecycle flows.

Current verification commands for rollout:

```bash
npm run typecheck
npm run lint
npm run format
npm test
pi --no-session --no-extensions -e ./src/index.ts -p /goal
pi --no-session --no-extensions -e ./src/index.ts --goal-continuation -p /goal
```

The remaining live TUI coverage is documented in [`acceptance-criteria.md`](acceptance-criteria.md#manual-session-lifecycle-smoke-checklist). It covers interactive `/compact`, `/reload`, `/resume`, `/tree`, `/fork`, and visible footer/widget lifecycle checks.

## Troubleshooting

| Symptom | Cause and fix |
| --- | --- |
| Import path rejected as outside workspace | Run Pi from the workspace root or import a file inside the workspace. |
| Import requires `--yes` | Non-interactive mode cannot confirm. Review the source, then rerun with `--yes`. |
| Goal replacement rejected | Use interactive confirmation or rerun with `--replace`. |
| `edit` fails | `/goal edit` needs interactive UI. Use `/goal <objective> --replace` without UI. |
| Continuation does not queue | Enable `--goal-continuation`, keep the goal active, wait until Pi is idle, and ensure no pending user messages exist. |
| Goal appears branch-stale | Run `/goal status` on the selected branch. The source of truth is the branch's `goal-state` entries. |

## Future work

- Package for distribution outside local `-e ./src/index.ts` loading.
- Optional richer Pi TUI popup if users need more than footer/widget plus command output.
- Optional stricter Codex parity features, such as token/time accounting or RPC compatibility, if Pi users need them.
