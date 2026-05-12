# Implementing the Pi `/goal` extension

The extension should make long-running objectives explicit, persistent, and safe across compaction, branches, restarts, and model-driven continuation. Use Pi session primitives instead of introducing a separate database.

## Recommendation

Use this shape:

- Canonical state: Pi custom entries named `goal-state`.
- Model-visible context: short hidden custom messages injected before turns, not full state dumps.
- Source docs: stored as file paths plus extracted brief text.
- Model tools: read goal, create goal, mark complete. The model must not silently rewrite user-owned scope.
- Runtime continuation: extension-queued follow-up user messages only when Pi is idle and the active goal is still current.
- Compaction: hook Pi compaction and preserve the goal summary in the custom compaction `details` and/or regenerated hidden context.

## What Codex `/goal` does

Codex has a first-class goal feature behind a feature flag.

| Area                       | Codex behavior                                                                                                                                                            | Source                                                                                         |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| Slash command registration | Adds `Goal`; description is “set or view the goal for a long-running task”; supports inline args; available while a task is running; not available in side conversations. | `codex-rs/tui/src/slash_command.rs`                                                            |
| Bare `/goal`               | Opens current goal menu when a thread exists; otherwise shows usage.                                                                                                      | `codex-rs/tui/src/chatwidget/slash_dispatch.rs`                                                |
| `/goal <objective>`        | Sets an objective, validates input, confirms before replacing an existing goal, queues command parsing when the session has not started.                                  | `codex-rs/tui/src/chatwidget/slash_dispatch.rs`                                                |
| Control args               | `clear`, `edit`, `pause`, `resume`; status updates are user/system-owned.                                                                                                 | `codex-rs/tui/src/chatwidget/slash_dispatch.rs`, `codex-rs/tui/src/app/thread_goal_actions.rs` |
| Persistence                | SQLite table `thread_goals` keyed by thread id, with `goal_id`, objective, status, token budget, usage, timestamps.                                                       | `codex-rs/state/migrations/0029_thread_goals.sql`, `codex-rs/state/src/runtime/goals.rs`       |
| Runtime                    | Tracks token and wall-clock usage, pauses on interrupt, restores runtime state on resume, and starts continuation turns when idle.                                        | `codex-rs/core/src/goals.rs`                                                                   |
| Model tools                | Exposes `get_goal`, `create_goal`, `update_goal`; update only allows `complete`.                                                                                          | `codex-rs/core/src/tools/handlers/goal_spec.rs`                                                |
| Compaction                 | Replaces history with a summary while preserving user messages and initial context placement rules.                                                                       | `codex-rs/core/src/compact.rs`, `codex-rs/core/src/session/turn.rs`                            |

Pi should copy the product behavior, not the implementation. Pi does not need Codex’s app-server or SQLite thread-goal table because Pi sessions are already JSONL, branch-aware, and extension-writable.

## Pi architecture to use

| Pi primitive                                                  | Use in `/goal`                                                                                          |
| ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `pi.registerCommand("goal", ...)`                             | User command entrypoint for viewing, setting, editing, clearing, pausing, resuming, and importing docs. |
| `pi.registerTool(...)`                                        | Model tools for goal read/create/complete.                                                              |
| `pi.appendEntry(customType, data)`                            | Canonical, branch-aware state persistence.                                                              |
| `before_agent_start`                                          | Inject hidden goal context before a turn starts.                                                        |
| `context`                                                     | Filter stale goal context and keep only current-branch context.                                         |
| `agent_end` / `turn_end`                                      | Update progress, decide whether to continue, update UI status.                                          |
| `session_start`, `session_tree`                               | Reconstruct in-memory state from the current branch.                                                    |
| `session_before_compact`                                      | Preserve goal state and source-doc brief in custom compaction summary.                                  |
| `ctx.ui.setStatus`, `ctx.ui.setWidget`, `ctx.ui.custom`       | Footer/status and optional full summary UI.                                                             |
| `ctx.waitForIdle()`, `pi.sendUserMessage(..., { deliverAs })` | Safe runtime continuation.                                                                              |

Useful Pi examples:

