# Pi Agent Goal

Pi Agent Goal adds persistent `/goal` workflows to Pi. Set a long-running objective, import context from docs, keep goal state aligned with branch history, expose narrow progress tools, and start agent work explicitly when you are ready.

Repository: [`KristjanPikhof/Pi-Agent-Goal`](https://github.com/KristjanPikhof/Pi-Agent-Goal)

## Quick start

Install the package, then start Pi:

```bash
pi install npm:pi-agent-goal
pi
```

In Pi, run:

```text
/goal
```

You should see usage when no goal exists yet. Create a goal, review the editable draft, then start it when you are ready:

```text
/goal Ship the onboarding cleanup
# choose Start, Edit, or Cancel in interactive Pi
```

If you created the goal without `--start`, start it later:

```text
/goal start
```

For non-interactive runs that should begin work immediately, opt in with `--start`:

```bash
pi -e npm:pi-agent-goal -p "/goal Ship the onboarding cleanup --start"
```

## Install

The full install reference, including settings.json edits, project-local installs, one-off runs, and local-checkout symlinks, lives in [`docs/setup.md`](./docs/setup.md). The short version:

```bash
pi install npm:pi-agent-goal      # recommended global install
pi install -l npm:pi-agent-goal   # project-local install
pi -e npm:pi-agent-goal           # one-off run, nothing written to settings
```

For local checkout development:

```bash
git clone git@github.com:KristjanPikhof/Pi-Agent-Goal.git
cd Pi-Agent-Goal
npm install
pi --no-extensions -e ./extensions/index.ts
```

The root extension shim loads `extensions/pi-goal/index.ts`, and the package manifest points Pi at `./extensions/index.ts`:

```json
{
	"pi": {
		"extensions": ["./extensions/index.ts"]
	}
}
```

## Commands

| Command                                 | Behavior                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `/goal`                                 | Show usage when no goal exists, otherwise show the current goal summary.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `/goal <objective> [--start]`           | Sends the plain text to the chat agent to draft a reviewable objective, short context, and acceptance criteria through `propose_goal_draft`. Nothing is saved until the review callback runs. Interactive Pi shows Start, Edit, and Cancel; Start saves the reviewed draft and queues the one-shot handoff, Edit opens the modal editor with objective and acceptance criteria prefilled, and Cancel saves nothing. Recognized flags such as `--replace` and `--start` are stripped from the objective even when they appear before the text. If a goal already exists, interactive Pi asks for confirmation. In non-interactive mode, use `--replace` to replace. |
| `/goal start`                           | Start the current active goal with a one-shot follow-up handoff. This is user-requested agent work, not automatic idle continuation. Paused or complete goals must be resumed, cleared, or replaced first.                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `/goal status`                          | Show objective, status, criteria, constraints, source docs, progress, blockers, and next commands.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `/goal import <path> [--yes] [--start]` | Import a markdown/text PRD file or docs folder. Stores source paths plus compact briefs. With no current goal, creates an active goal. With an existing active goal, imports merge source docs, constraints, and criteria instead of replacing the objective. Paused or complete goals reject import without mutation. Use `--yes` in non-interactive mode after reviewing the source, and add `--start` when that non-interactive import should begin work immediately.                                                                                                                                                                                           |
| `/goal edit`                            | Edit the objective and acceptance criteria through the interactive UI editor. Non-interactive mode should use `/goal <objective> --replace`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `/goal pause`                           | Pause the goal, which stops hidden active-goal context, continuation, completion, and progress updates until resumed.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `/goal resume [--start]`                | Resume a paused goal as active. Complete goals are terminal until cleared or replaced. Add `--start` when a non-interactive resume should immediately hand the active goal to the agent.                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `/goal complete [--yes]`                | Mark an active goal complete. Use `--yes` when there is no interactive confirmation UI.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `/goal clear [--yes]`                   | Clear the current goal and hide goal UI. Use `--yes` when there is no interactive confirmation UI.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |

## Plain goal review flow

Plain `/goal` text is a drafting request. The command sends a follow-up message that asks the chat agent to call `propose_goal_draft` exactly once with a concise objective, optional context, and concrete acceptance criteria. The proposal is review-only; it does not persist state by itself.

In interactive Pi, the callback confirms replacement when needed, then shows Start, Edit, and Cancel before anything is saved. The choices are:

- **Start**, save the reviewed draft and queue the one-shot start handoff.
- **Edit**, open a prefilled modal markdown editor for the objective and acceptance criteria, then return to review. Invalid editor content is reported and the review loop continues.
- **Cancel**, discard the unsaved draft and save nothing.

If the model replies in prose instead of calling `propose_goal_draft`, no goal is saved. Ask it to call the tool, or create a goal with an explicit approved `create_goal` request. If interactive review UI is unavailable, `propose_goal_draft` cancels with `review_ui_unavailable` and saves nothing; use an interactive Pi session for the review path. Criteria-free goals can still exist through older saved state or explicitly approved tool calls, and prompts call that out by using the objective as the source of truth.

## Model tools

The extension registers these tools for model use:

- `get_goal`, reads current goal state and source paths.
- `create_goal`, creates a goal only when `explicit_request` is true and no goal already exists.
- `propose_goal_draft`, opens the Start/Edit/Cancel review flow for agent-drafted `/goal` proposals and saves only after Start.
- `complete_goal`, marks an active goal complete with optional evidence. It rejects paused and already complete goals.
- `update_goal_progress`, updates progress only. It rejects paused or complete goals and cannot change objective, source docs, or acceptance criteria.

## State, compaction, and autonomy

Canonical state is stored as Pi custom session entries with custom type `goal-state`. The active state is reconstructed from `ctx.sessionManager.getBranch()`, so forks, `/tree`, reload, and resume follow the selected branch instead of a global latest value.

Active goals inject a short hidden `goal-context` message before agent turns. Compaction uses `session_before_compact` to preserve the active goal objective, criteria, source doc briefs, and progress in the compaction summary details. Full imported docs are not repeatedly pasted into model context.

Starting a goal and automatic continuation are separate controls. `/goal start` and `--start` queue a single, explicit handoff for the current active goal. They do not enable background work after that turn.

Automatic continuation is a separate opt-in. Start Pi with:

```bash
pi -e npm:pi-agent-goal --goal-continuation
```

Optional cap:

```bash
pi -e npm:pi-agent-goal --goal-continuation --goal-continuation-max-turns 3
```

Continuation only queues when the goal is active, Pi is idle, and no pending user messages exist. It rechecks the goal ID before starting and stops on no progress, completion, pause, clear, replacement, user interrupt, duplicate queue, busy state, disabled flag, pending messages, or max-turn cap.

## Known gaps versus Codex

- No Codex SQLite `thread_goals` table or app-server RPC compatibility. Pi uses session custom entries instead.
- No exact Codex token budget or wall-clock accounting. Pi uses an opt-in max-turn cap and progress checks.
- No exact Codex goal menu or bottom-pane UI. Pi uses footer status, widgets, command output, and tool renderers.
- No general model `update_goal` tool. This is intentional, to prevent silent objective or scope rewrites.
- Live TUI lifecycle checks for `/compact`, `/reload`, `/resume`, `/tree`, and `/fork` are manual smoke coverage. Record that evidence before release, or mark the release blocked. Automated tests cover the underlying hooks and reconstruction behavior, not the live TUI itself.

## Troubleshooting

| Symptom                                                         | What to do                                                                                                                                                                                                                                                                                                  |
| --------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/goal import` says the path is outside the workspace           | The requested path or its realpath resolved outside the workspace, including symlink escapes. Run from the workspace root or move/copy the source file inside it.                                                                                                                                           |
| `/goal import` requires `--yes`                                 | Non-interactive mode cannot show confirmation. Review the source docs, then rerun with `--yes`. Add `--start` only when the import should also start a one-shot agent handoff. Directory imports fail if supported docs exceed the configured `maxFiles`; narrow the path or raise the limit in code/tests. |
| Replacing a goal fails in non-interactive mode                  | Rerun `/goal <objective> --replace`. Add `--start` too if the replacement should begin immediately.                                                                                                                                                                                                         |
| `/goal edit` fails                                              | The editor is interactive-only. Use `/goal <objective> --replace` instead.                                                                                                                                                                                                                                  |
| `/goal <text>` says the draft was queued, but no review appears | The chat agent must call `propose_goal_draft`. If it answered in prose or stopped early, ask it to call the tool with objective and acceptance criteria. No goal is saved until that callback runs.                                                                                                         |
| `propose_goal_draft` reports `review_ui_unavailable`            | The draft review needs interactive `select` and `editor` UI. Re-run in the Pi TUI, or use an explicit approved `create_goal` request if you really need a non-interactive save.                                                                                                                             |
| Hidden context or UI looks stale after branch navigation        | Run `/goal status`; state is reconstructed from the selected branch. If it is wrong, inspect recent `goal-state` custom entries in the session.                                                                                                                                                             |
| Continuation does not start                                     | Confirm Pi was launched with `--goal-continuation`, the goal is active, Pi is idle, and there are no pending user messages.                                                                                                                                                                                 |

## Local development

```bash
npm run typecheck
npm run lint
npm run format
npm test
```

Related docs:

- [`docs/README.md`](docs/README.md), rollout notes and doc map.
- [`docs/implementation.md`](docs/implementation.md), implemented architecture and behavior.
- [`docs/acceptance-criteria.md`](docs/acceptance-criteria.md), acceptance status, test matrix, and smoke checklist.

## License

MIT. See [`LICENSE`](./LICENSE).
