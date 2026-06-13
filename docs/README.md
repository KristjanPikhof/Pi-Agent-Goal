# Pi `/goal` docs

Start with the root [`README.md`](../README.md). It has the install path, command reference, model tools, autonomy behavior, known Codex gaps, and troubleshooting.

Use these docs when you need more detail:

| Doc                                                | Use it for                                                                                                                           |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| [`setup.md`](setup.md)                             | Install options, settings.json examples, one-off runs, and local checkout development.                                               |
| [`implementation.md`](implementation.md)           | Architecture reference for state, commands, import, tools, context, compaction, continuation, UI, and intentional Codex parity gaps. |
| [`acceptance-criteria.md`](acceptance-criteria.md) | Release checklist, validation commands, automated coverage status, and manual TUI smoke checklist.                                   |

## Release facts to keep true

- Release version: `2026.6.14`.
- Runtime: Node.js `>=22.19.0`.
- Pi peer dependencies: open `*` ranges.
- Development validation: Pi packages `^0.79.3`.
- Package contents: `extensions`, `src`, `README.md`, `docs`, and `LICENSE`.
- Docs links: relative, so they work in GitHub and npm tarballs.

## Shipped behavior

- Branch-aware goal state stored in Pi session custom entries named `goal-state`.
- `/goal` lifecycle for drafting, review, start, status, edit, pause, resume, complete, clear, and import.
- Plain `/goal <objective>` asks the chat agent to draft through `propose_goal_draft`; Start/Edit/Cancel review runs before anything is saved.
- Markdown/text PRD and docs-folder import with workspace realpath checks, symlink escape rejection, size/binary checks, generated/vendor ignores, and directory overflow errors.
- Import creates a goal when none exists, then merges source docs, constraints, and criteria into an existing active goal without rewriting the objective.
- Narrow model tools: `get_goal`, `create_goal`, `propose_goal_draft`, `complete_goal`, and `update_goal_progress`.
- Hidden active-goal context and `session_before_compact` preservation.
- Compact active-goal widget, readable `/goal status`, actionable errors, and concise tool renderers.
- Opt-in idle continuation behind `--goal-continuation`.

## Verification

Use the canonical validation list in [`acceptance-criteria.md`](acceptance-criteria.md#validation-commands). Live TUI lifecycle smoke is still manual and release-blocking; use the checklist in [`acceptance-criteria.md`](acceptance-criteria.md#manual-session-lifecycle-smoke-checklist).

## Future work

Strict Codex compatibility is not part of this rollout. That includes app-server RPC compatibility, SQLite persistence, exact token/time accounting, and Codex's exact goal menu UI.