- `examples/extensions/todo.ts` shows branch-aware state reconstruction from session history.
- `examples/extensions/plan-mode/index.ts` shows custom entries, hidden context injection, status widgets, progress tracking, and continuation-like follow-up messages.

## State model

Persist every state mutation as a new custom entry. Reconstruct from `ctx.sessionManager.getBranch()`, not from all entries, so `/tree`, fork, and clone semantics are correct.

```typescript
type GoalStatus = "active" | "paused" | "complete";

type GoalSourceDoc = {
	path: string;
	kind: "prd" | "doc" | "directory" | "manual";
	brief: string;
	hash?: string;
	extractedAt: number;
};

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

Custom entry format:

```typescript
pi.appendEntry("goal-state", {
  action: "set" | "clear" | "pause" | "resume" | "complete" | "progress" | "import-docs",
  state: goalStateOrNull,
  reason?: string,
});
```

Why this works:

- Pi custom entries do not enter model context by default, so full state can be verbose without token cost.
- Current-branch reconstruction makes goals branch-safe by default.
- Each mutation is auditable in the session file.

Do not store canonical state only in memory or only in tool result details. In-memory state breaks resume/reload. Tool result-only state makes user command mutations harder to represent.

## Command behavior

Implement `/goal` with the following subcommands.

| Command               | Behavior                                                                     |
| --------------------- | ---------------------------------------------------------------------------- |
| `/goal`               | Show current goal summary. If none, show usage and examples.                 |
| `/goal <objective>`   | Set a new active goal. If a goal exists, ask before replacing.               |
| `/goal edit`          | Open editor with current objective and brief fields. Persist user edits.     |
| `/goal clear`         | Remove current goal after confirmation.                                      |
| `/goal pause`         | Set status to `paused`; stop continuation.                                   |
| `/goal resume`        | Set status to `active`; optionally queue continuation if idle.               |
| `/goal complete`      | Mark complete after confirmation.                                            |
| `/goal import <path>` | Import a PRD, markdown file, or docs directory into source docs.             |
| `/goal status`        | Show expanded status, source docs, acceptance criteria, progress, and risks. |

Bare `/goal` should work while the agent is active because it only reads state and displays UI. Mutating commands should wait for idle before writing canonical state, unless they are implemented as queued follow-up operations.

### Input validation

- Objective must be non-empty after trimming.
- Reject objectives that are only control words (`clear`, `pause`, etc.) unless used as subcommands.
- Paths for `/goal import` must resolve inside the current workspace unless the user explicitly provides an absolute external path and confirms.
- Source docs should be read-only inputs. Never mutate the PRD or docs files as part of goal setup.

## PRD and doc-folder input flow

Support two ways to seed a goal from docs.

### Single PRD or markdown file

1. User runs `/goal import docs/prd.md` or `/goal <objective> --from docs/prd.md` if argument parsing supports flags.
2. Extension reads the file.
3. Extension extracts:
   - objective or problem statement,
   - constraints,
   - acceptance criteria,
   - relevant paths,
   - non-goals and risks.
4. Extension stores the source path plus an extracted brief in `GoalState.sourceDocs`.
5. Extension asks user to confirm the resulting objective before activation.

### Docs folder

1. User runs `/goal import docs/`.
2. Extension scans markdown/text files under the folder, ignoring large generated/vendor paths.
3. Extension builds a compact brief per file, not a giant concatenation.
4. Extension stores file paths and briefs. The model can read source files later if needed.

Recommended extraction format:

```markdown
Source: docs/prd.md
Objective: ...
Constraints:

- ...
  Acceptance criteria:
- ...
  Implementation hints:
- path/to/file.ts: ...
  Open questions:
