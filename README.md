# Pi Goal

Pi Goal adds Codex-style `/goal` support to Pi as an installable package. It lets a user set a long-running objective, import goal context from docs, preserve state through branch-aware session history and compaction, expose narrow model tools, and optionally continue work when Pi is idle.

## Quick start

Install the package, then start Pi:

```bash
pi install npm:pi-goal
pi
```

In Pi, run:

```text
/goal
```

You should see usage when no goal exists yet. Create one with:

```text
/goal Ship the onboarding cleanup
```

## Install

The full install reference, including settings.json edits, project-local installs, one-off runs, and local-checkout symlinks, lives in [`docs/setup.md`](./docs/setup.md). The short version:

```bash
pi install npm:pi-goal      # recommended global install
pi install -l npm:pi-goal   # project-local install
pi -e npm:pi-goal           # one-off run, nothing written to settings
```

For local checkout development:

```bash
npm install
pi --no-extensions -e ./extensions/index.ts
```

The package uses the same source-extension shape as `pi-agents-team`: the root extension shim loads `extensions/pi-goal/index.ts`, and the package manifest points Pi at `./extensions/index.ts`:

```json
{
	"pi": {
		"extensions": ["./extensions/index.ts"]
	}
}
```

## Commands

| Command                       | Behavior                                                                                                                                                                                                                                                                                                                                                                               |
| ----------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/goal`                       | Show usage when no goal exists, otherwise show the current goal summary.                                                                                                                                                                                                                                                                                                               |
| `/goal <objective>`           | Create an active goal. Recognized flags such as `--replace` are stripped from the objective even when they appear before the text. If a goal already exists, interactive Pi asks for confirmation. In non-interactive mode, use `--replace`.                                                                                                                                           |
| `/goal status`                | Show objective, status, criteria, constraints, source docs, progress, blockers, and next commands.                                                                                                                                                                                                                                                                                     |
| `/goal import <path> [--yes]` | Import a markdown/text PRD file or docs folder. Stores source paths plus compact briefs. With no current goal, creates an active goal. With an existing active goal, imports merge source docs, constraints, and criteria instead of replacing the objective. Paused or complete goals reject import without mutation. Use `--yes` in non-interactive mode after reviewing the source. |
| `/goal edit`                  | Edit the objective through the interactive UI editor. Non-interactive mode should use `/goal <objective> --replace`.                                                                                                                                                                                                                                                                   |
| `/goal pause`                 | Pause the goal, which stops hidden active-goal context, continuation, completion, and progress updates until resumed.                                                                                                                                                                                                                                                                  |
| `/goal resume`                | Resume a paused goal as active. Complete goals are terminal until cleared or replaced.                                                                                                                                                                                                                                                                                                 |
| `/goal complete [--yes]`      | Mark an active goal complete. Use `--yes` when there is no interactive confirmation UI.                                                                                                                                                                                                                                                                                                |
| `/goal clear [--yes]`         | Clear the current goal and hide goal UI. Use `--yes` when there is no interactive confirmation UI.                                                                                                                                                                                                                                                                                     |

## Model tools

The extension registers these tools for model use:

- `get_goal`, reads current goal state and source paths.
- `create_goal`, creates a goal only when `explicit_request` is true and no goal already exists.
- `complete_goal`, marks an active goal complete with optional evidence. It rejects paused and already complete goals.
- `update_goal_progress`, updates progress only. It rejects paused or complete goals and cannot change objective, source docs, or acceptance criteria.

## State, compaction, and autonomy

Canonical state is stored as Pi custom session entries with custom type `goal-state`. The active state is reconstructed from `ctx.sessionManager.getBranch()`, so forks, `/tree`, reload, and resume follow the selected branch instead of a global latest value.

Active goals inject a short hidden `goal-context` message before agent turns. Compaction uses `session_before_compact` to preserve the active goal objective, criteria, source doc briefs, and progress in the compaction summary details. Full imported docs are not repeatedly pasted into model context.

Automatic continuation is opt-in. Start Pi with:

```bash
pi -e npm:pi-goal --goal-continuation
```

Optional cap:

```bash
pi -e npm:pi-goal --goal-continuation --goal-continuation-max-turns 3
```

Continuation only queues when the goal is active, Pi is idle, and no pending user messages exist. It rechecks the goal ID before starting and stops on no progress, completion, pause, clear, replacement, user interrupt, duplicate queue, busy state, disabled flag, pending messages, or max-turn cap.

## Known gaps versus Codex

- No Codex SQLite `thread_goals` table or app-server RPC compatibility. Pi uses session custom entries instead.
- No exact Codex token budget or wall-clock accounting. Pi uses an opt-in max-turn cap and progress checks.
- No exact Codex goal menu or bottom-pane UI. Pi uses footer status, widgets, command output, and tool renderers.
- No general model `update_goal` tool. This is intentional, to prevent silent objective or scope rewrites.
- Live TUI lifecycle checks for `/compact`, `/reload`, `/resume`, `/tree`, and `/fork` are manual smoke coverage. Record that evidence before release, or mark the release blocked. Automated tests cover the underlying hooks and reconstruction behavior, not the live TUI itself.

## Troubleshooting

| Symptom                                                  | What to do                                                                                                                                                                                                                   |
| -------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/goal import` says the path is outside the workspace    | The requested path or its realpath resolved outside the workspace, including symlink escapes. Run from the workspace root or move/copy the source file inside it.                                                            |
| `/goal import` requires `--yes`                          | Non-interactive mode cannot show confirmation. Review the source docs, then rerun with `--yes`. Directory imports fail if supported docs exceed the configured `maxFiles`; narrow the path or raise the limit in code/tests. |
| Replacing a goal fails in non-interactive mode           | Rerun `/goal <objective> --replace`.                                                                                                                                                                                         |
| `/goal edit` fails                                       | The editor is interactive-only. Use `/goal <objective> --replace` instead.                                                                                                                                                   |
| Hidden context or UI looks stale after branch navigation | Run `/goal status`; state is reconstructed from the selected branch. If it is wrong, inspect recent `goal-state` custom entries in the session.                                                                              |
| Continuation does not start                              | Confirm Pi was launched with `--goal-continuation`, the goal is active, Pi is idle, and there are no pending user messages.                                                                                                  |

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