- ...
```

Keep source-doc briefs short. The hidden turn context should mention source paths and a summary, not paste full documents every time.

## Model tool behavior

Expose model tools with narrow permissions.

| Tool                            | Parameters                                                           | Allowed behavior                                                                                                          |
| ------------------------------- | -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `get_goal`                      | none                                                                 | Return current goal, status, criteria, progress, and source paths.                                                        |
| `create_goal`                   | `objective`, optional `source_paths`, optional `acceptance_criteria` | Create only when the user explicitly asked for a goal or developer/system instructions require it. Fail if a goal exists. |
| `complete_goal`                 | optional `evidence`                                                  | Mark complete only when all required work is done.                                                                        |
| Optional `update_goal_progress` | `done`, `current`, `blocked`, `summary`                              | Update implementation progress, not objective or scope.                                                                   |

Do not expose a general `update_goal` tool that can rewrite objective, constraints, or source docs. Codex intentionally limits `update_goal` to `complete`, and Pi should keep the same safety boundary.

Prompt guideline example:

```text
Use get_goal when you need the current long-running objective. Use create_goal only when the user explicitly asks to start a goal. Use complete_goal only when the objective is achieved and no required work remains. Do not silently rewrite the user's goal objective or acceptance criteria.
```

## Hidden goal context

Inject a short hidden custom message before relevant turns when a goal is active.

```typescript
pi.on("before_agent_start", async (_event, ctx) => {
	if (!goal || goal.status !== "active") return;
	return {
		message: {
			customType: "goal-context",
			display: false,
			content: renderGoalContext(goal),
		},
	};
});
```

Suggested context:

```xml
<goal_context>
Objective: ...
Status: active
Acceptance criteria:
- ...
Current progress: ...
Source docs:
- docs/prd.md, brief: ...
Rules:
- Work toward the goal unless the user asks for something else.
- If the goal is complete, call complete_goal with evidence.
- Do not change objective, scope, or acceptance criteria without explicit user confirmation.
</goal_context>
```

Use the `context` event to remove stale `goal-context` messages if the reconstructed branch state no longer has that goal active.

## Compaction and session behavior

Pi compaction writes `CompactionEntry` records and supports extension customization through `session_before_compact`. The goal extension should preserve the goal summary even when old context is summarized away.

Implementation approach:

1. Reconstruct the current goal from `branchEntries`.
2. Let Pi’s default compaction handle conversation summarization unless the extension needs custom summary text.
3. If returning custom compaction, append a `Goal` section to the summary and include custom details:

```typescript
return {
	compaction: {
		summary: `${defaultLikeSummary}\n\n## Active goal\n${renderCompactGoalSummary(goal)}`,
		firstKeptEntryId: preparation.firstKeptEntryId,
		tokensBefore: preparation.tokensBefore,
		details: {
			goal: compactGoalDetails(goal),
		},
	},
};
```

If not replacing compaction, the extension can still rely on canonical custom entries plus future hidden context. The acceptance bar is that after `/compact`, `/goal status` and the next turn both preserve objective, criteria, source paths, and progress.

Important Pi behavior:

- Custom entries do not enter context automatically.
- Custom messages do enter context.
- Compaction summaries do enter context.
- Branch summaries and current branch reconstruction matter after `/tree`.

## Runtime continuation

Codex continues active goals automatically when idle. Pi can approximate this with extension follow-up messages.

Recommended guardrails:

- Continue only when `goal.status === "active"`.
- Do not continue if `ctx.isIdle()` is false.
- Do not continue if `ctx.hasPendingMessages()` is true.
- Do not continue immediately after a user interrupt; pause or require explicit `/goal resume`.
- Store `lastContinuationGoalId` and `lastContinuationAt` in state to prevent loops.
- Re-read current branch state immediately before queuing continuation.
- Use `deliverAs: "followUp"` when streaming, or normal `pi.sendUserMessage` when idle.

Continuation prompt:

```text
Continue working toward the active goal.

Objective: ...
Remaining acceptance criteria:
- ...
Use tools as needed. If all required work is complete, call complete_goal with evidence.
```

Loop prevention:

- If the previous continuation produced no tool calls and no progress update, do not auto-continue again.
- If the model marks the goal complete, clear continuation state.
- If the user sends a non-goal prompt, do not auto-continue until the prompt completes and the goal still applies.

## UI and status

Use lightweight UI first.

- Footer status: `goal: active`, `goal: paused`, or hidden when no goal exists.
- Widget: short progress list while active, similar to plan-mode’s todo widget.
- `/goal` popup or custom component: objective, status, source docs, criteria, progress, commands.
- Tool rendering: concise call/result renderers for `get_goal`, `create_goal`, `complete_goal`.

Minimum viable UI:

```typescript
ctx.ui.setStatus("goal", goal ? `goal: ${goal.status}` : undefined);
ctx.ui.setWidget("goal", goal?.status === "active" ? renderGoalWidget(goal) : undefined);
```

For a larger popup, follow Pi TUI constraints from `docs/tui.md`: every rendered line must fit the provided width, cache render output by width, and close on Escape/Ctrl+C.

## Branch, fork, reload, and resume semantics

- Reconstruct from `ctx.sessionManager.getBranch()` on `session_start` and `session_tree`.
- Persist state changes with `pi.appendEntry`, not a project-local file, unless a future version adds explicit export/import.
- On fork/clone, the branch path should carry the latest goal state up to the fork point.
- On `/tree`, the goal should reflect the selected branch. Do not use a global singleton goal across branches.
- On `/reload`, rebuild in-memory state from entries.
- On `/resume`, rebuild state, update UI, and if active, wait for explicit user action or safe idle continuation.

## Implementation phases

### Phase 1: Core state and command

- Add extension entrypoint.
- Define `GoalState` and reconstruction from branch custom entries.
- Implement `/goal`, `/goal <objective>`, `/goal status`, `/goal clear`, `/goal pause`, `/goal resume`, `/goal complete`.
- Update footer status.

### Phase 2: Model tools and hidden context

- Register `get_goal`, `create_goal`, `complete_goal`, optional progress tool.
- Inject hidden short goal context in `before_agent_start`.
- Filter stale goal context with `context`.
- Add concise tool renderers.

### Phase 3: PRD/doc-folder import

- Implement `/goal import <path>`.
- Extract brief, constraints, acceptance criteria, and source path metadata.
- Confirm extracted objective before activation.
- Add path validation and size limits.

### Phase 4: Compaction and branch hardening

- Add `session_before_compact` handling.
- Verify `/compact` preserves goal state and source-doc brief.
- Add `session_tree` reconstruction and branch tests.

### Phase 5: Runtime continuation

- Implement safe continuation after idle.
- Add loop prevention.
- Pause on interrupt or when continuation makes no progress.
- Show UI status while continuation is queued/running.

### Phase 6: Tests and polish

- Unit test state reducer and doc extraction.
- Integration test command flows in a Pi session.
- Test resume, reload, branch, fork, compaction, and model tool behavior.
- Polish UI copy and error messages.

### Verification coverage

The test suite includes focused unit tests plus integration-style harness tests for command lifecycle, docs import, model tools, hidden context, compaction details, branch-shaped reconstruction, stale `goalId` handling, and continuation safety. Interactive Pi operations that depend on a live TUI/session manager (`/compact`, `/reload`, `/resume`, `/tree`, `/fork`) are documented as a manual smoke checklist in `docs/acceptance-criteria.md`.

## Risks and mitigations

| Risk                                 | Mitigation                                                                             |
| ------------------------------------ | -------------------------------------------------------------------------------------- |
| Runaway autonomous continuation      | Require active status, idle checks, progress detection, and backoff/loop stop.         |
| Model silently changes user scope    | Do not expose objective rewrite tools; require `/goal edit` or user confirmation.      |
| Compaction drops source context      | Store canonical state in custom entries and re-inject hidden context after compaction. |
| Branch state leaks                   | Reconstruct only from `getBranch()`, never from all entries for active state.          |
| Docs import floods context           | Store paths plus extracted briefs; model can read files on demand.                     |
| Stale continuation after replacement | Track `goalId`; re-read before queuing and before acting.                              |
| UI unavailable in print/RPC modes    | Guard with `ctx.hasUI`; return text notifications or tool results instead.             |

## Implementation TODOs

- Confirm the final package structure and whether the extension will live under `.pi/extensions/pi-goal/index.ts`, `src/index.ts`, or a distributable Pi package.
- Confirm whether automatic continuation should be enabled by default or require `/goal resume --auto` style opt-in.
- Confirm the exact size limits for doc-folder import after the codebase structure is known.
